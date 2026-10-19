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
      // "WA-JS is broken" and "you are signed out" are different problems and
      // must not share an answer. Reporting the first as the second pauses the
      // campaign with "WhatsApp Web is not logged in" while a signed-in
      // session sits on screen, which sends the founder looking in the wrong
      // place — and a WhatsApp update breaking WA-JS is the failure the README
      // tells him to expect.
      //
      // No WPP at all means the bundle did not take. The three-tick grace in
      // background.js covers WhatsApp Web still loading, but nothing covers
      // WA-JS being permanently broken, so that has to arrive as a failure.
      if (!window.WPP) {
        return reply({
          outcome: "failed",
          error: "WA-JS did not initialise on this page",
        });
      }
      // WPP is there but not ready: this one really is a session that is not
      // signed in, or is still coming up.
      if (!window.WPP.isReady) return reply({ outcome: "logged_out" });

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

        // The text first, on its own, then one message per file in the order
        // the server listed them.
        //
        // WHY NOT ONE FILE CARRYING THE TEXT AS ITS CAPTION
        //
        // WhatsApp allows a caption on one attachment, so two files would mean
        // either a caption the second file cannot have or the text buried
        // under a picture. Three plain messages is what the founder chose.
        //
        // WHY A FAILURE HERE IS STILL A FAILURE
        //
        // If the text goes and a file does not, this throws and the recipient
        // is recorded failed, even though one message arrived. That is the
        // honest answer: /result records the number as messaged only on
        // `sent`, so a part-sent prospect stays off re_outreach_sent_phones
        // and can be reached again, and three in a row trip the dead-man
        // switch — which is exactly what should happen if attachments have
        // started failing.
        await window.WPP.chat.sendTextMessage(exists.wid, msg.text, {
          createChat: true,
        });

        for (const file of msg.attachments || []) {
          // The signed URL lives ten minutes and is fetched from the page, so
          // it is a plain cross-origin GET to Supabase Storage.
          const blob = await fetch(file.url).then((r) => {
            if (!r.ok) throw new Error(`Could not download ${file.fileName}`);
            return r.blob();
          });
          // A Blob from fetch() has no name, and a document with no name
          // reaches the recipient as "file". Rebuild it as a File so the name
          // and the type are both explicit rather than inferred.
          const asFile = new File([blob], file.fileName || "attachment", {
            type: blob.type || file.mimeType || "application/octet-stream",
          });
          await window.WPP.chat.sendFileMessage(exists.wid, asFile, {
            // "image" shows as a photo in the chat, "document" as a file card.
            type: file.kind === "image" ? "image" : "document",
            filename: file.fileName,
            createChat: true,
          });
          // A human does not paste three things into a chat in the same
          // instant. The gap between RECIPIENTS is the server's business; this
          // one is inside a single conversation and belongs here.
          await new Promise((r) => setTimeout(r, 1500 + Math.random() * 1500));
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
