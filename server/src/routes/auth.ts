import { Router } from "express";
import { config } from "../config";
import { beginLogin, completeLogin, mintSession, readSession, readCookie, SESSION_COOKIE, TX_COOKIE } from "../oidc";

export const auth = Router();

const baseCookie = {
  httpOnly: true as const,
  sameSite: "lax" as const,
  secure: config.isProd,
  path: "/",
};

// Reconstruct the exact callback URL from the REGISTERED redirect_uri plus the
// query the IdP appended — so it always matches what was registered, regardless
// of proxy host/scheme rewriting.
function callbackUrl(query: Record<string, unknown>): string {
  const u = new URL(config.oidcRedirectUri);
  for (const [k, v] of Object.entries(query)) if (typeof v === "string") u.searchParams.set(k, v);
  return u.href;
}

/** Start the OIDC login: stash PKCE/state/nonce in a signed cookie, redirect to the IdP. */
auth.get("/login", async (_req, res, next) => {
  if (!config.oidcEnabled) return res.status(501).json({ error: "OIDC login is not configured" });
  try {
    const { url, tx } = await beginLogin();
    res.cookie(TX_COOKIE, tx, { ...baseCookie, maxAge: 10 * 60 * 1000 });
    res.redirect(url);
  } catch (e) { next(e); }
});

/** IdP redirect target: validate, mint a session cookie, bounce back to the app. */
auth.get("/callback", async (req, res) => {
  if (!config.oidcEnabled) return res.status(501).json({ error: "OIDC login is not configured" });
  try {
    const claims = await completeLogin(callbackUrl(req.query as Record<string, unknown>), readCookie(req, TX_COOKIE));
    const session = await mintSession(claims);
    res.clearCookie(TX_COOKIE, baseCookie);
    res.cookie(SESSION_COOKIE, session, { ...baseCookie, maxAge: 8 * 60 * 60 * 1000 });
    res.redirect(config.appBaseUrl);
  } catch {
    // Never leak the IdP/validation error detail to the browser.
    res.clearCookie(TX_COOKIE, baseCookie);
    res.redirect(`${config.appBaseUrl}/?login=failed`);
  }
});

/** Clear the session cookie. */
auth.post("/logout", (_req, res) => {
  res.clearCookie(SESSION_COOKIE, baseCookie);
  res.status(204).end();
});

/** Report login state so the SPA can show a Sign-in button / current user. */
auth.get("/me", async (req, res) => {
  const token = readCookie(req, SESSION_COOKIE);
  const session = token ? await readSession(token) : null;
  res.json({
    oidcEnabled: config.oidcEnabled,
    authenticated: !!session,
    role: session?.role,
    tenant: session?.tenant,
    email: session?.email,
  });
});
