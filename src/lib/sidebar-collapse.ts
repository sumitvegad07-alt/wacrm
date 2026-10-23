"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Collapsing the main menu, the way ChatGPT's sidebar works: the menu is a
 * panel you can put away, and with it away the workspace is the whole screen.
 *
 * The chosen state has to survive a reload AND be on the document before the
 * first paint, or every page load would show the menu for a frame and then
 * snatch it away. So it lives in `data-sidebar` on <html>, set by the boot
 * script below (the same trick the theme already uses), and the width is done
 * in CSS off that attribute rather than from React state. React only reads it
 * back so the buttons can render the right way round.
 */

export const SIDEBAR_STORAGE_KEY = "wacrm.sidebar";

export type SidebarState = "expanded" | "collapsed";

export const DEFAULT_SIDEBAR: SidebarState = "expanded";

/**
 * Runs synchronously in <head>, before React. Keep it tiny and
 * exception-proof: a browser with storage blocked must still get the app.
 */
export const SIDEBAR_BOOT_SCRIPT = `
(function() {
  try {
    var v = localStorage.getItem('${SIDEBAR_STORAGE_KEY}');
    document.documentElement.setAttribute(
      'data-sidebar',
      v === 'collapsed' ? 'collapsed' : '${DEFAULT_SIDEBAR}'
    );
  } catch (e) {}
})();
`;

function read(): SidebarState {
  if (typeof document === "undefined") return DEFAULT_SIDEBAR;
  return document.documentElement.getAttribute("data-sidebar") === "collapsed"
    ? "collapsed"
    : "expanded";
}

export function useSidebarCollapse() {
  // Starts at the default so the server and the first client render agree.
  // The real value is already on <html>, so the menu is never the wrong width
  // on screen — only these buttons settle a frame later, which is invisible.
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    setCollapsed(read() === "collapsed");
  }, []);

  const apply = useCallback((next: boolean) => {
    setCollapsed(next);
    const value: SidebarState = next ? "collapsed" : "expanded";
    document.documentElement.setAttribute("data-sidebar", value);
    try {
      localStorage.setItem(SIDEBAR_STORAGE_KEY, value);
    } catch {
      // Private window, or storage is full. The toggle still works for this
      // visit; it just won't be remembered.
    }
  }, []);

  const toggle = useCallback(() => apply(read() !== "collapsed"), [apply]);

  return { collapsed, toggle, setCollapsed: apply };
}
