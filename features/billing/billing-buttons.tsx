"use client";

import { useActionState } from "react";
import { Button, FormError } from "@/components/ui";
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
      <Button type="submit" disabled={pending}>
        {pending ? "Opening checkout…" : "Subscribe for $100/month"}
      </Button>
      <FormError>{state.error}</FormError>
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
      <Button type="submit" variant="secondary" disabled={pending}>
        {pending ? "Opening portal…" : "Manage billing"}
      </Button>
      <FormError>{state.error}</FormError>
    </form>
  );
}
