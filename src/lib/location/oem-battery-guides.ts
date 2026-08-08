/**
 * Per-manufacturer instructions for stopping Android from killing background location tracking.
 *
 * Granting every permission is NOT enough on most Android phones: the OEM's own power manager
 * will still put the app to sleep, which silently ends a shift's tracking. Each vendor buries
 * this in a different place under a different name, so generic "set it to Unrestricted" advice
 * is unfollowable on the phones our reps actually carry.
 *
 * Steps are split deliberately:
 *  - `required`  — do these. On stock Android that is genuinely ONE step. On Xiaomi, Oppo, Vivo,
 *                  Samsung and the Transsion brands a second one (Autostart / never-sleeping) is
 *                  also genuinely required; the single step does not hold there.
 *  - `ifStillStopping` — only needed when tracking still drops after the required steps. Keeping
 *                  these separate stops a rep being handed five equal-looking instructions and
 *                  not knowing which actually matter.
 *
 * MUST stay in sync with the mobile copy at `wacrm-mobile/lib/oem-battery-guides.ts`.
 */

/** Product name shown to users. The app's launcher label must match this, or the steps below
 *  ("find OZZO in the list") can't be followed. */
export const APP_NAME = "OZZO";

export interface OemGuide {
  /** Human label for the phone brand/skin, e.g. "Samsung (One UI)". */
  brand: string;
  /** Must be done. 1 step on stock Android, 2 on aggressive OEMs. `{app}` is substituted. */
  required: string[];
  /** Extra hardening, only if tracking still stops after the required steps. */
  ifStillStopping: string[];
}

const GUIDES: { match: string[]; guide: OemGuide }[] = [
  {
    match: ["samsung"],
    guide: {
      brand: "Samsung (One UI)",
      required: [
        "Settings → Apps → {app} → Battery → choose “Unrestricted”.",
        "Settings → Battery → Background usage limits → “Never sleeping apps” → add {app}.",
      ],
      ifStillStopping: [
        "In the same Background usage limits screen, turn OFF “Put unused apps to sleep” and “Auto-disable unused apps”.",
        "Settings → Device care → Auto-optimisation → turn OFF “Restart when needed”.",
      ],
    },
  },
  {
    match: ["xiaomi", "redmi", "poco"],
    guide: {
      brand: "Xiaomi / Redmi / POCO (MIUI / HyperOS)",
      required: [
        "Settings → Apps → Manage apps → {app} → Battery saver → choose “No restrictions”.",
        "In the same {app} screen → turn ON “Autostart”.",
      ],
      ifStillStopping: [
        "Open Recent apps, swipe DOWN on the {app} card and tap the padlock so it isn’t cleared from memory.",
        "Settings → Battery → turn OFF “Battery saver” during work hours.",
      ],
    },
  },
  {
    match: ["oppo"],
    guide: {
      brand: "Oppo (ColorOS)",
      required: [
        "Settings → Battery → App battery management → {app} → turn ON “Allow background activity”.",
        "Settings → Apps → App management → {app} → turn ON “Allow auto startup”.",
      ],
      ifStillStopping: [
        "Settings → Battery → turn OFF “Smart power saver” / “Super power saving”.",
        "In Recent apps, lock the {app} card so it survives memory cleanups.",
      ],
    },
  },
  {
    match: ["realme"],
    guide: {
      brand: "Realme (realme UI)",
      required: [
        "Settings → Battery → App battery management → {app} → turn ON “Allow background activity”.",
        "Settings → Apps → App management → {app} → turn ON “Auto-start”.",
      ],
      ifStillStopping: [
        "Settings → Battery → turn OFF “Smart power saving” during work hours.",
        "In Recent apps, lock the {app} card.",
      ],
    },
  },
  {
    match: ["vivo", "iqoo"],
    guide: {
      brand: "Vivo / iQOO (Funtouch OS / OriginOS)",
      required: [
        "Settings → Battery → Background power consumption management → {app} → “Allow high background power consumption”.",
        "Settings → Apps → Autostart → turn ON for {app}.",
      ],
      ifStillStopping: [
        "Settings → Battery → turn OFF “Low power mode” during work hours.",
        "In Recent apps, lock the {app} card.",
      ],
    },
  },
  {
    match: ["oneplus"],
    guide: {
      brand: "OnePlus (OxygenOS)",
      required: [
        "Settings → Apps → {app} → Battery → “Unrestricted” (or Battery optimization → “Don’t optimize”).",
      ],
      ifStillStopping: [
        "Settings → Battery → Advanced settings → turn OFF “Sleep standby optimization” and “Deep optimization”.",
        "In Recent apps, lock the {app} card.",
      ],
    },
  },
  {
    match: ["huawei"],
    guide: {
      brand: "Huawei (EMUI)",
      required: [
        "Settings → Battery → App launch → {app} → switch to “Manage manually” and enable “Auto-launch”, “Secondary launch” and “Run in background”.",
      ],
      ifStillStopping: [
        "Settings → Battery → turn OFF “Power saving mode” during work hours.",
      ],
    },
  },
  {
    match: ["honor"],
    guide: {
      brand: "Honor (MagicOS)",
      required: [
        "Settings → Battery → App launch → {app} → set to “Manage manually” and enable “Auto-launch”, “Secondary launch” and “Run in background”.",
      ],
      ifStillStopping: [
        "Settings → Battery → turn OFF “Power saving mode” during work hours.",
      ],
    },
  },
  {
    // Transsion group — very common in India/Africa; HiOS/XOS share the same power manager.
    match: ["tecno", "infinix", "itel", "transsion"],
    guide: {
      brand: "Tecno / Infinix / itel (HiOS / XOS)",
      required: [
        "Settings → Battery → Background app management → {app} → “Allow background running”.",
        "Settings → Apps → Auto-start management → turn ON for {app}.",
      ],
      ifStillStopping: [
        "Open Phone Master / Power Marathon → Protected apps → add {app}.",
        "In Recent apps, lock the {app} card.",
      ],
    },
  },
  {
    match: ["asus"],
    guide: {
      brand: "Asus (ZenUI)",
      required: [
        "Settings → Apps → {app} → Battery → “Unrestricted” / “Don’t optimize”.",
      ],
      ifStillStopping: ["Settings → Battery → PowerMaster → Auto-start manager → allow {app}."],
    },
  },
  {
    match: ["sony"],
    guide: {
      brand: "Sony (Xperia)",
      required: [
        "Settings → Apps → {app} → Battery → “Unrestricted” (Battery optimisation → “Don’t optimise”).",
      ],
      ifStillStopping: ["Settings → Battery → turn OFF STAMINA mode during work hours."],
    },
  },
  {
    match: ["motorola", "moto", "lenovo"],
    guide: {
      brand: "Motorola / Lenovo",
      required: ["Settings → Apps → {app} → Battery → “Unrestricted”."],
      ifStillStopping: ["Settings → Battery → Battery optimization → {app} → “Don’t optimize”."],
    },
  },
  {
    match: ["nothing"],
    guide: {
      brand: "Nothing (Nothing OS)",
      required: ["Settings → Apps → {app} → App battery usage → “Unrestricted”."],
      ifStillStopping: ["Settings → Battery → turn OFF “Battery saver” during work hours."],
    },
  },
  {
    match: ["google", "pixel"],
    guide: {
      brand: "Google Pixel",
      required: ["Settings → Apps → {app} → App battery usage → “Unrestricted”."],
      ifStillStopping: ["Settings → Battery → turn OFF “Adaptive Battery”."],
    },
  },
  {
    match: ["nokia", "hmd"],
    guide: {
      brand: "Nokia / HMD",
      required: ["Settings → Apps → {app} → Battery → “Unrestricted”."],
      ifStillStopping: [
        "Settings → Battery → Adaptive preferences → turn OFF “Adaptive Battery”.",
      ],
    },
  },
  {
    match: ["lava", "micromax", "karbonn"],
    guide: {
      brand: "Lava / Micromax / Karbonn",
      required: [
        "Settings → Apps → {app} → Battery → “Unrestricted” / “Don’t optimize”.",
      ],
      ifStillStopping: [
        "If the phone has an “Autostart” or “Protected apps” list, add {app} to it.",
        "Settings → Battery → turn OFF any battery saver during work hours.",
      ],
    },
  },
];

