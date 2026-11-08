import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        navy: { DEFAULT: "#0a2e5c", deep: "#07234a" },
        brand: { DEFAULT: "#123d7c", light: "#e6f4fd", mid: "#bfe6fb" },
        accent: { DEFAULT: "#00b9f1", soft: "#e0f7ff" },
      },
      fontFamily: {
        sans: ["system-ui", "-apple-system", "Segoe UI", "Roboto", "Helvetica Neue", "sans-serif"],
      },
      boxShadow: {
        card: "0 1px 3px rgba(10, 46, 92, 0.08), 0 4px 14px rgba(10, 46, 92, 0.06)",
      },
    },
  },
  plugins: [],
};
export default config;
