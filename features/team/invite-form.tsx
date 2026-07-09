"use client";

import { Check, X } from "lucide-react";
import { useActionState } from "react";
import { Button, Card, FormError, Label } from "@/components/ui";
import { type InviteFormState, inviteStaffAction } from "./actions";

const initial: InviteFormState = {};

export function InviteForm({ slug }: { slug: string }) {
  const [state, action, pending] = useActionState(inviteStaffAction, initial);

  return (
    <Card>
      <form action={action} className="flex flex-col gap-4">
        <input type="hidden" name="slug" value={slug} />
        <div>
          <Label htmlFor="emails">
            Email addresses (one per line, up to 10)
          </Label>
          <textarea
            id="emails"
            name="emails"
            rows={3}
            required
            placeholder={"daniel@yourhotel.com\nsofia@yourhotel.com"}
            className="w-full rounded-lg border border-neutral-200 bg-white px-3.5 py-2.5 text-sm text-neutral-900 placeholder:text-neutral-400 outline-none transition-colors focus:border-accent-500 focus:ring-2 focus:ring-accent-500/20"
          />
        </div>
        <FormError>{state.error}</FormError>
        {state.results && (
          <ul className="flex flex-col gap-1.5 text-sm">
            {state.results.map((r) => (
              <li key={r.email} className="flex items-center gap-2">
                {r.status === "invited" ? (
                  <Check
                    size={16}
                    strokeWidth={2}
                    aria-hidden="true"
                    className="text-good"
                  />
                ) : (
                  <X
                    size={16}
                    strokeWidth={2}
                    aria-hidden="true"
                    className="text-bad"
                  />
                )}
                <span className="text-neutral-800">{r.email}</span>
                {r.note && <span className="text-neutral-500">: {r.note}</span>}
              </li>
            ))}
          </ul>
        )}
        <Button type="submit" disabled={pending} className="self-start">
          {pending ? "Sending invites…" : "Send invites"}
        </Button>
        <p className="text-xs text-neutral-500">
          Invitees join as staff. Magic links expire after a few days, and you
          can re-invite anytime.
        </p>
      </form>
    </Card>
  );
}
