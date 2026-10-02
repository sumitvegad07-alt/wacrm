# OZZO SALES — Google Play submission guide

**Audience:** founder, publishing from a **personal** (individual) Google Play
developer account that has just completed identity verification.
**Written:** 2 October 2026. Play policy dates in here are live as of that day.

---

## 1. Prerequisite check — what was verifiable and what was not

I checked every repository this account can reach:

| Repository | What it is | Play assets in it? |
| --- | --- | --- |
| `sumitvegad07-alt/wacrm` | Next.js web admin (this repo) | No |
| `sumitvegad07-alt/ozzo-website` | Marketing site, `ozzo.co.in` | No |
| `sumitvegad07-alt/Arshdeep-Dental` | Unrelated | No |

**There is no mobile-app repository and no `.aab`, keystore, icon, feature
graphic or screenshot file in version control.** `PROJECT.md` points at
`C:/Users/Xitij/Desktop/wacrm/`, so the Expo project and the 13 September
build outputs exist only on the Windows machine. Nothing from 13 September can
be inspected from here — section 4 is the checklist to run against those files
yourself, and section 9 lists what to paste back so the check can be finished.

### What *was* verified, and is good news

- **Privacy policy exists and is genuinely fit for this submission.**
  `ozzo-website/src/app/privacy/page.tsx` → `https://ozzo.co.in/privacy`. It
  names the app (*"OZZO SALES — Field Sales CRM" Android application*), and
  section 9 states plainly that the app "may collect location in the
  background so that the day's route is continuous." Section 10 covers the
  attendance selfie and visit photographs, section 12 covers retention,
  section 17–18 cover erasure and how to request it. Most apps get rejected
  because the policy does not mention background location; this one does.
- **Terms** exist at `https://ozzo.co.in/terms`.

### Two gaps found

1. **No dedicated account/data-deletion page.** The site has `/privacy`,
   `/terms`, `/cookie-policy`, `/contact` and nothing else. Play's Data safety
   form asks for a URL where a user can request account and data deletion
   *without installing the app*. Section 18 of the privacy policy describes an
   email route, which Google does accept when the URL points at it. But the
   page carries only two anchor ids (`#retention` and `#security`) — section 18
   has none, so a deep link to it will not work; `https://ozzo.co.in/privacy`
   lands the reviewer at the top and leaves them to scroll. Two ways to close
   this, either is enough: add `id="deletion"` to the section 18 heading in
   `ozzo-website/src/app/privacy/page.tsx`, or build a small
   `/delete-account` page. The second is better — it is a page a user can be
   pointed at directly.
2. **`MOBILE_APP_URL` is still empty** in
   `src/components/getting-started/StepPanel.tsx` (line 14), so the web app's
   Getting Started step shows a "coming soon" placeholder instead of a store
   link. Fill it in once the listing is live.

---

## 2. Read this before anything else: you cannot publish straight to production

A **personal** developer account created after **13 November 2023** must run a
**closed test with at least 12 testers, opted in continuously for at least 14
days**, before it is even allowed to *apply* for production access. Organisation
accounts registered to a legal entity are exempt; personal accounts are not.

Consequences for the plan:

- The 14-day clock does **not** start until the closed test is running and
  testers have opted in. **Starting the closed test is the first action, today.**
  Every day of delay is a day added to launch.
- Internal testing (up to 100 testers, available immediately) does **not** count
  toward the 14 days. It is still worth using first, for one hour, to prove the
  bundle uploads and installs — see section 5, step 3.
- 12 testers means 12 **distinct Google accounts that actually opt in** via the
  test link. Family and staff accounts count. They must stay opted in for the
  whole 14 days — if someone leaves the test on day 9, the clock effectively
  restarts for that slot.
- When applying for production access, Google asks how testers were recruited
  and what was learned from them. Keep a few notes of real feedback; vague
  answers get the application sent back.

Realistic earliest production date, starting today: **mid-to-late October 2026**
(14 days of testing, then a production-access review that commonly takes a few
days, then the app review itself).

---

## 3. Hard blockers — check these before uploading the 13 September `.aab`

### 3.1 Target API level 36 (most likely problem with a September build)

Since **31 August 2026**, new apps must target **Android 16 (API level 36)**.
A bundle built on 13 September is on the wrong side of that date only if it was
configured before it — many Expo projects were still on `targetSdkVersion 35`.
If the bundle targets 35, **Play will refuse the upload** and it must be rebuilt.

Check it in `app.json` / `app.config.js`, under the `expo-build-properties`
plugin:

```json
["expo-build-properties", {
  "android": { "compileSdkVersion": 36, "targetSdkVersion": 36, "buildToolsVersion": "36.0.0" }
}]
```

Or read it straight out of the bundle, which is authoritative:

```bash
java -jar bundletool.jar dump manifest --bundle=app.aab
```

That prints `targetSdkVersion`, `versionCode`, the package name and **every
permission** — all four things needed below. (`bundletool` comes from
github.com/google/bundletool/releases.)

