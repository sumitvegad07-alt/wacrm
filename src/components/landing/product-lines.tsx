"use client";

import { Users, MapPin, ShoppingCart, Check } from "lucide-react";

const BASE = [
  "Customers",
  "Products",
  "Tasks",
  "Attendance",
  "Leave",
  "Holiday",
  "Announcements",
];

const LINES = [
  {
    key: "crm",
    name: "CRM",
    sub: "Win & keep customers",
    price: 100,
    icon: Users,
    accent: "text-violet-400",
    ring: "ring-violet-500/20",
    dot: "bg-violet-400",
    features: [
      "Leads, Deals & Activities",
      "WhatsApp CRM — shared inbox, templates",
      "AI knowledge-base assistant",
      "Quotations with branded PDFs",
    ],
  },
  {
    key: "wfa",
    name: "WFA",
    sub: "Run your field force",
    price: 150,
    icon: MapPin,
    accent: "text-cyan-400",
    ring: "ring-cyan-500/20",
    dot: "bg-cyan-400",
    features: [
      "GPS tracking & live location",
      "Attendance with selfie & GPS",
      "Visits, Expenses & Beat planning",
      "Territory management & device health",
    ],
  },
  {
    key: "sfa",
    name: "SFA",
    sub: "Sell & distribute",
    price: 350,
    icon: ShoppingCart,
    accent: "text-emerald-400",
    ring: "ring-emerald-500/20",
    dot: "bg-emerald-400",
    features: [
      "Order management & payment collection",
      "Outstanding & customer financials",
      "Dealer & distributor management",
      "Sales analytics — includes all of Workforce",
    ],
  },
];

export function ProductLines() {
  return (
    <section id="product" className="py-24">
      <div className="max-w-7xl mx-auto px-6">
        <div className="text-center mb-16">
          <p className="text-sm font-semibold uppercase tracking-widest text-primary mb-3">
            One platform, three product lines
          </p>
          <h2 className="text-3xl md:text-5xl font-bold tracking-tight text-foreground mb-4 max-w-3xl mx-auto">
            Buy only what your team needs — or combine them
          </h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Start with CRM, add your field workforce, or run the full sales &amp;
            distribution engine. SFA already includes everything in Workforce.
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-6">
          {LINES.map((line) => (
            <div
              key={line.key}
              className={`bg-card border border-border rounded-3xl p-8 ring-1 ${line.ring} hover:-translate-y-1 transition-transform duration-300`}
            >
              <div className="flex items-center justify-between mb-6">
                <div className={`flex h-12 w-12 items-center justify-center rounded-2xl bg-muted ${line.accent}`}>
                  <line.icon className="h-6 w-6" />
                </div>
                <div className="text-right">
                  <div className="text-2xl font-extrabold text-foreground">₹{line.price}</div>
                  <div className="text-xs text-muted-foreground">/user/mo</div>
                </div>
              </div>
              <h3 className={`text-2xl font-bold ${line.accent}`}>{line.name}</h3>
              <p className="text-sm text-muted-foreground mb-6">{line.sub}</p>
              <ul className="space-y-3">
                {line.features.map((f) => (
                  <li key={f} className="flex items-start gap-2.5 text-sm text-foreground">
                    <Check className={`h-4 w-4 mt-0.5 shrink-0 ${line.accent}`} />
                    {f}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Base features included in every plan */}
        <div className="mt-8 rounded-3xl border border-border bg-muted/30 p-6 md:p-8">
          <div className="flex flex-col md:flex-row md:items-center gap-4 md:gap-8">
            <div className="shrink-0">
              <p className="text-sm font-semibold text-foreground">Included in every plan</p>
              <p className="text-xs text-muted-foreground">The essentials, no matter which line you buy</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {BASE.map((b) => (
                <span
                  key={b}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground"
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                  {b}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
