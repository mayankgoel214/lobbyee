"use client";

import { useActionState } from "react";
import {
  type BillingActionState,
  openPortalAction,
  startCheckoutAction,
} from "./actions";

export function SubscribeButton({ slug }: { slug: string }) {
  const [state, formAction, pending] = useActionState<
    BillingActionState,
    FormData
  >(startCheckoutAction, {});
  return (
    <form action={formAction}>
      <input type="hidden" name="slug" value={slug} />
      <button
        type="submit"
        disabled={pending}
        className="rounded-xl bg-neutral-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-neutral-700 disabled:opacity-50"
      >
        {pending ? "Opening checkout…" : "Subscribe — $100/month"}
      </button>
      {state.error && (
        <p role="alert" className="mt-2 text-sm text-red-600">
          {state.error}
        </p>
      )}
    </form>
  );
}

export function ManageBillingButton({ slug }: { slug: string }) {
  const [state, formAction, pending] = useActionState<
    BillingActionState,
    FormData
  >(openPortalAction, {});
  return (
    <form action={formAction}>
      <input type="hidden" name="slug" value={slug} />
      <button
        type="submit"
        disabled={pending}
        className="rounded-xl border border-neutral-300 bg-white px-4 py-2.5 text-sm font-medium hover:border-neutral-500 disabled:opacity-50"
      >
        {pending ? "Opening portal…" : "Manage billing"}
      </button>
      {state.error && (
        <p role="alert" className="mt-2 text-sm text-red-600">
          {state.error}
        </p>
      )}
    </form>
  );
}
