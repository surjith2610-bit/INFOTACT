import React, { useEffect, useRef } from "react";
import { Phone, Flame, ArrowRight, ShieldCheck } from "lucide-react";

export default function SparkHero() {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");

    let animationFrameId;
    let width = (canvas.width = window.innerWidth);
    let height = (canvas.height = window.innerHeight);

    const handleResize = () => {
      width = canvas.width = window.innerWidth;
      height = canvas.height = window.innerHeight;
    };
    window.addEventListener("resize", handleResize);

    // Particle spark system
    const sparkCount = 85;
    const sparks = [];

    class Spark {
      constructor() {
        this.reset();
      }

      reset() {
        // Spawn randomly across top half, concentrating around center-top arc
        this.x = Math.random() * width;
        this.y = Math.random() * (height * 0.4);
        this.vx = (Math.random() - 0.5) * 3;
        this.vy = Math.random() * 4 + 2;
        this.size = Math.random() * 2.5 + 1;
        this.alpha = Math.random() * 0.9 + 0.1;
        this.decay = Math.random() * 0.015 + 0.005;
        this.length = Math.random() * 12 + 6;
        
        // Colors: Orange, bright yellow, reddish ember
        const colors = ["#ff6a00", "#ffaa00", "#ff3300", "#ffffff", "#ffd700"];
        this.color = colors[Math.floor(Math.random() * colors.length)];
      }

      update() {
        this.x += this.vx;
        this.y += this.vy;
        this.alpha -= this.decay;

        // Slight gravity acceleration
        this.vy += 0.08;

        if (this.alpha <= 0 || this.y > height) {
          this.reset();
        }
      }

      draw() {
        ctx.save();
        ctx.globalAlpha = Math.max(0, this.alpha);
        ctx.strokeStyle = this.color;
        ctx.lineWidth = this.size;
        ctx.lineCap = "round";

        ctx.beginPath();
        ctx.moveTo(this.x, this.y);
        ctx.lineTo(this.x - this.vx * 2, this.y - this.vy * 2);
        ctx.stroke();

        // Glow particle head
        ctx.fillStyle = this.color;
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.size * 1.2, 0, Math.PI * 2);
        ctx.fill();

        ctx.restore();
      }
    }

    for (let i = 0; i < sparkCount; i++) {
      sparks.push(new Spark());
    }

    const render = () => {
      ctx.clearRect(0, 0, width, height);

      // Draw dark background gradient glow
      const bgGlow = ctx.createRadialGradient(
        width / 2,
        height * 0.3,
        20,
        width / 2,
        height * 0.3,
        width * 0.6
      );
      bgGlow.addColorStop(0, "rgba(255, 106, 0, 0.12)");
      bgGlow.addColorStop(0.5, "rgba(15, 23, 42, 0.6)");
      bgGlow.addColorStop(1, "rgba(2, 6, 23, 1)");

      ctx.fillStyle = bgGlow;
      ctx.fillRect(0, 0, width, height);

      // Update & render sparks
      sparks.forEach((spark) => {
        spark.update();
        spark.draw();
      });

      animationFrameId = requestAnimationFrame(render);
    };

    render();

    return () => {
      window.removeEventListener("resize", handleResize);
      cancelAnimationFrame(animationFrameId);
    };
  }, []);

  return (
    <section className="relative min-h-[90vh] flex items-center justify-center overflow-hidden pt-24 pb-16">
      {/* Animated Spark Canvas */}
      <canvas ref={canvasRef} className="absolute inset-0 z-0 pointer-events-none" />

      {/* Hero Content */}
      <div className="relative z-10 max-w-5xl mx-auto px-6 text-center space-y-8">
        {/* Badge */}
        <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-slate-900/90 border border-orange-500/40 text-orange-400 text-xs font-semibold uppercase tracking-widest shadow-lg shadow-orange-950/40 animate-pulse">
          <Flame className="w-4 h-4 text-orange-500" />
          <span>Premier Fabrication & Welding Experts</span>
        </div>

        {/* Main Title */}
        <h1 className="text-4xl sm:text-6xl lg:text-7xl font-extrabold font-industrial tracking-tight text-white leading-none uppercase">
          Strong. Reliable. <br />
          <span className="bg-gradient-to-r from-orange-500 via-amber-400 to-yellow-300 bg-clip-text text-transparent text-glow">
            Precision Welding Works
          </span>
        </h1>

        {/* Description */}
        <p className="max-w-2xl mx-auto text-slate-300 text-sm sm:text-lg leading-relaxed font-light">
          Custom Grill Gates, Stainless Steel Railings, Industrial Sheds & Architectural Metalwork built with unyielding strength and unmatched craftsmanship in Tamil Nadu.
        </p>

        {/* CTA Buttons */}
        <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-4">
          <a
            href="#enquiry"
            className="w-full sm:w-auto px-8 py-4 rounded-xl bg-gradient-to-r from-orange-600 to-amber-500 hover:from-orange-500 hover:to-amber-400 text-white font-bold text-sm uppercase tracking-wider shadow-lg spark-glow transition-all duration-300 transform hover:-translate-y-1 flex items-center justify-center gap-2"
          >
            <span>Get Free Quote</span>
            <ArrowRight className="w-4 h-4" />
          </a>

          <a
            href="#gallery"
            className="w-full sm:w-auto px-8 py-4 rounded-xl bg-slate-900/80 hover:bg-slate-800 text-slate-200 border border-slate-700 hover:border-orange-500/50 font-bold text-sm uppercase tracking-wider transition-all duration-300 flex items-center justify-center gap-2"
          >
            <span>View Our Work</span>
          </a>

          <a
            href="tel:6382970348"
            className="w-full sm:w-auto px-8 py-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm uppercase tracking-wider shadow-lg transition-all duration-300 flex items-center justify-center gap-2"
          >
            <Phone className="w-4 h-4" />
            <span>Call 6382970348</span>
          </a>
        </div>

        {/* Highlights Row */}
        <div className="pt-12 grid grid-cols-2 md:grid-cols-4 gap-4 max-w-4xl mx-auto text-left">
          <div className="glass-card p-4 rounded-xl border border-slate-800 flex items-center gap-3">
            <ShieldCheck className="w-8 h-8 text-orange-400 flex-shrink-0" />
            <div>
              <div className="text-white font-bold text-sm">15+ Years</div>
              <div className="text-slate-400 text-xs">Fabrication Experience</div>
            </div>
          </div>

          <div className="glass-card p-4 rounded-xl border border-slate-800 flex items-center gap-3">
            <Flame className="w-8 h-8 text-orange-400 flex-shrink-0" />
            <div>
              <div className="text-white font-bold text-sm">High Durability</div>
              <div className="text-slate-400 text-xs">Rust-Proof Coating</div>
            </div>
          </div>

          <div className="glass-card p-4 rounded-xl border border-slate-800 flex items-center gap-3">
            <ShieldCheck className="w-8 h-8 text-orange-400 flex-shrink-0" />
            <div>
              <div className="text-white font-bold text-sm">Custom Designs</div>
              <div className="text-slate-400 text-xs">Laser & Handcraft</div>
            </div>
          </div>

          <div className="glass-card p-4 rounded-xl border border-slate-800 flex items-center gap-3">
            <Phone className="w-8 h-8 text-emerald-400 flex-shrink-0" />
            <div>
              <div className="text-white font-bold text-sm">Fast Delivery</div>
              <div className="text-slate-400 text-xs">On-Time Completion</div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
