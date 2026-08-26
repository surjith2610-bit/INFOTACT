import React from "react";
import { Phone, MessageSquare } from "lucide-react";

export default function FloatingCTA() {
  const whatsappUrl = `https://wa.me/916382970348?text=${encodeURIComponent("Hello Mani Welding Works, I would like to get a price quote for a custom grill gate / fabrication project.")}`;

  return (
    <div className="fixed bottom-4 left-4 right-4 z-40 sm:hidden flex items-center gap-3">
      {/* Phone Call CTA */}
      <a
        href="tel:6382970348"
        className="flex-1 bg-gradient-to-r from-orange-600 to-amber-500 text-white font-bold text-xs py-3.5 px-4 rounded-2xl shadow-2xl spark-glow flex items-center justify-center gap-2 border border-orange-400/30"
      >
        <Phone className="w-4 h-4 fill-current" />
        <span>CALL 6382970348</span>
      </a>

      {/* WhatsApp CTA */}
      <a
        href={whatsappUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs py-3.5 px-4 rounded-2xl shadow-2xl flex items-center justify-center gap-2 border border-emerald-400/30"
      >
        <MessageSquare className="w-4 h-4 fill-current" />
        <span>WHATSAPP</span>
      </a>
    </div>
  );
}
