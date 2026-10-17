// The loop: ask, send, report, sleep as long as you were told.
//
// It holds the token and nothing else. Every number in this file came from the
// server's answer, not from here.

const ALARM = "ozzo-tick";

// How long to wait before asking again when the server says the campaign is
// paused or finished. The loop must NOT stop: the founder presses Start in the
// portal, not here, and an auto-pause (sender mismatch, logged out, three
// failures) would otherwise end the run for good with the portal still
// showing "running" after he resumes it. Matches the server's own
// MAX_POLL_WAIT_SEC, which exists so a mid-campaign edit takes effect within
// ten minutes.
const IDLE_POLL_SEC = 600;

// A tick may not overlap another tick. Two in flight both read the counters
// before either claims, so both are told to send and two messages go out with
// no gap — defeating the randomised gap, which is the main anti-ban control.
//
// It has to outlast the slowest possible tick, which is not just one 60s page
// call: askPage's 60s applies to whoami too, the shim handshake can burn 15s
// per tab, and there are two HTTP round trips on top. Four minutes covers two
// unresponsive tabs plus a slow send. Too long is safe (the loop waits);
// too short re-opens the overlap.
const LEASE_MS = 240_000;

async function config() {
  const { token, baseUrl } = await chrome.storage.local.get(["token", "baseUrl"]);
  return { token, baseUrl: (baseUrl || "https://app.ozzo.co.in").replace(/\/+$/, "") };
}

async function whatsappTab() {
  // Every matching tab, not just the first: with two WhatsApp Web tabs open
  // only one holds the session, and picking the dead one would report a
  // logged-out WhatsApp while a live session sits in the other tab.
  const tabs = await chrome.tabs.query({ url: "https://web.whatsapp.com/*" });
  return tabs;
}

async function ask(tab, op, payload = {}) {
  const reply = await chrome.tabs.sendMessage(tab.id, { op, ...payload });
  // Only a TRANSPORT failure throws: the page never answered at all — a shim
  // blocked by CSP, a bundle that failed to load, or a send still running past
  // 60s. There is no result to report in that case, and reporting a guess
  // would be worse than reporting nothing.
  //
  // It must not be confused with {outcome:"failed", error}, which is WhatsApp
  // telling us a real send genuinely failed. That has to reach /result: it is
  // what shows the founder the actual error, and what feeds the three-strike
  // pause that stops a restricted session being pushed towards a ban. Testing
  // a bare `error` key swallowed all of those, because the shim's failure
  // reply carries both fields.
  if (reply && reply.__transportError) throw new Error(reply.__transportError);
  return reply;
}

