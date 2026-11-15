/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // better-sqlite3 is a native addon and pdfkit ships its own font data files:
    // keep both out of the bundler, load on the Node server runtime only.
    serverComponentsExternalPackages: ["better-sqlite3", "pdfkit"],
  },
  // The campaign summary PDF route reads the embedded report fonts from disk at
  // runtime; trace them into the route bundle so serverless deploys keep working.
  outputFileTracingIncludes: {
    "/api/campaigns/[id]/summary-pdf": ["./assets/fonts/**"],
  },
};

export default nextConfig;
