"use client";

import { useState } from "react";
import { Building2, GraduationCap, ShoppingBag, Stethoscope, Briefcase, Plane, Car, Dumbbell, Calendar, Landmark, Code, Wrench } from "lucide-react";
import { cn } from "@/lib/utils";

const industries = [
  {
    id: "real-estate",
    name: "Real Estate & Agencies",
    icon: Building2,
    painPoint: "Agents lose leads because they don't reply fast enough. Managers have zero visibility into whether field agents actually visited the site. You're paying for a CRM, a bulk SMS tool, and a GPS tracker separately.",
    solution: "A unified system where every Facebook/MagicBricks lead gets an instant WhatsApp brochure. Managers track agent site visits via GPS, and AI answers basic property queries 24/7.",
    workflow: "Lead Captured ➔ Auto-WhatsApp Brochure ➔ Pipeline Stage Updated ➔ Agent GPS Check-in at Site ➔ AI Follow-up",
    imageGradient: "from-blue-500/30 via-cyan-400/20 to-transparent",
    textColor: "text-white",
    bgGradient: "bg-gradient-to-br from-blue-500 to-cyan-400"
  },
  {
    id: "edtech",
    name: "Education & EdTech",
    icon: GraduationCap,
    painPoint: "Admissions teams are overwhelmed with identical WhatsApp queries about fees and batch timings. Important broadcast updates (exams, holidays) via standard SMS get ignored or marked as spam.",
    solution: "Deploy an Agentic AI on your official WhatsApp number that knows your entire syllabus and fee structure. Broadcast visually rich templates to students that boast a 98% open rate.",
    workflow: "Student Inquiry on WhatsApp ➔ AI Answers FAQs ➔ Tagged as 'Interested in Python' ➔ Automated Enrollment Link Sent ➔ Fee Reminder Broadcast",
    imageGradient: "from-violet-500/30 via-fuchsia-400/20 to-transparent",
    textColor: "text-white",
    bgGradient: "bg-gradient-to-br from-violet-500 to-fuchsia-400"
  },
  {
    id: "retail",
    name: "E-Commerce & Retail",
    icon: ShoppingBag,
    painPoint: "Customers abandon carts and ignore marketing emails. Support tickets pile up for simple 'Where is my order?' queries. B2B bulk orders require manual PDF quotation generation.",
    solution: "Send automated WhatsApp cart recovery messages with direct checkout links. Let AI handle order tracking queries instantly. Generate and send PDF quotations for B2B deals with one click.",
    workflow: "Cart Abandoned ➔ WhatsApp Recovery Offer ➔ Order Placed ➔ Auto-Tracking Updates ➔ AI Handles 'Where is my order?'",
    imageGradient: "from-amber-500/30 via-orange-400/20 to-transparent",
    textColor: "text-white",
    bgGradient: "bg-gradient-to-br from-amber-500 to-orange-400"
  },
  {
    id: "healthcare",
    name: "Healthcare & Clinics",
    icon: Stethoscope,
    painPoint: "No-shows cost clinics thousands. Receptionists spend hours calling patients to confirm appointments. Medical records and follow-up reminders are scattered across paper and basic software.",
    solution: "Automated WhatsApp appointment confirmations and 24-hour reminders. Post-visit care instructions and health checkup camp broadcasts sent directly to tagged patient segments.",
    workflow: "Appointment Booked ➔ WhatsApp Confirmation ➔ 24hr Reminder ➔ Post-Visit Care PDF Sent ➔ Follow-up Tag Added",
    imageGradient: "from-emerald-500/30 via-teal-400/20 to-transparent",
    textColor: "text-white",
    bgGradient: "bg-gradient-to-br from-emerald-500 to-teal-400"
  },
  {
    id: "b2b",
    name: "B2B Sales & Agencies",
    icon: Briefcase,
    painPoint: "Sales cycles are long and complex. Reps forget to log meeting notes. Following up is entirely manual, leading to cold deals slipping through the cracks.",
    solution: "Visual drag-and-drop deal pipelines. Automate WhatsApp check-ins based on deal stages. Field reps log locations automatically, and quotations are generated straight from the CRM.",
    workflow: "Discovery Call Logged ➔ Deal Moved to 'Negotiation' ➔ Auto-WhatsApp Quotation Sent ➔ Rep GPS Check-in at Client Office ➔ Deal Won",
    imageGradient: "from-rose-500/30 via-pink-400/20 to-transparent",
    textColor: "text-white",
    bgGradient: "bg-gradient-to-br from-rose-500 to-pink-400"
  },
  {
    id: "travel",
    name: "Travel & Tourism",
    icon: Plane,
    painPoint: "Managing inquiries for 50 different destinations simultaneously is chaos. Sending flight updates, itineraries, and hotel vouchers via email results in travelers missing vital info.",
    solution: "AI qualifies the lead by asking their preferred destination and budget. Send rich PDF itineraries directly to WhatsApp. Broadcast urgent flight changes instantly.",
    workflow: "Inquiry Received ➔ AI Asks Destination/Budget ➔ Deal Created ➔ PDF Itinerary Sent ➔ Post-Trip Feedback Collection",
    imageGradient: "from-sky-500/30 via-blue-400/20 to-transparent",
    textColor: "text-white",
    bgGradient: "bg-gradient-to-br from-sky-500 to-blue-400"
  },
  {
    id: "auto",
    name: "Automotive Dealerships",
    icon: Car,
    painPoint: "Test drive leads go cold. Service centers struggle to remind customers about pending maintenance, and mechanics lack an easy way to share repair estimates.",
    solution: "Automate test drive confirmations. Set up recurring workflows to send service reminders every 6 months. Send instant repair quotations as PDFs to get quick approvals via WhatsApp.",
    workflow: "Test Drive Booked ➔ WhatsApp Confirmation/Location Sent ➔ Car Purchased ➔ 6-Month Service Reminder Flow Triggered",
    imageGradient: "from-slate-500/30 via-zinc-400/20 to-transparent",
    textColor: "text-white",
    bgGradient: "bg-gradient-to-br from-slate-500 to-zinc-400"
  },
  {
    id: "fitness",
    name: "Fitness & Gyms",
    icon: Dumbbell,
    painPoint: "Members churn because they feel ignored. Trainers struggle to distribute diet plans at scale. Membership renewal reminders are manual and awkward.",
    solution: "Drip-feed daily workout videos and diet PDFs to members via WhatsApp. Automate membership renewal reminders 7 days before expiry with a payment link.",
    workflow: "Member Joined ➔ Welcome Video Sent ➔ Daily Diet PDF Drip Campaign ➔ Day 350 Renewal Reminder + Payment Link",
    imageGradient: "from-orange-500/30 via-amber-400/20 to-transparent",
    textColor: "text-white",
    bgGradient: "bg-gradient-to-br from-orange-500 to-amber-400"
  },
  {
    id: "events",
    name: "Event Management",
    icon: Calendar,
    painPoint: "Collecting RSVPs via Google Forms is clunky. Sending last-minute venue changes or parking instructions via email guarantees half the guests won't see it.",
    solution: "Collect RSVPs via interactive WhatsApp buttons. Tag attendees automatically. Broadcast digital tickets and real-time event updates straight to their phones.",
    workflow: "RSVP Broadcast Sent ➔ User Taps 'Attending' Button ➔ Tagged as 'Confirmed' ➔ Digital Ticket Sent ➔ Day-Of Parking Instructions Broadcast",
    imageGradient: "from-pink-500/30 via-rose-400/20 to-transparent",
    textColor: "text-white",
    bgGradient: "bg-gradient-to-br from-pink-500 to-rose-400"
  },
  {
    id: "finance",
    name: "Finance & Insurance",
    icon: Landmark,
    painPoint: "Collecting KYC documents via email takes weeks. Clients forget to pay premiums on time, leading to lapsed policies and lost revenue.",
    solution: "Allow clients to securely snap and send KYC docs directly in the WhatsApp chat. Automate premium payment reminders with integrated tracking.",
    workflow: "Policy Issued ➔ Request KYC via WhatsApp ➔ Docs Uploaded to Shared Inbox ➔ 11-Month Premium Reminder Flow Initiated",
    imageGradient: "from-emerald-600/30 via-green-500/20 to-transparent",
    textColor: "text-white",
    bgGradient: "bg-gradient-to-br from-emerald-600 to-green-500"
  },
  {
    id: "saas",
    name: "SaaS & Software",
    icon: Code,
    painPoint: "Trial users don't convert because they don't log in. New feature announcements get lost in spam folders. Support queries overwhelm engineering teams.",
    solution: "Send onboarding tips via WhatsApp to bring them back to the app. AI handles level-1 support ('How do I reset my password?'), escalating only real bugs to humans.",
    workflow: "Trial Started ➔ Day 1 Welcome Tip ➔ Day 7 Feature Highlight ➔ Day 14 Upgrade Offer ➔ AI Handles 'How to upgrade' Query",
    imageGradient: "from-indigo-500/30 via-blue-500/20 to-transparent",
    textColor: "text-white",
    bgGradient: "bg-gradient-to-br from-indigo-500 to-blue-500"
  },
  {
    id: "home",
    name: "Home Services",
    icon: Wrench,
    painPoint: "Customers demand instant estimates for plumbing/cleaning. Dispatching staff and tracking their arrival time is a chaotic mix of phone calls and guesswork.",
    solution: "AI provides instant rough estimates based on photos sent by the customer. Field staff log their live location upon reaching the house, updating the CRM instantly.",
    workflow: "Customer Sends Photo of Leak ➔ AI Gives Estimate Range ➔ Plumber Dispatched ➔ Plumber GPS Check-in at House ➔ Auto-Invoice Sent",
    imageGradient: "from-yellow-500/30 via-orange-400/20 to-transparent",
    textColor: "text-white",
    bgGradient: "bg-gradient-to-br from-yellow-500 to-orange-400"
  }
];

