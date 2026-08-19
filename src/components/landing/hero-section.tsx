"use client";

import Link from "next/link";
import { ArrowRight, CheckCircle2, Smartphone, Monitor } from "lucide-react";

export function HeroSection() {
  return (
    <section className="relative pt-32 pb-20 md:pt-48 md:pb-28 overflow-hidden">
      {/* Background Glow */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-primary/20 blur-[120px] rounded-full pointer-events-none" />

      <div className="max-w-7xl mx-auto px-6 relative z-10 text-center">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary/10 border border-primary/20 text-primary text-sm font-medium mb-8">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
          </span>
          CRM · Workforce · Field Sales — in one platform
        </div>

        <h1 className="text-5xl md:text-7xl font-extrabold tracking-tight text-foreground mb-8 max-w-4xl mx-auto leading-[1.08]">
          Run your field sales team on{" "}
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-violet-400">
            WhatsApp &amp; AI
          </span>
        </h1>

        <p className="text-lg md:text-xl text-muted-foreground mb-10 max-w-2xl mx-auto">
          OZZO unifies your CRM, your on-ground workforce, and your sales &amp;
          distribution into one system — a web dashboard for managers and an
          Android app for reps in the field.
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
            href="#pricing"
            className="w-full sm:w-auto flex items-center justify-center gap-2 bg-card border border-border text-foreground text-sm font-bold px-7 py-3.5 rounded-full hover:bg-muted transition-all"
          >
            See plans &amp; pricing
          </Link>
        </div>

        <div className="mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-3 text-sm text-muted-foreground font-medium">
          <div className="flex items-center gap-1.5">
            <CheckCircle2 className="h-4 w-4 text-emerald-500" /> 10 &amp; 30-day refundable trials
          </div>
          <div className="flex items-center gap-1.5">
            <Monitor className="h-4 w-4 text-primary" /> Web dashboard
          </div>
          <div className="flex items-center gap-1.5">
            <Smartphone className="h-4 w-4 text-primary" /> Android field app
          </div>
        </div>
      </div>
    </section>
  );
}
