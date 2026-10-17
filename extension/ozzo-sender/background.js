// The loop: ask, send, report, sleep as long as you were told.
//
// It holds the token and nothing else. Every number in this file came from the
// server's answer, not from here.

const ALARM = "ozzo-tick";

async function config() {
  const { token, baseUrl } = await chrome.storage.local.get(["token", "baseUrl"]);
  return { token, baseUrl: baseUrl || "https://app.ozzo.co.in" };
}

async function whatsappTab() {
  const tabs = await chrome.tabs.query({ url: "https://web.whatsapp.com/*" });
  return tabs[0] || null;
}

async function ask(tab, op, payload = {}) {
  return chrome.tabs.sendMessage(tab.id, { op, ...payload });
}

async function post(path, body) {
  const { token, baseUrl } = await config();
  if (!token) throw new Error("No agent token set");
  const response = await fetch(`${baseUrl}/api/admin/revenue/outreach/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-ozzo-agent-token": token },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const error = new Error(`${path} returned ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return response.json();
}

function sleep(seconds) {
  // chrome.alarms is the only timer that survives the service worker being
  // evicted, which Chrome does within seconds of idle. A setTimeout here would
  // silently never fire and the campaign would stop with no error anywhere.
  chrome.alarms.create(ALARM, { delayInMinutes: Math.max(seconds, 1) / 60 });
}

const LOGGED_OUT_GRACE = 3; // ~3 minutes at the 60s sleep below

async function onLoggedOut() {
  // The count lives in storage, not in a variable: Chrome evicts an idle
  // service worker between alarms, so a variable would reset to zero every tick
  // and the threshold would never be reached.
  const { loggedOutTicks = 0 } = await chrome.storage.local.get("loggedOutTicks");
  const ticks = loggedOutTicks + 1;
  await chrome.storage.local.set({ loggedOutTicks: ticks });

  // Only once we are confident it is a real logout, not WhatsApp Web still
  // loading. Sending an empty senderPhone is what tells the server to pause
  // the campaign and show the founder why nothing is going out. The equality
  // (not >=) reports once per logout episode.
  if (ticks === LOGGED_OUT_GRACE) {
    await post("next", { senderPhone: "" }).catch(() => {});
  }
  sleep(60);
}

async function tick() {
  const tab = await whatsappTab();
  if (!tab) {
    await onLoggedOut();
    return;
  }

  const me = await ask(tab, "whoami");
  if (!me || !me.phone) {
    await onLoggedOut();
    return;
  }
  await chrome.storage.local.set({ loggedOutTicks: 0 });

  const decision = await post("next", { senderPhone: me.phone });

  if (decision.kind === "wait") {
    // Any reason: throttled, a skipped recipient, a possible duplicate, a test
    // message still to come. A short wait is normal, not an error.
    sleep(decision.waitSeconds);
    return;
  }
  if (decision.kind !== "send") {
    // paused or done: stop asking until the founder restarts it.
    return;
  }

  const result = await ask(tab, "send", {
    phone: decision.phone,
    text: decision.text,
    attachmentUrl: decision.attachmentUrl,
  });

  try {
    await post("result", {
      recipientId: decision.recipientId,
      outcome: result.outcome,
      error: result.error,
      // Every outcome carries the sender's number: the server uses it to spot
      // a changed WhatsApp login and restart the warm-up ramp. Leave it out and
      // the daily cap stays pinned at the day-one value for ever.
      senderPhone: me.phone,
    });
  } catch (error) {
    // 409 means the server never issued a send for this recipient (a replay or
    // a bug). It is terminal. Retrying would only hammer the endpoint, so log
    // it and go on to the next /next call.
    if (error.status === 409) {
      console.warn("[OZZO] result rejected with 409, not retrying", decision.recipientId);
    } else {
      throw error;
    }
  }

  // Ask again straight away — the server decides the gap, not this file.
  sleep(1);
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== ALARM) return;
  tick().catch((error) => {
    console.error("[OZZO]", error);
    // 401/403 means the token is gone — retrying cannot help, so stop and let
    // the founder mint a new one. Everything else (a dropped connection, a
    // 5xx, a sleeping laptop) is transient, and stopping on it would end the
    // campaign silently, which is how a run dies without anyone noticing.
    if (error && (error.status === 401 || error.status === 403)) return;
    sleep(60);
  });
});

chrome.runtime.onMessage.addListener((request, _sender, respond) => {
  if (request.op === "start") {
    tick().then(() => respond({ ok: true })).catch((e) => respond({ error: String(e) }));
    return true;
  }
  if (request.op === "stop") {
    chrome.alarms.clear(ALARM).then(() => respond({ ok: true }));
    return true;
  }
});