export function IndustryUseCases() {
  const [activeTab, setActiveTab] = useState(industries[0].id);
  const activeIndustry = industries.find(i => i.id === activeTab)!;

  return (
    <section id="industries" className="py-24 bg-background">
      <div className="max-w-7xl mx-auto px-6">
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-5xl font-bold tracking-tight text-foreground mb-4">
            Built for your industry
          </h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Discover how companies across different sectors use our BOS to drive growth, automate operations, and delight customers.
          </p>
        </div>

        <div className="flex flex-col lg:flex-row gap-12">
          {/* Tabs */}
          <div className="lg:w-1/3 flex flex-col gap-2 overflow-y-auto max-h-[700px] pr-2 custom-scrollbar">
            {industries.map((ind) => {
              const isActive = activeTab === ind.id;
              return (
                <button
                  key={ind.id}
                  onClick={() => setActiveTab(ind.id)}
                  className={cn(
                    "flex items-center gap-4 px-6 py-4 rounded-xl text-left transition-all",
                    isActive 
                      ? "bg-primary text-primary-foreground shadow-md scale-[1.02]" 
                      : "bg-card text-muted-foreground border border-border hover:bg-muted"
                  )}
                >
                  <ind.icon className="h-6 w-6 shrink-0" />
                  <span className="font-bold text-lg">{ind.name}</span>
                </button>
              );
            })}
          </div>

          {/* Content Panel */}
          <div className="lg:w-2/3">
            <div className={`relative h-full rounded-3xl border border-white/5 bg-card/40 backdrop-blur-2xl p-8 md:p-12 shadow-2xl transition-colors duration-500 overflow-hidden`}>
              <div className={`absolute inset-0 bg-gradient-to-br ${activeIndustry.imageGradient} pointer-events-none transition-colors duration-500`} />
              
              <div className="relative z-10">
                <div className="flex items-center gap-5 mb-10">
                  <div className={`p-4 rounded-2xl shadow-lg ${activeIndustry.bgGradient}`}>
                    <activeIndustry.icon className={`h-8 w-8 ${activeIndustry.textColor}`} />
                  </div>
                  <h3 className="text-3xl md:text-4xl font-extrabold text-foreground tracking-tight">{activeIndustry.name}</h3>
                </div>
                
                <div className="space-y-6">
                  <div className="bg-background/40 backdrop-blur-md p-6 rounded-2xl border border-white/5 shadow-sm">
                    <h4 className="text-sm font-bold uppercase tracking-wider text-red-400 mb-2">The Market Gap</h4>
                    <p className="text-foreground/90 font-medium leading-relaxed">{activeIndustry.painPoint}</p>
                  </div>
                  
                  <div className="bg-background/40 backdrop-blur-md p-6 rounded-2xl border border-white/5 shadow-sm">
                    <h4 className="text-sm font-bold uppercase tracking-wider text-green-400 mb-2">The WACRM Solution</h4>
                    <p className="text-foreground/90 font-medium leading-relaxed">{activeIndustry.solution}</p>
                  </div>

                  <div className="bg-background/80 backdrop-blur-xl p-6 rounded-2xl border border-white/10 shadow-lg mt-8">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-4">Automated Workflow Example</h4>
                    <div className="flex flex-wrap items-center gap-2 text-sm font-bold text-foreground">
                      {activeIndustry.workflow.split(' ➔ ').map((step, i, arr) => (
                        <span key={i} className="flex items-center gap-2">
                          <span className={`px-3 py-1.5 rounded-lg bg-card border border-border shadow-sm`}>
                            {step}
                          </span>
                          {i < arr.length - 1 && <span className="text-muted-foreground">➔</span>}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
