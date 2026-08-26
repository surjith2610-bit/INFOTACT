/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        spark: {
          500: '#ff6a00',
          600: '#ea580c',
          glow: '#ff9d00',
        },
        steel: {
          800: '#1e293b',
          900: '#0f172a',
          950: '#020617',
        }
      },
      fontFamily: {
        industrial: ['Oswald', 'sans-serif'],
      }
    },
  },
  plugins: [],
}
