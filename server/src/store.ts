import { promises as fs } from "fs";
import path from "path";
import { config } from "./config";
import { Assessment, DiscoveredApp, KbVendor, ControlFact, ControlKey, Alert, AuditEntry } from "./controls";
import { DiscoveredUpsert, applyDiscoveredUpsert } from "./store.shared";
import { currentTenant } from "./tenant";

export type { DiscoveredUpsert } from "./store.shared";

export interface Store {
  // assessments
  list(): Promise<Assessment[]>;
  get(id: string): Promise<Assessment | undefined>;
  upsertByApp(record: Assessment): Promise<Assessment>;
  remove(id: string): Promise<void>;
  // discovered apps (from the extension / catalog webhooks)
  listDiscovered(): Promise<DiscoveredApp[]>;
  getDiscovered(domain: string): Promise<DiscoveredApp | undefined>;
  upsertDiscovered(app: DiscoveredUpsert): Promise<DiscoveredApp>;
  removeDiscovered(domain: string): Promise<void>;
  linkAssessment(domain: string, assessmentId: string): Promise<void>;
  // knowledge-base overrides (human verify/override; merged over repo kb/ files)
  listKbOverrides(): Promise<KbVendor[]>;
  getKbOverride(domain: string): Promise<KbVendor | undefined>;
  upsertKbControl(domain: string, vendor: string, control: ControlKey, fact: ControlFact): Promise<KbVendor>;
  // continuous-monitoring alerts (breach/CVE feed + detected control regressions)
  listAlerts(): Promise<Alert[]>;
  addAlert(alert: Alert): Promise<Alert>;
  removeAlert(id: string): Promise<void>;
  // audit log of mutating API calls (who/what/outcome)
  listAudit(): Promise<AuditEntry[]>;
  addAudit(entry: AuditEntry): Promise<void>;
}

/**
 * JsonStore — zero-dependency persistence for getting started and small teams.
 * It is SINGLE-TENANT: the tenant context is ignored. For multi-tenant
 * deployments set DATABASE_URL to switch to the Postgres store, which scopes
 * every row by tenant. Both implement the same Store interface.
 */
class JsonStore implements Store {
  private aFile = path.join(config.dataDir, "assessments.json");
  private dFile = path.join(config.dataDir, "discovered.json");
  private kFile = path.join(config.dataDir, "kb.json");
  private alFile = path.join(config.dataDir, "alerts.json");
  private auFile = path.join(config.dataDir, "audit.json");
  private aCache: Assessment[] | null = null;
  private dCache: DiscoveredApp[] | null = null;
  private kCache: KbVendor[] | null = null;
  private alCache: Alert[] | null = null;
  private auCache: AuditEntry[] | null = null;

  private async read<T>(file: string): Promise<T[]> {
    try { return JSON.parse(await fs.readFile(file, "utf8")); } catch { return []; }
  }
  private async write(file: string, data: unknown) {
    await fs.mkdir(config.dataDir, { recursive: true });
    await fs.writeFile(file, JSON.stringify(data, null, 2));
  }
  private async loadA() { return (this.aCache ??= await this.read<Assessment>(this.aFile)); }
  private async loadD() { return (this.dCache ??= await this.read<DiscoveredApp>(this.dFile)); }

  async list() {
    return [...(await this.loadA())].sort((a, b) => +new Date(b.assessedAt) - +new Date(a.assessedAt));
  }
  async get(id: string) { return (await this.loadA()).find((a) => a.id === id); }
  async upsertByApp(record: Assessment) {
    const list = await this.loadA();
    this.aCache = [record, ...list.filter((a) => a.app.toLowerCase() !== record.app.toLowerCase())];
    await this.write(this.aFile, this.aCache);
    return record;
  }
  async remove(id: string) {
    this.aCache = (await this.loadA()).filter((a) => a.id !== id);
    await this.write(this.aFile, this.aCache);
  }

  async listDiscovered() {
    return [...(await this.loadD())].sort((a, b) => b.lastSeen - a.lastSeen);
  }
  async getDiscovered(domain: string) { return (await this.loadD()).find((a) => a.domain === domain); }

