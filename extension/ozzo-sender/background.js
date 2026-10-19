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

// Slack for a wall clock that steps backwards under a renewed lease. Big
// enough for a routine NTP correction, far smaller than the stall the clamp
// exists to escape.
const CLOCK_SKEW_MS = 60_000;

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

/**
 * Gives a claimed recipient back untried.
 *
 * Called when this tick decided not to send after /next had already claimed
 * and stamped the row - Stop pressed, or the lease lost to another tick.
 * Without it the row sits in flight until the 15-minute sweep and is then
 * recorded as a possible duplicate, burning a prospect who was never
 * messaged.
 */
async function handBack(recipientId, senderPhone) {
  try {
    await post("result", { recipientId, outcome: "abandoned", senderPhone });
  } catch (error) {
    // Nothing left to do about it here, and the sweep plus the duplicate guard
    // are the backstop. But put it where the founder can see it: the row will
    // come back as a possible duplicate and he deserves to know why a prospect
    // he never messaged was burned.
    console.warn("[OZZO] could not hand back", recipientId, error);
    await chrome.storage.local.set({
      lastError:
        "Could not hand recipient " +
        recipientId +
        " back: " +
        ((error && error.message) || error),
    });
  }
}

async function tick() {
  // Nothing to do if Stop has been pressed. The watchdog below can outlive a
  // Stop, and without this check it would claim a recipient only to hand it
  // straight back.
  if (!(await isRunning())) return;

  // A watchdog, armed BEFORE anything else can fail.
  //
  // An alarm is consumed when it fires, and until this tick reaches a sleep()
  // there is no pending alarm at all - which is most of a tick: whoami, /next,
  // the send itself, /result. A fetch does not reset Chrome's idle timer, so
  // that stretch is exactly where the worker gets evicted, and the run would
  // stop in silence with the portal still showing "running". Every normal exit
  // replaces this alarm by name, so it costs nothing and only ever fires for a
  // tick that died. Longer than LEASE_MS, so it cannot race the lease.
  // Awaited so the guarantee above is real rather than nearly real.
  //
  // It MAY fire while its own tick is still going: renewLease() below pushes
  // the lease out as a slow tick progresses, so a tick's effective life is
  // unbounded while the watchdog delay is fixed. That is safe, and is why the
  // lease is what makes it safe rather than the delay: the tick the watchdog
  // starts sees a live lease, backs off with sleep(30), and does no real work.
  await chrome.alarms.create(ALARM, {
    delayInMinutes: (LEASE_MS + 60_000) / 60_000,
  });

  // One tick at a time. Start and a firing alarm both land here, and an alarm
  // chain can still be live when the founder presses Start again.
  //
  // The lease carries an owner so that only the tick still holding it can
  // release it: a tick that overran its lease must not clear the lease of the
  // tick that replaced it, or the exclusion stays broken instead of healing.
  const now = Date.now();
  const mine = `${now}-${Math.random().toString(36).slice(2)}`;
  const { leaseUntil = 0 } = await chrome.storage.local.get("leaseUntil");
  // The second half of that test is the escape hatch. leaseUntil is an
  // absolute timestamp and, since Start stopped clearing it, only the owning
  // tick or the clock passing it can lower it. A clock that jumps backwards -
  // an NTP step, a resume with a bad RTC, the date being changed by hand -
  // would otherwise park a lease years in the future and stall the loop for
  // good, with no way back but wiping extension storage.
  //
  // CLOCK_SKEW_MS of slack, because renewLease() resets the headroom to
  // exactly LEASE_MS on every call. Without the slack a two-second backwards
  // NTP correction makes a freshly renewed lease look stale, and the tick that
  // then takes it runs alongside the live one.
  if (leaseUntil > now && leaseUntil - now <= LEASE_MS + CLOCK_SKEW_MS) {
    // Ask again rather than returning: this alarm is consumed, and the only
    // other thing that arms one is the tick holding the lease. If that tick
    // dies with the worker, a bare return would end the run in silence with
    // the portal still showing a running campaign.
    await sleep(30);
    return;
  }
  await chrome.storage.local.set({ leaseUntil: now + LEASE_MS, leaseOwner: mine });

  /**
   * Pushes the lease out while a slow tick is still genuinely working.
   * Returns false if the lease is no longer ours, which means another tick has
   * taken over and this one must not act.
   */
  const renewLease = async () => {
    const { leaseOwner } = await chrome.storage.local.get("leaseOwner");
    if (leaseOwner !== mine) return false;
    await chrome.storage.local.set({ leaseUntil: Date.now() + LEASE_MS });
    return true;
  };

  try {
    const tabs = await whatsappTab();
    let tab = null;
    let me = null;
    let answered = false;
    let askError = null;
    for (const candidate of tabs) {
      try {
        const who = await ask(candidate, "whoami");

        // WhatsApp itself failing to say who we are is NOT a logout.
        // getMaybeMeUser() can throw when WPP is ready but its internals have
        // moved, and the shim turns that into {outcome:"failed"}. Treating it
        // as signed out would pause every running campaign with "WhatsApp Web
        // is not logged in" while a signed-in session sat on screen - the one
        // diagnosis that sends the founder looking in the wrong place.
        if (who && who.outcome === "failed") {
          throw new Error(who.error || "WhatsApp Web could not say who it is");
        }

        // Only a real answer counts: a phone number, or the shim saying
        // outright that the session is logged out. An undefined reply means
        // nothing answered at all.
        if (who && (typeof who.phone === "string" || who.outcome === "logged_out")) {
          answered = true;
        }

        if (who && who.phone) {
          tab = candidate;
          me = who;
          break;
        }
      } catch (error) {
        // This tab could not answer; try the next one before giving up.
        askError = error;
      }
      // Each tab can cost up to 75s (a 15s shim handshake plus a 60s ask), so
      // a handful of dead tabs would otherwise outlast a fixed lease and let a
      // second tick start alongside this one.
      await renewLease();
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
      await handBack(decision.recipientId, me.phone);
      return;
    }

    // The send is the longest single step; renew before it rather than relying
    // on whatever the lease has left.
    //
    // And if the lease is gone, do not send. Losing it means another tick has
    // taken over, so sending here is the unspaced pair the lease exists to
    // prevent. This is the cheapest place to catch that, because it is the
    // last moment before the one irreversible act in this file. Hand the
    // recipient back exactly as the Stop branch does.
    if (!(await renewLease())) {
      await handBack(decision.recipientId, me.phone);
      return;
    }

    const result = await ask(tab, "send", {
      phone: decision.phone,
      text: decision.text,
      // Sent after the text, in the order the server listed them. An empty
      // list is normal: a campaign with no files attached.
      attachments: decision.attachments || [],
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
    // Not atomic: a successor acquiring between this get and this set would
    // have its lease cleared. The window is two storage calls wide and only
    // opens after this tick has already overrun its whole lease, which
    // renewLease() exists to prevent. chrome.storage has no compare-and-swap,
    // so a lost race costs one unspaced pair at worst, and the server folding
    // live claims into the gap is the backstop.
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
