"use client";

import { Sparkles } from "lucide-react";
import { use, useActionState, useState } from "react";
import { Button, Card, FormError, Input, Label } from "@/components/ui";
import {
  createScenarioAction,
  type ScenarioFormState,
  suggestScenarioDepthAction,
} from "@/features/scenarios/actions";
import {
  RESOLVABILITY,
  RESOLVABILITY_HELP,
  RESOLVABILITY_LABELS,
  type Resolvability,
} from "@/lib/scenario/depth";

const initial: ScenarioFormState = {};

const textareaClass =
  "w-full rounded-lg border border-neutral-200 bg-white px-3.5 py-2.5 text-sm text-neutral-900 placeholder:text-neutral-400 outline-none transition-colors focus:border-accent-500 focus:ring-2 focus:ring-accent-500/20";

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

  // Title + situation are controlled so we can gate the "Suggest" button (which
  // spends a Gemini call) until both are filled.
  const [title, setTitle] = useState("");
  const [situation, setSituation] = useState("");
  // Controlled so the AI suggestion can pre-fill them; the manager still edits
  // or clears anything before saving.
  const [underlyingNeed, setUnderlyingNeed] = useState("");
  const [resolutionPath, setResolutionPath] = useState("");
  const [resolvability, setResolvability] =
    useState<Resolvability>("resolvable");

  // Suggest is NOT a form submit — calling the server action directly avoids
  // submitting (and, in React 19, RESETTING) the whole create form, which would
  // wipe the uncontrolled Success criteria / Difficulty fields.
  const [suggesting, setSuggesting] = useState(false);
  const [suggestError, setSuggestError] = useState<string | null>(null);

  const canSuggest = title.trim().length >= 3 && situation.trim().length >= 20;

  async function handleSuggest() {
    if (!canSuggest || suggesting) return;
    setSuggesting(true);
    setSuggestError(null);
    try {
      const fd = new FormData();
      fd.set("slug", slug);
      fd.set("title", title);
      fd.set("situation", situation);
      const res = await suggestScenarioDepthAction({}, fd);
      if (res.suggestion) {
        setUnderlyingNeed(res.suggestion.underlyingNeed);
        setResolutionPath(res.suggestion.resolutionPath);
        setResolvability(res.suggestion.resolvability);
      } else {
        setSuggestError(res.error ?? "Couldn't draft a suggestion. Try again.");
      }
    } catch {
      setSuggestError("Couldn't draft a suggestion. Try again.");
    } finally {
      setSuggesting(false);
    }
  }

  return (
    <main className="mx-auto max-w-xl p-6 md:p-8">
      <h1 className="mb-1 text-xl font-semibold text-neutral-900">
        New situation
      </h1>
      <p className="mb-6 text-sm text-neutral-500">
        Describe what's happening, not who the guest is. Any guest can play this
        situation. The success criteria drive the coaching, so specific beats
        vague.
      </p>
      <Card>
        <form action={action} className="flex flex-col gap-4">
          <input type="hidden" name="slug" value={slug} />
          <div>
            <Label htmlFor="title">Title</Label>
            <Input
              id="title"
              name="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Disputed minibar charge"
              required
            />
          </div>
          <div>
            <Label htmlFor="situation">The situation: what just happened</Label>
            <textarea
              id="situation"
              name="situation"
              rows={4}
              maxLength={1000}
              value={situation}
              onChange={(e) => setSituation(e.target.value)}
              placeholder="The guest has just checked out. There's a $40 minibar charge on their folio they insist they didn't make…"
              className={textareaClass}
              required
            />
          </div>
          <div>
            <Label htmlFor="difficulty">Difficulty (1 to 5)</Label>
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
              Success criteria (one per line)
            </Label>
            <textarea
              id="successCriteria"
              name="successCriteria"
              rows={4}
              placeholder={
                "Acknowledge the frustration before explaining anything\nWalk through the charges line by line, together"
              }
              className={textareaClass}
              required
            />
          </div>

          {/* Hidden depth — what makes a guest realistically hard to satisfy. */}
          <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-4">
            <div className="mb-1 flex items-center justify-between gap-3">
              <span className="text-sm font-medium text-neutral-900">
                Hidden depth{" "}
                <span className="font-normal text-neutral-500">(optional)</span>
              </span>
              <Button
                type="button"
                variant="secondary"
                onClick={handleSuggest}
                disabled={suggesting || !canSuggest}
                title={
                  canSuggest ? undefined : "Add a title and situation first"
                }
                className="!py-1.5 !text-xs"
              >
                <Sparkles className="mr-1 inline size-3.5" aria-hidden />
                {suggesting ? "Drafting…" : "Suggest with AI"}
              </Button>
            </div>
            <p className="mb-3 text-xs text-neutral-500">
              The real issue beneath the surface complaint. The guest won't
              volunteer it. Staff have to uncover it to fully satisfy them. Fill
              a title and situation, then let AI draft a starting point.
            </p>

            <div className="mb-3">
              <Label htmlFor="underlyingNeed">
                What's really going on for the guest
              </Label>
              <textarea
                id="underlyingNeed"
                name="underlyingNeed"
                rows={2}
                maxLength={600}
                value={underlyingNeed}
                onChange={(e) => setUnderlyingNeed(e.target.value)}
                placeholder="They feel accused of lying and want their honesty respected. The $40 is really about their dignity."
                className={textareaClass}
              />
            </div>

            <div className="mb-3">
              <Label htmlFor="resolutionPath">
                What would genuinely resolve it
              </Label>
              <textarea
                id="resolutionPath"
                name="resolutionPath"
                rows={2}
                maxLength={600}
                value={resolutionPath}
                onChange={(e) => setResolutionPath(e.target.value)}
                placeholder="Believe them without making them prove it, remove the charge graciously, and thank them for flagging it."
                className={textareaClass}
              />
            </div>

            <div>
              <Label htmlFor="resolvability">How winnable is it?</Label>
              <select
                id="resolvability"
                name="resolvability"
                value={resolvability}
                onChange={(e) =>
                  setResolvability(e.target.value as Resolvability)
                }
                className={textareaClass}
              >
                {RESOLVABILITY.map((r) => (
                  <option key={r} value={r}>
                    {RESOLVABILITY_LABELS[r]}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-neutral-500">
                {RESOLVABILITY_HELP[resolvability]}
              </p>
            </div>

            {suggestError ? (
              <p className="mt-2 text-xs text-warn">{suggestError}</p>
            ) : null}
          </div>

          <FormError>{state.error}</FormError>
          <Button type="submit" disabled={pending || suggesting}>
            {pending ? "Saving…" : "Save situation"}
          </Button>
        </form>
      </Card>
    </main>
  );
}
