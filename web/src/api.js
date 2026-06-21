// Talks to the Snout server. In dev, Vite proxies /api to the server
// (see vite.config.js); in prod, set VITE_API_URL or serve behind one origin.
// When built with VITE_DEMO=true, all calls are served from local seed data
// (no server, no API key) so the UI can be demoed offline.
const BASE = import.meta.env.VITE_API_URL || "/api";
const TOKEN = import.meta.env.VITE_API_TOKEN || "";
const DEMO = import.meta.env.VITE_DEMO === "true";

function headers(json = true) {
  const h = {};
  if (json) h["Content-Type"] = "application/json";
  if (TOKEN) h["Authorization"] = `Bearer ${TOKEN}`;
  return h;
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
  const r = await fetch(`${BASE}/assessments`, { headers: headers(false) });
  if (!r.ok) throw new Error("Failed to load assessments");
  return r.json();
}

export async function assess(input) {
  if (DEMO) { const d = await demoState(); await wait(1400); const rec = d.synth(input); d.assessments = [rec, ...d.assessments]; return rec; }
  const r = await fetch(`${BASE}/assess`, { method: "POST", headers: headers(), body: JSON.stringify(input) });
  if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error || `Assessment failed (${r.status})`); }
  return r.json();
}

export async function deleteAssessment(id) {
  if (DEMO) { const d = await demoState(); d.assessments = d.assessments.filter((a) => a.id !== id); return; }
  const r = await fetch(`${BASE}/assessments/${id}`, { method: "DELETE", headers: headers(false) });
  if (!r.ok) throw new Error("Delete failed");
}

export async function getFeatures() {
  if (DEMO) return { catalog: true };
  try {
    const r = await fetch(`${BASE}/config`, { headers: headers(false) });
    if (!r.ok) return { catalog: true };
    return (await r.json()).features || { catalog: true };
  } catch { return { catalog: true }; }
}

// --- Discovered apps (from the browser extension / catalog pipeline) ---

export async function listDiscovered() {
  if (DEMO) { const d = await demoState(); return [...d.discovered].sort((a, b) => b.lastSeen - a.lastSeen); }
  const r = await fetch(`${BASE}/catalog`, { headers: headers(false) });
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
  const r = await fetch(`${BASE}/catalog/${encodeURIComponent(domain)}/assess`, { method: "POST", headers: headers() });
  if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error || `Assessment failed (${r.status})`); }
  return r.json();
}

// --- Knowledge base (verify / override a control fact) ---

export async function verifyControl(key, control, body) {
  if (DEMO) { await wait(300); return { ok: true }; }
  const r = await fetch(`${BASE}/kb/${encodeURIComponent(key)}/${encodeURIComponent(control)}`, {
    method: "POST", headers: headers(), body: JSON.stringify(body),
  });
  if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error || `Verify failed (${r.status})`); }
  return r.json();
}

export async function deleteDiscovered(domain) {
  if (DEMO) { const d = await demoState(); d.discovered = d.discovered.filter((a) => a.domain !== domain); return; }
  const r = await fetch(`${BASE}/catalog/${encodeURIComponent(domain)}`, { method: "DELETE", headers: headers(false) });
  if (!r.ok) throw new Error("Delete failed");
}
