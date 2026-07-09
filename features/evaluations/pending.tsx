"use client";

// "Feedback is being prepared" state. The evaluation usually lands within
// ~30s of ending a session (inline after() trigger), so poll by refreshing
// the server component — with backoff (5s → 10s → 20s) and a pause while the
// tab is hidden, since every refresh re-runs the whole transcript query.
// After two minutes of visible waiting, stop and level with the user.
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

const POLL_STEPS_MS = [5_000, 5_000, 5_000, 10_000, 10_000, 20_000];
const GIVE_UP_MS = 120_000;

export function PendingFeedback() {
  const router = useRouter();
  const [waitedTooLong, setWaitedTooLong] = useState(false);

  useEffect(() => {
    const startedAt = Date.now();
    let tick = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;

    const schedule = () => {
      if (cancelled) return;
      const delay =
        POLL_STEPS_MS[Math.min(tick, POLL_STEPS_MS.length - 1)] ?? 20_000;
      timer = setTimeout(() => {
        if (cancelled) return;
        if (Date.now() - startedAt > GIVE_UP_MS) {
          setWaitedTooLong(true);
          return;
        }
        tick += 1;
        if (!document.hidden) router.refresh();
        schedule();
      }, delay);
    };
    schedule();

    // Refresh immediately when the user comes back to the tab.
    const onVisible = () => {
      if (!document.hidden && !cancelled) router.refresh();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [router]);

  return (
    <div className="mb-5 rounded-xl border border-accent-100 bg-accent-50/60 p-4 text-sm text-accent-900 shadow-sm">
      {waitedTooLong ? (
        <>
          Your coaching feedback is taking longer than usual. It will retry on
          its own. Check back in a little while.
        </>
      ) : (
        <span className="inline-flex items-center gap-2">
          <span className="h-2 w-2 animate-pulse rounded-full bg-accent-600" />
          Your coach is reviewing the conversation. Feedback usually lands in
          under a minute.
        </span>
      )}
    </div>
  );
}
