import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        terminal: {
          bg: "#07090d",
          panel: "#0e141b",
          rail: "#121b25",
          line: "#26313e",
          text: "#e6f0ff",
          muted: "#7e8da3",
          cyan: "#2ce6d1",
          green: "#5df58d",
          amber: "#ffca58",
          red: "#ff5d73",
          violet: "#9f7cff"
        }
      },
      boxShadow: {
        glow: "0 0 32px rgba(44, 230, 209, 0.14)",
      },
    },
  },
  plugins: [],
};

export default config;
