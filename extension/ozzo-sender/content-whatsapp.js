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

// MAIN world: WA-JS has to reach WhatsApp's own modules, which an isolated
// content-script world cannot see.
function injectBundle() {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = BUNDLE_URL;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("WA-JS failed to load"));
    (document.head || document.documentElement).appendChild(script);
  });
}

// The page and this script cannot share objects, so everything goes through
// window.postMessage with a page-side shim injected as source text.
const PAGE_SHIM = `
(() => {
  const ready = () => window.WPP && window.WPP.isReady;

  window.addEventListener("message", async (event) => {
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
      reply({ outcome: "failed", error: String(error && error.message || error) });
    }
  });
})();
`;

function injectShim() {
  const script = document.createElement("script");
  script.textContent = PAGE_SHIM;
  (document.head || document.documentElement).appendChild(script);
  script.remove();
}

let nextId = 1;
function askPage(op, payload) {
  return new Promise((resolve) => {
    const id = nextId++;
    const onMessage = (event) => {
      const msg = event.data;
      if (!msg || msg.__ozzo !== "response" || msg.id !== id) return;
      window.removeEventListener("message", onMessage);
      resolve(msg);
    };
    window.addEventListener("message", onMessage);
    window.postMessage({ __ozzo: "request", id, op, ...payload }, "*");
    // A send that never answers must not hang the loop for ever.
    setTimeout(() => {
      window.removeEventListener("message", onMessage);
      resolve({ outcome: "failed", error: "WhatsApp Web did not answer" });
    }, 60_000);
  });
}

chrome.runtime.onMessage.addListener((request, _sender, respond) => {
  askPage(request.op, request).then(respond);
  return true; // keep the channel open for the async reply
});

(async () => {
  try {
    await injectBundle();
    injectShim();
  } catch (error) {
    console.error("[OZZO Sender]", error);
  }
})();
