"use client";

import { useActionState } from "react";
import { Button, Card, FormError, Input, Label } from "@/components/ui";
import {
  createWorkspaceAction,
  type WorkspaceFormState,
} from "@/features/workspace/actions";

const initial: WorkspaceFormState = {};

export default function CreateWorkspacePage() {
  const [state, action, pending] = useActionState(
    createWorkspaceAction,
    initial,
  );

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Create your workspace</h1>
        <p className="mt-1 text-sm text-neutral-500">
          One workspace per property or team — you&apos;ll invite staff next.
        </p>
      </div>
      <Card>
        <form action={action} className="flex flex-col gap-4">
          <div>
            <Label htmlFor="name">Workspace name</Label>
            <Input
              id="name"
              name="name"
              placeholder="The Marlowe Hotel"
              required
              minLength={2}
            />
          </div>
          <div>
            <Label htmlFor="industry">What kind of business?</Label>
            <select
              id="industry"
              name="industry"
              className="w-full rounded-xl border border-neutral-300 bg-white px-3.5 py-2.5 text-sm text-neutral-900 placeholder:text-neutral-400 outline-none focus:border-neutral-500"
              defaultValue="hotel"
            >
              <option value="hotel">Hotel / resort</option>
              <option value="restaurant">Restaurant / cafe</option>
              <option value="training_school">Hospitality school</option>
              <option value="other">Other</option>
            </select>
          </div>
          <FormError>{state.error}</FormError>
          <Button type="submit" disabled={pending}>
            {pending ? "Creating…" : "Create workspace"}
          </Button>
        </form>
      </Card>
    </main>
  );
}
