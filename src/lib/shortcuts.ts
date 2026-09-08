/**
 * App-wide keyboard shortcut catalogue.
 *
 * The founder asked for the reference SFA product's shortcuts but on **Ctrl**
 * instead of Alt. A few had to be remapped because the browser owns them:
 *  - Ctrl+N (new window) can't be intercepted → Save & New uses Ctrl+Shift+S.
 *  - Ctrl+X is Cut → Export uses Ctrl+Shift+X so cutting text still works.
 * Ctrl+A (select all) and Ctrl+X (cut) only trigger the app action when focus
 * is NOT inside a text field — see keyboard-shortcuts-provider.tsx.
 *
 * This is the single source of truth: the provider dispatches these `action`s
 * and the help dialog renders these `keys`.
 */
export type ShortcutAction =
  | "search"
  | "add"
  | "save"
  | "save-new"
  | "send"
  | "edit"
  | "import"
  | "export"
  | "print"
  | "refresh"
  | "back"
  | "help";

export interface ShortcutDef {
  action: ShortcutAction;
  label: string;
  /** Display tokens, e.g. ["Ctrl", "Shift", "S"]. */
  keys: string[];
}

export const APP_SHORTCUTS: ShortcutDef[] = [
  { action: "search", label: "Find / Search", keys: ["Ctrl", "F"] },
  { action: "add", label: "Add new", keys: ["Ctrl", "A"] },
  { action: "save", label: "Save", keys: ["Ctrl", "S"] },
  { action: "save-new", label: "Save and new", keys: ["Ctrl", "Shift", "S"] },
  { action: "send", label: "Send message", keys: ["Ctrl", "Enter"] },
  { action: "edit", label: "Edit", keys: ["Ctrl", "E"] },
  { action: "import", label: "Import", keys: ["Ctrl", "I"] },
  { action: "export", label: "Export", keys: ["Ctrl", "Shift", "X"] },
  { action: "print", label: "Print", keys: ["Ctrl", "P"] },
  { action: "refresh", label: "Refresh", keys: ["Ctrl", "R"] },
  { action: "back", label: "Back", keys: ["Ctrl", "B"] },
  { action: "help", label: "Keyboard shortcuts", keys: ["Ctrl", "/"] },
];

/**
 * Text-match fallbacks so the shortcut works on pages whose Add/Save/Edit/…
 * buttons don't (yet) carry a `data-shortcut` attribute. Matched against a
 * button's trimmed, lower-cased text content.
 */
export const SHORTCUT_TEXT_MATCHERS: Partial<Record<ShortcutAction, RegExp>> = {
  add: /^(\+\s*)?(add|add new|new|create)\b/,
  save: /^save$/,
  "save-new": /^save\s*(&|and)\s*new/,
  edit: /^edit\b/,
  import: /^import\b/,
  export: /^export\b/,
  send: /^send\b/,
};
