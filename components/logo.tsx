// Lobbyee brand mark — "Portal": nested arches (a lobby entrance that doubles
// as listening waves) with a warm amber spark at the apex (the guest, the
// moment). Colors are fixed brand values (a teal gradient + amber spark), not
// theme tokens, so the mark renders identically everywhere. The gradient ids
// are shared constants — if the mark renders more than once on a page the
// duplicate <defs> are harmless (every reference resolves to the same gradient).

export function LobbyeeMark({
  size = 30,
  className = "",
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      className={className}
      role="img"
      aria-label="Lobbyee"
      fill="none"
    >
      <defs>
        <linearGradient id="lby-teal" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#3ee0cb" />
          <stop offset="0.5" stopColor="#12a394" />
          <stop offset="1" stopColor="#0a5f57" />
        </linearGradient>
        <linearGradient id="lby-spark" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffd166" />
          <stop offset="1" stopColor="#f59e2c" />
        </linearGradient>
      </defs>
      <path
        d="M6 42V23a18 18 0 0 1 36 0v19"
        stroke="url(#lby-teal)"
        strokeWidth="6"
        strokeLinecap="round"
      />
      <path
        d="M16 42V23a8 8 0 0 1 16 0v19"
        stroke="url(#lby-teal)"
        strokeOpacity="0.45"
        strokeWidth="5"
        strokeLinecap="round"
      />
      <circle cx="24" cy="23" r="4.6" fill="url(#lby-spark)" />
    </svg>
  );
}

export function LobbyeeLogo({
  className = "",
  markSize = 28,
  tone = "ink",
}: {
  className?: string;
  markSize?: number;
  /** Wordmark color: "ink" for light backgrounds, "light" for dark panels. */
  tone?: "ink" | "light";
}) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <LobbyeeMark size={markSize} />
      <span
        className={`text-[17px] font-semibold tracking-tight ${
          tone === "light" ? "text-white" : "text-neutral-900"
        }`}
      >
        Lobbyee
      </span>
    </span>
  );
}
