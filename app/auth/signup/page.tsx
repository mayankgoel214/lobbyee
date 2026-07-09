"use client";

import Link from "next/link";
import { useActionState } from "react";
import { AuthShell } from "@/components/auth-shell";
import { Button, FormError, FormMessage, Input, Label } from "@/components/ui";
import { type AuthFormState, signUpAction } from "@/features/auth/actions";

const initial: AuthFormState = {};

export default function SignUpPage() {
  const [state, action, pending] = useActionState(signUpAction, initial);

  return (
    <AuthShell>
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
          <Input id="fullName" name="fullName" autoComplete="name" required />
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
    </AuthShell>
  );
}