### 3.2 Background location needs a declaration and a video

If that manifest dump contains `android.permission.ACCESS_BACKGROUND_LOCATION`
— and for continuous route tracking it will — then the listing cannot be
submitted without:

- a **Sensitive app permissions → background location declaration** in
  Play Console (App content), explaining the feature and why foreground-only
  location will not do;
- a **prominent in-app disclosure** shown *before* the permission prompt: a
  dialog in OZZO SALES that says, in plain words, that the app collects
  location in the background to record the day's route and attendance, and that
  requires the user to accept or decline. A Play reviewer looks for this
  screen specifically;
- a **short demo video** (unlisted YouTube link) showing that disclosure, the
  permission prompt, and the feature actually using the location.

This is the single most common reason a field-force app gets rejected. Verify
the prominent disclosure screen exists in the 13 September build **before**
recording the video — if it does not, that is a code change and a rebuild.

### 3.3 Package name is permanent

`android.package` in `app.json` (something like `co.in.ozzo.sales`) can never be
changed for the life of the listing, and cannot be reused even after deletion.
Confirm it reads the way it should be read publicly, forever, before the first
upload.

### 3.4 Signing — do not lose the keystore

Opt into **Play App Signing** (default for new apps). The upload key used by
EAS must be backed up: if EAS manages credentials, run
`eas credentials` → Android → keystore → download, and store it somewhere
that is not just the laptop. Losing the upload key is recoverable with Google's
help; losing it when not on Play App Signing is not recoverable at all.

---

## 4. Asset specs — check the 13 September graphics against this

| Asset | Required spec | Notes |
| --- | --- | --- |
| App icon | **512 × 512**, 32-bit PNG **with** alpha, ≤ 1 MB | Not the launcher icon from the APK; a separate upload |
| Feature graphic | **1024 × 500**, JPEG or 24-bit PNG **no alpha**, ≤ 1 MB | Mandatory. No alpha channel — a transparent PNG is rejected |
| Phone screenshots | **2 minimum**, 4–8 recommended, JPEG or 24-bit PNG no alpha | 16:9 or 9:16, 1080 px or more on the long edge |
| Tablet screenshots | Optional | Add 7" and 10" only if the app is genuinely usable on a tablet |
| App name | ≤ 30 characters | e.g. `OZZO SALES — Field CRM` |
| Short description | ≤ 80 characters | Shown first; make it a sentence, not keywords |
| Full description | ≤ 4000 characters | |

Two specific traps with the feature graphic, worth re-checking on the
13 September file:

- **No alpha channel.** Export as JPEG, or as 24-bit PNG. If it was exported
  from a design tool with transparency anywhere, Play rejects it.
- **Keep text away from the edges and the centre-bottom.** Play crops and
  overlays a play button on the feature graphic in some placements. Logo and
  tagline belong in the upper-left two-thirds.

Verify both files on Windows with PowerShell:

```powershell
Add-Type -AssemblyName System.Drawing
Get-ChildItem *.png,*.jpg | ForEach-Object {
  $i = [System.Drawing.Image]::FromFile($_.FullName)
  "{0}: {1}x{2} {3} {4:N0} KB" -f $_.Name, $i.Width, $i.Height, $i.PixelFormat, ($_.Length/1KB)
  $i.Dispose()
}
```

`PixelFormat` must read `Format32bppArgb` for the icon and `Format24bppRgb`
(or any JPEG) for the feature graphic.

---

## 5. Step-by-step in Play Console

### Step 1 — Create the app
Play Console → **All apps → Create app**. App name, default language, **App**
(not game), **Free**. Free→paid is impossible later; paid→free is allowed.
Accept the declarations.

### Step 2 — Complete "App content" before touching tracks
Left nav → **Policy → App content**. Every item has to go green:

- **Privacy policy** → `https://ozzo.co.in/privacy`
- **App access** — the app is behind a login, so Google cannot review it
  without credentials. Choose *All or some functionality is restricted* and
  provide a **working demo tenant**: email, password, and any steps to reach
  tracking and attendance. This account must stay alive through review. Do not
  skip this; "reviewer could not log in" is a fast rejection.
- **Ads** — declare honestly whether the app shows ads.
- **Content rating** — fill in the questionnaire. A business CRM rates as
  *Everyone*; answer "no" to the violence/sexual/gambling questions truthfully.
- **Target audience** — 18+. Not child-directed.
- **Data safety** — the long one; draft answers in section 6.
- **Government apps**, **Financial features**, **Health** — almost certainly
  *no*, but each must be answered.
- **Sensitive app permissions** — the background location declaration from
  section 3.2, with the demo video link.

### Step 3 — Internal testing, as a one-hour smoke test
**Testing → Internal testing → Create new release.** Upload the `.aab`,
add yourself as a tester, install from the opt-in link on a real phone.
This is where Play tells you, immediately and for free, whether the target API
level is wrong, whether the signing is set up, and what permissions it sees
(**App bundle explorer** shows the full permission list). Fix anything here
before the 14-day clock starts.

