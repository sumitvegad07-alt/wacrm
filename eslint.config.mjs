import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Vendored minified opus-recorder encoder worker (served statically).
    "public/opus/**",
  ]),
  {
    files: ["src/components/**/*.{ts,tsx}", "src/app/**/*.{ts,tsx}", "src/hooks/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@supabase/supabase-js", "@/lib/supabase/*"],
              message: "UI components must not interact directly with Supabase. Use Application Services via React Hooks instead."
            },
            {
              group: ["@/lib/repositories/*"],
              message: "UI components must not import Repositories directly. Use Application Services via React Hooks instead."
            },
            {
              group: ["@/lib/runtime/*"],
              message: "UI components must not interact with the Sync Runtime directly. Use Application Services via React Hooks instead."
            }
          ]
        }
      ]
    }
  },
  {
    files: ["src/lib/application/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@supabase/supabase-js", "@/lib/supabase/*"],
              message: "Application Services must not interact directly with Supabase. Use Repositories instead."
            }
          ]
        }
      ]
    }
  },

  // ===================================================================
  // DESIGN SYSTEM (Phase 7 enforcement)
  //
  // Only patterns that are at ZERO across the tenant app are errors here.
  // A rule nobody can pass is not a rule, it is noise — and this project
  // already has 300-odd pre-existing lint errors drowning out signal.
  //
  // The anti-patterns that still have real debt (312 raw <button>, 279
  // text-red-*, 331 arbitrary text-[Npx]) are held by a RATCHET instead:
  // scripts/check-design-system.mjs counts them against a recorded
  // baseline and fails only when a count goes UP. See
  // docs/engineering/UI_COMPONENT_GUIDELINES.md.
  // ===================================================================
  {
    files: ["src/**/*.{ts,tsx}"],
    // A test that guards an anti-pattern has to contain it in order to detect
    // it — lib/theme/color-fallbacks.test.ts scans globals.css for
    // `hsl(var(--`, and that test is how the CSS side stays clean. This rule
    // covers the other side: the same mistake written in JS/TS, which is where
    // it last shipped (the map's GPS trail).
    ignores: ["src/**/*.test.{ts,tsx}", "src/tests/**"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          // These tokens hold COMPLETE colours (oklch, with a hex fallback),
          // not bare HSL channels, so hsl(var(--x)) is invalid CSS and paints
          // nothing at all. It has shipped twice: once on the marketing site's
          // scrollbar, and once on the location-tracking map's GPS trail,
          // which drew no line for anyone.
          selector: "Literal[value=/hsl\\(var\\(/]",
          message:
            "hsl(var(--token)) paints NOTHING — these tokens hold complete colours, not HSL channels. Use var(--token), or a Tailwind class like text-primary.",
        },
        {
          selector: "TemplateElement[value.raw=/hsl\\(var\\(/]",
          message:
            "hsl(var(--token)) paints NOTHING — these tokens hold complete colours, not HSL channels. Use var(--token), or a Tailwind class like text-primary.",
        },
        {
          // The popovers are Base UI, which exposes --anchor-width. Three
          // selects asked for Radix's --radix-popover-trigger-width, which
          // does not exist, so the rule was dropped and every dropdown panel
          // silently fell back to a fixed width matching no trigger.
          selector: "Literal[value=/--radix-/]",
          message:
            "Radix CSS variables do not exist on Base UI components. Use --anchor-width (see components/ui/control-base.ts).",
        },
        {
          // One definition, in shared/form-grid. This literal was copy-pasted
          // into six form files while the constant that was supposed to be
          // canonical had zero importers.
          selector: "Literal[value=/sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4/]",
          message:
            "Import FORM_GRID_PAGE from @/components/shared instead of repeating the field-grid classes.",
        },
      ],
    },
  },
  {
    // The dashboard (tenant) app only. /admin is founder-only and explicitly
    // out of scope for the design-system programme; the marketing landing
    // page uses alert() deliberately, to fake an AI reply in a demo.
    files: ["src/app/(dashboard)/**/*.{ts,tsx}", "src/components/**/*.{ts,tsx}"],
    ignores: [
      "src/components/landing/**",
      "src/components/shared/confirm-provider.tsx",
    ],
    rules: {
      "no-restricted-globals": [
        "error",
        {
          name: "confirm",
          message:
            "Use `const confirm = useConfirm()` from @/components/shared and `await confirm({ title, variant })`. The native dialog cannot be styled and reads like a different product.",
        },
        {
          name: "alert",
          message: "Use toast.success / toast.error from sonner instead of a blocking browser alert.",
        },
      ],
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              // design-tokens is NOT the design system — the real tokens are
              // in app/globals.css. Its old `tokens` object had one import in
              // the whole app and had drifted into being factually wrong about
              // the sidebar width, row height, padding and radius.
              name: "@/lib/design-tokens",
              importNames: ["tokens", "DIALOG_SIZES", "DRAWER_SIZES", "TOAST_DURATIONS", "ACTION_ORDER"],
              message:
                "The design tokens live in src/app/globals.css (@theme inline), not in TypeScript. A second source of truth is what caused the drift the first time.",
            },
          ],
          patterns: [
            {
              // The component layer is Base UI; the one remaining Radix
              // dependency (react-progress) is slated for removal.
              group: ["@radix-ui/*"],
              message:
                "This app's primitives are Base UI (@base-ui/react), not Radix. Do not add new Radix dependencies.",
            },
            {
              group: ["@supabase/supabase-js", "@/lib/supabase/*"],
              message: "UI components must not interact directly with Supabase. Use Application Services via React Hooks instead."
            },
            {
              group: ["@/lib/repositories/*"],
              message: "UI components must not import Repositories directly. Use Application Services via React Hooks instead."
            },
            {
              group: ["@/lib/runtime/*"],
              message: "UI components must not interact with the Sync Runtime directly. Use Application Services via React Hooks instead."
            },
          ],
        },
      ],
    },
  },
  {
    // ui/progress.tsx is the one legitimate Radix import left. Exempted by
    // name rather than by weakening the rule, so removing that dependency
    // means deleting this block — not hunting for a loophole.
    files: ["src/components/ui/progress.tsx"],
    rules: { "no-restricted-imports": "off" },
  },
]);

export default eslintConfig;
