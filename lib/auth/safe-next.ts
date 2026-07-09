/** Open-redirect guard for a `next` query param: it must be a same-origin
 *  relative path. Rejects absolute URLs, protocol-relative (`//evil.com`), and
 *  the backslash/userinfo tricks (`/\\evil.com`, `@evil.com`). Shared by the
 *  email-confirm and OAuth-callback routes so the guard lives in one place. */
export function safeNext(next: string | null): string | null {
  if (!next) return null;
  if (!next.startsWith("/") || next.startsWith("//") || next.includes("\\")) {
    return null;
  }
  return next;
}