async function post(path, body) {
  const { token, baseUrl } = await config();
  if (!token) {
    // Terminal, like a 401: no amount of retrying mints a token. Carrying the
    // status makes the alarm handler stop instead of looping every minute.
    const error = new Error("No agent token set");
    error.status = 401;
    throw error;
  }
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

async function isRunning() {
  const { running = false } = await chrome.storage.local.get("running");
  return running;
}

async function sleep(seconds) {
  // chrome.alarms is the only timer that survives the service worker being
  // evicted, which Chrome does within seconds of idle. A setTimeout here would
  // silently never fire and the campaign would stop with no error anywhere.
  //
  // Nothing is armed once Stop has been pressed: clearing the pending alarm is
  // not enough on its own, because a tick already in flight finishes and would
  // arm the next one behind the founder's back.
  if (!(await isRunning())) return;
  chrome.alarms.create(ALARM, { delayInMinutes: Math.max(seconds, 1) / 60 });
}

const LOGGED_OUT_GRACE = 3; // ~3 minutes at the 60s sleep below

async function onLoggedOut() {
  // The count lives in storage, not in a variable: Chrome evicts an idle
  // service worker between alarms, so a variable would reset to zero every tick
  // and the threshold would never be reached.
  const { loggedOutTicks = 0, loggedOutReported = false } =
    await chrome.storage.local.get(["loggedOutTicks", "loggedOutReported"]);
  const ticks = loggedOutTicks + 1;
  await chrome.storage.local.set({ loggedOutTicks: ticks });

  // Only once we are confident it is a real logout, not WhatsApp Web still
  // loading. Sending an empty senderPhone is what tells the server to pause
  // the campaign and show the founder why nothing is going out.
  //
  // `>=` with a reported flag set only AFTER the POST resolves, not equality
  // before it: one dropped POST at exactly tick 3 used to mean the founder was
  // never told at all, and the extension then polled in silence for ever —
  // the precise failure this counter exists to prevent.
  if (ticks >= LOGGED_OUT_GRACE && !loggedOutReported) {
    await post("next", { senderPhone: "" });
    await chrome.storage.local.set({ loggedOutReported: true });
  }
  await sleep(60);
}

async function tick() {
  // One tick at a time. Start and a firing alarm both land here, and an alarm
  // chain can still be live when the founder presses Start again.
  //
  // The lease carries an owner so that only the tick still holding it can
  // release it: a tick that overran its lease must not clear the lease of the
  // tick that replaced it, or the exclusion stays broken instead of healing.
  const now = Date.now();
  const mine = `${now}-${Math.random().toString(36).slice(2)}`;
  const { leaseUntil = 0 } = await chrome.storage.local.get("leaseUntil");
  if (leaseUntil > now) {
    // Ask again rather than returning: this alarm is consumed, and the only
    // other thing that arms one is the tick holding the lease. If that tick
    // dies with the worker, a bare return would end the run in silence with
    // the portal still showing a running campaign.
    await sleep(30);
    return;
  }
  await chrome.storage.local.set({ leaseUntil: now + LEASE_MS, leaseOwner: mine });

  try {
    const tabs = await whatsappTab();
    let tab = null;
    let me = null;
    let answered = false;
    let askError = null;
    for (const candidate of tabs) {
      try {
        const who = await ask(candidate, "whoami");
        // A reply at all means the shim is alive and WhatsApp itself answered.
        // No phone in it means genuinely signed out.
        answered = true;
        if (who && who.phone) {
          tab = candidate;
          me = who;
          break;
        }
      } catch (error) {
        // This tab could not answer; try the next one before giving up.
        askError = error;
      }
    }

    // Tabs are open but not one of them could answer: the bundle or the shim
    // failed to load, not a logged-out WhatsApp. Reporting a logout here would
    // pause every running campaign with "WhatsApp Web is not logged in" while
    // a signed-in session sits on screen, and the founder would have no way to
    // tell the two apart. Throw so the real reason is recorded and retried.
    if (!tab && tabs.length > 0 && !answered) {
      throw askError ?? new Error("WhatsApp Web did not answer");
    }

    if (!tab) {
      await onLoggedOut();
      return;
    }
    await chrome.storage.local.set({ loggedOutTicks: 0, loggedOutReported: false });

    const decision = await post("next", { senderPhone: me.phone });

    if (decision.kind === "wait") {
      // Any reason: throttled, a skipped recipient, a possible duplicate, a test
      // message still to come. A short wait is normal, not an error.
      await sleep(decision.waitSeconds);
      return;
    }
    if (decision.kind !== "send") {
      // Paused or done. Keep asking slowly rather than stopping: the founder
      // restarts the campaign in the portal, and nothing there would tell him
      // he also has to come back here and press Start.
      await sleep(IDLE_POLL_SEC);
      return;
    }

    // Last check before the one irreversible act in this file. Stop must mean
    // stop even if it was pressed while this tick was waiting on the server.
    //
    // The row is already claimed and stamped at this point, so it cannot just
    // be dropped: it would sit in flight until the sweep and then be recorded
    // as a possible duplicate, burning a prospect who was never messaged. Hand
    // it back instead.
    if (!(await isRunning())) {
      await post("result", {
        recipientId: decision.recipientId,
        outcome: "abandoned",
        senderPhone: me.phone,
      }).catch((error) => {
        // Nothing left to do about it here — the sweep and the duplicate guard
        // are the backstop. Record it so the founder is not guessing.
        console.warn("[OZZO] could not hand back", decision.recipientId, error);
      });
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
    await sleep(1);
  } finally {
    const { leaseOwner } = await chrome.storage.local.get("leaseOwner");
    if (leaseOwner === mine) {
      await chrome.storage.local.set({ leaseUntil: 0, leaseOwner: null });
    }
  }
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== ALARM) return;
  tick().catch(async (error) => {
    console.error("[OZZO]", error);
    await chrome.storage.local.set({ lastError: String(error && error.message) });
    // 401/403 means the token is gone — retrying cannot help, so stop and let
    // the founder mint a new one. Everything else (a dropped connection, a
    // 5xx, a sleeping laptop) is transient, and stopping on it would end the
    // campaign silently, which is how a run dies without anyone noticing.
    if (error && (error.status === 401 || error.status === 403)) {
      await chrome.storage.local.set({ running: false });
      return;
    }
    await sleep(60);
  });
});

chrome.runtime.onMessage.addListener((request, _sender, respond) => {
  if (request.op === "start") {
    (async () => {
      // NOT leaseUntil. Start is what the founder presses when nothing seems
      // to be happening, and a tick waiting on a slow send is exactly when it
      // seems that way. Clearing the lease here handed that live tick's
      // exclusion away, so the armed alarm ran a second tick alongside it and
      // two prospects were messaged seconds apart. The lease expires on its
      // own; leave it alone.
      await chrome.storage.local.set({
        running: true,
        lastError: "",
        loggedOutTicks: 0,
        loggedOutReported: false,
      });
      // Arm the alarm rather than ticking inline, so Start can never run
      // alongside an alarm chain that is already going.
      await sleep(1);
    })()
      .then(() => respond({ ok: true }))
      .catch((e) => respond({ error: String(e) }));
    return true;
  }
  if (request.op === "stop") {
    (async () => {
      // The flag first: a tick already in flight checks it before sending and
      // before arming the next alarm, so Stop takes effect on the first press.
      await chrome.storage.local.set({ running: false });
      await chrome.alarms.clear(ALARM);
    })()
      .then(() => respond({ ok: true }))
      .catch((e) => respond({ error: String(e) }));
    return true;
  }
});

// A service worker is evicted constantly and Chrome restarts it for an alarm,
// but a browser restart leaves nothing armed. If the founder left it running,
// pick the loop back up.
chrome.runtime.onStartup.addListener(() => {
  isRunning().then((on) => {
    if (on) chrome.alarms.create(ALARM, { delayInMinutes: 1 });
  });
});
