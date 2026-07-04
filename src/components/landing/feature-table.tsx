"use client";

import { Check, Minus, Info } from "lucide-react";
import { Fragment } from "react";

const features = [
  {
    category: "Core CRM (Business OS)",
    items: [
      { name: "Users", basic: "Min 3 Users", pro: "Min 3 Users", ent: "Min 3 Users" },
      { name: "Contacts", basic: "Unlimited", pro: "Unlimited", ent: "Unlimited" },
      { name: "Custom Fields & Tags", basic: true, pro: true, ent: true },
      { name: "Deal Pipelines", basic: true, pro: true, ent: true },
      { name: "Products & Quotations", basic: true, pro: true, ent: true },
      { name: "Task Management", basic: true, pro: true, ent: true },
    ]
  },
  {
    category: "WhatsApp Capabilities",
    items: [
      { name: "Official Meta API Integration", basic: false, pro: true, ent: true },
      { name: "Shared Team Inbox", basic: false, pro: true, ent: true },
      { name: "Message Templates", basic: false, pro: true, ent: true },
      { name: "Industry-ready Templates", basic: false, pro: true, ent: true },
      { name: "Broadcasts & Campaigns", basic: false, pro: "Fair-use limits", ent: "Fair-use limits" },
    ]
  },
  {
    category: "Workflow & AI",
    items: [
      { name: "Basic Automations", basic: false, pro: true, ent: true },
      { name: "Agentic AI Assistant", basic: false, pro: false, ent: true },
      { name: "AI Knowledge Base Training", basic: false, pro: false, ent: true },
      { name: "Advanced Flows (Drag-and-Drop)", basic: false, pro: false, ent: true },
    ]
  },
  {
    category: "Support & Add-ons",
    items: [
      { name: "Priority Support", basic: "Standard", pro: "Standard", ent: "VIP Dedicated" },
      { name: "Onboarding Assistance", basic: false, pro: false, ent: true },
      { name: "Field Force Location Tracking", basic: "₹200/user add-on", pro: "₹200/user add-on", ent: "₹200/user add-on" },
    ]
  }
];

export function FeatureTable() {
  const renderValue = (value: boolean | string) => {
    if (typeof value === 'boolean') {
      return value 
        ? <Check className="h-5 w-5 text-green-500 mx-auto" /> 
        : <Minus className="h-5 w-5 text-muted-foreground/30 mx-auto" />;
    }
    return <span className="text-sm font-medium text-foreground">{value}</span>;
  };

  return (
    <section className="py-24 bg-muted/20">
      <div className="max-w-5xl mx-auto px-6">
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-5xl font-bold tracking-tight text-foreground mb-4">
            Compare all features
          </h2>
          <p className="text-lg text-muted-foreground">
            A detailed breakdown of everything included in our plans.
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[800px]">
            <thead>
              <tr>
                <th className="w-2/5 p-4 border-b border-border text-lg font-bold text-foreground">Features</th>
                <th className="w-1/5 p-4 border-b border-border text-center text-lg font-bold text-slate-500">Basic</th>
                <th className="w-1/5 p-4 border-b border-border text-center text-lg font-bold text-blue-500">Pro</th>
                <th className="w-1/5 p-4 border-b border-border text-center text-lg font-bold text-violet-500">Enterprise</th>
              </tr>
            </thead>
            <tbody>
              {features.map((section, idx) => (
                <Fragment key={idx}>
                  <tr>
                    <td colSpan={4} className="p-4 bg-muted/40 font-semibold text-foreground border-b border-border">
                      {section.category}
                    </td>
                  </tr>
                  {section.items.map((item, i) => (
                    <tr key={i} className="hover:bg-muted/10 transition-colors">
                      <td className="p-4 border-b border-border text-sm text-muted-foreground flex items-center gap-2">
                        {item.name}
                      </td>
                      <td className="p-4 border-b border-border text-center">
                        {renderValue(item.basic)}
                      </td>
                      <td className="p-4 border-b border-border text-center bg-blue-500/5">
                        {renderValue(item.pro)}
                      </td>
                      <td className="p-4 border-b border-border text-center bg-violet-500/5">
                        {renderValue(item.ent)}
                      </td>
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
