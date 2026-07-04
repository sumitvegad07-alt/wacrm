"use client";

import { MessageSquare, Users, GitBranch, Zap, Bot, MapPin } from "lucide-react";

const features = [
  {
    title: "Official WhatsApp API",
    description: "Connect your official WhatsApp Business number. Broadcast messages, use rich templates, and manage a shared team inbox.",
    icon: MessageSquare,
    gradient: "from-blue-500 to-cyan-400",
  },
  {
    title: "Intelligent CRM",
    description: "Manage unlimited contacts, create custom fields, tag segments, and track interaction history automatically.",
    icon: Users,
    gradient: "from-violet-500 to-purple-400",
  },
  {
    title: "Pipeline & Deals",
    description: "Visualize your sales process. Move deals across stages, generate custom quotations, and manage product catalogs.",
    icon: GitBranch,
    gradient: "from-fuchsia-500 to-pink-400",
  },
  {
    title: "Visual Automations",
    description: "Build complex workflows without code. Trigger WhatsApp messages based on deal stages, tags, or incoming keywords.",
    icon: Zap,
    gradient: "from-amber-500 to-orange-400",
  },
  {
    title: "Agentic AI Assistant",
    description: "Train an AI on your knowledge base. Let it answer FAQs, draft smart replies, and handle level-1 support 24/7.",
    icon: Bot,
    gradient: "from-emerald-500 to-teal-400",
  },
  {
    title: "Field Force Tracking",
    description: "Live GPS tracking for your on-ground sales team. Log location data automatically when closing deals or completing tasks.",
    icon: MapPin,
    gradient: "from-rose-500 to-red-400",
  },
];

export function FeaturesGrid() {
  return (
    <section id="features" className="py-24 bg-muted/30">
      <div className="max-w-7xl mx-auto px-6">
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-5xl font-bold tracking-tight text-foreground mb-4">
            Everything you need in one BOS
          </h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Stop juggling 5 different tools. WACRM integrates your sales, support, and marketing into a single, cohesive operating system.
          </p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {features.map((feature, i) => (
            <div
              key={i}
              className="bg-card/50 backdrop-blur-xl border border-white/5 p-8 rounded-3xl shadow-2xl hover:shadow-primary/5 transition-all duration-300 group hover:-translate-y-1 overflow-hidden relative"
            >
              {/* Subtle background gradient glow on hover */}
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
