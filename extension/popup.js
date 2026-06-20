import { posture } from "./classify.js";

let db = { apps: {}, settings: {} };
let filter = "all";

const $ = (id) => document.getElementById(id);
const send = (msg) => new Promise((res) => chrome.runtime.sendMessage(msg, res));

function toast(text) {
  let t = document.querySelector(".toast");
  if (!t) { t = document.createElement("div"); t.className = "toast"; document.body.appendChild(t); }
  t.textContent = text; t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 1800);
}

function methodBadges(app) {
  const m = app.methods, out = [];
  if (m.sso) out.push(`<span class="badge good">Corp SSO</span>`);
  if (m.social) out.push(`<span class="badge warn">Social IdP</span>`);
  if (m.federated && !m.sso) out.push(`<span class="badge warn">Federated</span>`);
  if (m.password) out.push(`<span class="badge bad">Local password</span>`);
  if (m.oauthGrant) out.push(`<span class="badge">OAuth grant</span>`);
  if (!out.length) out.push(`<span class="badge">seen</span>`);
  return out.join("");
}

function render() {
  const apps = Object.values(db.apps);
  const shadow = apps.filter((a) => posture(a, db.settings).tone !== "green");
  const oauth = apps.filter((a) => a.methods.oauthGrant);

  $("s-apps").textContent = apps.length;
  $("s-shadow").textContent = shadow.length;
  $("s-oauth").textContent = oauth.length;
  $("sub").textContent = db.settings.paused ? "paused" : "capturing";
  $("pause").textContent = db.settings.paused ? "▶" : "⏸";

  let rows = apps;
  if (filter === "shadow") rows = shadow;
  if (filter === "oauth") rows = oauth;
  rows = rows.sort((a, b) => b.lastSeen - a.lastSeen);

  $("empty").hidden = rows.length > 0;
  $("list").innerHTML = rows.map((a) => {
    const p = posture(a, db.settings);
    const tone = p.tone === "green" ? "p-green" : p.tone === "red" ? "p-red" : "p-amber";
    const grant = a.oauth[0];
    const scopes = grant && grant.scopes.length
      ? `<div class="scopes">↳ ${escapeHtml(grant.idp)} · scopes: ${escapeHtml(grant.scopes.join(" "))}</div>` : "";
    return `<div class="row" data-d="${escapeAttr(a.domain)}">
      <div class="row-top">
        <div><div class="app">${escapeHtml(a.name)}</div><div class="dom">${escapeHtml(a.domain)}</div></div>
        <span class="posture ${tone}">${p.label}</span>
      </div>
      <div class="methods">${methodBadges(a)}</div>
      ${scopes}
      <div class="row-act">
        <button class="ghost act-assess">Assess in Trust Agent</button>
        <button class="ghost act-ignore">Ignore</button>
      </div>
    </div>`;
  }).join("");

  document.querySelectorAll(".act-assess").forEach((b) =>
    b.addEventListener("click", (e) => onAssess(e.target.closest(".row").dataset.d)));
  document.querySelectorAll(".act-ignore").forEach((b) =>
    b.addEventListener("click", (e) => onIgnore(e.target.closest(".row").dataset.d)));
}

async function onAssess(domain) {
  toast("Assessing… (~30s)");
  const r = await send({ type: "assess", domain });
  if (r?.ok) toast(`Assessed: ${r.result.recommendation} (${r.result.score}/100)`);
  else toast(r?.error || "Assess failed — check Options.");
}
async function onIgnore(domain) { await send({ type: "ignore", domain }); refresh(); }

async function refresh() { db = await send({ type: "getDb" }); render(); }

function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
function escapeAttr(s) { return escapeHtml(s); }

document.querySelectorAll(".chip").forEach((c) =>
  c.addEventListener("click", () => {
    document.querySelectorAll(".chip").forEach((x) => x.classList.remove("active"));
    c.classList.add("active"); filter = c.dataset.f; render();
  }));

$("pause").addEventListener("click", async () => { await send({ type: "setPaused", paused: !db.settings.paused }); refresh(); });
$("options").addEventListener("click", () => chrome.runtime.openOptionsPage());
$("sync").addEventListener("click", async () => {
  toast("Syncing to Trust Agent…");
  const r = await send({ type: "syncCatalog" });
  if (r?.ok) toast(`Synced ${r.accepted} app${r.accepted === 1 ? "" : "s"} to Trust Agent`);
  else toast(r?.error || "Sync failed — set the URL in Options.");
});
$("clear").addEventListener("click", async () => { if (confirm("Clear all captured apps?")) { await send({ type: "clearAll" }); refresh(); } });
$("export").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(Object.values(db.apps), null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `shadow-saas-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
});

chrome.storage.onChanged.addListener(() => refresh());
refresh();
