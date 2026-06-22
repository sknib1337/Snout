import { AsyncLocalStorage } from "async_hooks";
import { config } from "./config";

// Per-request tenant context. A `withTenant` middleware runs each request inside
// run(tenant, ...) so that any code it calls — routes, the agent, the store
// facade — resolves the right tenant without threading a parameter through every
// call site. Background jobs (pollers, scheduler) run OUTSIDE any request context,
// so currentTenant() falls back to the operator's default tenant.
export const tenantContext = new AsyncLocalStorage<string>();

export function currentTenant(): string {
  return tenantContext.getStore() || config.tenantId;
}

export function runAsTenant<T>(tenant: string, fn: () => T): T {
  return tenantContext.run(tenant || config.tenantId, fn);
}
