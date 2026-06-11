"use client";

import Link from "next/link";
import { useActionState } from "react";
import {
  Button,
  Card,
  FormError,
  FormMessage,
  Input,
  Label,
} from "@/components/ui";
import { type AuthFormState, signUpAction } from "@/features/auth/actions";

const initial: AuthFormState = {};

export default function SignUpPage() {
  const [state, action, pending] = useActionState(signUpAction, initial);

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Create your account</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Set up your team&apos;s training workspace in the next step.
        </p>
      </div>
      <Card>
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
      </Card>
      <p className="text-center text-sm text-neutral-500">
        Already have an account?{" "}
        <Link className="font-medium text-neutral-900" href="/auth/signin">
          Sign in
        </Link>
      </p>
    </main>
  );
}
