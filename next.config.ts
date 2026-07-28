import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";

// No nonce-based strict CSP (would need per-request wiring through
// middleware) — 'unsafe-inline' on script-src is the pragmatic tradeoff so
// Next's own RSC hydration scripts keep working. It still blocks loading
// script from any external origin, which is the primary XSS payload vector
// for an app that never renders untrusted HTML (no dangerouslySetInnerHTML
// of user content anywhere in this codebase).
function buildCsp() {
  const directives = [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
    // Radix/Framer Motion set inline `style` attributes for positioning and
    // animation — style-src must allow inline or those silently no-op.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src 'self'${isDev ? " ws: wss:" : ""}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ];
  return directives.join("; ");
}

const securityHeaders = [
  { key: "Content-Security-Policy", value: buildCsp() },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  // HSTS only makes sense once the app is actually served over HTTPS.
  ...(isDev
    ? []
    : [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" }]),
];

const nextConfig: NextConfig = {
  images: {
    // Local placeholder art ships as SVG; uploads are served from /public/uploads.
    dangerouslyAllowSVG: true,
    contentDispositionType: "attachment",
    contentSecurityPolicy: "default-src 'self'; script-src 'none'; sandbox;",
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
