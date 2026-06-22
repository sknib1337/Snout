import { Pool, PoolClient } from "pg";
import { config } from "./config";
import { Assessment, DiscoveredApp, KbVendor, ControlFact, ControlKey, Alert, AuditEntry } from "./controls";
import { Store } from "./store";
import { DiscoveredUpsert, applyDiscoveredUpsert } from "./store.shared";

const ALERT_CAP = 500;
const AUDIT_CAP = 2000;

// Shared connection pool (one per process). Only constructed when DATABASE_URL
// is set and the Postgres store is actually selected.
let pool: Pool | null = null;
let ready: Promise<void> | null = null;

function getPool(): Pool {
  if (!pool) pool = new Pool({ connectionString: config.databaseUrl });
  return pool;
}

// Idempotent schema. Tables store the rich domain object as JSONB (mirroring the
// JSON store shapes exactly) plus the columns needed to scope, key, and sort.
// Every table is partitioned logically by a leading `tenant` column.
const SCHEMA = `
CREATE TABLE IF NOT EXISTS snout_assessments (
  tenant text NOT NULL, id text NOT NULL, app text NOT NULL,
  assessed_at timestamptz NOT NULL DEFAULT now(), data jsonb NOT NULL,
  PRIMARY KEY (tenant, id)
);
CREATE UNIQUE INDEX IF NOT EXISTS snout_assessments_app ON snout_assessments (tenant, lower(app));
CREATE TABLE IF NOT EXISTS snout_discovered (
  tenant text NOT NULL, domain text NOT NULL, last_seen bigint NOT NULL DEFAULT 0,
  data jsonb NOT NULL, PRIMARY KEY (tenant, domain)
);
CREATE TABLE IF NOT EXISTS snout_kb (
  tenant text NOT NULL, domain text NOT NULL, data jsonb NOT NULL,
  PRIMARY KEY (tenant, domain)
);
CREATE TABLE IF NOT EXISTS snout_alerts (
  tenant text NOT NULL, id text NOT NULL, ts bigint NOT NULL, data jsonb NOT NULL,
  PRIMARY KEY (tenant, id)
);
CREATE TABLE IF NOT EXISTS snout_audit (
  tenant text NOT NULL, id text NOT NULL, ts bigint NOT NULL, data jsonb NOT NULL,
  PRIMARY KEY (tenant, id)
);
`;

function ensureSchema(): Promise<void> {
  return (ready ??= getPool().query(SCHEMA).then(() => undefined));
}

/**
 * Postgres-backed, per-tenant Store. Constructed with a fixed tenant; EVERY query
 * carries `WHERE tenant = $1` so one tenant can never read or write another's rows.
 * Read-modify-write paths (discovered merge, KB control upsert) run in a
 * transaction with SELECT ... FOR UPDATE to stay correct under concurrency.
 */
class PgStore implements Store {
  constructor(private readonly tenant: string) {}

  private async q<T = unknown>(text: string, params: unknown[]): Promise<T[]> {
    await ensureSchema();
    const r = await getPool().query(text, params);
    return r.rows as T[];
  }
  private async tx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
    await ensureSchema();
    const client = await getPool().connect();
    try {
      await client.query("BEGIN");
      const out = await fn(client);
      await client.query("COMMIT");
      return out;
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  }

  // --- assessments ---
  async list(): Promise<Assessment[]> {
    const rows = await this.q<{ data: Assessment }>(
      "SELECT data FROM snout_assessments WHERE tenant=$1 ORDER BY assessed_at DESC", [this.tenant]);
    return rows.map((r) => r.data);
  }
  async get(id: string): Promise<Assessment | undefined> {
    const rows = await this.q<{ data: Assessment }>(
      "SELECT data FROM snout_assessments WHERE tenant=$1 AND id=$2", [this.tenant, id]);
    return rows[0]?.data;
  }
  async upsertByApp(record: Assessment): Promise<Assessment> {
    await this.q(
      `INSERT INTO snout_assessments (tenant, id, app, assessed_at, data)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (tenant, lower(app))
       DO UPDATE SET id=excluded.id, assessed_at=excluded.assessed_at, data=excluded.data`,
      [this.tenant, record.id, record.app, record.assessedAt, record as unknown as object]);
    return record;
  }
  async remove(id: string): Promise<void> {
    await this.q("DELETE FROM snout_assessments WHERE tenant=$1 AND id=$2", [this.tenant, id]);
  }

