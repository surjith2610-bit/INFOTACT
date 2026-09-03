/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#EFF6FF",
          100: "#DBEAFE",
          200: "#BFDBFE",
          300: "#93C5FD",
          400: "#60A5FA",
          500: "#3B82F6",
          600: "#2563EB",
          700: "#1D4ED8",
          800: "#1E40AF",
          900: "#1E3A8A",
          950: "#172554",
        },
        navy: {
          DEFAULT: "#0F172A",
          50: "#F8FAFC",
          100: "#F1F5F9",
          200: "#E2E8F0",
          700: "#334155",
          800: "#1E293B",
          900: "#0F172A",
          950: "#0A0F1D",
        },
        panel: "#FFFFFF",
        panelHover: "#F8FAFC",
        borderLight: "#E2E8F0",
        borderGlow: "#BFDBFE",
        ledger: "#64748B",
        obsidian: "#07090E",
        ink: "#0B0E17",
        teal: {
          DEFAULT: "#2563EB",
          glow: "rgba(37, 99, 235, 0.25)",
          dim: "rgba(37, 99, 235, 0.08)",
          400: "#60A5FA",
          500: "#3B82F6",
          600: "#2563EB",
          700: "#1D4ED8",
        },
        flare: {
          DEFAULT: "#EF4444",
          glow: "rgba(239, 68, 68, 0.25)",
          dim: "rgba(239, 68, 68, 0.08)",
          500: "#EF4444",
          600: "#DC2626",
        },
        gold: {
          DEFAULT: "#F59E0B",
          glow: "rgba(245, 158, 11, 0.25)",
          dim: "rgba(245, 158, 11, 0.08)",
          500: "#F59E0B",
        },
        emerald: {
          DEFAULT: "#10B981",
          glow: "rgba(16, 185, 129, 0.25)",
          dim: "rgba(16, 185, 129, 0.08)",
          500: "#10B981",
        }
      },
      fontFamily: {
        display: ["'Space Grotesk'", "system-ui", "sans-serif"],
        mono: ["'JetBrains Mono'", "monospace"],
      },
      backgroundImage: {
        "ledger-grid":
          "linear-gradient(rgba(37,99,235,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(37,99,235,0.03) 1px, transparent 1px)",
        "radial-glow":
          "radial-gradient(circle at 50% 0%, rgba(37, 99, 235, 0.08) 0%, transparent 70%)",
        "radial-flare":
          "radial-gradient(circle at 50% 0%, rgba(239, 68, 68, 0.08) 0%, transparent 70%)",
      },
      backgroundSize: {
        "grid-24": "24px 24px",
      },
      boxShadow: {
        "glass": "0 4px 24px -2px rgba(15, 23, 42, 0.06), 0 2px 8px -1px rgba(15, 23, 42, 0.04)",
        "neon-teal": "0 4px 14px -1px rgba(37, 99, 235, 0.35)",
        "neon-flare": "0 4px 14px -1px rgba(239, 68, 68, 0.35)",
        "card-glow": "0 0 0 1px rgba(226, 232, 240, 0.8), 0 4px 20px -2px rgba(37, 99, 235, 0.08)",
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
