import type { Request } from "express";
import { config } from "./config";
import { importESM } from "./esm";
import type { Role } from "./security/auth";

// openid-client and jose are ESM-only; load them lazily so they are never
// required unless OIDC is actually configured (and so the CommonJS build doesn't
// try to require() an ESM module at load time).
type OidcMod = typeof import("openid-client");
type JoseMod = typeof import("jose");
let oidcP: Promise<OidcMod> | null = null;
let joseP: Promise<JoseMod> | null = null;
const oidc = () => (oidcP ??= importESM<OidcMod>("openid-client"));
const jose = () => (joseP ??= importESM<JoseMod>("jose"));

// Discovered + cached relying-party configuration.
let discoveredP: Promise<unknown> | null = null;
async function rp() {
  const c = await oidc();
  return (discoveredP ??= c.discovery(new URL(config.oidcIssuer), config.oidcClientId, config.oidcClientSecret));
}

const secretKey = () => new TextEncoder().encode(config.sessionSecret);

export const SESSION_COOKIE = "snout_session";
export const TX_COOKIE = "snout_oidc_tx";
const SESSION_TTL = "8h";
const TX_TTL = "10m";

export interface SessionClaims { sub: string; email?: string; role: Role; tenant: string; }
interface LoginTx { code_verifier: string; state: string; nonce: string; }

// --- signed cookies (jose JWT, HS256) ---
async function sign(payload: Record<string, unknown>, ttl: string): Promise<string> {
  const j = await jose();
  return new j.SignJWT(payload).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime(ttl).sign(secretKey());
}
async function verify<T>(token: string): Promise<T | null> {
  try {
    const j = await jose();
    const { payload } = await j.jwtVerify(token, secretKey());
    return payload as T;
  } catch {
    return null;
  }
}

export function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return undefined;
}

// --- login flow ---
/** Build the IdP authorization URL and the signed transaction cookie value. */
export async function beginLogin(): Promise<{ url: string; tx: string }> {
  const c = await oidc();
  const cfg = await rp();
  const code_verifier = c.randomPKCECodeVerifier();
  const code_challenge = await c.calculatePKCECodeChallenge(code_verifier);
  const state = c.randomState();
  const nonce = c.randomNonce();
  const url = c.buildAuthorizationUrl(cfg as never, {
    redirect_uri: config.oidcRedirectUri,
    scope: config.oidcScopes,
    code_challenge,
    code_challenge_method: "S256",
    state,
    nonce,
  }).href;
  const tx = await sign({ code_verifier, state, nonce }, TX_TTL);
  return { url, tx };
}

/** Validate the callback against the transaction cookie and return the ID-token claims. */
export async function completeLogin(currentUrl: string, txCookie: string | undefined): Promise<SessionClaims> {
  if (!txCookie) throw new Error("missing login transaction");
  const tx = await verify<LoginTx>(txCookie);
  if (!tx) throw new Error("invalid or expired login transaction");
  const c = await oidc();
  const cfg = await rp();
  const tokens = await c.authorizationCodeGrant(cfg as never, new URL(currentUrl), {
    pkceCodeVerifier: tx.code_verifier,
    expectedState: tx.state,
    expectedNonce: tx.nonce,
  });
  const claims = tokens.claims() || {};
  return claimsToSession(claims as Record<string, unknown>);
}

function claimsToSession(claims: Record<string, unknown>): SessionClaims {
  const sub = String(claims.sub || "");
  const email = typeof claims.email === "string" ? claims.email : undefined;
  // Role: admin if no admin value is configured (no differentiation), or if the
  // configured role claim contains the admin value. Otherwise read-only viewer.
  let role: Role = "viewer";
  if (!config.oidcAdminValue) {
    role = "admin";
  } else {
    const raw = claims[config.oidcRoleClaim];
    const values = Array.isArray(raw) ? raw.map(String) : raw != null ? [String(raw)] : [];
    if (values.includes(config.oidcAdminValue)) role = "admin";
  }
  let tenant = config.tenantId;
  if (config.oidcTenantClaim && claims[config.oidcTenantClaim] != null) {
    tenant = String(claims[config.oidcTenantClaim]).slice(0, 64);
  }
  return { sub, email, role, tenant };
}

export const mintSession = (s: SessionClaims) => sign({ ...s }, SESSION_TTL);
export const readSession = (token: string) => verify<SessionClaims>(token);