  // --- discovered ---
  async listDiscovered(): Promise<DiscoveredApp[]> {
    const rows = await this.q<{ data: DiscoveredApp }>(
      "SELECT data FROM snout_discovered WHERE tenant=$1 ORDER BY last_seen DESC", [this.tenant]);
    return rows.map((r) => r.data);
  }
  async getDiscovered(domain: string): Promise<DiscoveredApp | undefined> {
    const rows = await this.q<{ data: DiscoveredApp }>(
      "SELECT data FROM snout_discovered WHERE tenant=$1 AND domain=$2", [this.tenant, domain]);
    return rows[0]?.data;
  }
  async upsertDiscovered(incoming: DiscoveredUpsert): Promise<DiscoveredApp> {
    return this.tx(async (c) => {
      const cur = (await c.query("SELECT data FROM snout_discovered WHERE tenant=$1 AND domain=$2 FOR UPDATE",
        [this.tenant, incoming.domain])).rows[0]?.data as DiscoveredApp | undefined;
      const merged = applyDiscoveredUpsert(cur, incoming, Date.now());
      await c.query(
        `INSERT INTO snout_discovered (tenant, domain, last_seen, data) VALUES ($1,$2,$3,$4)
         ON CONFLICT (tenant, domain) DO UPDATE SET last_seen=excluded.last_seen, data=excluded.data`,
        [this.tenant, merged.domain, merged.lastSeen, merged]);
      return merged;
    });
  }
  async removeDiscovered(domain: string): Promise<void> {
    await this.q("DELETE FROM snout_discovered WHERE tenant=$1 AND domain=$2", [this.tenant, domain]);
  }
  async linkAssessment(domain: string, assessmentId: string): Promise<void> {
    await this.q(
      `UPDATE snout_discovered SET data = jsonb_set(data, '{assessmentId}', to_jsonb($3::text))
       WHERE tenant=$1 AND domain=$2`, [this.tenant, domain, assessmentId]);
  }

  // --- knowledge-base overrides ---
  async listKbOverrides(): Promise<KbVendor[]> {
    const rows = await this.q<{ data: KbVendor }>(
      "SELECT data FROM snout_kb WHERE tenant=$1", [this.tenant]);
    return rows.map((r) => r.data);
  }
  async getKbOverride(domain: string): Promise<KbVendor | undefined> {
    const rows = await this.q<{ data: KbVendor }>(
      "SELECT data FROM snout_kb WHERE tenant=$1 AND domain=$2", [this.tenant, domain]);
    return rows[0]?.data;
  }
  async upsertKbControl(domain: string, vendor: string, control: ControlKey, fact: ControlFact): Promise<KbVendor> {
    return this.tx(async (c) => {
      const cur = (await c.query("SELECT data FROM snout_kb WHERE tenant=$1 AND domain=$2 FOR UPDATE",
        [this.tenant, domain])).rows[0]?.data as KbVendor | undefined;
      const now = new Date().toISOString();
      const v: KbVendor = cur || { vendor: vendor || domain, domain, updatedAt: now, controls: {} };
      if (vendor) v.vendor = vendor;
      v.controls[control] = fact;
      v.updatedAt = now;
      await c.query(
        `INSERT INTO snout_kb (tenant, domain, data) VALUES ($1,$2,$3)
         ON CONFLICT (tenant, domain) DO UPDATE SET data=excluded.data`,
        [this.tenant, domain, v]);
      return v;
    });
  }

  // --- alerts ---
  async listAlerts(): Promise<Alert[]> {
    const rows = await this.q<{ data: Alert }>(
      "SELECT data FROM snout_alerts WHERE tenant=$1 ORDER BY ts DESC", [this.tenant]);
    return rows.map((r) => r.data);
  }
  async addAlert(alert: Alert): Promise<Alert> {
    await this.q(
      `INSERT INTO snout_alerts (tenant, id, ts, data) VALUES ($1,$2,$3,$4)
       ON CONFLICT (tenant, id) DO UPDATE SET ts=excluded.ts, data=excluded.data`,
      [this.tenant, alert.id, alert.ts, alert]);
    await this.q(
      `DELETE FROM snout_alerts WHERE tenant=$1 AND id NOT IN
       (SELECT id FROM snout_alerts WHERE tenant=$1 ORDER BY ts DESC LIMIT $2)`,
      [this.tenant, ALERT_CAP]);
    return alert;
  }
  async removeAlert(id: string): Promise<void> {
    await this.q("DELETE FROM snout_alerts WHERE tenant=$1 AND id=$2", [this.tenant, id]);
  }

  // --- audit ---
  async listAudit(): Promise<AuditEntry[]> {
    const rows = await this.q<{ data: AuditEntry }>(
      "SELECT data FROM snout_audit WHERE tenant=$1 ORDER BY ts DESC", [this.tenant]);
    return rows.map((r) => r.data);
  }
  async addAudit(entry: AuditEntry): Promise<void> {
    await this.q(
      `INSERT INTO snout_audit (tenant, id, ts, data) VALUES ($1,$2,$3,$4)
       ON CONFLICT (tenant, id) DO NOTHING`,
      [this.tenant, entry.id, entry.ts, entry]);
    await this.q(
      `DELETE FROM snout_audit WHERE tenant=$1 AND id NOT IN
       (SELECT id FROM snout_audit WHERE tenant=$1 ORDER BY ts DESC LIMIT $2)`,
      [this.tenant, AUDIT_CAP]);
  }
}

export function createPgStore(tenant: string): Store {
  return new PgStore(tenant);
}
