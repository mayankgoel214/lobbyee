"use client";

import { useActionState, useState } from "react";
import { Button, FormError, Input, Label } from "@/components/ui";
import {
  type DeleteWorkspaceFormState,
  deleteWorkspaceAction,
} from "./actions";

const initial: DeleteWorkspaceFormState = {};

export function DeleteWorkspaceForm({
  slug,
  workspaceName,
  hasSubscription,
}: {
  slug: string;
  workspaceName: string;
  hasSubscription: boolean;
}) {
  const [state, action, pending] = useActionState(
    deleteWorkspaceAction,
    initial,
  );
  const [confirm, setConfirm] = useState("");
  const matches = confirm.trim() === workspaceName.trim();

  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="slug" value={slug} />
      <div>
        <Label htmlFor="confirm">
          Type <span className="font-semibold">{workspaceName}</span> to confirm
        </Label>
        <Input
          id="confirm"
          name="confirm"
          type="text"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          autoComplete="off"
          spellCheck={false}
          required
        />
      </div>
      {hasSubscription && (
        <p className="rounded-lg border border-warn/30 bg-warn/10 px-3 py-2 text-xs text-[#a76a12]">
          Your Stripe subscription will be canceled as part of this deletion.
        </p>
      )}
      <FormError>{state.error}</FormError>
      <Button
        type="submit"
        disabled={pending || !matches}
        className="self-start bg-bad text-white hover:bg-bad focus-visible:ring-bad disabled:cursor-not-allowed"
      >
        {pending ? "Deleting…" : "Delete workspace permanently"}
      </Button>
      <p className="text-xs text-neutral-500">
        This will remove all personas, scenarios, sessions, transcripts, and
        evaluations for this workspace. This cannot be undone.
      </p>
    </form>
  );
}
