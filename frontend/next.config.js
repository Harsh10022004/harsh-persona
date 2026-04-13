/** @type {import('next').NextConfig} */
const path = require("path");

// Load root .env so Next.js API routes can access all keys
require("dotenv").config({ path: path.join(__dirname, "../.env") });

const nextConfig = {};

module.exports = nextConfig;
