"use client";

import { Plus } from "lucide-react";

const FAQS = [
  {
    q: "What's the difference between CRM, WFA and SFA?",
    a: "CRM is for winning and keeping customers — leads, deals, WhatsApp and quotations. WFA (Workforce Automation) runs your field team — GPS, attendance, visits, expenses and beats. SFA adds sales & distribution — orders, payments, financials and dealer/distributor management, and it already includes everything in Workforce.",
  },
  {
    q: "Do I have to buy the whole platform?",
    a: "No. Pick a single line (CRM, WFA or SFA) or combine them (CRM + WFA, or CRM + SFA). Every plan includes the essentials — customers, products, tasks, attendance, leave, holiday and announcements.",
  },
  {
    q: "Is there a trial?",
    a: "Yes. A 10-day trial is ₹1,000 and a 30-day trial is ₹2,500, each for up to 10 users, and both are refundable when you move to a subscription. A trial gives you a real plan for the trial period.",
  },
  {
    q: "How does billing work?",
    a: "Prices are per user, per month, with a minimum of 3 users. Annual is the base rate; half-yearly adds 20% and quarterly adds 30% over the annual rate.",
  },
  {
    q: "Do I need the WhatsApp Business API?",
    a: "WhatsApp CRM — shared inbox, templates and the AI assistant — is included in any plan with the CRM line (CRM, CRM + WFA, CRM + SFA). You connect your official WhatsApp Business number to use it.",
  },
  {
    q: "Does it work without internet in the field?",
    a: "Yes. The Android app captures attendance, visits, orders, quotations, payments and expenses offline and syncs them automatically once the rep is back online.",
  },
];

export function FAQ() {
  return (
    <section id="faq" className="py-24">
      <div className="max-w-3xl mx-auto px-6">
        <div className="text-center mb-14">
          <h2 className="text-3xl md:text-5xl font-bold tracking-tight text-foreground mb-4">
            Frequently asked questions
          </h2>
          <p className="text-lg text-muted-foreground">Everything you need to know before you start.</p>
        </div>

        <div className="space-y-3">
          {FAQS.map((item) => (
            <details
              key={item.q}
              className="group rounded-2xl border border-border bg-card p-5 [&_svg]:open:rotate-45"
            >
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-base font-semibold text-foreground marker:hidden">
                {item.q}
                <Plus className="h-5 w-5 shrink-0 text-primary transition-transform duration-200" />
              </summary>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{item.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
