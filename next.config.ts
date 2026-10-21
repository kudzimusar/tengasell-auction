import type { NextConfig } from "next";

// ── Security headers (DAST gap8-g6 finding #1) ─────────────────────────
// Baseline hardening for every response served by the Next layer; the
// Caddy gateway passes upstream headers through unchanged, so these reach
// the browser on :81 as well. CSP keeps dev-compatible quoting ('unsafe-*'
// required by Turbopack HMR + framer-motion inline styles); production
// launch condition: tighten script-src with per-request nonces and drop
// 'unsafe-eval' (tracked in the audit pack).
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(self), payment=()" },
  // Enforced once TLS-terminated at the edge in production; ignored on plain HTTP dev.
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https:",
      "connect-src 'self' ws: wss:",
      "font-src 'self' data:",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join("; "),
  },
];

// ── Static demo build (GitHub Pages) ─────────────────────────────────
// STATIC_DEMO=1 emits a fully static export for GitHub Pages. It removes the
// need for the API server by using the app's own offline store
// (src/lib/tengasell/api/index.ts probes TrailBase, then falls back to LocalStore).
// API routes are excluded by scripts/build-static-demo.mjs because `output: export`
// cannot include route handlers. Production builds are unchanged.
const isStaticDemo = process.env.STATIC_DEMO === "1";
const demoBasePath = process.env.STATIC_DEMO_BASE_PATH || "";

const nextConfig: NextConfig = {
  ...(isStaticDemo
    ? {
        output: "export" as const,
        trailingSlash: true,
        ...(demoBasePath ? { basePath: demoBasePath, assetPrefix: demoBasePath } : {}),
        images: { unoptimized: true },
      }
    : { output: "standalone" as const }),
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  // `headers()` is not supported by static export — omit it in demo builds.
  ...(isStaticDemo
    ? {}
    : {
        async headers() {
          return [{ source: "/:path*", headers: securityHeaders }];
        },
      }),
};

export default nextConfig;
