/** @type {import('next').NextConfig} */

const isDev = process.env.NODE_ENV === "development";

// The browser talks directly to the Railway passthrough backend
// (NEXT_PUBLIC_PASSTHROUGH_URL) for auto-submit, job polling and telemetry.
const passthroughOrigin = "https://*.up.railway.app";

// Next.js hydration/flight payloads are inline <script> blocks, so 'unsafe-inline'
// is required here. `next dev` additionally evals for hot reload.
const csp = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: ${passthroughOrigin}`,
  "font-src 'self' data:",
  `connect-src 'self' ${passthroughOrigin} https://vitals.vercel-insights.com`,
  "worker-src 'self'",
  "manifest-src 'self'",
  "upgrade-insecure-requests",
].join("; ");

const nextConfig = {
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
          { key: "Strict-Transport-Security", value: "max-age=31536000" },
        ],
      },
    ];
  },
};

export default nextConfig;
