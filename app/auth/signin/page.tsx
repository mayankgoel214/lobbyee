"use client";

import Link from "next/link";
import { useActionState, useEffect, useState } from "react";
import { AuthShell } from "@/components/auth-shell";
import { GoogleButton } from "@/components/google-button";
import { Button, FormError, FormMessage, Input, Label } from "@/components/ui";
import {
  type AuthFormState,
  magicLinkAction,
  signInAction,
} from "@/features/auth/actions";

const initial: AuthFormState = {};

export default function SignInPage() {
  // Magic link is the DEFAULT: the page already tells staff this is how they
  // sign in, and hiding it behind a mode switch meant the send button was one
  // click further than anyone got — the rate-limit ledger recorded zero magic
  // link requests for the entire life of the two-step form.
  const [mode, setMode] = useState<"password" | "magic">("magic");
  const [authError, setAuthError] = useState<string | null>(null);
  // Shared across both modes so switching doesn't blank out what the user
  // already typed — the empty field was the main reason people switched to
  // magic-link mode and then abandoned without ever pressing Send.
  const [email, setEmail] = useState("");
  const [pwState, pwSubmit, pwPending] = useActionState(signInAction, initial);
  const [mlState, mlSubmit, mlPending] = useActionState(
    magicLinkAction,
    initial,
  );

  // The confirm/callback routes send failures back here with an error flag.
  // Read it on the client so the user learns why nothing happened.
  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get("error");
    if (code === "link-expired-or-invalid") {
      setAuthError(
        "That link has expired or was already used. Sign in below, or request a new magic link.",
      );
    } else if (code === "google") {
      setAuthError(
        "Couldn't start Google sign-in. Please try again, or use email.",
      );
    }
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
      {authError ? (
        <div className="mb-4">
          <FormError>{authError}</FormError>
        </div>
      ) : null}
      <GoogleButton />
      <div className="my-5 flex items-center gap-3">
        <span className="h-px flex-1 bg-neutral-200" />
        <span className="text-xs text-neutral-400">or</span>
        <span className="h-px flex-1 bg-neutral-200" />
      </div>
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
              value={email}
              onChange={(e) => setEmail(e.target.value)}
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
            Use a magic link instead
          </button>
        </form>
      ) : (
        <form action={mlSubmit} className="flex flex-col gap-4">
          <p className="-mt-1 text-sm text-neutral-500">
            We&rsquo;ll email you a link that signs you in instantly.
          </p>
          <div>
            <Label htmlFor="ml-email">Email</Label>
            <Input
              id="ml-email"
              name="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
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
