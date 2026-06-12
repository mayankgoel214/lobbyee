"use client";

// "Feedback is being prepared" state. The evaluation usually lands within
// ~30s of ending a session (inline after() trigger), so poll by refreshing
// the server component for two minutes, then stop and level with the user.
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

const POLL_MS = 5_000;
const GIVE_UP_MS = 120_000;

export function PendingFeedback() {
  const router = useRouter();
  const [waitedTooLong, setWaitedTooLong] = useState(false);
  const startedAt = useRef<number | null>(null);

  useEffect(() => {
    startedAt.current ??= Date.now();
    const timer = setInterval(() => {
      if (Date.now() - (startedAt.current ?? 0) > GIVE_UP_MS) {
        setWaitedTooLong(true);
        clearInterval(timer);
        return;
      }
      router.refresh();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [router]);

  return (
    <div className="mb-5 rounded-2xl border border-neutral-200 bg-neutral-50 p-4 text-sm text-neutral-600">
      {waitedTooLong ? (
        <>
          Your coaching feedback is taking longer than usual. It will retry on
          its own — check back in a little while.
        </>
      ) : (
        <span className="inline-flex items-center gap-2">
          <span className="h-2 w-2 animate-pulse rounded-full bg-neutral-400" />
          Your coach is reviewing the conversation — feedback usually lands in
          under a minute.
        </span>
      )}
    </div>
  );
}
