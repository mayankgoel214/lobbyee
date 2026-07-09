// Shared shell for the auth pages (sign in / sign up). A single floating card
// centered on the same soft teal ambient background + faint grid as the
// landing hero, so auth feels like the same product as the marketing site.
// Presentational only; the page passes the heading + form as children.
import Link from "next/link";
import type { ReactNode } from "react";
import { LobbyeeLogo } from "@/components/logo";

export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#f5f7f9] px-4 py-10">
      {/* Ambient glows — teal dominant, a soft mint and a faint blue — matching
          the landing hero so the two surfaces read as one product. */}
      <div
        aria-hidden
        className="pointer-events-none absolute z-0"
        style={{
          width: 820,
          height: 820,
          left: "-220px",
          top: "-260px",
          borderRadius: "50%",
          filter: "blur(110px)",
          background:
            "radial-gradient(circle, rgba(18,163,148,.40), rgba(62,224,203,.20) 42%, transparent 72%)",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute z-0"
        style={{
          width: 520,
          height: 520,
          right: "-160px",
          bottom: "-180px",
          borderRadius: "50%",
          filter: "blur(110px)",
          background:
            "radial-gradient(circle, rgba(93,202,165,.34), transparent 66%)",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute z-0"
        style={{
          width: 360,
          height: 360,
          right: "8%",
          top: "6%",
          borderRadius: "50%",
          filter: "blur(110px)",
          background:
            "radial-gradient(circle, rgba(59,130,196,.14), transparent 70%)",
        }}
      />
      {/* Faint grid, masked to fade at the edges. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 z-0"
        style={{
          backgroundImage:
            "linear-gradient(rgba(20,24,33,.04) 1px, transparent 1px), linear-gradient(90deg, rgba(20,24,33,.04) 1px, transparent 1px)",
          backgroundSize: "44px 44px",
          WebkitMaskImage:
            "radial-gradient(circle at 50% 42%, #000, transparent 72%)",
          maskImage:
            "radial-gradient(circle at 50% 42%, #000, transparent 72%)",
        }}
      />

      <div className="auth-rise relative z-10 w-full max-w-[400px]">
        <div className="mb-7 flex justify-center">
          <Link href="/" className="inline-flex" aria-label="Lobbyee home">
            <LobbyeeLogo />
          </Link>
        </div>
        <div className="rounded-[20px] border border-white/70 bg-white/95 p-8 shadow-[0_2px_4px_rgba(16,20,30,.04),0_24px_60px_rgba(6,52,44,.14)] backdrop-blur-sm">
          {children}
        </div>
      </div>

      <style>{`
        @keyframes auth-rise-in {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .auth-rise { animation: auth-rise-in .5s cubic-bezier(.22,.61,.36,1) both; }
        @media (prefers-reduced-motion: reduce) {
          .auth-rise { animation: none; }
        }
      `}</style>
    </main>
  );
}
