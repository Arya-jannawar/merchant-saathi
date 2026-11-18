/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // pdfkit ships its own font data files: keep it out of the bundler,
    // load on the Node server runtime only. (The data layer is postgres.js,
    // which is already server-runtime-only and does not need this entry.)
    serverComponentsExternalPackages: ["pdfkit"],
    // The campaign summary PDF route reads the embedded report fonts from disk
    // at runtime; trace them into the route bundle so serverless deploys work.
    outputFileTracingIncludes: {
      "/api/campaigns/[id]/summary-pdf": ["./assets/fonts/**"],
    },
  },
};

export default nextConfig;