const FALLBACK: OemGuide = {
  brand: "Android",
  required: [
    "Settings → Apps → {app} → Battery → choose “Unrestricted” (or Battery optimization → “Don’t optimize”).",
  ],
  ifStillStopping: [
    "If the phone has an “Autostart”, “Protected apps” or “Never sleeping apps” list, add {app} to it.",
    "Settings → Battery → turn OFF battery saver / power saving during work hours.",
    "In Recent apps, lock the {app} card so it isn’t cleared from memory.",
  ],
};

/** Pick the guide for a manufacturer string as reported by the device. */
export function getOemGuide(manufacturer?: string | null): OemGuide {
  const make = (manufacturer ?? "").toLowerCase().trim();
  if (make) {
    for (const entry of GUIDES) {
      if (entry.match.some((m) => make.includes(m))) return entry.guide;
    }
  }
  return FALLBACK;
}

const sub = (steps: string[], appName: string) =>
  steps.map((s) => s.split("{app}").join(appName));

/** Guide with `{app}` resolved, ready to render. */
export function resolveGuide(
  manufacturer?: string | null,
  appName: string = APP_NAME,
): OemGuide {
  const g = getOemGuide(manufacturer);
  return {
    brand: g.brand,
    required: sub(g.required, appName),
    ifStillStopping: sub(g.ifStillStopping, appName),
  };
}

/** Flat plain-text rendering, used for clipboard and compact UI. */
export function formatOemGuide(
  manufacturer?: string | null,
  appName: string = APP_NAME,
): string {
  const g = resolveGuide(manufacturer, appName);
  const required = g.required.map((s, i) => `${i + 1}. ${s}`).join("\n");
  const extra = g.ifStillStopping.map((s) => `• ${s}`).join("\n");
  return `${g.brand}\n\nDo this:\n${required}\n\nOnly if it still stops:\n${extra}`;
}
