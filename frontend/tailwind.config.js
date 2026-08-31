/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        obsidian: "#07090E",    // deepest space black
        ink: "#0B0E17",         // near-black primary background
        panel: "#101626",       // elevated card glass background
        panelHover: "#151E33",  // interactive surface hover
        borderDark: "#1E293B",  // structural subtle border
        borderGlow: "#334155",  // highlighted card border
        ledger: "#8B9BB4",      // muted readable secondary typography
        teal: {
          DEFAULT: "#00F2FE",
          glow: "rgba(0, 242, 254, 0.35)",
          dim: "rgba(0, 242, 254, 0.12)",
          400: "#38BDF8",
          500: "#00F2FE",
          600: "#0284C7",
        },
        flare: {
          DEFAULT: "#FF385C",
          glow: "rgba(255, 56, 92, 0.4)",
          dim: "rgba(255, 56, 92, 0.12)",
          500: "#FF385C",
          600: "#E11D48",
        },
        gold: {
          DEFAULT: "#FBBF24",
          glow: "rgba(251, 191, 36, 0.35)",
          dim: "rgba(251, 191, 36, 0.12)",
          500: "#FBBF24",
        },
        emerald: {
          DEFAULT: "#10B981",
          glow: "rgba(16, 185, 129, 0.35)",
          dim: "rgba(16, 185, 129, 0.12)",
          500: "#10B981",
        }
      },
      fontFamily: {
        display: ["'Space Grotesk'", "system-ui", "sans-serif"],
        mono: ["'JetBrains Mono'", "monospace"],
      },
      backgroundImage: {
        "ledger-grid":
          "linear-gradient(rgba(255,255,255,0.025) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.025) 1px, transparent 1px)",
        "radial-glow":
          "radial-gradient(circle at 50% 0%, rgba(0, 242, 254, 0.08) 0%, transparent 70%)",
        "radial-flare":
          "radial-gradient(circle at 50% 0%, rgba(255, 56, 92, 0.08) 0%, transparent 70%)",
      },
      backgroundSize: {
        "grid-24": "24px 24px",
      },
      boxShadow: {
        "glass": "0 8px 32px 0 rgba(0, 0, 0, 0.37)",
        "neon-teal": "0 0 20px -2px rgba(0, 242, 254, 0.35)",
        "neon-flare": "0 0 20px -2px rgba(255, 56, 92, 0.4)",
        "card-glow": "0 0 0 1px rgba(255, 255, 255, 0.08), 0 4px 20px rgba(0, 0, 0, 0.5)",
      },
      animation: {
        "pulse-slow": "pulse 4s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        "shimmer": "shimmer 2.5s infinite linear",
      },
      keyframes: {
        shimmer: {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
      },
    },
  },
  plugins: [],
};
