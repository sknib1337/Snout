import { registrableDomain, guessName, parseAuth, classifyIdp, isSanctioned } from "./classify.js";

const DEFAULT_SETTINGS = {
  corpIdpDomains: [],     // your sanctioned IdP hosts, e.g. ["yourco.okta.com","login.microsoftonline.com"]
  sanctionedApps: [],     // explicitly approved app domains
  ignoreDomains: [],      // never record these
  trustAgentUrl: "",      // e.g. https://trust-agent.yourco.com
  trustAgentToken: "",
  paused: false,
};

const tabContext = {}; // tabId -> last non-auth app domain the user was on

async function load() {
  const { db } = await chrome.storage.local.get("db");
  return db || { apps: {}, settings: { ...DEFAULT_SETTINGS } };
}
async function save(db) {
  await chrome.storage.local.set({ db });
  updateBadge(db);
}

function updateBadge(db) {
  const shadow = Object.values(db.apps).filter((a) => !isSanctioned(a, db.settings)).length;
  chrome.action.setBadgeText({ text: shadow ? String(shadow) : "" });
  chrome.action.setBadgeBackgroundColor({ color: "#e11d48" });
}

function ignored(domain, settings) {
  return (settings.ignoreDomains || []).some((d) => domain === d || domain.endsWith("." + d));
}

function ensureApp(db, domain) {
  if (!db.apps[domain]) {
    db.apps[domain] = {
      domain, name: guessName(domain), firstSeen: Date.now(), lastSeen: Date.now(), visits: 0,
      methods: { sso: false, social: false, password: false, federated: false, oauthGrant: false },
      idps: [], oauth: [],
    };
  }
  return db.apps[domain];
}

// --- Capture auth flows from top-level navigations -------------------------

chrome.webNavigation.onBeforeNavigate.addListener(async (d) => {
  if (d.frameId !== 0) return;
  const db = await load();
  if (db.settings.paused) return;

  const auth = parseAuth(d.url);
  if (!auth) {
    // Remember where the user is, so we can attribute a later auth redirect to it.
    try {
      const host = new URL(d.url).hostname;
      if (host) tabContext[d.tabId] = registrableDomain(host);
    } catch { /* ignore */ }
    return;
  }

  // The app being authenticated = redirect_uri domain, else the page we came from.
  const appDomain = auth.appDomain || tabContext[d.tabId];
  if (!appDomain) return;
  if (ignored(appDomain, db.settings)) return;
  // Don't catalog an IdP as if it were an app.
  if (classifyIdp(appDomain, db.settings.corpIdpDomains) !== "other") { /* still allow, but rare */ }

  const idpClass = classifyIdp(auth.idpHost, db.settings.corpIdpDomains);
  const app = ensureApp(db, appDomain);
  app.lastSeen = Date.now();
  if (!app.idps.includes(auth.idpHost)) app.idps.unshift(auth.idpHost);
  app.idps = app.idps.slice(0, 6);

  if (idpClass === "corp") app.methods.sso = true;
  else if (idpClass === "consumer") app.methods.social = true;
  else if (idpClass === "enterprise") app.methods.federated = true;
  else app.methods.federated = true;

  if (auth.kind === "oauth" && (auth.scopes.length || auth.clientId)) {
    app.methods.oauthGrant = true;
    app.oauth.unshift({ idp: auth.idpHost, clientId: auth.clientId, scopes: auth.scopes, ts: Date.now() });
    app.oauth = app.oauth.slice(0, 10);
  }
  await save(db);
});

// --- Capture local credential entry (content script) -----------------------

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    const db = await load();
    if (msg.type === "localAuth") {
      if (db.settings.paused) return sendResponse({ ok: true });
      const host = msg.host || (sender.tab && new URL(sender.tab.url).hostname);
      if (!host) return sendResponse({ ok: false });
      const domain = registrableDomain(host);
      if (ignored(domain, db.settings)) return sendResponse({ ok: true });
      // A password form on an IdP host is the IdP's own login, not shadow auth.
      if (classifyIdp(host, db.settings.corpIdpDomains) !== "other") return sendResponse({ ok: true });
      const app = ensureApp(db, domain);
      app.methods.password = true;
      app.lastSeen = Date.now();
      await save(db);
      return sendResponse({ ok: true });
    }
    if (msg.type === "getDb") return sendResponse(db);
    if (msg.type === "ignore") {
      delete db.apps[msg.domain];
      if (!db.settings.ignoreDomains.includes(msg.domain)) db.settings.ignoreDomains.push(msg.domain);
      await save(db); return sendResponse({ ok: true });
    }
    if (msg.type === "clearAll") { db.apps = {}; await save(db); return sendResponse({ ok: true }); }
    if (msg.type === "setPaused") { db.settings.paused = !!msg.paused; await save(db); return sendResponse({ ok: true }); }
    if (msg.type === "saveSettings") { db.settings = { ...db.settings, ...msg.settings }; await save(db); return sendResponse({ ok: true }); }
    if (msg.type === "assess") {
      try { const r = await assessInTrustAgent(db, msg.domain); sendResponse({ ok: true, result: r }); }
      catch (e) { sendResponse({ ok: false, error: e.message }); }
      return;
    }
    sendResponse({ ok: false });
  })();
  return true; // async response
});

async function assessInTrustAgent(db, domain) {
  const s = db.settings;
  if (!s.trustAgentUrl) throw new Error("Set the Trust Agent URL in Options first.");
  const app = db.apps[domain];
  const methods = Object.entries(app.methods).filter(([, v]) => v).map(([k]) => k).join(", ") || "none observed";
  const res = await fetch(s.trustAgentUrl.replace(/\/$/, "") + "/api/assess", {
    method: "POST",
    headers: { "content-type": "application/json", ...(s.trustAgentToken ? { authorization: "Bearer " + s.trustAgentToken } : {}) },
    body: JSON.stringify({
      name: app.name,
      url: "https://" + app.domain,
      context: `Discovered via browser extension. Observed auth methods: ${methods}. IdPs: ${app.idps.join(", ") || "n/a"}.`,
    }),
  });
  if (!res.ok) throw new Error(`Trust Agent responded ${res.status}`);
  return res.json();
}

chrome.tabs?.onRemoved.addListener((tabId) => { delete tabContext[tabId]; });
chrome.runtime.onInstalled.addListener(async () => { const db = await load(); await save(db); });
