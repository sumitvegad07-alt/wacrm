"use client";

import { UserPlus, Bot, UserCheck, FileText, CreditCard, Rocket, HeartHandshake, TrendingUp } from "lucide-react";

const funnelSteps = [
  {
    icon: UserPlus,
    title: "1. Capture & Qualify",
    description: "A customer messages your WhatsApp number. The AI instantly replies, asks pre-qualifying questions, and automatically creates a Deal in your CRM pipeline.",
    gradient: "from-blue-500 to-cyan-400"
  },
  {
    icon: Bot,
    title: "2. 24/7 AI Engagement",
    description: "The prospect asks about pricing or features. Your Agentic AI, trained on your knowledge base, answers perfectly in seconds without human intervention.",
    gradient: "from-violet-500 to-purple-400"
  },
  {
    icon: UserCheck,
    title: "3. Seamless Human Handover",
    description: "The AI detects a complex query or buying intent and seamlessly pauses itself, assigning the chat to a live sales rep in the Shared Inbox.",
    gradient: "from-fuchsia-500 to-pink-400"
  },
  {
    icon: FileText,
    title: "4. Automated Quotations",
    description: "The sales rep selects products from the catalog and instantly generates a professional PDF quotation, sending it directly in the WhatsApp chat.",
    gradient: "from-amber-500 to-orange-400"
  },
  {
    icon: CreditCard,
    title: "5. Frictionless Payment",
    description: "The prospect approves the quote. An automated flow triggers a payment link via WhatsApp. Once paid, the pipeline stage automatically moves to 'Won'.",
    gradient: "from-emerald-500 to-teal-400"
  },
  {
    icon: Rocket,
    title: "6. Instant Onboarding",
    description: "Moving to 'Won' triggers your onboarding workflow. Welcome messages, tutorial PDFs, and account details are dripped to the customer automatically.",
    gradient: "from-blue-600 to-indigo-500"
  },
  {
    icon: HeartHandshake,
    title: "7. Proactive Support",
    description: "Post-sale, the AI continues to handle level-1 support queries (e.g., 'How do I reset my password?') freeing up your team completely.",
    gradient: "from-rose-500 to-red-400"
  },
  {
    icon: TrendingUp,
    title: "8. Targeted Upsell",
    description: "30 days later, the CRM automatically filters tagged customers and broadcasts a highly targeted upsell offer directly to their WhatsApp.",
    gradient: "from-primary to-violet-500"
  }
];

export function FullFunnelSection() {
  return (
    <section className="py-24 bg-card border-y border-border relative overflow-hidden">
      {/* Background elements */}
      <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-primary/5 rounded-full blur-[100px] pointer-events-none" />
      <div className="absolute bottom-0 left-0 w-[500px] h-[500px] bg-violet-500/5 rounded-full blur-[100px] pointer-events-none" />

      <div className="max-w-7xl mx-auto px-6 relative z-10">
        <div className="text-center mb-16 max-w-3xl mx-auto">
          <h2 className="text-3xl md:text-5xl font-bold tracking-tight text-foreground mb-6">
            The Ultimate WhatsApp Funnel
          </h2>
          <p className="text-lg text-muted-foreground">
            WACRM is the only platform that handles the <strong className="text-foreground">entire customer lifecycle</strong>—from a cold lead to a raving, repeat customer—without ever leaving WhatsApp.
          </p>
        </div>

        <div className="relative max-w-4xl mx-auto">
          {/* Vertical Connecting Line */}
          <div className="absolute left-[27px] md:left-1/2 top-0 bottom-0 w-0.5 bg-gradient-to-b from-blue-500 via-fuchsia-500 to-primary opacity-30 md:-translate-x-1/2" />

          <div className="space-y-12">
            {funnelSteps.map((step, index) => {
              const isEven = index % 2 === 0;
              return (
                <div key={index} className={`relative flex flex-col md:flex-row items-start md:items-center gap-8 ${isEven ? 'md:flex-row' : 'md:flex-row-reverse'}`}>
                  
                  {/* Icon Node */}
                  <div className="absolute left-0 md:left-1/2 -translate-x-1/2 w-14 h-14 rounded-2xl flex items-center justify-center bg-card border border-border shadow-xl z-10">
                    <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${step.gradient} flex items-center justify-center`}>
                      <step.icon className="h-5 w-5 text-white" />
                    </div>
                  </div>

                  {/* Content Box */}
                  <div className={`ml-20 md:ml-0 md:w-1/2 ${isEven ? 'md:pr-16 md:text-right' : 'md:pl-16 md:text-left'}`}>
                    <div className="bg-background/60 backdrop-blur-xl border border-white/5 p-6 rounded-3xl shadow-lg hover:shadow-xl hover:-translate-y-1 transition-all duration-300">
                      <h3 className="text-xl font-bold text-foreground mb-3">{step.title}</h3>
                      <p className="text-sm text-muted-foreground leading-relaxed">
                        {step.description}
                      </p>
                    </div>
                  </div>
                  
                  {/* Empty space for the other side in grid */}
                  <div className="hidden md:block md:w-1/2" />
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
