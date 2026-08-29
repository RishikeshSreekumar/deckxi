/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
  preview: { port: 4173 },
  test: {
    // Unit tests only — e2e/ belongs to Playwright.
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
