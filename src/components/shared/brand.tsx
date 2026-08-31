"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * OZZO brand assets, in one place so the sidebar, login screen and the
 * app-boot loader all draw from the same source and never drift.
 *
 * The wordmark ships as two raster variants (public/brand/logo-*.png):
 *   - logo-dark.png  — neon mark for dark surfaces (the ZZ letters glow white)
 *   - logo-light.png — the ZZ letters recoloured to navy so they read on
 *     light surfaces; icon + gradient O's are shared.
 * We render both and let the active `.dark` class (toggled on <html> by the
 * theme boot script) pick one — no JS, no hydration flash.
 */
export function BrandWordmark({ className }: { className?: string }) {
  return (
    <>
      {/* light-mode variant */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/brand/logo-light.png"
        alt="OZZO"
        className={cn("block h-7 w-auto dark:hidden", className)}
      />
      {/* dark-mode variant */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/brand/logo-dark.png"
        alt="OZZO"
        className={cn("hidden h-7 w-auto dark:block", className)}
      />
    </>
  );
}

/** The standalone rounded-square icon mark. Works on any background. */
export function BrandIcon({ className }: { className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/brand/icon.png"
      alt="OZZO"
      className={cn("h-12 w-12", className)}
    />
  );
}

/**
 * Full-screen branded loader shown while the app boots / auth resolves.
 * The icon sits inside a slowly-rotating conic gradient ring and gives a
 * soft pulsing glow — an OZZO-flavoured replacement for the plain spinner.
 */
export function BrandSplash({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex h-screen w-full items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-5">
        <div className="relative flex h-24 w-24 items-center justify-center">
          {/* rotating gradient ring */}
          <span
            aria-hidden
            className="absolute inset-0 animate-spin rounded-[26px] [animation-duration:2.4s]"
            style={{
              background:
                "conic-gradient(from 0deg, #22d3ee, #3b82f6, #a855f7, #22d3ee)",
              WebkitMask:
                "radial-gradient(farthest-side, transparent calc(100% - 3px), #000 calc(100% - 3px))",
              mask: "radial-gradient(farthest-side, transparent calc(100% - 3px), #000 calc(100% - 3px))",
            }}
          />
          {/* pulsing glow halo */}
          <span
            aria-hidden
            className="absolute inset-2 animate-pulse rounded-[22px] bg-cyan-400/20 blur-xl"
          />
          <BrandIcon className="relative h-16 w-16 drop-shadow-[0_0_12px_rgba(56,189,248,0.35)]" />
        </div>
        {label ? (
          <p className="text-sm font-medium text-muted-foreground">{label}</p>
        ) : null}
      </div>
    </div>
  );
}
