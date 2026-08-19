"use client";

import { useState } from "react";
import Link from "next/link";
import { Check, ArrowRight, Sparkles } from "lucide-react";

interface PlanTier {
  name: string;
  price: number;
  tagline: string;
  features: string[];
  color: string;
  bgColor: string;
  buttonVariant: "default" | "outline";
  popular?: boolean;
  /** CRM-inclusive plans get the WhatsApp AI reply preview. */
  hasAI?: boolean;
}

// Mirrors the OZZO Pricing & Feature Catalogue v1.0: three product lines —
// CRM, WFA (Workforce Automation) and SFA — sold on their own or combined.
const PLANS: PlanTier[] = [
  {
    name: "CRM",
    price: 100,
    tagline: "Win and keep customers",
    features: [
      "Min 3 users",
      "Customers, Products & Tasks",
      "Leads & Deal Pipeline",
      "WhatsApp CRM + AI Assistant",
      "Quotations",
      "Attendance, Leave & Holiday",
    ],
    color: "text-violet-500",
    bgColor: "bg-card border-border",
    buttonVariant: "outline",
    hasAI: true,
  },
  {
    name: "WFA",
    price: 150,
    tagline: "Run your field force",
    features: [
      "Min 3 users",
      "GPS Tracking & Live Location",
      "Attendance with selfie & GPS",
      "Visit Management",
      "Expense Management",
      "Beat Planning & Territory",
      "Device Health",
    ],
    color: "text-cyan-500",
    bgColor: "bg-card border-border",
    buttonVariant: "outline",
  },
  {
    name: "CRM + WFA",
    price: 200,
    tagline: "Front office + field force",
    features: [
      "Min 3 users",
      "Everything in CRM",
      "Everything in Workforce",
      "One team, one platform",
    ],
    color: "text-blue-500",
    bgColor: "bg-blue-500/5 border-blue-500/30 ring-2 ring-blue-500/40 relative z-10",
    buttonVariant: "default",
    popular: true,
    hasAI: true,
  },
  {
    name: "SFA",
    price: 350,
    tagline: "Sales & distribution",
    features: [
      "Min 3 users",
      "Everything in Workforce",
      "Order Management",
      "Payment Collection & Outstanding",
      "Customer Financials",
      "Dealer & Distributor Management",
      "Sales Analytics",
    ],
    color: "text-emerald-500",
    bgColor: "bg-card border-border",
    buttonVariant: "outline",
  },
  {
    name: "CRM + SFA",
    price: 450,
    tagline: "The complete platform",
    features: [
      "Min 3 users",
      "Everything in CRM",
      "Everything in SFA",
      "Sell, track & distribute in one place",
    ],
    color: "text-foreground",
    bgColor: "bg-card border-border",
    buttonVariant: "outline",
    hasAI: true,
  },
];

export function PricingSection() {
  const [billingCycle, setBillingCycle] = useState<'yearly' | 'half-yearly' | 'quarterly'>('yearly');

  return (
    <section id="pricing" className="py-24 bg-background">
      <div className="max-w-7xl mx-auto px-6">
        <div className="text-center mb-12">
          <h2 className="text-3xl md:text-5xl font-bold tracking-tight text-foreground mb-4">
            Transparent Pricing
          </h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto mb-8">
            Pick a product line — CRM, Workforce or Sales — or combine them. Priced per user, per month.
          </p>

          <div className="inline-flex items-center bg-muted/50 p-1.5 rounded-full border border-border shadow-sm">
            <button
              onClick={() => setBillingCycle('quarterly')}
              className={`px-6 py-2.5 text-sm font-bold rounded-full transition-all duration-200 ${billingCycle === 'quarterly' ? 'bg-primary text-primary-foreground shadow-md scale-105' : 'text-muted-foreground hover:text-foreground'}`}
            >
              Quarterly
            </button>
            <button
              onClick={() => setBillingCycle('half-yearly')}
              className={`px-6 py-2.5 text-sm font-bold rounded-full transition-all duration-200 ${billingCycle === 'half-yearly' ? 'bg-primary text-primary-foreground shadow-md scale-105' : 'text-muted-foreground hover:text-foreground'}`}
            >
              Half-Yearly
            </button>
            <button
              onClick={() => setBillingCycle('yearly')}
              className={`px-6 py-2.5 text-sm font-bold rounded-full transition-all duration-200 relative ${billingCycle === 'yearly' ? 'bg-primary text-primary-foreground shadow-md scale-105' : 'text-muted-foreground hover:text-foreground'}`}
            >
              Yearly
              <span className="absolute -top-3 -right-3 bg-green-500 text-white text-[10px] px-2 py-0.5 rounded-full shadow-sm">Best value</span>
            </button>
          </div>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-6 max-w-7xl mx-auto items-stretch mt-12">
          {PLANS.map((plan) => (
            <div
              key={plan.name}
              className={`border p-6 rounded-3xl flex flex-col ${plan.bgColor}`}
            >
              {plan.popular && (
                <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-blue-500 text-white text-xs font-bold px-3 py-1 rounded-full shadow-md whitespace-nowrap">
                  Most Popular
                </div>
              )}

              <h3 className={`text-xl font-bold mb-1 ${plan.color}`}>
                {plan.name}
              </h3>
              <p className="text-xs text-muted-foreground mb-4">{plan.tagline}</p>

              <div className="mb-6 flex items-baseline gap-1">
                <span className="text-3xl font-extrabold text-foreground">
                  ₹{(billingCycle === 'quarterly'
                        ? Math.round(plan.price * 1.3)
                        : billingCycle === 'half-yearly'
                          ? Math.round(plan.price * 1.2)
                          : plan.price
                      ).toLocaleString("en-IN")}
                </span>
                <span className="text-sm font-medium text-muted-foreground">/user/mo</span>
              </div>

              <Link
                href="/signup"
                className={`w-full py-3 px-4 rounded-xl font-bold text-center transition-all mb-6 flex items-center justify-center gap-2 ${
                  plan.buttonVariant === 'default'
                    ? 'bg-blue-500 text-white hover:bg-blue-600 shadow-lg shadow-blue-500/25'
                    : 'bg-muted text-foreground hover:bg-muted/80'
                }`}
              >
                Get Started <ArrowRight className="h-4 w-4" />
              </Link>

              <ul className="space-y-3 flex-1">
                {plan.features.map((f, i) => (
                  <li key={i} className="flex items-start gap-2.5 text-sm text-foreground font-medium">
                    <Check className={`h-5 w-5 shrink-0 ${plan.color}`} />
                    {f}
                  </li>
                ))}
              </ul>

              {plan.hasAI && (
                <button
                  onClick={() => alert("Simulating AI Reply:\n\nUser: What are your working hours?\nOZZO AI: Hi! We are open Monday to Friday from 9 AM to 6 PM. How can I help you today?")}
                  className="mt-6 w-full py-2.5 px-4 rounded-xl text-sm font-bold text-center transition-all flex items-center justify-center gap-2 border border-violet-500/30 text-violet-500 hover:bg-violet-500/10"
                >
                  <Sparkles className="h-4 w-4" /> Preview AI Reply
                </button>
              )}
            </div>
          ))}
        </div>

        <p className="text-center text-xs text-muted-foreground mt-10">
          Billed per user / month. Half-yearly +20%, quarterly +30% over the annual rate. 10-day and 30-day trials available.
        </p>
      </div>
    </section>
  );
}
