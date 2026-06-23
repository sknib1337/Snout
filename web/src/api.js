// Talks to the Snout server. In dev, Vite proxies /api to the server
// (see vite.config.js); in prod, set VITE_API_URL or serve behind one origin.
// When built with VITE_DEMO=true, all calls are served from local seed data
// (no server, no API key) so the UI can be demoed offline.
const BASE = import.meta.env.VITE_API_URL || "/api";
const AUTH_BASE = BASE.replace(/\/api$/, "") + "/auth";
const TOKEN = import.meta.env.VITE_API_TOKEN || "";
const DEMO = import.meta.env.VITE_DEMO === "true";

function headers(json = true) {
  const h = {};
  if (json) h["Content-Type"] = "application/json";
  if (TOKEN) h["Authorization"] = `Bearer ${TOKEN}`;
  return h;
}

// Send cookies so an OIDC session (set by /auth/callback) authorizes API calls.
// Harmless when bearer-token auth is used instead.
const cred = { credentials: "include" };

// --- Auth (OIDC dashboard login) -------------------------------------------
// Reports whether OIDC is enabled and whether the current session cookie is valid.
export async function getAuth() {
  if (DEMO) return { oidcEnabled: false, authenticated: true };
  try {
    const r = await fetch(`${AUTH_BASE}/me`, { ...cred });
    if (!r.ok) return { oidcEnabled: false, authenticated: false };
    return r.json();
  } catch { return { oidcEnabled: false, authenticated: false }; }
}
export function loginUrl() { return `${AUTH_BASE}/login`; }
export async function logout() {
  if (DEMO) return;
  try { await fetch(`${AUTH_BASE}/logout`, { method: "POST", ...cred }); } catch { /* ignore */ }
}

// --- Demo mode (offline) ---------------------------------------------------
let _demo = null;
async function demoState() {
  if (!_demo) {
    const m = await import("./demo.js");
    _demo = { assessments: [...m.DEMO_ASSESSMENTS], discovered: [...m.DEMO_DISCOVERED], synth: m.demoSynthesize };
  }
  return _demo;
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export async function listAssessments() {
  if (DEMO) { const d = await demoState(); return [...d.assessments].sort((a, b) => +new Date(b.assessedAt) - +new Date(a.assessedAt)); }
  const r = await fetch(`${BASE}/assessments`, { headers: headers(false), ...cred });
  if (!r.ok) throw new Error("Failed to load assessments");
  return r.json();
}

export async function assess(input) {
  if (DEMO) { const d = await demoState(); await wait(1400); const rec = d.synth(input); d.assessments = [rec, ...d.assessments]; return rec; }
  const r = await fetch(`${BASE}/assess`, { method: "POST", headers: headers(), ...cred, body: JSON.stringify(input) });
  if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error || `Assessment failed (${r.status})`); }
  return r.json();
}

export async function deleteAssessment(id) {
  if (DEMO) { const d = await demoState(); d.assessments = d.assessments.filter((a) => a.id !== id); return; }
  const r = await fetch(`${BASE}/assessments/${id}`, { method: "DELETE", headers: headers(false), ...cred });
  if (!r.ok) throw new Error("Delete failed");
}

export async function getFeatures() {
  if (DEMO) return { catalog: true };
  try {
    const r = await fetch(`${BASE}/config`, { headers: headers(false), ...cred });
    if (!r.ok) return { catalog: true };
    return (await r.json()).features || { catalog: true };
  } catch { return { catalog: true }; }
}

// Operator readiness for the honest status badge + setup checklist (EPIC-ACTIVATION).
// Returns null when the backend is unreachable so the UI can show "offline".
export async function getReadiness() {
  if (DEMO) return { assessReady: true, provider: "demo", model: "demo", webSearch: true, store: "demo", catalog: true, webhooks: true, oidc: false };
  try {
    const r = await fetch(`${BASE}/config`, { headers: headers(false), ...cred });
    if (!r.ok) return null;
    return (await r.json()).readiness || null;
  } catch { return null; }
}

// --- Discovered apps (from the browser extension / catalog pipeline) ---

export async function listDiscovered() {
  if (DEMO) { const d = await demoState(); return [...d.discovered].sort((a, b) => b.lastSeen - a.lastSeen); }
  const r = await fetch(`${BASE}/catalog`, { headers: headers(false), ...cred });
  if (!r.ok) throw new Error("Failed to load discovered apps");
  return r.json();
}

export async function assessDiscovered(domain) {
  if (DEMO) {
    const d = await demoState(); await wait(1400);
    const app = d.discovered.find((a) => a.domain === domain);
    const rec = d.synth({ name: app?.name || domain, vendor: app?.name });
    d.assessments = [rec, ...d.assessments];
    if (app) { app.assessmentId = rec.id; app.assessment = { id: rec.id, score: rec.score, recommendation: rec.recommendation }; }
    return rec;
  }
  const r = await fetch(`${BASE}/catalog/${encodeURIComponent(domain)}/assess`, { method: "POST", headers: headers(), ...cred });
  if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error || `Assessment failed (${r.status})`); }
  return r.json();
}

// --- Monitoring alerts (breach/CVE feed + control regressions) ---

export async function listAlerts() {
  if (DEMO) return [];
  try {
    const r = await fetch(`${BASE}/alerts`, { headers: headers(false), ...cred });
    if (!r.ok) return [];
    return r.json();
  } catch { return []; }
}

// --- Knowledge base (verify / override a control fact) ---

export async function listKb() {
  if (DEMO) return [];
  try {
    const r = await fetch(`${BASE}/kb`, { headers: headers(false), ...cred });
    if (!r.ok) return [];
    return r.json();
  } catch { return []; }
}

export async function verifyControl(key, control, body) {
  if (DEMO) { await wait(300); return { ok: true }; }
  const r = await fetch(`${BASE}/kb/${encodeURIComponent(key)}/${encodeURIComponent(control)}`, {
    method: "POST", headers: headers(), ...cred, body: JSON.stringify(body),
  });
  if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error || `Verify failed (${r.status})`); }
  return r.json();
}

export async function deleteDiscovered(domain) {
  if (DEMO) { const d = await demoState(); d.discovered = d.discovered.filter((a) => a.domain !== domain); return; }
  const r = await fetch(`${BASE}/catalog/${encodeURIComponent(domain)}`, { method: "DELETE", headers: headers(false), ...cred });
  if (!r.ok) throw new Error("Delete failed");
}
