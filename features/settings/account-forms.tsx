"use client";

import { LogOut } from "lucide-react";
import { useActionState } from "react";
import { Button, FormError, FormMessage, Input, Label } from "@/components/ui";
import { signOutAction } from "@/features/auth/actions";
import {
  changePasswordAction,
  type PasswordFormState,
  type ProfileFormState,
  updateProfileAction,
} from "./actions";

const initialProfile: ProfileFormState = {};
const initialPassword: PasswordFormState = {};

export function ProfileForm({ initialName }: { initialName: string }) {
  const [state, action, pending] = useActionState(
    updateProfileAction,
    initialProfile,
  );
  return (
    <form action={action} className="flex flex-col gap-4">
      <div>
        <Label htmlFor="fullName">Display name</Label>
        <Input
          id="fullName"
          name="fullName"
          type="text"
          required
          maxLength={120}
          defaultValue={initialName}
          autoComplete="name"
        />
      </div>
      <FormError>{state.error}</FormError>
      <FormMessage>{state.message}</FormMessage>
      <Button type="submit" disabled={pending} className="self-start">
        {pending ? "Saving…" : "Save name"}
      </Button>
    </form>
  );
}

export function PasswordForm() {
  const [state, action, pending] = useActionState(
    changePasswordAction,
    initialPassword,
  );
  return (
    <form action={action} className="flex flex-col gap-4" autoComplete="off">
      <div>
        <Label htmlFor="currentPassword">Current password</Label>
        <Input
          id="currentPassword"
          name="currentPassword"
          type="password"
          required
          autoComplete="current-password"
        />
      </div>
      <div>
        <Label htmlFor="password">New password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
        />
      </div>
      <div>
        <Label htmlFor="confirm">Confirm new password</Label>
        <Input
          id="confirm"
          name="confirm"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
        />
      </div>
      <FormError>{state.error}</FormError>
      <FormMessage>{state.message}</FormMessage>
      <Button type="submit" disabled={pending} className="self-start">
        {pending ? "Updating…" : "Update password"}
      </Button>
      <p className="text-xs text-neutral-500">
        Minimum 8 characters. You&apos;ll stay signed in on this device.
      </p>
    </form>
  );
}

export function SignOutForm() {
  return (
    <form action={signOutAction}>
      <Button type="submit" variant="secondary">
        <LogOut size={16} aria-hidden="true" />
        Sign out
      </Button>
    </form>
  );
}
