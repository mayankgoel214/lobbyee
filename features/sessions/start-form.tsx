"use client";

import { useActionState } from "react";
import { Button, Card, FormError, Label } from "@/components/ui";
import {
  type StartSessionState,
  startSessionAction,
} from "@/features/sessions/actions";

const initial: StartSessionState = {};

export function StartSessionForm({
  slug,
  personas,
  scenarios,
}: {
  slug: string;
  personas: Array<{ id: string; name: string; guestType: string }>;
  scenarios: Array<{
    id: string;
    title: string;
    difficulty: number;
    isLibrary: boolean;
  }>;
}) {
  const [state, action, pending] = useActionState(startSessionAction, initial);
  const selectClass =
    "w-full rounded-xl border border-neutral-300 bg-white px-3.5 py-2.5 text-sm text-neutral-900 outline-none focus:border-neutral-500";

  return (
    <Card>
      <form action={action} className="flex flex-col gap-4">
        <input type="hidden" name="slug" value={slug} />
        <div>
          <Label htmlFor="scenarioId">Scenario</Label>
          <select id="scenarioId" name="scenarioId" className={selectClass}>
            {scenarios.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title} · difficulty {s.difficulty}
                {s.isLibrary ? " · library" : ""}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="personaId">Guest</Label>
          <select id="personaId" name="personaId" className={selectClass}>
            {personas.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} — {p.guestType}
              </option>
            ))}
          </select>
        </div>
        <FormError>{state.error}</FormError>
        <Button type="submit" disabled={pending}>
          {pending ? "The guest is on their way…" : "Start session"}
        </Button>
        <p className="text-center text-xs text-neutral-500">
          Text session · the guest opens the conversation
        </p>
      </form>
    </Card>
  );
}
