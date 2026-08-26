import React, { useState } from "react";
import { Link } from "react-router-dom";
import { Phone, Flame, Menu, X, Shield, Wrench } from "lucide-react";

export default function Navbar() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 bg-slate-950/90 backdrop-blur-md border-b border-slate-800 shadow-xl">
      {/* Top Contact Notice Bar */}
      <div className="bg-slate-900 border-b border-slate-800 py-1.5 px-6 text-xs text-slate-300 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1.5 text-orange-400 font-semibold">
            <Flame className="w-3.5 h-3.5" /> High Precision Heavy Metal & Sheet Fabrication
          </span>
          <span className="hidden md:inline text-slate-500">|</span>
          <span className="hidden md:inline text-slate-400">Serving Homeowners, Builders & Contractors</span>
        </div>
        <div className="flex items-center gap-4">
          <a href="tel:6382970348" className="flex items-center gap-1.5 font-bold text-white hover:text-orange-400 transition-colors">
            <Phone className="w-3.5 h-3.5 text-emerald-400" />
            <span>Call: 6382970348</span>
          </a>
          <Link to="/admin/enquiries" className="text-slate-400 hover:text-white transition-colors underline font-mono text-[11px]">
            Admin Portal
          </Link>
        </div>
      </div>

      {/* Main Navbar */}
      <div className="max-w-7xl mx-auto px-6 py-3.5 flex items-center justify-between">
        {/* Brand Logo */}
        <Link to="/" className="flex items-center gap-3 group">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-orange-600 to-amber-500 p-2 text-white flex items-center justify-center shadow-lg group-hover:scale-105 transition-transform spark-glow">
            <Flame className="w-6 h-6 fill-current text-yellow-200" />
          </div>
          <div>
            <span className="text-xl font-black font-industrial tracking-wider uppercase text-white block leading-none">
              Mani Welding <span className="text-orange-500">Works</span>
            </span>
            <span className="text-[10px] text-slate-400 font-mono tracking-widest uppercase block mt-1">
              Grill Gate & Steel Fabrication
            </span>
          </div>
        </Link>

        {/* Desktop Nav Links */}
        <nav className="hidden md:flex items-center gap-8 text-sm font-semibold text-slate-300">
          <a href="#services" className="hover:text-orange-400 transition-colors">Services</a>
          <a href="#gallery" className="hover:text-orange-400 transition-colors">Gallery</a>
          <a href="#enquiry" className="hover:text-orange-400 transition-colors">Get Quote</a>
          <a href="#contact" className="hover:text-orange-400 transition-colors">Contact Us</a>
        </nav>

        {/* Phone CTA Button */}
        <div className="hidden lg:flex items-center gap-3">
          <a
            href="tel:6382970348"
            className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-orange-600 to-amber-500 hover:from-orange-500 hover:to-amber-400 text-white font-bold text-xs uppercase tracking-wider shadow-md spark-glow transition-transform hover:scale-105 flex items-center gap-2"
          >
            <Phone className="w-4 h-4" />
            <span>6382970348</span>
          </a>
        </div>

        {/* Mobile Menu Toggle Button */}
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="md:hidden p-2 text-slate-300 hover:text-white"
        >
          {isOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
        </button>
      </div>

      {/* Mobile Menu Dropdown */}
      {isOpen && (
        <div className="md:hidden bg-slate-900 border-t border-slate-800 px-6 py-4 space-y-3 font-semibold text-sm text-slate-200">
          <a href="#services" onClick={() => setIsOpen(false)} className="block py-1 hover:text-orange-400">Services</a>
          <a href="#gallery" onClick={() => setIsOpen(false)} className="block py-1 hover:text-orange-400">Gallery</a>
          <a href="#enquiry" onClick={() => setIsOpen(false)} className="block py-1 hover:text-orange-400">Get Quote</a>
          <a href="#contact" onClick={() => setIsOpen(false)} className="block py-1 hover:text-orange-400">Contact Us</a>
          <div className="pt-2">
            <a
              href="tel:6382970348"
              className="w-full py-3 rounded-xl bg-emerald-600 text-white font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-2"
            >
              <Phone className="w-4 h-4" />
              <span>Call 6382970348</span>
            </a>
          </div>
        </div>
      )}
    </header>
  );
}
