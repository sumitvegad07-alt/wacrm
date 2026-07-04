"use client";

import Link from "next/link";
import { MessageSquare, Menu, X } from "lucide-react";
import { useState, useEffect } from "react";

export function LandingNavbar() {
  const [isScrolled, setIsScrolled] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 10);
    };
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  return (
    <nav
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
        isScrolled
          ? "bg-background/80 backdrop-blur-md border-b border-border shadow-sm"
          : "bg-transparent"
      }`}
    >
      <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2 group">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-lg shadow-primary/20 transition-transform group-hover:scale-105">
            <MessageSquare className="h-5 w-5" />
          </div>
          <span className="text-xl font-bold tracking-tight text-foreground">
            WACRM <span className="text-primary">BOS</span>
          </span>
        </Link>

        {/* Desktop Nav */}
        <div className="hidden md:flex items-center gap-8">
          <Link href="#features" className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
            Features
          </Link>
          <Link href="#industries" className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
            Industries
          </Link>
          <Link href="#pricing" className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
            Pricing
          </Link>
          <div className="flex items-center gap-4 ml-4">
            <Link
              href="/login"
              className="text-sm font-medium text-foreground hover:text-primary transition-colors"
            >
              Sign In
            </Link>
            <Link
              href="/signup"
              className="text-sm font-bold bg-primary text-primary-foreground px-5 py-2.5 rounded-full shadow-lg shadow-primary/25 hover:shadow-primary/40 transition-all hover:-translate-y-0.5"
            >
              Get Started
            </Link>
          </div>
        </div>

        {/* Mobile Menu Toggle */}
        <button
          className="md:hidden p-2 text-foreground"
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
        >
          {mobileMenuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
        </button>
      </div>

      {/* Mobile Nav */}
      {mobileMenuOpen && (
        <div className="md:hidden bg-background border-b border-border px-6 py-4 flex flex-col gap-4 shadow-lg">
          <Link href="#features" onClick={() => setMobileMenuOpen(false)} className="text-base font-medium text-muted-foreground">
            Features
          </Link>
          <Link href="#industries" onClick={() => setMobileMenuOpen(false)} className="text-base font-medium text-muted-foreground">
            Industries
          </Link>
          <Link href="#pricing" onClick={() => setMobileMenuOpen(false)} className="text-base font-medium text-muted-foreground">
            Pricing
          </Link>
          <div className="flex flex-col gap-2 mt-4 pt-4 border-t border-border">
            <Link
              href="/login"
              className="text-base text-center font-medium text-foreground py-2 border border-border rounded-lg"
            >
              Sign In
            </Link>
            <Link
              href="/signup"
              className="text-base text-center font-bold bg-primary text-primary-foreground py-2 rounded-lg"
            >
              Get Started
            </Link>
          </div>
        </div>
      )}
    </nav>
  );
}
