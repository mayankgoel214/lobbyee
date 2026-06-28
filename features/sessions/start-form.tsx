"use client";

import { MessageSquare, Mic } from "lucide-react";
import { useActionState, useState } from "react";
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
  voiceEnabled = false,
}: {
  slug: string;
  // Phase 5 M4: when true, offer a Text/Voice toggle. Off → text only.
  voiceEnabled?: boolean;
  personas: Array<{ id: string; name: string; guestType: string }>;
  scenarios: Array<{
    id: string;
    title: string;
    difficulty: number;
    isLibrary: boolean;
  }>;
}) {
  const [state, action, pending] = useActionState(startSessionAction, initial);
  const [modality, setModality] = useState<"text" | "voice">("text");
  const selectClass =
    "w-full rounded-xl border border-neutral-300 bg-white px-3.5 py-2.5 text-sm text-neutral-900 outline-none focus:border-neutral-500";

  return (
    <Card>
      <form action={action} className="flex flex-col gap-4">
        <input type="hidden" name="slug" value={slug} />
        <input type="hidden" name="modality" value={modality} />
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
        {voiceEnabled && (
          <div>
            <Label>Mode</Label>
            <div className="grid grid-cols-2 gap-2">
              {(["text", "voice"] as const).map((m) => {
                const active = modality === m;
                return (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setModality(m)}
                    aria-pressed={active}
                    className={`inline-flex items-center justify-center gap-2 rounded-lg border px-3.5 py-2.5 text-sm font-medium transition-colors ${
                      active
                        ? "border-accent-600 bg-accent-50 text-accent-700"
                        : "border-neutral-300 bg-white text-neutral-700 hover:border-neutral-400"
                    }`}
                  >
                    {m === "text" ? (
                      <MessageSquare size={16} aria-hidden="true" />
                    ) : (
                      <Mic size={16} aria-hidden="true" />
                    )}
                    {m === "text" ? "Text" : "Voice"}
                  </button>
                );
              })}
            </div>
          </div>
        )}
        <FormError>{state.error}</FormError>
        <Button type="submit" disabled={pending}>
          {pending ? "The guest is on their way…" : "Start session"}
        </Button>
        <p className="text-center text-xs text-neutral-500">
          {modality === "voice"
            ? "Voice session · talk with the guest out loud · the guest opens"
            : "Text session · the guest opens the conversation"}
        </p>
      </form>
    </Card>
  );
}
