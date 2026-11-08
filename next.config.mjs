/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // better-sqlite3 is a native addon: keep it out of the bundler, load on the Node server runtime only.
    serverComponentsExternalPackages: ["better-sqlite3"],
  },
};

export default nextConfig;