### Step 4 — Closed testing: start the clock today
**Testing → Closed testing → Create track** (or use the default *Alpha*).
Create an email list of your 12+ testers, upload the same bundle, write release
notes, **roll out**. Send the opt-in link and confirm each person actually
accepts — a tester who does not click opt-in does not count. Record the date
every tester joined; the 14 days run from when you have 12 simultaneously
opted in, not from the day the track was created.

### Step 5 — Build the store listing while the clock runs
**Grow → Store presence → Main store listing.** App name, short and full
description, icon, feature graphic, phone screenshots, app category
(*Business*), contact email, website `https://ozzo.co.in`. Save.

### Step 6 — Apply for production access
After 14 continuous days with 12+ testers: **Dashboard → apply for production
access**. Answer the questions about tester recruitment and feedback with real
specifics. Review of this application typically takes a few days.

### Step 7 — Production release
Once granted: **Production → Create new release**, upload the bundle (rebuild
with a higher `versionCode` if anything changed), set countries, roll out.
First-time app review commonly takes several days and sometimes longer.
Consider a **staged rollout** at 20% for the first release.

### Step 8 — After it is live
- Set `MOBILE_APP_URL` in `src/components/getting-started/StepPanel.tsx` to the
  store link so the web onboarding stops showing "coming soon".
- Add the Play badge to `ozzo.co.in`.

---

## 6. Data safety — draft answers

These follow from what `ozzo.co.in/privacy` already says the app does. **Confirm
each line against the actual build before submitting** — a Data safety form that
contradicts the app's real behaviour is treated as a policy violation, not a
mistake, and the manifest dump from section 3.1 is the way to check.

| Data type | Collected | Shared | Purpose | Required? |
| --- | --- | --- | --- | --- |
| **Precise location** (incl. background) | Yes | No | App functionality — attendance, visit verification, route | Required for those features |
| Name, email address | Yes | No | Account management | Required |
| Phone number | Yes | No | Account management, CRM records | Required |
| **Photos** (selfie, visit, bill, odometer) | Yes | No | App functionality | Optional per feature |
| Contacts/customer records entered by the user | Yes | No | App functionality | Required |
| App activity / in-app actions | Yes | No | Analytics, app functionality | — |
| Crash logs, diagnostics | Yes | No | Crash reporting | — |
| Device or other IDs | Yes | No | Push notifications | — |

Cross-cutting answers:

- **Encrypted in transit:** Yes (privacy policy section, "All traffic … is
  encrypted").
- **Users can request data deletion:** Yes → URL. Use
  `https://ozzo.co.in/privacy` today; switch it to `#deletion` or to
  `/delete-account` once one of those exists (see section 1). Do not invent an
  anchor that is not in the page — a URL that 404s or jumps nowhere is worse
  than the plain policy link.
- **Data collected is processed ephemerally:** No.
- **"Shared"** in Play's sense means transferred to a *third party*. Sending
  data to your own Supabase backend and to processors acting on your
  instructions is **collection, not sharing** — answer No to sharing, which
  matches section 6 of the privacy policy.

---

## 7. Timeline

| When | What |
| --- | --- |
| **Today** | Verify target API 36 + background-location disclosure; internal test; start closed testing with 12 testers |
| Day 1–14 | Closed test runs. Build the store listing, record the permission demo video, collect tester feedback |
| Day 15 | Apply for production access |
| Day 15–20 | Google reviews the application |
| Then | Create the production release; first app review takes several days |

---

## 8. Things that will get this app rejected

In rough order of likelihood for a field-force tracking app:

1. Background location without the prominent in-app disclosure, the Play
   declaration, or the demo video.
2. **No reviewer login.** The app is behind a tenant login; without working
   demo credentials under App access, the reviewer sees a login wall.
3. Data safety form that does not list background location.
4. `targetSdkVersion` below 36.
5. Feature graphic with an alpha channel or wrong dimensions.
6. Screenshots that are mockups with marketing frames rather than the real UI.
7. Permissions in the manifest that nothing in the app uses — Expo config
   plugins add these quietly. The manifest dump shows them all; remove any that
   cannot be justified.

---

## 9. To finish the prerequisite check, paste these back

Run `java -jar bundletool.jar dump manifest --bundle=app.aab` and share:

1. `package` and `versionCode`
2. `targetSdkVersion`
3. the full `uses-permission` list
4. the PowerShell output from section 4 for the icon and feature graphic
5. whether the build has a prominent-disclosure dialog before the location
   permission prompt

With those five answers the 13 September assets can be confirmed go/no-go
rather than guessed at.

---

## Sources

- [App testing requirements for new personal developer accounts](https://support.google.com/googleplay/android-developer/answer/14151465?hl=en)
- [Target API level requirements for Google Play apps](https://support.google.com/googleplay/android-developer/answer/11926878?hl=en)
- [Add preview assets to showcase your app](https://support.google.com/googleplay/android-developer/answer/9866151?hl=en)
