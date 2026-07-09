"use client";

import { useActionState } from "react";
import { FormError, FormMessage } from "@/components/ui";
import { type AuthFormState, resendEmailAction } from "@/features/auth/actions";

const initial: AuthFormState = {};

export function ResendEmail({ email }: { email: string }) {
  const [state, action, pending] = useActionState(resendEmailAction, initial);
  return (
    <form action={action} className="flex flex-col items-center gap-2">
      <input type="hidden" name="email" value={email} />
      <button
        type="submit"
        disabled={pending}
        className="text-sm font-medium text-accent-700 transition-colors hover:text-accent-800 disabled:opacity-50"
      >
        {pending ? "Sending…" : "Resend email"}
      </button>
      <FormError>{state.error}</FormError>
      <FormMessage>{state.message}</FormMessage>
    </form>
  );
}
