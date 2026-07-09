"use client";

import { use, useActionState } from "react";
import { Button, Card, FormError, Input, Label } from "@/components/ui";
import {
  createPersonaAction,
  type PersonaFormState,
} from "@/features/personas/actions";

const initial: PersonaFormState = {};

const MOODS: Array<{ key: string; label: string; def: number }> = [
  { key: "frustration", label: "Frustration", def: 60 },
  { key: "trust", label: "Trust", def: 40 },
  { key: "patience", label: "Patience", def: 50 },
  { key: "satisfaction", label: "Satisfaction", def: 35 },
];

export default function NewPersonaPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = use(params);
  const [state, action, pending] = useActionState(createPersonaAction, initial);

  return (
    <main className="mx-auto max-w-xl p-6">
      <h1 className="mb-1 text-xl font-semibold text-neutral-900">New guest</h1>
      <p className="mb-6 text-sm text-neutral-500">
        Define who this guest is — their temperament and story. You'll pair them
        with any situation when you start a session.
      </p>
      <Card>
        <form action={action} className="flex flex-col gap-4">
          <input type="hidden" name="slug" value={slug} />
          <div>
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              name="name"
              placeholder="Maria Castellanos"
              required
            />
          </div>
          <div>
            <Label htmlFor="guestType">Type of guest</Label>
            <Input
              id="guestType"
              name="guestType"
              placeholder="Business traveler"
              required
            />
          </div>
          <div>
            <Label htmlFor="backstory">Backstory</Label>
            <textarea
              id="backstory"
              name="backstory"
              rows={4}
              maxLength={600}
              placeholder="Travels weekly for work and guards her expense reports carefully. Efficient, polite, and hates feeling brushed off."
              className="w-full rounded-lg border border-neutral-200 bg-white px-3.5 py-2.5 text-sm text-neutral-900 placeholder:text-neutral-400 outline-none transition-colors focus:border-accent-500 focus:ring-2 focus:ring-accent-500/20"
              required
            />
          </div>
          <fieldset>
            <Label>Baseline mood — where the guest starts (0–100)</Label>
            <div className="mt-2 flex flex-col gap-3">
              {MOODS.map((m) => (
                <div key={m.key} className="flex items-center gap-3">
                  <span className="w-28 text-sm text-neutral-700">
                    {m.label}
                  </span>
                  <input
                    type="range"
                    name={m.key}
                    min={0}
                    max={100}
                    defaultValue={m.def}
                    className="flex-1 accent-accent-600"
                  />
                </div>
              ))}
            </div>
          </fieldset>
          <FormError>{state.error}</FormError>
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save guest"}
          </Button>
        </form>
      </Card>
    </main>
  );
}
