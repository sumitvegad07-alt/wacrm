/**
 * Per-manufacturer instructions for stopping Android from killing background location tracking.
 *
 * Granting every permission is NOT enough on most Android phones: the OEM's own power manager
 * will still put the app to sleep, which silently ends a shift's tracking. Each vendor buries
 * this in a different place under a different name, so generic "set it to Unrestricted" advice
 * is unfollowable on the phones our reps actually carry.
 *
 * MUST stay in sync with the mobile copy at `wacrm-mobile/lib/oem-battery-guides.ts`.
 * Steps are ordered and written to be followed literally by a non-technical field agent.
 */

/** Product name shown to users. The app's launcher label must match this, or the steps below
 *  ("find OZZO in the list") can't be followed. */
export const APP_NAME = "OZZO";

export interface OemGuide {
  /** Human label for the phone brand/skin, e.g. "Samsung (One UI)". */
  brand: string;
  /** Ordered, literal steps. `{app}` is substituted with the product name. */
  steps: string[];
}

const GUIDES: { match: string[]; guide: OemGuide }[] = [
  {
    match: ["samsung"],
    guide: {
      brand: "Samsung (One UI)",
      steps: [
        "Settings → Apps → {app} → Battery → choose “Unrestricted”.",
        "Settings → Battery → Background usage limits → turn OFF “Put unused apps to sleep” and “Auto-disable unused apps”.",
        "In the same screen, open “Never sleeping apps” → add {app}.",
        "Settings → Device care → Auto-optimisation → turn OFF “Restart when needed” (if present).",
      ],
    },
  },
  {
    match: ["xiaomi", "redmi", "poco"],
    guide: {
      brand: "Xiaomi / Redmi / POCO (MIUI / HyperOS)",
      steps: [
        "Settings → Apps → Manage apps → {app} → Battery saver → choose “No restrictions”.",
        "In the same {app} screen → turn ON “Autostart”.",
        "Open Recent apps, swipe DOWN on the {app} card and tap the padlock so it isn’t cleared from memory.",
        "Settings → Battery → turn OFF “Battery saver” during work hours.",
      ],
    },
  },
  {
    match: ["oppo"],
    guide: {
      brand: "Oppo (ColorOS)",
      steps: [
        "Settings → Battery → App battery management → {app} → turn ON “Allow background activity” / “Allow foreground activity”.",
        "Settings → Apps → App management → {app} → turn ON “Allow auto startup”.",
        "Settings → Battery → turn OFF “Smart power saver” / “Super power saving”.",
        "In Recent apps, lock the {app} card so it survives memory cleanups.",
      ],
    },
  },
  {
    match: ["realme"],
    guide: {
      brand: "Realme (realme UI)",
      steps: [
        "Settings → Battery → App battery management → {app} → turn ON “Allow background activity”.",
        "Settings → Apps → App management → {app} → turn ON “Auto-start”.",
        "Settings → Battery → turn OFF “Smart power saving” during work hours.",
        "In Recent apps, lock the {app} card.",
      ],
    },
  },
  {
    match: ["vivo", "iqoo"],
    guide: {
      brand: "Vivo / iQOO (Funtouch OS / OriginOS)",
      steps: [
        "Settings → Battery → Background power consumption management → {app} → “Allow high background power consumption”.",
        "Settings → Apps → Autostart (or Permissions → Autostart) → turn ON for {app}.",
        "Settings → Battery → turn OFF “Low power mode” during work hours.",
        "In Recent apps, lock the {app} card.",
      ],
    },
  },
  {
    match: ["oneplus"],
    guide: {
      brand: "OnePlus (OxygenOS)",
      steps: [
        "Settings → Apps → {app} → Battery → “Unrestricted” (or Battery optimization → “Don’t optimize”).",
        "Settings → Battery → Advanced settings/Optimization → turn OFF “Sleep standby optimization” and “Deep optimization”.",
        "In Recent apps, lock the {app} card.",
      ],
    },
  },
  {
    match: ["huawei"],
    guide: {
      brand: "Huawei (EMUI)",
      steps: [
        "Settings → Battery → App launch → {app} → switch from “Manage automatically” to “Manage manually”.",
        "Enable all three: “Auto-launch”, “Secondary launch” and “Run in background”.",
        "Settings → Battery → turn OFF “Power saving mode” during work hours.",
      ],
    },
  },
  {
    match: ["honor"],
    guide: {
      brand: "Honor (MagicOS)",
      steps: [
        "Settings → Battery → App launch → {app} → set to “Manage manually”.",
        "Enable “Auto-launch”, “Secondary launch” and “Run in background”.",
        "Settings → Battery → turn OFF “Power saving mode” during work hours.",
      ],
    },
  },
  {
    // Transsion group — very common in India/Africa; HiOS/XOS share the same power manager.
    match: ["tecno", "infinix", "itel", "transsion"],
    guide: {
      brand: "Tecno / Infinix / itel (HiOS / XOS)",
      steps: [
        "Settings → Battery → Background app management (or Power Saving) → {app} → “Allow background running”.",
        "Settings → Apps → Auto-start management → turn ON for {app}.",
        "Phone Master / Power Marathon app → Protected apps → add {app}.",
        "In Recent apps, lock the {app} card.",
      ],
    },
  },
  {
    match: ["asus"],
    guide: {
      brand: "Asus (ZenUI)",
      steps: [
        "Settings → Battery → PowerMaster → Auto-start manager → allow {app}.",
        "Settings → Apps → {app} → Battery → “Unrestricted” / “Don’t optimize”.",
      ],
    },
  },
  {
    match: ["sony"],
    guide: {
      brand: "Sony (Xperia)",
      steps: [
        "Settings → Battery → STAMINA mode → turn OFF during work hours.",
        "Settings → Apps → {app} → Battery → “Unrestricted” (Battery optimisation → “Don’t optimise”).",
      ],
    },
  },
  {
    match: ["motorola", "moto", "lenovo"],
    guide: {
      brand: "Motorola / Lenovo",
      steps: [
        "Settings → Apps → {app} → Battery → “Unrestricted”.",
        "Settings → Battery → Battery optimization → {app} → “Don’t optimize”.",
      ],
    },
  },
  {
    match: ["nothing"],
    guide: {
      brand: "Nothing (Nothing OS)",
      steps: [
        "Settings → Apps → {app} → App battery usage → “Unrestricted”.",
        "Settings → Battery → turn OFF “Battery saver” during work hours.",
      ],
    },
  },
  {
    match: ["google", "pixel"],
    guide: {
      brand: "Google Pixel",
      steps: [
        "Settings → Apps → {app} → App battery usage → “Unrestricted”.",
        "Settings → Battery → turn OFF “Adaptive Battery” if tracking still stops.",
      ],
    },
  },
  {
    match: ["nokia", "hmd"],
    guide: {
      brand: "Nokia / HMD",
      steps: [
        "Settings → Apps → {app} → Battery → “Unrestricted”.",
        "Settings → Battery → Adaptive preferences → turn OFF “Adaptive Battery”.",
      ],
    },
  },
  {
    match: ["lava", "micromax", "karbonn"],
    guide: {
      brand: "Lava / Micromax / Karbonn",
      steps: [
        "Settings → Apps → {app} → Battery → “Unrestricted” / “Don’t optimize”.",
        "Settings → Battery → turn OFF any battery saver during work hours.",
        "If the phone has an Autostart or Protected apps list, add {app}.",
      ],
    },
  },
];

const FALLBACK: OemGuide = {
  brand: "Android",
  steps: [
    "Settings → Apps → {app} → Battery → choose “Unrestricted” (or Battery optimization → “Don’t optimize”).",
    "Settings → Battery → turn OFF battery saver / power saving during work hours.",
    "If the phone has an “Autostart”, “Protected apps” or “Never sleeping apps” list, add {app} to it.",
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

/** Substitute the product name into a guide's steps. */
export function resolveSteps(guide: OemGuide, appName: string = APP_NAME): string[] {
  return guide.steps.map((s) => s.split("{app}").join(appName));
}

/** One-paragraph rendering for compact UI / clipboard. */
export function formatOemGuide(manufacturer?: string | null, appName: string = APP_NAME): string {
  const guide = getOemGuide(manufacturer);
  const steps = resolveSteps(guide, appName)
    .map((s, i) => `${i + 1}. ${s}`)
    .join("\n");
  return `${guide.brand}:\n${steps}`;
}
