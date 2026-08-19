"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";

export function FinalCTA() {
  return (
    <section className="py-24">
      <div className="max-w-5xl mx-auto px-6">
        <div className="relative overflow-hidden rounded-3xl border border-primary/20 bg-card p-10 md:p-16 text-center">
          {/* glow */}
          <div className="absolute -top-24 left-1/2 -translate-x-1/2 w-[600px] h-[400px] bg-primary/20 blur-[100px] rounded-full pointer-events-none" />
          <div className="relative z-10">
            <h2 className="text-3xl md:text-5xl font-extrabold tracking-tight text-foreground mb-5 max-w-2xl mx-auto leading-[1.1]">
              Put your whole field team on one platform
            </h2>
            <p className="text-lg text-muted-foreground mb-9 max-w-xl mx-auto">
              Start on the line that fits today — CRM, Workforce or Sales — and add
              the rest whenever you&apos;re ready.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
              <Link
                href="/signup"
                className="w-full sm:w-auto flex items-center justify-center gap-2 bg-primary text-primary-foreground text-sm font-bold px-7 py-3.5 rounded-full shadow-lg shadow-primary/25 hover:shadow-primary/40 transition-all hover:-translate-y-0.5"
              >
                Start your trial
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                href="/login"
                className="w-full sm:w-auto flex items-center justify-center gap-2 bg-transparent border border-border text-foreground text-sm font-bold px-7 py-3.5 rounded-full hover:bg-muted transition-all"
              >
                Sign in
              </Link>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
