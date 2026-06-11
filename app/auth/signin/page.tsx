"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import {
  Button,
  Card,
  FormError,
  FormMessage,
  Input,
  Label,
} from "@/components/ui";
import {
  type AuthFormState,
  magicLinkAction,
  signInAction,
} from "@/features/auth/actions";

const initial: AuthFormState = {};

export default function SignInPage() {
  const [mode, setMode] = useState<"password" | "magic">("password");
  const [pwState, pwSubmit, pwPending] = useActionState(signInAction, initial);
  const [mlState, mlSubmit, mlPending] = useActionState(
    magicLinkAction,
    initial,
  );

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Sign in to Lobbyee</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Staff usually sign in with a magic link — no password needed.
        </p>
      </div>
      <Card>
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
              className="text-sm text-neutral-500 underline"
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
              className="text-sm text-neutral-500 underline"
              onClick={() => setMode("password")}
            >
              Use a password instead
            </button>
          </form>
        )}
      </Card>
      <p className="text-center text-sm text-neutral-500">
        New here?{" "}
        <Link className="font-medium text-neutral-900" href="/auth/signup">
          Create an account
        </Link>
      </p>
    </main>
  );
}
