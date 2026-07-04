"use client";

import { useState } from "react";
import Link from "next/link";
import { Check, ArrowRight } from "lucide-react";

interface PlanTier {
  name: string;
  price: number;
  features: string[];
  color: string;
  bgColor: string;
  buttonVariant: "default" | "outline";
  popular?: boolean;
}

const PLANS: PlanTier[] = [
  {
    name: "Basic",
    price: 100,
    features: [
      "Min 3 Users",
      "Core CRM (Contacts, Pipelines, Tasks)",
      "Quotations & Products",
      "Custom Fields & Tags",
    ],
    color: "text-slate-700 dark:text-slate-300",
    bgColor: "bg-card border-border",
    buttonVariant: "outline",
  },
  {
    name: "Pro",
    price: 200,
    features: [
      "Min 3 Users",
      "WhatsApp Integration (Shared Inbox)",
      "Message & Industry Templates",
      "Basic Automations",
      "Broadcasts",
    ],
    color: "text-blue-500",
    bgColor: "bg-blue-500/5 border-blue-500/20 scale-105 shadow-xl relative z-10",
    buttonVariant: "default",
    popular: true,
  },
  {
    name: "Enterprise",
    price: 350,
    features: [
      "Min 3 Users",
      "Full AI Assistant",
      "AI Knowledge Base",
      "Advanced Flows (Builder)",
      "VIP Support",
    ],
    color: "text-violet-500",
    bgColor: "bg-card border-border",
    buttonVariant: "outline",
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
            Start with the basic CRM or unlock the full power of WhatsApp and Agentic AI.
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
              <span className="absolute -top-3 -right-3 bg-green-500 text-white text-[10px] px-2 py-0.5 rounded-full shadow-sm">Save 30%</span>
            </button>
          </div>
        </div>

        <div className="grid md:grid-cols-3 gap-8 md:gap-4 max-w-5xl mx-auto items-center mt-12">
          {PLANS.map((plan) => (
            <div
              key={plan.name}
              className={`border p-8 rounded-3xl flex flex-col ${plan.bgColor}`}
            >
              {plan.popular && (
                <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-blue-500 text-white text-xs font-bold px-3 py-1 rounded-full shadow-md">
                  Most Popular
                </div>
              )}
              
              <h3 className={`text-2xl font-bold mb-2 ${plan.color}`}>
                {plan.name}
              </h3>
              
              <div className="mb-6 flex items-baseline gap-1">
                <span className="text-4xl font-extrabold text-foreground">
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
                className={`w-full py-3 px-4 rounded-xl font-bold text-center transition-all mb-8 flex items-center justify-center gap-2 ${
                  plan.buttonVariant === 'default' 
                    ? 'bg-blue-500 text-white hover:bg-blue-600 shadow-lg shadow-blue-500/25' 
                    : 'bg-muted text-foreground hover:bg-muted/80'
                }`}
              >
                Get Started <ArrowRight className="h-4 w-4" />
              </Link>

              <ul className="space-y-4 flex-1">
                {plan.features.map((f, i) => (
                  <li key={i} className="flex items-start gap-3 text-sm text-foreground font-medium">
                    <Check className={`h-5 w-5 shrink-0 ${plan.color}`} />
                    {f}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
