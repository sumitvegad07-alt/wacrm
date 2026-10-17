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
  // Install once per page, whatever happens.
  //
  // The content script retries injection when the ready handshake times out,
  // and that timeout can fire while this file's own load is merely slow — a
  // sleeping laptop or a frozen tab is enough. The shim then runs anyway, and
  // the retry appends a SECOND copy. Two listeners both answer one send
  // request, so WhatsApp sends the same message twice while only one reply is
  // read: the prospect gets two messages and the portal records one. After the
  // first occurrence that is the steady state for the rest of the page's life.
  //
  // Re-announcing ready is what lets the retrying content script carry on with
  // the listener that is already here.
  if (window.__ozzoShimInstalled) {
    window.postMessage({ __ozzo: "shim-ready" }, "*");
    return;
  }
  window.__ozzoShimInstalled = true;

  const ready = () => window.WPP && window.WPP.isReady;

  window.addEventListener("message", async (event) => {
    // Ignore other windows and frames. This does NOT make the channel
    // trustworthy: any script in this same page, WhatsApp's own code included,
    // can still post a request or forge a response. Worth having, but it is
    // not a security boundary.
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
