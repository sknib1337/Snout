-- Snout Postgres store — reference schema.
--
-- The application creates these tables automatically on first use (idempotent
-- CREATE TABLE IF NOT EXISTS, see server/src/store.pg.ts). This file is provided
-- so operators can pre-provision the schema, review it, or harden it.
--
-- ISOLATION MODEL: every table has a leading `tenant` column and the application
-- includes `WHERE tenant = $1` on every read and write. The rich domain object is
-- stored as JSONB (mirroring the JSON store) with the columns needed to scope,
-- key, and sort. A tenant therefore can never read or write another tenant's rows.

CREATE TABLE IF NOT EXISTS snout_assessments (
  tenant      text NOT NULL,
  id          text NOT NULL,
  app         text NOT NULL,
  assessed_at timestamptz NOT NULL DEFAULT now(),
  data        jsonb NOT NULL,
  PRIMARY KEY (tenant, id)
);
-- One current assessment per app per tenant (upsertByApp conflict target).
CREATE UNIQUE INDEX IF NOT EXISTS snout_assessments_app ON snout_assessments (tenant, lower(app));

CREATE TABLE IF NOT EXISTS snout_discovered (
  tenant    text NOT NULL,
  domain    text NOT NULL,
  last_seen bigint NOT NULL DEFAULT 0,
  data      jsonb NOT NULL,
  PRIMARY KEY (tenant, domain)
);

CREATE TABLE IF NOT EXISTS snout_kb (
  tenant text NOT NULL,
  domain text NOT NULL,
  data   jsonb NOT NULL,
  PRIMARY KEY (tenant, domain)
);

CREATE TABLE IF NOT EXISTS snout_alerts (
  tenant text NOT NULL,
  id     text NOT NULL,
  ts     bigint NOT NULL,
  data   jsonb NOT NULL,
  PRIMARY KEY (tenant, id)
);

CREATE TABLE IF NOT EXISTS snout_audit (
  tenant text NOT NULL,
  id     text NOT NULL,
  ts     bigint NOT NULL,
  data   jsonb NOT NULL,
  PRIMARY KEY (tenant, id)
);

-- OPTIONAL DEFENSE-IN-DEPTH: Postgres row-level security. The application already
-- scopes by tenant in every query; enabling RLS adds a database-enforced backstop.
-- To use it, run the server with a non-superuser role and set
--   SET app.tenant = '<tenant>';
-- per connection, then enable policies like:
--
--   ALTER TABLE snout_assessments ENABLE ROW LEVEL SECURITY;
--   CREATE POLICY tenant_isolation ON snout_assessments
--     USING (tenant = current_setting('app.tenant', true));
--
-- (Repeat per table.) This is not enabled by default because it requires the
-- connection-level GUC wiring above.
