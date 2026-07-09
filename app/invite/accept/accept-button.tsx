"use client";

// Client child of the server-rendered invite/accept form so the CTA can show a
// pending label via useFormStatus. Without this, clicking the button gave no
// feedback until the server-action redirect finally completed — the exact
// "I clicked and nothing happened" moment we want to avoid.
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui";

export function AcceptInvitesButton({ single }: { single: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending
        ? single
          ? "Accepting invitation…"
          : "Accepting invitations…"
        : single
          ? "Accept invitation"
          : "Accept all invitations"}
    </Button>
  );
}
