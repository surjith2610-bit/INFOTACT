import React from "react";
import { ShieldAlert, Layers, Flame, Hammer, ArrowRight } from "lucide-react";

const servicesData = [
  {
    id: "grill-gate",
    title: "Grill Gate Fabrication",
    icon: ShieldAlert,
    tag: "Most Popular",
    desc: "Custom main entrance gates, laser-cut steel gates, sliding motorized gates, and heavy-duty security iron gates built to exact dimensions.",
    features: ["Laser-cut CNC sheet designs", "Rust-resistant primer coating", "Heavy-duty hinges & locks"]
  },
  {
    id: "railings",
    title: "Staircase & Balcony Railings",
    icon: Layers,
    tag: "High Demand",
    desc: "Elegant stainless steel (SS 304/316) staircase railings, toughened glass balcony handrails, and ornamental wrought iron balusters.",
    features: ["Mirror / Satin SS finish", "Custom glass fittings", "Indoor & outdoor durability"]
  },
  {
    id: "industrial",
    title: "Industrial Welding & Roofing",
    icon: Flame,
    tag: "Heavy Structural",
    desc: "Structural steel truss fabrication, industrial warehouse roofing sheds, factory pipe welding, and heavy machinery frame reinforcement.",
    features: ["High-penetration ARC/MIG welding", "Heavy gauge steel channels", "Weatherproof roofing sheets"]
  },
  {
    id: "custom",
    title: "Custom Steel & Metal Works",
    icon: Hammer,
    tag: "Customized",
    desc: "Tailored window safety grills, rolling shutters, steel pergolas, compound wall spikes, metal furniture frames, and repair work.",
    features: ["100% custom specifications", "On-site installation", "Fast turnaround time"]
  }
];

export default function ServicesSection() {
  return (
    <section id="services" className="py-20 bg-slate-950 relative">
      <div className="max-w-7xl mx-auto px-6">
        {/* Section Header */}
        <div className="text-center space-y-3 mb-16">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-orange-500/10 border border-orange-500/30 text-orange-400 text-xs font-semibold uppercase tracking-widest">
            <Flame className="w-3.5 h-3.5" /> Our Core Specialties
          </div>
          <h2 className="text-3xl sm:text-5xl font-extrabold font-industrial tracking-tight text-white uppercase">
            Fabrication & <span className="text-orange-500">Welding Services</span>
          </h2>
          <p className="text-slate-400 text-sm max-w-2xl mx-auto">
            From residential villa gates to heavy commercial steel structures, Mani Welding Works delivers precision, strength, and flawless finishing.
          </p>
        </div>

        {/* Services Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {servicesData.map((s) => {
            const Icon = s.icon;
            return (
              <div
                key={s.id}
                className="glass-card rounded-2xl p-8 border border-slate-800 hover:border-orange-500/50 transition-all duration-300 transform hover:-translate-y-1.5 spark-glow-hover flex flex-col justify-between group"
              >
                <div>
                  <div className="flex items-center justify-between mb-6">
                    <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-orange-600 to-amber-500 p-3 text-white flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform">
                      <Icon className="w-8 h-8" />
                    </div>
                    <span className="px-3 py-1 rounded-full bg-slate-800 border border-slate-700 text-orange-400 text-xs font-mono font-semibold">
                      {s.tag}
                    </span>
                  </div>

                  <h3 className="text-2xl font-bold text-white group-hover:text-orange-400 transition-colors mb-3">
                    {s.title}
                  </h3>

                  <p className="text-slate-300 text-sm leading-relaxed mb-6">
                    {s.desc}
                  </p>

                  <ul className="space-y-2 mb-8">
                    {s.features.map((feat, i) => (
                      <li key={i} className="flex items-center gap-2 text-xs text-slate-400">
                        <span className="w-1.5 h-1.5 rounded-full bg-orange-500" />
                        <span>{feat}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <a
                  href="#enquiry"
                  className="w-full py-3 rounded-xl bg-slate-900 group-hover:bg-orange-600 text-slate-200 group-hover:text-white font-bold text-xs uppercase tracking-wider transition-colors border border-slate-700 group-hover:border-orange-500 flex items-center justify-center gap-2"
                >
                  <span>Request Custom Quote</span>
                  <ArrowRight className="w-4 h-4" />
                </a>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
