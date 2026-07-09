"use client";

import Link from "next/link";
import { useActionState } from "react";
import { LobbyeeLogo } from "@/components/logo";
import { Button, FormError, FormMessage, Input, Label } from "@/components/ui";
import { type AuthFormState, signUpAction } from "@/features/auth/actions";

const initial: AuthFormState = {};

const COMPETENCY_WORDS = [
  "empathy",
  "clarity",
  "problem solving",
  "professionalism",
];

export default function SignUpPage() {
  const [state, action, pending] = useActionState(signUpAction, initial);

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
              Create your account
            </h1>
            <p className="mt-1.5 text-sm text-neutral-500">
              Set up your team&rsquo;s training workspace in the next step.
            </p>
          </div>
          <form action={action} className="flex flex-col gap-4">
            <div>
              <Label htmlFor="fullName">Your name</Label>
              <Input
                id="fullName"
                name="fullName"
                autoComplete="name"
                required
              />
            </div>
            <div>
              <Label htmlFor="email">Work email</Label>
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
                autoComplete="new-password"
                minLength={8}
                required
              />
            </div>
            <FormError>{state.error}</FormError>
            <FormMessage>{state.message}</FormMessage>
            <Button type="submit" disabled={pending}>
              {pending ? "Creating account…" : "Create account"}
            </Button>
          </form>
          <p className="mt-8 text-center text-sm text-neutral-500">
            Already have an account?{" "}
            <Link
              className="font-medium text-accent-700 hover:text-accent-800"
              href="/auth/signin"
            >
              Sign in
            </Link>
          </p>
        </div>
      </div>

      {/* Brand panel — ink base with a teal gradient wash. Hidden on mobile. */}
      <aside
        className="relative hidden flex-col justify-between overflow-hidden bg-neutral-900 px-12 py-12 text-white md:flex"
        aria-hidden="true"
      >
        <div
          className="pointer-events-none absolute inset-0 bg-gradient-to-br from-accent-700/70 via-neutral-900 to-clarity/40"
          aria-hidden="true"
        />
        <div className="relative z-10">
          <LobbyeeLogo tone="light" markSize={32} />
        </div>
        <div className="relative z-10">
          <p className="font-serif text-3xl leading-snug tracking-tight text-white">
            Practice every difficult guest,
            <br />
            before it&rsquo;s real.
          </p>
          <ul className="mt-10 flex flex-wrap gap-x-6 gap-y-2 text-sm text-white/60">
            {COMPETENCY_WORDS.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      </aside>
    </main>
  );
}
