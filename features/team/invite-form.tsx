"use client";

import { useActionState } from "react";
import { Button, Card, FormError } from "@/components/ui";
import { type InviteFormState, inviteStaffAction } from "./actions";

const initial: InviteFormState = {};

export function InviteForm({ slug }: { slug: string }) {
  const [state, action, pending] = useActionState(inviteStaffAction, initial);

  return (
    <Card>
      <form action={action} className="flex flex-col gap-4">
        <input type="hidden" name="slug" value={slug} />
        <div>
          <label
            htmlFor="emails"
            className="mb-1.5 block text-xs font-semibold tracking-wide text-neutral-500 uppercase"
          >
            Email addresses — one per line, up to 10
          </label>
          <textarea
            id="emails"
            name="emails"
            rows={3}
            required
            placeholder={"daniel@yourhotel.com\nsofia@yourhotel.com"}
            className="w-full rounded-xl border border-neutral-300 bg-white px-3.5 py-2.5 text-sm text-neutral-900 placeholder:text-neutral-400 outline-none focus:border-neutral-500"
          />
        </div>
        <FormError>{state.error}</FormError>
        {state.results && (
          <ul className="flex flex-col gap-1 text-sm">
            {state.results.map((r) => (
              <li key={r.email}>
                {r.status === "invited" ? "✓" : "✕"} {r.email}
                {r.note && (
                  <span className="text-neutral-500"> — {r.note}</span>
                )}
              </li>
            ))}
          </ul>
        )}
        <Button type="submit" disabled={pending} className="self-start">
          {pending ? "Sending invites…" : "Send invites"}
        </Button>
        <p className="text-xs text-neutral-400">
          Invitees join as staff. Magic links expire after a few days — you can
          re-invite anytime.
        </p>
      </form>
    </Card>
  );
}
