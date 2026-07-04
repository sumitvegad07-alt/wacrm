"use client";

import { MessageCircle, Phone, X } from "lucide-react";
import { useState } from "react";

export function FloatingWidget() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end gap-4">
      {isOpen && (
        <div className="flex flex-col gap-3 animate-in slide-in-from-bottom-5 fade-in duration-300">
          <a
            href="tel:+919876543210"
            className="flex items-center gap-3 bg-card border border-border p-3 rounded-full shadow-xl hover:shadow-2xl hover:scale-105 transition-all group"
          >
            <span className="text-sm font-bold text-foreground px-2">Call Sales</span>
            <div className="bg-blue-500 h-10 w-10 rounded-full flex items-center justify-center text-white shadow-lg shadow-blue-500/30 group-hover:bg-blue-600 transition-colors">
              <Phone className="h-5 w-5" />
            </div>
          </a>
          <a
            href="https://wa.me/919876543210"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-3 bg-card border border-border p-3 rounded-full shadow-xl hover:shadow-2xl hover:scale-105 transition-all group"
          >
            <span className="text-sm font-bold text-foreground px-2">Chat on WhatsApp</span>
            <div className="bg-[#25D366] h-10 w-10 rounded-full flex items-center justify-center text-white shadow-lg shadow-[#25D366]/30 group-hover:bg-[#128C7E] transition-colors">
              <MessageCircle className="h-5 w-5" />
            </div>
          </a>
        </div>
      )}

      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`h-16 w-16 rounded-full flex items-center justify-center shadow-2xl transition-all duration-300 hover:scale-110 ${
          isOpen 
            ? "bg-muted text-foreground border border-border rotate-90" 
            : "bg-gradient-to-tr from-primary to-violet-500 text-white hover:shadow-primary/40 animate-pulse"
        }`}
      >
        {isOpen ? <X className="h-8 w-8" /> : <MessageCircle className="h-8 w-8" />}
      </button>
    </div>
  );
}
