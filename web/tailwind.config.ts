import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        my: {
          red: "#CC0001",
          navy: "#003893",
          yellow: "#FFD100",
        },
      },
    },
  },
  plugins: [],
};

export default config;
