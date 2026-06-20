const $ = (id) => document.getElementById(id);
const send = (msg) => new Promise((res) => chrome.runtime.sendMessage(msg, res));
const lines = (s) => s.split("\n").map((x) => x.trim()).filter(Boolean);

async function init() {
  const db = await send({ type: "getDb" });
  const s = db.settings || {};
  $("corp").value = (s.corpIdpDomains || []).join("\n");
  $("sanctioned").value = (s.sanctionedApps || []).join("\n");
  $("ignore").value = (s.ignoreDomains || []).join("\n");
  $("ta-url").value = s.trustAgentUrl || "";
  $("ta-token").value = s.trustAgentToken || "";
  $("autosync").value = s.autoSyncMinutes || 0;
}

$("save").addEventListener("click", async () => {
  await send({
    type: "saveSettings",
    settings: {
      corpIdpDomains: lines($("corp").value),
      sanctionedApps: lines($("sanctioned").value),
      ignoreDomains: lines($("ignore").value),
      trustAgentUrl: $("ta-url").value.trim(),
      trustAgentToken: $("ta-token").value.trim(),
      autoSyncMinutes: Math.max(0, parseInt($("autosync").value, 10) || 0),
    },
  });
  $("status").textContent = "Saved ✓";
  setTimeout(() => ($("status").textContent = ""), 1800);
});

init();
