import type { NextConfig } from "next";

// Security headers applied to every route. Intentionally CONSERVATIVE:
// X-Frame-Options + frame-ancestors kill clickjacking (the audit's main
// concern, with /invite/accept the highest-value target). The remaining
// headers are safe, well-understood hardening with no expected breakage.
//
// A full CSP (default-src/script-src/connect-src) is NOT set here — it
// risks breaking Next.js inline scripts, Supabase realtime, Gemini, and the
// Pipecat WebRTC voice worker and cannot be verified without browser-driven
// testing. Treat that as a separately-tested follow-up.
const securityHeaders = [
  // Clickjacking — legacy browsers.
  { key: "X-Frame-Options", value: "DENY" },
  // Clickjacking — modern browsers; supersedes X-Frame-Options where supported.
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  // Don't leak full URLs (including invite links / session ids) to third
  // parties, but keep enough info for our own analytics + same-origin nav.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Stop MIME-sniffing-based content-type confusion.
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Voice training records microphone same-origin; everything else is off.
  {
    key: "Permissions-Policy",
    value: "microphone=(self), camera=(), geolocation=()",
  },
];

const nextConfig: NextConfig = {
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
