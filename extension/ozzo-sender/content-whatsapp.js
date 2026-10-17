// Injects WA-JS into the page and sends exactly what the server tells it to.
//
// WHY WA-JS AND NOT TYPING INTO THE BOX
//
// Finding the message box in the DOM and simulating keystrokes is how most of
// these tools work, and it is why most of them are dangerous: the selectors
// break on every WhatsApp redesign, and the failure mode is not an error, it
// is the right text in the wrong chat. WA-JS calls WhatsApp's own internal
// send functions instead.
//
// This script decides nothing. It does not know the cap, the window, the gap
// or the template.

const BUNDLE_URL = chrome.runtime.getURL("vendor/wppconnect-wa.js");
const SHIM_URL = chrome.runtime.getURL("page-shim.js");

// MAIN world: WA-JS has to reach WhatsApp's own modules, which an isolated
// content-script world cannot see.
//
// Both of these are loaded by src from web_accessible_resources, never as
// inline text. web.whatsapp.com enforces a nonce-based CSP with no
// 'unsafe-inline', so an inline script is silently refused — see the comment
// at the top of page-shim.js.
function injectByUrl(url, what) {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = url;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`${what} failed to load`));
    (document.head || document.documentElement).appendChild(script);
  });
}

// The page and this script cannot share objects, so everything goes through
// window.postMessage. The shim posts `shim-ready` once its listener is live;
// without that handshake a shim that never ran would be indistinguishable
// from a logged-out WhatsApp, which is the wrong thing to tell the founder.
function waitForShim() {
  return new Promise((resolve, reject) => {
    const onReady = (event) => {
      if (event.source !== window) return;
      if (!event.data || event.data.__ozzo !== "shim-ready") return;
      window.removeEventListener("message", onReady);
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      window.removeEventListener("message", onReady);
      reject(new Error("The page shim did not start (blocked by WhatsApp Web's CSP?)"));
    }, 15_000);
    window.addEventListener("message", onReady);
  });
}

// Each of these is injected at most ONCE per page while it is working, and a
// retry is allowed only where a retry is actually safe.
//
// A load that REJECTED put nothing in the page, so retrying it is safe and
// necessary — one failed fetch of the bundle would otherwise brick that tab
// for the life of the page, with every tick replaying the same error and only
// a tab reload to recover. What must never be repeated is a load that
// SUCCEEDED: re-running WA-JS against WhatsApp's internals, or appending a
// second shim, is not a retry, it is a duplicate.
//
// The shim handshake is retried too, because its 15s timeout can fire while
// the file is merely slow — a sleeping laptop or a frozen tab is enough — so
// the shim may be alive even though the handshake rejected. That retry is safe
// ONLY because page-shim.js installs itself once and re-announces ready if it
// is already there. Without that guard the retry would append a second
// listener, both would answer one send request, and every prospect from then
// on would get two messages. Do not remove either guard without the other.
let bundleLoaded = null;
let shimLoaded = null;

function ensureReady() {
  if (!bundleLoaded) {
    bundleLoaded = injectByUrl(BUNDLE_URL, "WA-JS").catch((error) => {
      bundleLoaded = null;
      throw error;
    });
  }
  if (!shimLoaded) {
    shimLoaded = (async () => {
      await bundleLoaded;
      // Listener first: the shim announces itself as it runs, and a handshake
      // registered after the injection could miss it.
      const started = waitForShim();
      // If the injection itself fails, nothing will ever resolve `started`;
      // swallow its later rejection so it is not an unhandled one in the page
      // console, and let the injection error be the one that propagates.
      started.catch(() => {});
      await injectByUrl(SHIM_URL, "The page shim");
      await started;
    })().catch((error) => {
      shimLoaded = null;
      throw error;
    });
  }
  return shimLoaded;
}

let nextId = 1;
function askPage(op, payload) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    const onMessage = (event) => {
      // Ignores other windows and frames only. A script in this same page can
      // still forge a response; this is not a security boundary.
      if (event.source !== window) return;
      const msg = event.data;
      if (!msg || msg.__ozzo !== "response" || msg.id !== id) return;
      window.removeEventListener("message", onMessage);
      clearTimeout(timer);
      resolve(msg);
    };
    window.addEventListener("message", onMessage);
    window.postMessage({ __ozzo: "request", id, op, ...payload }, "*");

    // A send that never answers must REJECT, not resolve as failed.
    //
    // WPP.chat.sendTextMessage is still running in the page when this fires,
    // and it may yet succeed — a socket reconnect can push one send past a
    // minute. Reporting "failed" for a message that then goes out is the worst
    // outcome available: /result only records the number in
    // re_outreach_sent_phones on `sent`, so the prospect would be messaged
    // again by the next campaign, and the false failure would also feed the
    // three-strike dead-man switch.
    //
    // Rejecting means the loop posts no result at all. The row stays in_flight,
    // the stale sweep requeues it, and /next's existing guard
    // (attempts > 1 && rendered_text != null) marks it "Possible duplicate: a
    // send was issued but never confirmed. Not resent." That is the honest
    // answer, and it is already built.
    const timer = setTimeout(() => {
      window.removeEventListener("message", onMessage);
      reject(new Error(`WhatsApp Web did not answer "${op}" within 60s`));
    }, 60_000);
  });
}

chrome.runtime.onMessage.addListener((request, _sender, respond) => {
  ensureReady()
    .then(() => askPage(request.op, request))
    .then(respond)
    // __transportError, never "error": the shim's own failure result carries
    // BOTH outcome and error, so a bare "error" key could not be told apart
    // from a genuine {outcome:"failed", error} reply. That ambiguity made the
    // loop throw away every real WhatsApp send failure instead of reporting
    // it, which also starved the three-strike dead-man switch.
    .catch((error) =>
      respond({ __transportError: String((error && error.message) || error) }),
    );
  return true;
});
