"use client";

import { useActionState } from "react";
import { Button, FormError, FormMessage, Input, Label } from "@/components/ui";
import {
  type AuthFormState,
  resendCodeAction,
  verifyCodeAction,
} from "@/features/auth/actions";

const initial: AuthFormState = {};

// The 6-digit code the user types after requesting a sign-in / signup email.
// Browser-independent by design: no link to click, so it works across devices,
// on shared terminals, and through email security scanners.
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
    <div className="flex flex-col gap-4">
      <form action={submit} className="flex flex-col gap-4">
        <input type="hidden" name="email" value={email} />
        <input type="hidden" name="flow" value={flow} />
        <div>
          <Label htmlFor="code">Code from your email</Label>
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
            placeholder="Enter the code"
            className="text-center text-lg tracking-[0.3em]"
          />
        </div>
        <FormError>{state.error}</FormError>
        <Button type="submit" disabled={pending}>
          {pending ? "Verifying…" : "Verify & sign in"}
        </Button>
      </form>

      <form
        action={resend}
        className="flex flex-col items-center gap-2 border-t border-neutral-100 pt-4"
      >
        <input type="hidden" name="email" value={email} />
        <input type="hidden" name="flow" value={flow} />
        <p className="text-xs text-neutral-400">Didn&rsquo;t get a code?</p>
        <button
          type="submit"
          disabled={resendPending}
          className="text-sm font-medium text-accent-700 transition-colors hover:text-accent-800 disabled:opacity-50"
        >
          {resendPending ? "Sending…" : "Send a new code"}
        </button>
        <FormMessage>{resendState.message}</FormMessage>
        <FormError>{resendState.error}</FormError>
      </form>
    </div>
  );
}
