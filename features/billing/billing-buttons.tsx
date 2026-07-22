"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button, FormError } from "@/components/ui";
import {
  cancelDodoSubscriptionAction,
  createDodoCheckoutAction,
  getBillingStatusAction,
} from "./actions";

const PRICE_COPY: Record<"USD" | "INR", string> = {
  USD: "Subscribe for $100/month",
  INR: "Subscribe for ₹8,999/month",
};

/** Subscribe button — kicks off a Dodo hosted-checkout redirect. No SDK is
 *  loaded on our page; we hand control to Dodo's URL and rely on the
 *  webhook to flip the workspace plan when the subscription becomes active.
 *
 *  On return to /w/[slug]/settings/billing we poll for the plan flip
 *  (webhook race) and surface a "still activating" fallback after ~15s so
 *  the user never re-clicks Subscribe (which would hit the double-billing
 *  guard). Same polling pattern used for the Razorpay flow before this. */
export function SubscribeButton({ slug }: { slug: string }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [activating, setActivating] = useState(false);
  const [slowActivation, setSlowActivation] = useState(false);
  const [currency, setCurrency] = useState<"USD" | "INR">("USD");
  const mounted = useRef(true);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const startPolling = useCallback(() => {
    const startedAt = Date.now();
    const HARD_FALLBACK_MS = 15_000;
    const INTERVAL_MS = 2_000;
    const tick = async () => {
      if (!mounted.current) return;
      try {
        const status = await getBillingStatusAction(slug);
        if (!mounted.current) return;
        if (status.ok && status.plan === "starter") {
          if (typeof window !== "undefined") {
            window.sessionStorage.removeItem(`dodo-activating:${slug}`);
          }
          window.location.reload();
          return;
        }
      } catch (e) {
        console.warn("dodo billing status poll failed:", e);
      }
      if (Date.now() - startedAt >= HARD_FALLBACK_MS) {
        if (mounted.current) setSlowActivation(true);
        return;
      }
      pollTimerRef.current = setTimeout(tick, INTERVAL_MS);
    };
    pollTimerRef.current = setTimeout(tick, INTERVAL_MS);
  }, [slug]);

  useEffect(() => {
    mounted.current = true;
    // If we've just come back from Dodo, we might already be in the
    // "activating" window — start polling opportunistically. (Cheap: the
    // action bails immediately for anyone not admin, and the query is a
    // single-row lookup by workspaceId.)
    if (
      typeof window !== "undefined" &&
      window.sessionStorage.getItem(`dodo-activating:${slug}`) === "1"
    ) {
      setActivating(true);
      startPolling();
    }
    return () => {
      mounted.current = false;
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    };
  }, [slug, startPolling]);

  const start = useCallback(async () => {
    setError(undefined);
    setPending(true);
    try {
      const result = await createDodoCheckoutAction(slug);
      if (!result.ok) {
        setError(result.error);
        setPending(false);
        return;
      }
      setCurrency(result.currency);
      // Mark that we're expecting to come back into activating mode so
      // the effect above can pick up polling on the return leg.
      if (typeof window !== "undefined") {
        window.sessionStorage.setItem(`dodo-activating:${slug}`, "1");
      }
      // Hosted redirect — Dodo owns the entire card flow from here.
      window.location.assign(result.checkoutUrl);
    } catch (e) {
      console.error("dodo checkout open failed:", e);
      if (mounted.current) {
        setError("Couldn't open checkout. Try again in a moment.");
        setPending(false);
      }
    }
  }, [slug]);

  if (activating) {
    return (
      <div>
        <Button type="button" disabled>
          Activating your plan…
        </Button>
        {slowActivation ? (
          <p className="mt-2 text-xs text-neutral-500">
            Dodo is taking a moment to confirm. Your payment IS on file, no need
            to click Subscribe again.{" "}
            <button
              type="button"
              className="underline underline-offset-2 hover:text-neutral-800"
              onClick={() => window.location.reload()}
            >
              Refresh the page
            </button>{" "}
            to check again.
          </p>
        ) : (
          <p className="mt-2 text-xs text-neutral-500">
            Payment received. This page will refresh once Dodo confirms the
            subscription.
          </p>
        )}
      </div>
    );
  }

  return (
    <div>
      <Button type="button" disabled={pending} onClick={start}>
        {pending ? "Opening checkout…" : PRICE_COPY[currency]}
      </Button>
      <FormError>{error}</FormError>
    </div>
  );
}

export function CancelSubscriptionButton({ slug }: { slug: string }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [done, setDone] = useState(false);

  const onClick = useCallback(async () => {
    if (
      typeof window !== "undefined" &&
      !window.confirm(
        "Cancel subscription at the end of the current billing period?",
      )
    ) {
      return;
    }
    setError(undefined);
    setPending(true);
    try {
      const result = await cancelDodoSubscriptionAction(slug);
      if (!result.ok) {
        setError(result.error);
        setPending(false);
        return;
      }
      setDone(true);
      setPending(false);
      if (typeof window !== "undefined")
        setTimeout(() => window.location.reload(), 1500);
    } catch (e) {
      console.error("cancel subscription failed:", e);
      setError("Couldn't cancel. Try again in a moment.");
      setPending(false);
    }
  }, [slug]);

  if (done) {
    return (
      <p className="text-sm text-neutral-600">
        Cancellation scheduled. Your plan stays active until the current billing
        period ends.
      </p>
    );
  }

  return (
    <div>
      <Button
        type="button"
        variant="secondary"
        disabled={pending}
        onClick={onClick}
      >
        {pending ? "Canceling…" : "Cancel subscription"}
      </Button>
      <FormError>{error}</FormError>
    </div>
  );
}
