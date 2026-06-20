// Talks to the Trust Agent server. In dev, Vite proxies /api to the server
// (see vite.config.js); in prod, set VITE_API_URL or serve behind one origin.
const BASE = import.meta.env.VITE_API_URL || "/api";
const TOKEN = import.meta.env.VITE_API_TOKEN || "";

function headers(json = true) {
  const h = {};
  if (json) h["Content-Type"] = "application/json";
  if (TOKEN) h["Authorization"] = `Bearer ${TOKEN}`;
  return h;
}

export async function listAssessments() {
  const r = await fetch(`${BASE}/assessments`, { headers: headers(false) });
  if (!r.ok) throw new Error("Failed to load assessments");
  return r.json();
}

export async function assess(input) {
  const r = await fetch(`${BASE}/assess`, { method: "POST", headers: headers(), body: JSON.stringify(input) });
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw new Error(e.error || `Assessment failed (${r.status})`);
  }
  return r.json();
}

export async function deleteAssessment(id) {
  const r = await fetch(`${BASE}/assessments/${id}`, { method: "DELETE", headers: headers(false) });
  if (!r.ok) throw new Error("Delete failed");
}
