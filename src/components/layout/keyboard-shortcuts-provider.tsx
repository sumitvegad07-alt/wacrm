"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import {
  SHORTCUT_TEXT_MATCHERS,
  type ShortcutAction,
} from "@/lib/shortcuts";
import { KeyboardShortcutsDialog } from "./keyboard-shortcuts-dialog";
import { CommandPalette } from "./command-palette";

interface ShortcutsContextValue {
  openHelp: () => void;
  openPalette: () => void;
}

const ShortcutsContext = createContext<ShortcutsContextValue | null>(null);

/** Access `openHelp()` / `openPalette()` from anywhere in the dashboard. */
export function useAppShortcuts(): ShortcutsContextValue {
  const ctx = useContext(ShortcutsContext);
  if (!ctx) {
    // Safe no-op fallback so a stray call never crashes the app.
    return { openHelp: () => {}, openPalette: () => {} };
  }
  return ctx;
}

function isTextInput(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag === "INPUT") {
    const type = (el as HTMLInputElement).type;
    // Non-text inputs (checkbox/radio/button) don't own select-all/cut.
    return !["checkbox", "radio", "button", "submit", "reset", "range", "color"].includes(
      type,
    );
  }
  if (el.isContentEditable) return true;
  return false;
}

/** A visible, enabled element (offsetParent is null when display:none). */
function isActionable(el: Element | null): el is HTMLElement {
  if (!(el instanceof HTMLElement)) return false;
  if (el.offsetParent === null && el.getClientRects().length === 0) return false;
  if ((el as HTMLButtonElement).disabled) return false;
  if (el.getAttribute("aria-disabled") === "true") return false;
  return true;
}

function findByDataShortcut(action: ShortcutAction): HTMLElement | null {
  const nodes = Array.from(
    document.querySelectorAll<HTMLElement>(`[data-shortcut="${action}"]`),
  );
  return nodes.find(isActionable) ?? null;
}

function findByText(action: ShortcutAction): HTMLElement | null {
  const matcher = SHORTCUT_TEXT_MATCHERS[action];
  if (!matcher) return null;
  const buttons = Array.from(
    document.querySelectorAll<HTMLElement>('button, a[role="button"], [role="button"]'),
  );
  return (
    buttons.find((b) => {
      if (!isActionable(b)) return false;
      const text = (b.textContent ?? "").trim().toLowerCase();
      return text.length > 0 && matcher.test(text);
    }) ?? null
  );
}

export function KeyboardShortcutsProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [helpOpen, setHelpOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);

  const openHelp = useCallback(() => setHelpOpen(true), []);
  const openPalette = useCallback(() => setPaletteOpen(true), []);

  const runAction = useCallback(
    (action: ShortcutAction) => {
      if (action === "back") {
        router.back();
        return;
      }
      if (action === "refresh") {
        const el = findByDataShortcut("refresh");
        if (el) el.click();
        else router.refresh();
        return;
      }
      if (action === "print") {
        const el = findByDataShortcut("print");
        if (el) el.click();
        else window.print();
        return;
      }
      const target = findByDataShortcut(action) ?? findByText(action);
      if (target) target.click();
    },
    [router],
  );

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Alt+F → command palette (no Ctrl). Matches the header search hint.
      if (e.altKey && !e.ctrlKey && !e.metaKey && (e.key === "f" || e.key === "F")) {
        e.preventDefault();
        setPaletteOpen(true);
        return;
      }

      const ctrl = e.ctrlKey || e.metaKey;
      if (!ctrl || e.altKey) return;

      const key = e.key.toLowerCase();
      const shift = e.shiftKey;
      const editing = isTextInput(e.target);

      switch (key) {
        case "f":
          if (shift) return;
          e.preventDefault();
          setPaletteOpen(true);
          return;
        case "/":
          e.preventDefault();
          setHelpOpen(true);
          return;
        case "s":
          e.preventDefault();
          runAction(shift ? "save-new" : "save");
          return;
        case "a":
          // Preserve native select-all while editing text.
          if (shift || editing) return;
          e.preventDefault();
          runAction("add");
          return;
        case "e":
          if (shift) return;
          e.preventDefault();
          runAction("edit");
          return;
        case "i":
          if (shift) return;
          e.preventDefault();
          runAction("import");
          return;
        case "x":
          // Only Ctrl+Shift+X is Export; bare Ctrl+X stays Cut.
          if (!shift) return;
          e.preventDefault();
          runAction("export");
          return;
        case "p":
          if (shift) return;
          e.preventDefault();
          runAction("print");
          return;
        case "r":
          if (shift) return;
          e.preventDefault();
          runAction("refresh");
          return;
        case "b":
          if (shift) return;
          e.preventDefault();
          runAction("back");
          return;
        case "enter": {
          // Ctrl+Enter → send. Only intercept when a send target exists.
          const el = findByDataShortcut("send") ?? findByText("send");
          if (el) {
            e.preventDefault();
            el.click();
          }
          return;
        }
        default:
          return;
      }
    };

    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [runAction]);

  const value = useMemo(() => ({ openHelp, openPalette }), [openHelp, openPalette]);

  return (
    <ShortcutsContext.Provider value={value}>
      {children}
      <KeyboardShortcutsDialog open={helpOpen} onOpenChange={setHelpOpen} />
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </ShortcutsContext.Provider>
  );
}
