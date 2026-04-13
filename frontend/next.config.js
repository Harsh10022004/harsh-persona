/** @type {import('next').NextConfig} */
const path = require("path");

// Load root .env so Next.js API routes can access all keys during local dev.
// On Vercel, env vars are injected via the dashboard — dotenv is a no-op there.
require("dotenv").config({ path: path.join(__dirname, "../.env") });

const nextConfig = {
  env: {
    // Expose to server-side API routes (not browser) at build time
    BACKEND_URL: process.env.BACKEND_URL ?? process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : "http://localhost:3000",
  },
};

module.exports = nextConfig;
