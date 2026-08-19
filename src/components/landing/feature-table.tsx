"use client";

import { Check, Minus } from "lucide-react";
import { Fragment } from "react";

// Columns, in order: CRM, WFA, CRM+WFA, SFA, CRM+SFA.
const PLANS = [
  { label: "CRM", price: 100, highlight: false },
  { label: "WFA", price: 150, highlight: false },
  { label: "CRM + WFA", price: 200, highlight: true },
  { label: "SFA", price: 350, highlight: false },
  { label: "CRM + SFA", price: 450, highlight: false },
];

type Row = { name: string; soon?: boolean; on: [boolean, boolean, boolean, boolean, boolean] };

const SECTIONS: { category: string; items: Row[] }[] = [
  {
    category: "Included in every plan",
    items: [
      { name: "Customer Management", on: [true, true, true, true, true] },
      { name: "Product Management", on: [true, true, true, true, true] },
      { name: "Task Management", on: [true, true, true, true, true] },
      { name: "Attendance", on: [true, true, true, true, true] },
      { name: "Leave", on: [true, true, true, true, true] },
      { name: "Holiday", on: [true, true, true, true, true] },
      { name: "Announcements", on: [true, true, true, true, true] },
    ],
  },
  {
    category: "CRM",
    items: [
      { name: "Lead Management", on: [true, false, true, false, true] },
      { name: "Deal Pipeline", on: [true, false, true, false, true] },
      { name: "WhatsApp CRM", on: [true, false, true, false, true] },
      { name: "Quotation", on: [true, false, true, false, true] },
    ],
  },
  {
    category: "Workforce (WFA)",
    items: [
      { name: "GPS Tracking", on: [false, true, true, true, true] },
      { name: "Live Location", on: [false, true, true, true, true] },
      { name: "Route Playback", soon: true, on: [false, true, true, true, true] },
      { name: "Visit Management", on: [false, true, true, true, true] },
      { name: "Expense Management", on: [false, true, true, true, true] },
      { name: "Beat Planning", on: [false, true, true, true, true] },
      { name: "Territory Management", on: [false, true, true, true, true] },
      { name: "User Hierarchy", soon: true, on: [false, true, true, true, true] },
      { name: "Device Health", on: [false, true, true, true, true] },
    ],
  },
  {
    category: "Sales & Distribution (SFA)",
    items: [
      { name: "Order Management", on: [false, false, false, true, true] },
      { name: "Payment Collection", on: [false, false, false, true, true] },
      { name: "Outstanding Management", on: [false, false, false, true, true] },
      { name: "Customer Financials", on: [false, false, false, true, true] },
      { name: "Dealer Management", on: [false, false, false, true, true] },
      { name: "Distributor Management", on: [false, false, false, true, true] },
      { name: "Price Floor Control", on: [false, false, false, true, true] },
      { name: "Sales Analytics", on: [false, false, false, true, true] },
    ],
  },
];

export function FeatureTable() {
  return (
    <section className="py-24 bg-muted/20">
      <div className="max-w-6xl mx-auto px-6">
        <div className="text-center mb-14">
          <h2 className="text-3xl md:text-5xl font-bold tracking-tight text-foreground mb-4">
            Compare every plan
          </h2>
          <p className="text-lg text-muted-foreground">
            Exactly what&apos;s included, line by line. Prices are per user, per month.
          </p>
        </div>

        <div className="overflow-x-auto rounded-2xl border border-border">
          <table className="w-full text-left border-collapse min-w-[820px] bg-card">
            <thead>
              <tr>
                <th className="p-4 text-sm font-bold text-foreground sticky left-0 bg-card">Feature</th>
                {PLANS.map((p) => (
                  <th
                    key={p.label}
                    className={`p-4 text-center ${p.highlight ? "bg-primary/5" : ""}`}
                  >
                    <div className="text-sm font-bold text-foreground">{p.label}</div>
                    <div className="text-xs text-muted-foreground font-medium">₹{p.price}/mo</div>
                    {p.highlight && (
                      <div className="mt-1 inline-block rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-primary">
                        Popular
                      </div>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {SECTIONS.map((section, idx) => (
                <Fragment key={idx}>
                  <tr>
                    <td
                      colSpan={6}
                      className="px-4 py-2.5 bg-muted/50 text-xs font-bold uppercase tracking-wider text-muted-foreground border-y border-border"
                    >
                      {section.category}
                    </td>
                  </tr>
                  {section.items.map((item, i) => (
                    <tr key={i} className="border-b border-border/60 hover:bg-muted/20 transition-colors">
                      <td className="p-4 text-sm text-foreground sticky left-0 bg-card">
                        <span className="flex items-center gap-2">
                          {item.name}
                          {item.soon && (
                            <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-bold uppercase text-amber-500">
                              Soon
                            </span>
                          )}
                        </span>
                      </td>
                      {item.on.map((v, ci) => (
                        <td
                          key={ci}
                          className={`p-4 text-center ${PLANS[ci].highlight ? "bg-primary/5" : ""}`}
                        >
                          {v ? (
                            <Check className="h-5 w-5 text-emerald-500 mx-auto" />
                          ) : (
                            <Minus className="h-5 w-5 text-muted-foreground/30 mx-auto" />
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>

        <p className="text-center text-xs text-muted-foreground mt-6">
          Items marked <span className="font-semibold text-amber-500">Soon</span> are on the near-term roadmap.
          Billing cycles: annual is the base rate, half-yearly +20%, quarterly +30%.
        </p>
      </div>
    </section>
  );
}
