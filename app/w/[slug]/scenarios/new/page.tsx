"use client";

import { use, useActionState } from "react";
import { Button, Card, FormError, Input, Label } from "@/components/ui";
import {
  createScenarioAction,
  type ScenarioFormState,
} from "@/features/scenarios/actions";

const initial: ScenarioFormState = {};

export default function NewScenarioPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = use(params);
  const [state, action, pending] = useActionState(
    createScenarioAction,
    initial,
  );

  return (
    <main className="mx-auto max-w-xl p-6">
      <h1 className="mb-1 text-xl font-semibold">New scenario</h1>
      <p className="mb-5 text-sm text-neutral-500">
        Written guest-agnostic — any persona can play it. The success criteria
        drive the coaching, so specific beats vague.
      </p>
      <Card>
        <form action={action} className="flex flex-col gap-4">
          <input type="hidden" name="slug" value={slug} />
          <div>
            <Label htmlFor="title">Title</Label>
            <Input
              id="title"
              name="title"
              placeholder="Disputed minibar charge"
              required
            />
          </div>
          <div>
            <Label htmlFor="situation">
              The situation — what just happened
            </Label>
            <textarea
              id="situation"
              name="situation"
              rows={4}
              maxLength={1000}
              placeholder="The guest has just checked out. There's a $40 minibar charge on their folio they insist they didn't make…"
              className="w-full rounded-xl border border-neutral-300 bg-white px-3.5 py-2.5 text-sm text-neutral-900 placeholder:text-neutral-400 outline-none focus:border-neutral-500"
              required
            />
          </div>
          <div>
            <Label htmlFor="difficulty">Difficulty (1–5)</Label>
            <Input
              id="difficulty"
              name="difficulty"
              type="number"
              min={1}
              max={5}
              defaultValue={3}
              required
            />
          </div>
          <div>
            <Label htmlFor="successCriteria">
              Success criteria — one per line
            </Label>
            <textarea
              id="successCriteria"
              name="successCriteria"
              rows={4}
              placeholder={
                "Acknowledge the frustration before explaining anything\nWalk through the charges line by line, together"
              }
              className="w-full rounded-xl border border-neutral-300 bg-white px-3.5 py-2.5 text-sm text-neutral-900 placeholder:text-neutral-400 outline-none focus:border-neutral-500"
              required
            />
          </div>
          <FormError>{state.error}</FormError>
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save scenario"}
          </Button>
        </form>
      </Card>
    </main>
  );
}
