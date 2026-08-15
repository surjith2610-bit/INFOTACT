import { useEffect, useRef } from "react";

/**
 * Ambient canvas backdrop: a field of drifting "account" nodes connected by
 * faint transaction edges. Every few seconds one node bursts into a
 * starburst of inbound edges and flashes red — a quiet preview of exactly
 * what the product exists to catch, rather than a decorative particle field.
 */
export default function GraphBackdrop() {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    let width, height;
    let raf;

    const NODE_COUNT = 42;
    const nodes = [];

    function resize() {
      width = canvas.width = canvas.offsetWidth * devicePixelRatio;
      height = canvas.height = canvas.offsetHeight * devicePixelRatio;
    }
    resize();
    window.addEventListener("resize", resize);

    for (let i = 0; i < NODE_COUNT; i++) {
      nodes.push({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * 0.15,
        vy: (Math.random() - 0.5) * 0.15,
        r: 1.5 + Math.random() * 1.5,
        flagged: false,
      });
    }

    let burstTarget = null;
    let burstTimer = 0;
    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    function pickBurst() {
      burstTarget = nodes[Math.floor(Math.random() * nodes.length)];
      burstTarget.flagged = true;
      burstTimer = 140;
    }
    const burstInterval = prefersReducedMotion ? null : setInterval(pickBurst, 6000);

    function tick() {
      ctx.clearRect(0, 0, width, height);

      // drift
      for (const n of nodes) {
        if (!prefersReducedMotion) {
          n.x += n.vx;
          n.y += n.vy;
          if (n.x < 0 || n.x > width) n.vx *= -1;
          if (n.y < 0 || n.y > height) n.vy *= -1;
        }
      }

      // edges between nearby nodes
      ctx.lineWidth = 1;
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i], b = nodes[j];
          const dx = a.x - b.x, dy = a.y - b.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 160 * devicePixelRatio) {
            ctx.strokeStyle = `rgba(45, 217, 196, ${0.06 * (1 - dist / (160 * devicePixelRatio))})`;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
          }
        }
      }

      // starburst flare
      if (burstTarget && burstTimer > 0) {
        const alpha = burstTimer / 140;
        ctx.strokeStyle = `rgba(255, 92, 61, ${0.5 * alpha})`;
        for (const n of nodes) {
          if (n === burstTarget) continue;
          const dx = n.x - burstTarget.x, dy = n.y - burstTarget.y;
          if (Math.sqrt(dx * dx + dy * dy) < 260 * devicePixelRatio) {
            ctx.beginPath();
            ctx.moveTo(burstTarget.x, burstTarget.y);
            ctx.lineTo(n.x, n.y);
            ctx.stroke();
          }
        }
        burstTimer--;
        if (burstTimer <= 0) burstTarget.flagged = false;
      }

      // nodes
      for (const n of nodes) {
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.r * devicePixelRatio, 0, Math.PI * 2);
        ctx.fillStyle = n.flagged ? "#FF5C3D" : "rgba(122, 135, 156, 0.55)";
        ctx.fill();
      }

      raf = requestAnimationFrame(tick);
    }
    tick();

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      if (burstInterval) clearInterval(burstInterval);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 w-full h-full opacity-70"
      aria-hidden="true"
    />
  );
}
