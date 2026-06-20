// Detects when a user enters credentials directly into a site (i.e., the app
// accepts a local password instead of enforcing SSO). Reports only the hostname
// to the service worker — never the password or any field values.
(function () {
  let reported = false;
  function report() {
    if (reported) return;
    reported = true;
    try { chrome.runtime.sendMessage({ type: "localAuth", host: location.hostname }); } catch (_) {}
    setTimeout(() => { reported = false; }, 30000); // allow re-report after 30s
  }

  // Standard form submit containing a password field.
  document.addEventListener("submit", (e) => {
    try {
      const f = e.target;
      if (f && f.querySelector && f.querySelector('input[type="password"]')) report();
    } catch (_) {}
  }, true);

  // JS-driven logins: a click on a submit-like control while a non-empty password exists.
  document.addEventListener("click", (e) => {
    try {
      const pw = document.querySelector('input[type="password"]');
      if (!pw || !pw.value) return;
      const t = e.target.closest && e.target.closest('button,[type="submit"],input[type="submit"],a');
      if (!t) return;
      const txt = (t.innerText || t.value || "").toLowerCase();
      if (/log ?in|sign ?in|continue|submit|next|access/.test(txt)) report();
    } catch (_) {}
  }, true);
})();
