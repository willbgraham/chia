import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        bg: "#0b0d10",
        surface: "#13161b",
        border: "#1f242c",
        muted: "#7d8794",
        text: "#e7eaf0",
        accent: "#e85d75",
        accentMuted: "#5a2630",
        success: "#3fb27f",
        warn: "#e0a458",
        danger: "#e25c5c",
      },
      fontFamily: {
        sans: ["ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "Roboto", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
    },
  },
  plugins: [],
};

export default config;
