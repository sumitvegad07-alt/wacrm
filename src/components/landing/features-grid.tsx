"use client";

import { MessageSquare, GitBranch, MapPin, ShoppingCart, FileText, PieChart } from "lucide-react";

const features = [
  {
    title: "WhatsApp CRM",
    description: "A shared team inbox on your official WhatsApp number, message templates, and an AI assistant trained on your knowledge base to answer FAQs.",
    icon: MessageSquare,
    gradient: "from-emerald-500 to-teal-400",
  },
  {
    title: "Leads & Deal Pipelines",
    description: "Capture leads, qualify them, and move deals across visual Kanban pipelines with products, stages and custom fields.",
    icon: GitBranch,
    gradient: "from-violet-500 to-purple-400",
  },
  {
    title: "GPS, Attendance & Visits",
    description: "Live location for field reps, punch-in with selfie and GPS, geo-tagged customer visits, expenses and beat planning — all from the Android app.",
    icon: MapPin,
    gradient: "from-cyan-500 to-blue-400",
  },
  {
    title: "Orders & Collections",
    description: "Capture orders offline and sync them, run dispatch, collect payments in the field, and track outstanding and customer financials.",
    icon: ShoppingCart,
    gradient: "from-amber-500 to-orange-400",
  },
  {
    title: "Quotations & Documents",
    description: "Generate branded PDF quotations, orders, dispatch notes and payment receipts using your own company letterhead and templates.",
    icon: FileText,
    gradient: "from-fuchsia-500 to-pink-400",
  },
  {
    title: "Reports & DSR",
    description: "Eleven built-in reports across orders, sales, payments, leads, visits, expenses and more — plus a Daily Sales Report per rep.",
    icon: PieChart,
    gradient: "from-rose-500 to-red-400",
  },
];

export function FeaturesGrid() {
  return (
    <section id="features" className="py-24 bg-muted/30">
      <div className="max-w-7xl mx-auto px-6">
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-5xl font-bold tracking-tight text-foreground mb-4">
            Everything your field business runs on
          </h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Stop stitching five tools together. OZZO brings sales, field tracking,
            distribution and messaging into one connected system.
          </p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {features.map((feature, i) => (
            <div
              key={i}
              className="bg-card/50 backdrop-blur-xl border border-border p-8 rounded-3xl shadow-2xl hover:shadow-primary/5 transition-all duration-300 group hover:-translate-y-1 overflow-hidden relative"
            >
              <div className={`absolute inset-0 opacity-0 group-hover:opacity-10 bg-gradient-to-br ${feature.gradient} transition-opacity duration-500`} />

              <div className="relative z-10">
                <div className={`w-14 h-14 rounded-2xl flex items-center justify-center mb-6 shadow-lg bg-gradient-to-br ${feature.gradient} transition-transform duration-500 group-hover:scale-110 group-hover:rotate-3`}>
                  <feature.icon className="h-7 w-7 text-white" />
                </div>
                <h3 className="text-xl font-bold text-foreground mb-3 tracking-tight">{feature.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {feature.description}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
