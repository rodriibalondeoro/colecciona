/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "yoynwwgjuxgwcvigtunj.supabase.co",
      },
    ],
  },
  headers: async () => [
    {
      // API routes: never cache (dynamic, user-specific, financial)
      source: "/api/:path*",
      headers: [
        {
          key: "Cache-Control",
          value: "no-store, no-cache, must-revalidate",
        },
      ],
    },
    {
      // Static assets: long cache (Next.js handles hashing)
      source: "/_next/static/:path*",
      headers: [
        {
          key: "Cache-Control",
          value: "public, max-age=31536000, immutable",
        },
      ],
    },
  ],
};

export default nextConfig;
