"use client";

import { useActionState } from "react";
import { Button, FormError, FormMessage, Input, Label } from "@/components/ui";
import { updateWorkspaceAction, type WorkspaceFormState } from "./actions";

const initial: WorkspaceFormState = {};

const industries: Array<{
  value: "hotel" | "restaurant" | "training_school" | "other";
  label: string;
}> = [
  { value: "hotel", label: "Hotel" },
  { value: "restaurant", label: "Restaurant" },
  { value: "training_school", label: "Training school" },
  { value: "other", label: "Other" },
];

export function WorkspaceForm({
  slug,
  name,
  industry,
}: {
  slug: string;
  name: string;
  industry: string | null;
}) {
  const [state, action, pending] = useActionState(
    updateWorkspaceAction,
    initial,
  );
  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="slug" value={slug} />
      <div>
        <Label htmlFor="ws-name">Workspace name</Label>
        <Input
          id="ws-name"
          name="name"
          type="text"
          required
          maxLength={80}
          defaultValue={name}
        />
      </div>
      <div>
        <Label htmlFor="ws-industry">Industry</Label>
        <select
          id="ws-industry"
          name="industry"
          required
          defaultValue={industry ?? "other"}
          className="w-full rounded-lg border border-neutral-200 bg-white px-3.5 py-2.5 text-sm text-neutral-900 outline-none transition-colors focus:border-accent-500 focus:ring-2 focus:ring-accent-500/20"
        >
          {industries.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>
      <div>
        <Label htmlFor="ws-slug">URL slug</Label>
        <Input
          id="ws-slug"
          type="text"
          value={slug}
          readOnly
          disabled
          className="cursor-not-allowed bg-neutral-50 text-neutral-500"
        />
        <p className="mt-1.5 text-xs text-neutral-500">
          The slug is fixed once a workspace is created.
        </p>
      </div>
      <FormError>{state.error}</FormError>
      <FormMessage>{state.message}</FormMessage>
      <Button type="submit" disabled={pending} className="self-start">
        {pending ? "Saving…" : "Save workspace"}
      </Button>
    </form>
  );
}
