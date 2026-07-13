"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button, FormError } from "@/components/ui";
import {
  cancelSubscriptionAction,
  createRazorpaySubscriptionAction,
  getBillingStatusAction,
} from "./actions";

const CHECKOUT_SRC = "https://checkout.razorpay.com/v1/checkout.js";

// Narrow type — we only use the Razorpay constructor + .open().
type RazorpayCtor = new (options: RazorpayOptions) => { open: () => void };
type RazorpayOptions = {
  key: string;
  subscription_id: string;
  name: string;
  description: string;
  currency?: string;
  prefill?: { email?: string; name?: string };
  notes?: Record<string, string>;
  theme?: { color?: string };
  handler?: (response: {
    razorpay_payment_id: string;
    razorpay_subscription_id: string;
    razorpay_signature: string;
  }) => void;
  modal?: { ondismiss?: () => void };
};
declare global {
  interface Window {
    Razorpay?: RazorpayCtor;
  }
}

/** Load checkout.js once per page; resolves when the global is available.
 *  Reuses an in-flight load if two buttons mount at the same time. */
let checkoutLoader: Promise<RazorpayCtor> | null = null;
function loadRazorpayCheckout(): Promise<RazorpayCtor> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Razorpay Checkout requires a browser."));
  }
  if (window.Razorpay) return Promise.resolve(window.Razorpay);
  if (checkoutLoader) return checkoutLoader;
  checkoutLoader = new Promise<RazorpayCtor>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${CHECKOUT_SRC}"]`,
    );
    const el = existing ?? document.createElement("script");
    el.src = CHECKOUT_SRC;
    el.async = true;
    el.onload = () => {
      if (window.Razorpay) resolve(window.Razorpay);
      else reject(new Error("Razorpay script loaded but global is missing."));
    };
    el.onerror = () =>
      reject(new Error("Failed to load Razorpay Checkout script."));
    if (!existing) document.head.appendChild(el);
  });
  return checkoutLoader;
}

const PRICE_COPY: Record<"USD" | "INR", string> = {
  USD: "Subscribe for $100/month",
  INR: "Subscribe for ₹8,000/month",
};

export function SubscribeButton({
  slug,
  email,
  workspaceName,
}: {
  slug: string;
  email?: string | undefined;
  workspaceName?: string | undefined;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | undefined>();
  // "activating" = payment succeeded on the client, waiting for webhook to
  // flip the plan. We poll getBillingStatusAction and reload as soon as
  // plan=starter arrives (rather than a fixed timer that races the webhook).
  const [activating, setActivating] = useState(false);
  const [slowActivation, setSlowActivation] = useState(false);
  const [currency, setCurrency] = useState<"USD" | "INR">("USD");
  const mounted = useRef(true);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    };
  }, []);

  // Poll for the plan flip. Interval 2s, hard fallback after ~15s that
  // shows "still activating, refresh" so the user never sits on a stuck
  // screen (and doesn't re-click Subscribe — which would hit the
  // double-billing guard).
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
          window.location.reload();
          return;
        }
      } catch (e) {
        // Transient — keep polling; if we truly never converge, the
        // hard-fallback banner takes over.
        console.warn("razorpay billing status poll failed:", e);
      }
      if (Date.now() - startedAt >= HARD_FALLBACK_MS) {
        if (mounted.current) setSlowActivation(true);
        return;
      }
      pollTimerRef.current = setTimeout(tick, INTERVAL_MS);
    };
    pollTimerRef.current = setTimeout(tick, INTERVAL_MS);
  }, [slug]);

  const start = useCallback(async () => {
    setError(undefined);
    setPending(true);
    try {
      const result = await createRazorpaySubscriptionAction(slug);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setCurrency(result.currency);
      const Razorpay = await loadRazorpayCheckout();
      const options: RazorpayOptions = {
        key: result.keyId,
        subscription_id: result.subscriptionId,
        name: workspaceName ?? "Lobbyee",
        description: "Starter plan",
        currency: result.currency,
        prefill: email ? { email } : {},
        notes: { slug },
        theme: { color: "#0f766e" },
        handler: () => {
          // Payment succeeded client-side. The webhook does the real plan
          // flip — start polling for it and reload as soon as we see
          // plan=starter.
          if (!mounted.current) return;
          setActivating(true);
          setPending(false);
          startPolling();
        },
        modal: {
          ondismiss: () => {
            if (!mounted.current) return;
            setPending(false);
          },
        },
      };
      new Razorpay(options).open();
    } catch (e) {
      console.error("razorpay checkout open failed:", e);
      if (mounted.current) {
        setError("Couldn't open checkout. Try again in a moment.");
        setPending(false);
      }
    }
  }, [slug, email, workspaceName, startPolling]);

  if (activating) {
    return (
      <div>
        <Button type="button" disabled>
          Activating your plan…
        </Button>
        {slowActivation ? (
          <p className="mt-2 text-xs text-neutral-500">
            Razorpay is taking a moment to confirm. Your payment IS on file — no
            need to click Subscribe again.{" "}
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
            Payment received. This page will refresh once Razorpay confirms the
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
      const result = await cancelSubscriptionAction(slug);
      if (!result.ok) {
        setError(result.error);
        setPending(false);
        return;
      }
      setDone(true);
      setPending(false);
      // Refresh to pick up the updated status badge.
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
