"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { LobbyeeLogo, LobbyeeMark } from "@/components/logo";
import { Button, FormError, FormMessage, Input, Label } from "@/components/ui";
import {
  type AuthFormState,
  magicLinkAction,
  signInAction,
} from "@/features/auth/actions";

const initial: AuthFormState = {};

const COMPETENCY_WORDS = [
  "empathy",
  "clarity",
  "problem solving",
  "professionalism",
];

export default function SignInPage() {
  const [mode, setMode] = useState<"password" | "magic">("password");
  const [pwState, pwSubmit, pwPending] = useActionState(signInAction, initial);
  const [mlState, mlSubmit, mlPending] = useActionState(
    magicLinkAction,
    initial,
  );

  return (
    <main className="grid min-h-screen grid-cols-1 md:grid-cols-2">
      {/* Form column. */}
      <div className="flex flex-col px-6 py-8 md:px-12">
        <div className="mb-12">
          <Link href="/" className="inline-flex">
            <LobbyeeLogo />
          </Link>
        </div>
        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center">
          <div className="mb-6">
            <h1 className="text-2xl font-semibold text-neutral-900">
              Sign in to Lobbyee
            </h1>
            <p className="mt-1.5 text-sm text-neutral-500">
              Staff usually sign in with a magic link — no password needed.
            </p>
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
                className="text-sm text-accent-600 transition-colors hover:text-accent-700"
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
                className="text-sm text-accent-600 transition-colors hover:text-accent-700"
                onClick={() => setMode("password")}
              >
                Use a password instead
              </button>
            </form>
          )}
          <p className="mt-8 text-center text-sm text-neutral-500">
            New here?{" "}
            <Link
              className="font-medium text-accent-600 hover:text-accent-700"
              href="/auth/signup"
            >
              Create an account
            </Link>
          </p>
        </div>
      </div>

      {/* Brand panel — hidden on mobile. */}
      <aside
        className="hidden flex-col justify-between bg-neutral-900 px-12 py-12 text-white md:flex"
        aria-hidden="true"
      >
        <LobbyeeMark size={36} />
        <div>
          <p className="font-serif text-3xl leading-snug tracking-tight text-white">
            Practice every difficult guest,
            <br />
            before it&rsquo;s real.
          </p>
          <ul className="mt-10 flex flex-wrap gap-x-6 gap-y-2 text-sm text-neutral-400">
            {COMPETENCY_WORDS.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      </aside>
    </main>
  );
}
