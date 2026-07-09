"use client";

import Link from "next/link";
import { useActionState, useEffect, useState } from "react";
import { AuthShell } from "@/components/auth-shell";
import { Button, FormError, FormMessage, Input, Label } from "@/components/ui";
import {
  type AuthFormState,
  magicLinkAction,
  signInAction,
} from "@/features/auth/actions";

const initial: AuthFormState = {};

export default function SignInPage() {
  const [mode, setMode] = useState<"password" | "magic">("password");
  const [linkError, setLinkError] = useState(false);
  const [pwState, pwSubmit, pwPending] = useActionState(signInAction, initial);
  const [mlState, mlSubmit, mlPending] = useActionState(
    magicLinkAction,
    initial,
  );

  // The email-confirm route sends failed/expired links back here with an error
  // flag. Read it on the client so the user learns why nothing happened.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("error") === "link-expired-or-invalid") setLinkError(true);
  }, []);

  return (
    <AuthShell>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-neutral-900">
          Sign in to Lobbyee
        </h1>
        <p className="mt-1.5 text-sm text-neutral-500">
          Staff usually sign in with a magic link, no password needed.
        </p>
      </div>
      {linkError ? (
        <div className="mb-4">
          <FormError>
            That link has expired or was already used. Sign in below, or request
            a new magic link.
          </FormError>
        </div>
      ) : null}
      {mode === "password" ? (
        <form action={pwSubmit} className="flex flex-col gap-4">
          <div>
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
            />
          </div>
          <div>
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
          </div>
          <FormError>{pwState.error}</FormError>
          <Button type="submit" disabled={pwPending}>
            {pwPending ? "Signing in…" : "Sign in"}
          </Button>
          <button
            type="button"
            className="text-sm text-accent-700 transition-colors hover:text-accent-800"
            onClick={() => setMode("magic")}
          >
            Email me a magic link instead
          </button>
        </form>
      ) : (
        <form action={mlSubmit} className="flex flex-col gap-4">
          <div>
            <Label htmlFor="ml-email">Email</Label>
            <Input
              id="ml-email"
              name="email"
              type="email"
              autoComplete="email"
              required
            />
          </div>
          <FormError>{mlState.error}</FormError>
          <FormMessage>{mlState.message}</FormMessage>
          <Button type="submit" disabled={mlPending}>
            {mlPending ? "Sending…" : "Send magic link"}
          </Button>
          <button
            type="button"
            className="text-sm text-accent-700 transition-colors hover:text-accent-800"
            onClick={() => setMode("password")}
          >
            Use a password instead
          </button>
        </form>
      )}
      <p className="mt-8 text-center text-sm text-neutral-500">
        New here?{" "}
        <Link
          className="font-medium text-accent-700 hover:text-accent-800"
          href="/auth/signup"
        >
          Create an account
        </Link>
      </p>
    </AuthShell>
  );
}
