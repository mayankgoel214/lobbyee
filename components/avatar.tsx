// Client component: needs local state to fall back to initials when the
// remote image URL (Google's lh3.googleusercontent.com, an outdated cached
// Supabase user_metadata avatar_url, etc.) fails to load.
"use client";

import { useState } from "react";

type AvatarProps = {
  /** Remote avatar URL. `null`/`undefined`/empty → initials fallback. */
  src?: string | null;
  /** Display name — drives initials AND the img `alt`. */
  name: string;
  /** Pixel size of the circle. Defaults to 32. */
  size?: number;
  /** Optional extra classes (e.g. ring, shadow). */
  className?: string;
};

// Reusable, RSC-safe avatar. Renders the photo when we have one and it
// loads; otherwise the Atrium initials chip (gradient accent → clarity)
// used elsewhere in the sidebar. Kept as a plain <img> (not next/image)
// so Google avatar hosts don't require next.config remotePatterns tweaks
// and `referrerPolicy="no-referrer"` can be applied cleanly.
export function Avatar({ src, name, size = 32, className = "" }: AvatarProps) {
  const [errored, setErrored] = useState(false);
  const initials = getInitials(name);
  const showImage = Boolean(src) && !errored;
  // Font size scales with the circle so initials still read at any size.
  const fontSize = Math.max(10, Math.round(size * 0.4));

  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-accent-600 to-clarity font-semibold text-white ${className}`}
      style={{ width: size, height: size, fontSize }}
    >
      {showImage && src ? (
        // biome-ignore lint/performance/noImgElement: Google avatar hosts (lh3.googleusercontent.com) are remote; plain <img> avoids next.config remotePatterns coupling and lets us set referrerPolicy.
        <img
          src={src}
          alt={name}
          referrerPolicy="no-referrer"
          className="h-full w-full object-cover"
          onError={() => setErrored(true)}
        />
      ) : (
        <span aria-hidden="true">{initials}</span>
      )}
    </span>
  );
}

/** "Sidhi Goel" → "SG"; "mayank@lobbyee.com" → "M"; empty → "?". */
function getInitials(name: string): string {
  const parts = name
    .split(/[\s@]+/)
    .filter(Boolean)
    .map((p) => p[0])
    .filter((c): c is string => Boolean(c));
  const joined = parts.join("").slice(0, 2).toUpperCase();
  return joined || "?";
}
