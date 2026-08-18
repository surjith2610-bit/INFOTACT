/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#0B0E14",        // near-black base
        panel: "#11151F",      // card surfaces
        grid: "#1C2230",       // hairline grid lines
        ledger: "#7A879C",     // muted secondary text
        teal: "#2DD9C4",       // clean-flow accent
        flare: "#FF5C3D",      // fraud/alert accent
        gold: "#E8B34C",       // risk/medium accent
      },
      fontFamily: {
        display: ["'Space Grotesk'", "sans-serif"],
        mono: ["'JetBrains Mono'", "monospace"],
      },
      backgroundImage: {
        "ledger-grid":
          "linear-gradient(rgba(255,255,255,0.035) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.035) 1px, transparent 1px)",
      },
      backgroundSize: {
        "grid-24": "24px 24px",
      },
    },
  },
  plugins: [],
}
