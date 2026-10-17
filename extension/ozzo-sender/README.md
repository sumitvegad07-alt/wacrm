# OZZO Sender

A Chrome extension that sends OZZO outreach messages through WhatsApp Web, one
at a time. It is for the founder only. It is never published to the Chrome Web
Store, and it should not be given to anyone else.

## Read this first

Bulk unsolicited messaging breaks WhatsApp's Terms of Service. WhatsApp can ban
the number it catches doing it. This extension cannot make that risk go away.

The risk sits on whichever number Chrome is logged into at web.whatsapp.com. If
that is the business number, the business number is what you can lose. Test
against a spare SIM first, and keep the first real campaign small.

## How it works

The extension holds no policy. It does not know the daily cap, the sending
window, the gap between messages, or the message template. All of that lives on
the server. The extension:

1. Asks the portal what to do next (`/api/admin/revenue/outreach/next`).
2. Sends exactly that one message, or waits exactly as long as it was told.
3. Reports what happened (`/api/admin/revenue/outreach/result`), including the
   number WhatsApp is logged in as, so the server can restart the warm-up ramp
   if the number changes.

It sleeps on `chrome.alarms`, not `setTimeout`. Chrome removes an idle
extension background worker within seconds, so a `setTimeout` would never fire
and the campaign would stop with no error.

Sending uses WA-JS, which calls WhatsApp's own send functions. It does not type
into the message box.

## Load it

1. Open `chrome://extensions`.
2. Turn on Developer mode.
3. Click Load unpacked and choose this folder (`extension/ozzo-sender`).
4. Open the extension's options page. Paste the agent token from
   `/admin/revenue/outreach` in the portal, set the Portal URL, and click Save.
5. Open web.whatsapp.com in another tab and sign in.
6. Click Start sending on the options page.

WhatsApp Web must stay open in a tab for the whole campaign. If the tab is
closed or signed out, the extension finds nothing to send through and checks
again every minute. After about three minutes of that it tells the portal, which
pauses the campaign and shows "WhatsApp Web is not logged in" — so sign back in
and resume the campaign in the portal. The extension keeps polling every ten
minutes while a campaign is paused or finished, so resuming in the portal is
enough and you do not have to come back here and press Start again.

Stop takes effect on the first press, including on a send that is already in
flight.

## Two things to know about the timing

**Chrome will not fire an alarm sooner than 30 seconds.** The server sometimes
answers "ask again in 1 second" — after a skipped recipient, say. Chrome rounds
that up, and only tolerates shorter delays at all because this extension is
loaded unpacked. So a run that has to skip a long stretch of recipients idles
roughly 30 seconds per skip and looks slower than it is. Nothing is sent early
because of this; waiting longer is always safe.

**Start can take a few minutes to show anything.** If a message is already
being sent when you press Start, the extension waits for that one to finish
rather than sending two at once. Expect up to about four or five minutes of
nothing before the next message goes out. Pressing Start again does not speed
it up.

**One campaign at a time, and one browser at a time.** The portal refuses to
start a second campaign while one is running. Do not run this extension in two
Chrome profiles against the same portal: the server guards against sending to
the same person twice, but two senders will not space their messages the way one
does, and the spacing is the part that keeps the number safe.

## WA-JS is vendored and pinned

`vendor/wppconnect-wa.js` is WA-JS 4.6.0, committed to this repository. It is
not loaded from a CDN. An upstream publish must not be able to change what runs
against the business WhatsApp number without a commit here.

To upgrade it, download the new release, read what changed, and commit the new
file.

The extension calls `WPP.contact.queryWidExists`. Do not switch it to
`queryExists`. WA-JS marks `queryExists` as deprecated, with removal on
27/10/2026.

WA-JS follows WhatsApp Web's internals, so a WhatsApp update can break it. If
messages stop going out after a WhatsApp update, check for a newer WA-JS.
