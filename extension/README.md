# Trust Agent — Shadow SaaS & Auth Capture (Chrome extension)

Discovers the SaaS apps you actually log into and **how** you authenticate to them,
so you can find shadow IT and shadow auth: local passwords, consumer/social IdP
logins, and OAuth consent grants that bypass your sanctioned corporate SSO.

It is **local-first** — everything stays in your browser until you explicitly export
or send an app to Trust Agent.

## What it captures

For each app domain you authenticate to:
- **Auth method** — Corporate SSO (sanctioned), Social/consumer IdP, an unrecognized
  federated IdP, or a local password form.
- **OAuth grants** — the IdP, client, and requested scopes when an OAuth/OIDC
  `authorize` flow runs.
- First/last seen.

It records **only** domains and auth signals — never passwords, field values, page
content, or full URLs with query strings beyond the OAuth metadata above.

## How it works

- A background service worker watches top-level navigations (`webNavigation`) and
  classifies OAuth/OIDC `authorize` and SAML flows: the IdP host decides whether it's
  sanctioned SSO, social, or unknown-federated; the `redirect_uri` (or the page you
  came from) identifies the app.
- A content script notices when you submit a password form on a non-IdP site and
  reports just the hostname — the signal that the app accepts local credentials
  instead of SSO.
- A domain is **shadow** unless it's on your sanctioned-apps list or it authenticated
  through a corporate IdP you configured.

## Install (unpacked)

1. `chrome://extensions` → enable **Developer mode**.
2. **Load unpacked** → select this `extension/` folder.
3. Open the extension's **Options** and set your **Corporate IdP hosts** (e.g.
   `yourco.okta.com`, `login.microsoftonline.com`) and sanctioned app domains.
   Without these, every login looks unsanctioned.

The toolbar badge shows the current shadow-app count.

## Connect to Trust Agent

In Options, set the **Trust Agent URL** (e.g. `https://trust-agent.yourco.com`) and,
if the server has `API_TOKEN` set, the **API token**. Then:

- **Sync** (popup footer) bulk-pushes every discovered app to `POST /api/catalog`. They
  appear in the dashboard's **Discovered** view, where each can be assessed in place
  (`POST /api/catalog/:domain/assess`, which links the result back to the discovered app).
- **Assess in Trust Agent** (per app) runs a single assessment directly via `/api/assess`.

The extension holds host permission for all sites, so these cross-origin calls work
without server CORS changes.

## Managed deployment (Chrome Enterprise, zero-touch)

For fleet rollout, force-install the extension via Google Admin console (or Windows
GPO / macOS plist) and push configuration so employees never touch the options page.
The extension reads `chrome.storage.managed` against `managed_schema.json` and seeds
itself; managed values win over local settings, and `autoSyncMinutes` enables periodic
background sync.

Example managed configuration (Admin console → the extension → "Policy for extensions"):

```json
{
  "corpIdpDomains": { "Value": ["yourco.okta.com", "login.microsoftonline.com"] },
  "sanctionedApps": { "Value": ["salesforce.com", "atlassian.net"] },
  "trustAgentUrl":  { "Value": "https://trust-agent.yourco.com" },
  "trustAgentToken":{ "Value": "REDACTED" },
  "autoSyncMinutes":{ "Value": 30 }
}
```

**Feasibility notes (docs vs. reality):**
- `chrome.storage.managed` only populates when the extension is installed under
  enterprise management; unmanaged sideloads fall back to the options page.
- `host_permissions: <all_urls>` plus a password-form content script will draw scrutiny
  in any security review and in Chrome Web Store review — distribute as a **private/
  unlisted** Web Store item or self-host the CRX and force-install by ID.
- Pushing `trustAgentToken` via policy is convenient but puts a bearer token on every
  endpoint; prefer a short-lived/per-fleet token and rotate it, or terminate auth at an
  ingress the extension reaches without a token.
- `autoSyncMinutes` is clamped to a 5-minute floor by the Chrome alarms API.

## Permissions

- `storage` — local catalog + settings.
- `webNavigation` — observe auth-flow navigations.
- `alarms` — periodic auto-sync when configured.
- `storage.managed` — read enterprise policy (zero-touch config).
- `host_permissions: <all_urls>` — required to observe logins across the SaaS you use
  and to call your Trust Agent server. The extension never sends browsing data anywhere
  on its own.
