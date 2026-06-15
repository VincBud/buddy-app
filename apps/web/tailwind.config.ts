import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Buddy brand
        ink: "#2A2D34",
        paper: "#FEFCFD",
        purple: "#6761A8",
        flame: "#FF4000",
        // Subtle neutrals derived from ink
        smoke: "#6B6E78",
        mist: "#E9E7EC",
      },
      fontFamily: {
        sans: [
          "var(--font-sans)",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Helvetica Neue",
          "Arial",
          "sans-serif",
        ],
      },
      fontSize: {
        // Fluid display sizes for the hero — feel premium on mobile and desktop
        "display-1": ["clamp(2.5rem, 6vw + 1rem, 5.25rem)", { lineHeight: "1.04", letterSpacing: "-0.04em", fontWeight: "800" }],
        "display-2": ["clamp(2rem, 4vw + 1rem, 3.5rem)",  { lineHeight: "1.08", letterSpacing: "-0.03em", fontWeight: "800" }],
        "display-3": ["clamp(1.5rem, 2vw + 1rem, 2.25rem)", { lineHeight: "1.15", letterSpacing: "-0.02em", fontWeight: "700" }],
      },
      boxShadow: {
        soft: "0 1px 2px rgba(42,45,52,0.04), 0 8px 24px -8px rgba(42,45,52,0.10)",
        card: "0 1px 2px rgba(42,45,52,0.04), 0 12px 32px -10px rgba(42,45,52,0.14)",
        flame: "0 8px 24px -10px rgba(255,64,0,0.55)",
      },
      borderRadius: {
        xl2: "1.25rem",
      },
      backgroundImage: {
        "hero-radial":
          "radial-gradient(1200px 600px at 80% -10%, rgba(103,97,168,0.18), transparent 60%), radial-gradient(800px 400px at 0% 0%, rgba(255,64,0,0.10), transparent 60%)",
      },
    },
  },
  plugins: [],
};

export default config;
