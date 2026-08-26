import React from "react";
import { Link } from "react-router-dom";
import { Phone, Flame, MapPin, Clock, Mail } from "lucide-react";

export default function Footer() {
  return (
    <footer id="contact" className="bg-slate-950 border-t border-slate-800 text-slate-400 pt-16 pb-24 sm:pb-16 font-sans">
      <div className="max-w-7xl mx-auto px-6 grid grid-cols-1 md:grid-cols-4 gap-10">
        {/* Brand Column */}
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-orange-600 to-amber-500 p-2 text-white flex items-center justify-center spark-glow">
              <Flame className="w-6 h-6 fill-current text-yellow-200" />
            </div>
            <div>
              <span className="text-xl font-black font-industrial tracking-wider uppercase text-white block leading-none">
                Mani Welding <span className="text-orange-500">Works</span>
              </span>
              <span className="text-[10px] text-slate-400 font-mono tracking-widest uppercase block mt-1">
                Precision Metal Fabrication
              </span>
            </div>
          </div>

          <p className="text-xs leading-relaxed text-slate-400">
            Tamil Nadu's trusted metal fabrication workshop specializing in CNC laser cut gates, stainless steel railings, and industrial structural welding.
          </p>
        </div>

        {/* Quick Links */}
        <div className="space-y-3">
          <h4 className="text-sm font-bold uppercase tracking-wider text-white">Quick Navigation</h4>
          <ul className="space-y-2 text-xs">
            <li><a href="#services" className="hover:text-orange-400 transition-colors">Grill Gate Fabrication</a></li>
            <li><a href="#services" className="hover:text-orange-400 transition-colors">Staircase & Balcony Railings</a></li>
            <li><a href="#services" className="hover:text-orange-400 transition-colors">Industrial Welding & Roofing</a></li>
            <li><a href="#gallery" className="hover:text-orange-400 transition-colors">Work Portfolio Gallery</a></li>
            <li><a href="#enquiry" className="hover:text-orange-400 transition-colors">Request Free Estimate</a></li>
          </ul>
        </div>

        {/* Contact Info */}
        <div className="space-y-3">
          <h4 className="text-sm font-bold uppercase tracking-wider text-white">Contact & Support</h4>
          <ul className="space-y-3 text-xs">
            <li className="flex items-center gap-2">
              <Phone className="w-4 h-4 text-emerald-400 flex-shrink-0" />
              <a href="tel:6382970348" className="text-slate-200 hover:text-orange-400 font-bold">
                6382970348
              </a>
            </li>
            <li className="flex items-start gap-2">
              <MapPin className="w-4 h-4 text-orange-400 flex-shrink-0 mt-0.5" />
              <span>Main Road, Industrial Estate, Tamil Nadu, India</span>
            </li>
            <li className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-amber-400 flex-shrink-0" />
              <span>Mon - Sat: 8:00 AM - 8:30 PM</span>
            </li>
          </ul>
        </div>

        {/* Admin Link & Portal Info */}
        <div className="space-y-3">
          <h4 className="text-sm font-bold uppercase tracking-wider text-white">Admin Management</h4>
          <p className="text-xs text-slate-400">
            Access lead management dashboard to view customer quotes and update lead statuses.
          </p>
          <Link
            to="/admin/enquiries"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-900 border border-slate-700 hover:border-orange-500 text-orange-400 text-xs font-mono font-bold transition-all"
          >
            <span>Open Admin Dashboard</span>
          </Link>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 pt-12 mt-12 border-t border-slate-900 text-center text-xs text-slate-500">
        © {new Date().getFullYear()} Mani Welding Works. All rights reserved. Precision Welding & Metal Fabrication.
      </div>
    </footer>
  );
}
