import React, { useState } from "react";
import { Flame, Maximize2, X, CheckCircle } from "lucide-react";

const galleryItems = [
  {
    id: "laser-cut",
    title: "Modern CNC Laser-Cut Villa Gate",
    style: "Contemporary CNC Laser Cut",
    finish: "Matte Black & LED Backlight",
    image: "/images/laser_cut_gate.jpg",
    desc: "Precision CNC cut geometric steel sheets framed with heavy square hollow tubes and integrated warm LED accent lights."
  },
  {
    id: "traditional-iron",
    title: "Grand Wrought Iron Entrance Gate",
    style: "Traditional Heritage Wrought Iron",
    finish: "Satin Black & Gold Leaf Highlights",
    image: "/images/traditional_iron_gate.jpg",
    desc: "Handcrafted classical scrollwork wrought iron main gate with antique brass ornament studs and golden crest emblem."
  },
  {
    id: "luxury-villa",
    title: "Designer Stainless Steel & Teak Gate",
    style: "Luxury Stainless Composite",
    finish: "Polished SS 304 & Natural Teak Wood",
    image: "/images/luxury_villa_gate.jpg",
    desc: "Architectural sliding entrance gate combining corrosion-resistant polished stainless steel border with weather-sealed teak wood slats."
  },
  {
    id: "industrial-heavy",
    title: "Heavy-Duty Industrial Security Gate",
    style: "Commercial Industrial Grade",
    finish: "Powder Coated Dark Slate Grey",
    image: "/images/industrial_heavy_gate.jpg",
    desc: "High-security cantilever sliding track gate built with thick solid steel bars and heavy-duty roller bearing assemblies."
  }
];

export default function GallerySection() {
  const [activeModalItem, setActiveModalItem] = useState(null);

  return (
    <section id="gallery" className="py-20 bg-slate-900 border-t border-b border-slate-800 relative">
      <div className="max-w-7xl mx-auto px-6">
        {/* Section Header */}
        <div className="text-center space-y-3 mb-16">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-orange-500/10 border border-orange-500/30 text-orange-400 text-xs font-semibold uppercase tracking-widest">
            <Flame className="w-3.5 h-3.5" /> Handcrafted Work Portfolio
          </div>
          <h2 className="text-3xl sm:text-5xl font-extrabold font-industrial tracking-tight text-white uppercase">
            Featured <span className="text-orange-500">Grill Gate Gallery</span>
          </h2>
          <p className="text-slate-400 text-sm max-w-2xl mx-auto">
            Explore our custom grill gate designs. Each gate is fabricated to order with premium grade steel, anti-rust coating, and flawless welds.
          </p>
        </div>

        {/* Gallery Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {galleryItems.map((item) => (
            <div
              key={item.id}
              className="group glass-card rounded-2xl overflow-hidden border border-slate-800 hover:border-orange-500/50 transition-all duration-500 shadow-xl cursor-pointer"
              onClick={() => setActiveModalItem(item)}
            >
              {/* Image Container with Zoom */}
              <div className="relative aspect-[4/3] overflow-hidden bg-slate-950">
                <img
                  src={item.image}
                  alt={item.title}
                  className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700 ease-out"
                />
                
                {/* Overlay Glow */}
                <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/20 to-transparent opacity-80 group-hover:opacity-90 transition-opacity" />

                {/* Top Badge */}
                <div className="absolute top-4 left-4 z-10">
                  <span className="px-3 py-1 rounded-full bg-slate-950/80 backdrop-blur-md border border-orange-500/40 text-orange-400 text-xs font-mono font-semibold">
                    {item.style}
                  </span>
                </div>

                {/* Expand Icon */}
                <div className="absolute top-4 right-4 z-10 w-10 h-10 rounded-full bg-slate-950/80 backdrop-blur-md border border-slate-700 text-white flex items-center justify-center group-hover:bg-orange-600 group-hover:border-orange-500 transition-all">
                  <Maximize2 className="w-5 h-5" />
                </div>

                {/* Bottom Caption Info */}
                <div className="absolute bottom-0 inset-x-0 p-6 z-10 text-left space-y-2">
                  <h3 className="text-xl font-bold text-white group-hover:text-orange-400 transition-colors">
                    {item.title}
                  </h3>
                  <div className="flex items-center gap-2 text-xs text-amber-300 font-mono">
                    <CheckCircle className="w-3.5 h-3.5 text-orange-500" />
                    <span>Finish: {item.finish}</span>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Lightbox Image Modal */}
      {activeModalItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/90 backdrop-blur-md">
          <div className="relative max-w-4xl w-full glass-card rounded-2xl overflow-hidden border border-slate-700 shadow-2xl animate-fade-in">
            <button
              onClick={() => setActiveModalItem(null)}
              className="absolute top-4 right-4 z-20 w-10 h-10 rounded-full bg-slate-900/90 text-slate-300 hover:text-white flex items-center justify-center border border-slate-700 hover:border-orange-500"
            >
              <X className="w-6 h-6" />
            </button>

            <div className="aspect-[4/3] max-h-[65vh] overflow-hidden bg-black">
              <img
                src={activeModalItem.image}
                alt={activeModalItem.title}
                className="w-full h-full object-contain"
              />
            </div>

            <div className="p-6 bg-slate-900 text-left space-y-3">
              <span className="px-3 py-1 rounded-full bg-orange-500/10 border border-orange-500/30 text-orange-400 text-xs font-mono">
                {activeModalItem.style}
              </span>
              <h3 className="text-2xl font-bold text-white">{activeModalItem.title}</h3>
              <p className="text-slate-300 text-sm">{activeModalItem.desc}</p>
              <div className="pt-2 text-xs text-amber-300 font-mono flex items-center gap-2">
                <span>Finish: {activeModalItem.finish}</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
