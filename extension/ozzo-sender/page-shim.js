// Runs in the PAGE world, where window.WPP exists.
//
// WHY THIS IS A FILE AND NOT AN INLINE STRING
//
// web.whatsapp.com sends an ENFORCED Content-Security-Policy whose script-src
// is nonce-based and has no 'unsafe-inline':
//
//   script-src blob: 'self' 'nonce-XXXXXXXX' 'report-sample'
//              https://static.whatsapp.net 'unsafe-eval' https://*.fbcdn.net ...
//
// A <script> whose body is assigned with textContent carries no nonce, so the
// page refuses to run it. The refusal is quiet: the console shows one CSP
// line, no page-side listener is ever registered, and every askPage() call
// then times out and looks exactly like a logged-out WhatsApp. The campaign
// gets paused with "WhatsApp Web is not logged in" while a logged-in session
// sits on screen.
//
// A script loaded from a chrome-extension:// URL listed in the manifest's
// web_accessible_resources is exempt from the page's CSP, which is why
// injecting the WA-JS bundle by src has always worked. This file is injected
// the same way. Do not inline it again.
(() => {
  const ready = () => window.WPP && window.WPP.isReady;

  window.addEventListener("message", async (event) => {
    // Only this page may drive the shim. Without this check any script running
    // on web.whatsapp.com could post a request and have a message sent, or
    // forge a response and resolve a pending send early.
    if (event.source !== window) return;

    const msg = event.data;
    if (!msg || msg.__ozzo !== "request") return;

    const reply = (payload) =>
      window.postMessage({ __ozzo: "response", id: msg.id, ...payload }, "*");

    try {
      if (!ready()) return reply({ outcome: "logged_out" });

      if (msg.op === "whoami") {
        const me = window.WPP.whatsapp.UserPrefs.getMaybeMeUser();
        return reply({ phone: me ? me.user : "" });
      }

      if (msg.op === "send") {
        const exists = await window.WPP.contact.queryWidExists(msg.phone);
        if (!exists || !exists.wid) return reply({ outcome: "skipped_not_on_whatsapp" });

        if (await window.WPP.blocklist.isBlocked(exists.wid)) {
          return reply({ outcome: "skipped_blocked" });
        }

        if (msg.attachmentUrl) {
          const blob = await fetch(msg.attachmentUrl).then((r) => r.blob());
          await window.WPP.chat.sendFileMessage(exists.wid, blob, {
            type: "document",
            caption: msg.text,
            createChat: true,
          });
        } else {
          await window.WPP.chat.sendTextMessage(exists.wid, msg.text, {
            createChat: true,
          });
        }
        return reply({ outcome: "sent" });
      }

      reply({ outcome: "failed", error: "Unknown op" });
    } catch (error) {
      reply({ outcome: "failed", error: String((error && error.message) || error) });
    }
  });

  // Tells the content script the listener is live, so a CSP refusal or a
  // failed load is reported as itself instead of as a logged-out WhatsApp.
  window.postMessage({ __ozzo: "shim-ready" }, "*");
})();
