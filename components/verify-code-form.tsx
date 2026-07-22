"use client";

import { useActionState } from "react";
import { Button, FormError, FormMessage, Input, Label } from "@/components/ui";
import {
  type AuthFormState,
  resendCodeAction,
  verifyCodeAction,
} from "@/features/auth/actions";

const initial: AuthFormState = {};

// The code the user types after requesting a sign-in or signup email. Browser
// independent by design: no link to click, so it works across devices, on
// shared terminals, and through email security scanners.
export function VerifyCodeForm({
  email,
  flow,
}: {
  email: string;
  flow: "magic" | "signup";
}) {
  const [state, submit, pending] = useActionState(verifyCodeAction, initial);
  const [resendState, resend, resendPending] = useActionState(
    resendCodeAction,
    initial,
  );

  return (
    <>
      <form action={submit} className="flex flex-col gap-4">
        <input type="hidden" name="email" value={email} />
        <input type="hidden" name="flow" value={flow} />
        <div>
          <Label htmlFor="code">Code</Label>
          <Input
            id="code"
            name="code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]*"
            maxLength={8}
            required
            autoFocus
          />
        </div>
        <FormError>{state.error}</FormError>
        <Button type="submit" disabled={pending}>
          {pending ? "Verifying…" : "Continue"}
        </Button>
      </form>

      <form
        action={resend}
        className="mt-5 text-center text-sm text-neutral-500"
      >
        <input type="hidden" name="email" value={email} />
        <input type="hidden" name="flow" value={flow} />
        Didn&rsquo;t get it?{" "}
        <button
          type="submit"
          disabled={resendPending}
          className="font-medium text-accent-700 transition-colors hover:text-accent-800 disabled:opacity-50"
        >
          {resendPending ? "Sending…" : "Send a new code"}
        </button>
        <div className="mt-2">
          <FormMessage>{resendState.message}</FormMessage>
          <FormError>{resendState.error}</FormError>
        </div>
      </form>
    </>
  );
}
