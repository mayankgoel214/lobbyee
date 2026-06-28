// Lobbyee brand mark — an arch/doorway (a lobby) with a single accent dot
// inside it (a guest, present). Colors are fixed brand values, not theme
// tokens, so the mark renders identically everywhere.

export function LobbyeeMark({
  size = 28,
  className = "",
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      className={className}
      role="img"
      aria-label="Lobbyee"
    >
      <rect width="64" height="64" rx="16" fill="#1c1917" />
      <path
        d="M20 48 L20 31 A12 12 0 0 1 44 31 L44 48"
        fill="none"
        stroke="#ffffff"
        strokeWidth="4.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="32" cy="35" r="5" fill="#4f46e5" />
    </svg>
  );
}

export function LobbyeeLogo({
  className = "",
  markSize = 26,
}: {
  className?: string;
  markSize?: number;
}) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <LobbyeeMark size={markSize} />
      <span className="text-[17px] font-semibold tracking-tight text-neutral-900">
        Lobbyee
      </span>
    </span>
  );
}