  async upsertDiscovered(incoming: DiscoveredUpsert) {
    const list = await this.loadD();
    const i = list.findIndex((a) => a.domain === incoming.domain);
    const merged = applyDiscoveredUpsert(i === -1 ? undefined : list[i], incoming, Date.now());
    if (i === -1) this.dCache = [merged, ...list];
    else { list[i] = merged; this.dCache = list; }
    await this.write(this.dFile, this.dCache);
    return merged;
  }
  async removeDiscovered(domain: string) {
    this.dCache = (await this.loadD()).filter((a) => a.domain !== domain);
    await this.write(this.dFile, this.dCache);
  }
  async linkAssessment(domain: string, assessmentId: string) {
    const list = await this.loadD();
    const app = list.find((a) => a.domain === domain);
    if (app) { app.assessmentId = assessmentId; this.dCache = list; await this.write(this.dFile, list); }
  }

  private async loadK() { return (this.kCache ??= await this.read<KbVendor>(this.kFile)); }
  async listKbOverrides() { return [...(await this.loadK())]; }
  async getKbOverride(domain: string) { return (await this.loadK()).find((v) => v.domain === domain); }
  async upsertKbControl(domain: string, vendor: string, control: ControlKey, fact: ControlFact) {
    const list = await this.loadK();
    const now = new Date().toISOString();
    let v = list.find((x) => x.domain === domain);
    if (!v) { v = { vendor: vendor || domain, domain, updatedAt: now, controls: {} }; list.push(v); }
    if (vendor) v.vendor = vendor;
    v.controls[control] = fact;
    v.updatedAt = now;
    this.kCache = list;
    await this.write(this.kFile, list);
    return v;
  }

  private async loadAl() { return (this.alCache ??= await this.read<Alert>(this.alFile)); }
  async listAlerts() { return [...(await this.loadAl())].sort((a, b) => b.ts - a.ts); }
  async addAlert(alert: Alert) {
    const list = await this.loadAl();
    this.alCache = [alert, ...list].slice(0, 500); // bound the store
    await this.write(this.alFile, this.alCache);
    return alert;
  }
  async removeAlert(id: string) {
    this.alCache = (await this.loadAl()).filter((a) => a.id !== id);
    await this.write(this.alFile, this.alCache);
  }

  private async loadAu() { return (this.auCache ??= await this.read<AuditEntry>(this.auFile)); }
  async listAudit() { return [...(await this.loadAu())].sort((a, b) => b.ts - a.ts); }
  async addAudit(entry: AuditEntry) {
    const list = await this.loadAu();
    this.auCache = [entry, ...list].slice(0, 2000); // bound the store
    await this.write(this.auFile, this.auCache);
  }
}

// --- Store selection + per-tenant scoping --------------------------------
// JSON (default, zero-config, single-tenant) vs Postgres (DATABASE_URL set,
// multi-tenant with row-level scoping). getStore(tenant) returns the backend
// for a tenant; the exported `store` facade resolves the current request's
// tenant per call (via AsyncLocalStorage) so existing call sites need no change.

const jsonStore = new JsonStore();
const pgStores = new Map<string, Store>();

export function getStore(tenant: string = currentTenant()): Store {
  if (!config.databaseUrl) return jsonStore; // single-tenant JSON backend
  let s = pgStores.get(tenant);
  if (!s) {
    // Lazy require so `pg` and the pool are only loaded when actually used.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createPgStore } = require("./store.pg") as typeof import("./store.pg");
    s = createPgStore(tenant);
    pgStores.set(tenant, s);
  }
  return s;
}

const STORE_METHODS: (keyof Store)[] = [
  "list", "get", "upsertByApp", "remove",
  "listDiscovered", "getDiscovered", "upsertDiscovered", "removeDiscovered", "linkAssessment",
  "listKbOverrides", "getKbOverride", "upsertKbControl",
  "listAlerts", "addAlert", "removeAlert",
  "listAudit", "addAudit",
];

// Facade: every call is dispatched to the backend for the current tenant. In
// JSON mode this is always the single JsonStore; in Postgres mode it is the
// tenant-scoped PgStore for whichever tenant owns the active request.
export const store: Store = STORE_METHODS.reduce((acc, name) => {
  acc[name] = ((...args: unknown[]) => (getStore() as unknown as Record<string, (...a: unknown[]) => unknown>)[name](...args)) as never;
  return acc;
}, {} as Store);
