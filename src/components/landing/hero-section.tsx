"use client";

import Link from "next/link";
import { ArrowRight, CheckCircle2, Mail } from "lucide-react";

export function HeroSection() {
  return (
    <section className="relative pt-32 pb-20 md:pt-48 md:pb-32 overflow-hidden">
      {/* Background Glow */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-primary/20 blur-[120px] rounded-full pointer-events-none" />
      
      <div className="max-w-7xl mx-auto px-6 relative z-10 text-center">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary/10 border border-primary/20 text-primary text-sm font-medium mb-8">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
          </span>
          More than just a CRM. A true Business Operating System.
        </div>
        
        <h1 className="text-5xl md:text-7xl font-extrabold tracking-tight text-foreground mb-8 max-w-4xl mx-auto leading-[1.1]">
          Run your entire business on <br className="hidden md:block" />
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-violet-500">
            WhatsApp & AI
          </span>
        </h1>
        
        <p className="text-lg md:text-xl text-muted-foreground mb-10 max-w-2xl mx-auto">
          Stop duct-taping 5 different tools together. Unify your sales pipeline, field tracking, automated messaging, and customer support into a single, intelligent platform. 
        </p>
        
        <div className="max-w-md mx-auto">
          <form className="flex flex-col sm:flex-row items-center gap-2 bg-card border border-border p-2 rounded-2xl shadow-xl shadow-primary/5 focus-within:ring-2 focus-within:ring-primary/50 transition-all">
            <div className="flex items-center flex-1 w-full pl-4">
              <Mail className="h-5 w-5 text-muted-foreground mr-3" />
              <input 
                type="email" 
                placeholder="Enter your work email" 
                className="w-full bg-transparent border-none outline-none text-foreground placeholder:text-muted-foreground"
                required
              />
            </div>
            <button
              type="submit"
              className="w-full sm:w-auto flex items-center justify-center gap-2 bg-primary text-primary-foreground text-sm font-bold px-6 py-3 rounded-xl shadow-lg shadow-primary/25 hover:shadow-primary/40 transition-all hover:bg-primary/90"
            >
              Start Free Trial
              <ArrowRight className="h-4 w-4" />
            </button>
          </form>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-6 text-sm text-muted-foreground font-medium">
            <div className="flex items-center gap-1.5">
              <CheckCircle2 className="h-4 w-4 text-green-500" /> No credit card required
            </div>
            <div className="flex items-center gap-1.5">
              <CheckCircle2 className="h-4 w-4 text-green-500" /> 14-day free trial
            </div>
            <div className="flex items-center gap-1.5">
              <CheckCircle2 className="h-4 w-4 text-green-500" /> Setup in 5 minutes
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
