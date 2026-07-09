-- §5 Scenario depth — backfill the seeded LIBRARY scenarios with a hidden
-- underlying need + resolvability, and add two showcase scenarios (one
-- "partial", one that leans on empathy). Library rows are workspace_id NULL,
-- is_library true → visible to every workspace. Runs once via migrate deploy.
--
-- UPDATEs are keyed on title + is_library so they only ever touch library rows
-- and are safe to re-run. INSERTs add new library rows.

-- 1) Disputed minibar charge — the $40 is really about being called a liar.
UPDATE "scenario" SET
  "underlying_need" = 'They are an honest, frequent guest, and the charge makes them feel accused of lying or stealing on their way out the door. The forty dollars barely matters — what stings is being doubted.',
  "resolution_path" = 'Take their word without making them prove innocence, remove the charge graciously and immediately, and thank them for flagging it — restoring their standing as a trusted guest.',
  "resolvability" = 'resolvable'
WHERE "is_library" = true AND "workspace_id" IS NULL
  AND "title" = 'Disputed minibar charge';

-- 2) Late check-in, room not ready — the fear is being left stranded, not the wait itself.
UPDATE "scenario" SET
  "underlying_need" = 'They are exhausted after a long journey and, more than the room itself, they are afraid of being left in limbo — stuck waiting with no clear answer, treated as an afterthought despite having pre-paid and confirmed.',
  "resolution_path" = 'Give a firm, specific time, own the mistake without over-explaining, and make the wait genuinely comfortable right now (a place to sit, a drink, luggage handled) so they feel looked-after rather than stranded.',
  "resolvability" = 'resolvable'
WHERE "is_library" = true AND "workspace_id" IS NULL
  AND "title" = 'Late check-in, room not ready';

-- 3) VIP early check-in, full house — genuinely unwinnable; the win is making status count.
UPDATE "scenario" SET
  "underlying_need" = 'Beneath the demand for a room is a need to feel that their loyalty and status actually mean something here — to be recognized and treated as special, not processed like a walk-in. The early room is really a test of whether they matter.',
  "resolution_path" = 'They cannot have a clean room now, so the win is making their status visibly count: warm personal recognition, lounge access or a comfortable place to wait, luggage handled, and a genuine commitment to the first available room with a personal follow-up — so they feel prioritized even though the answer is not-yet.',
  "resolvability" = 'unwinnable'
WHERE "is_library" = true AND "workspace_id" IS NULL
  AND "title" = 'VIP early check-in, full house';

-- 4) NEW — Anniversary dinner, lost reservation (resolvable, empathy + save-the-night).
INSERT INTO "scenario"
  (id, workspace_id, title, situation, difficulty, success_criteria, underlying_need, resolution_path, resolvability, is_library)
VALUES (
  gen_random_uuid(), NULL,
  'Anniversary dinner, lost reservation',
  'It is a couple''s anniversary. They booked weeks ago, but the reservation is not in the system and the dining room is full. They are dressed up, quietly crushed, and one of them is starting to get angry on the other''s behalf.',
  4,
  '["Acknowledge the occasion and the disappointment before anything else","Take ownership of the lost booking without blaming the system","Find a concrete way to still make the night special"]',
  'This was meant to be a special, memorable night, and right now it feels ruined and like they do not matter. They do not really care whose fault the booking is — they need to feel the evening can still be saved and that someone cares that it is their anniversary.',
  'Treat it as the occasion it is: acknowledge the anniversary warmly, do whatever is possible to seat them or offer something genuinely nice while they wait (a drink at the bar, a comped dessert or a glass of champagne), and make them feel personally looked-after so the night is rescued, not merely fixed.',
  'resolvable',
  true
);

-- 5) NEW — Bereavement, non-refundable booking (partial; empathy over policy).
INSERT INTO "scenario"
  (id, workspace_id, title, situation, difficulty, success_criteria, underlying_need, resolution_path, resolvability, is_library)
VALUES (
  gen_random_uuid(), NULL,
  'Bereavement — non-refundable booking',
  'A guest calls to cancel a three-night non-refundable stay because a close family member has just died and they can no longer travel. They are composed but clearly grieving, and bracing to be told policy is policy.',
  5,
  '["Lead with genuine human empathy, not policy","Do not make them justify or prove their loss","Do whatever is actually within reach — even if a full refund is not"]',
  'In the middle of grief, they need to be treated as a human being, not a transaction. The money matters far less than not being met with a cold, bureaucratic no at the worst moment of their week.',
  'Lead with sincere condolences, do not make them prove anything, and offer the most compassionate thing actually possible — waiving what can be waived, rebooking with an open date, or escalating for a goodwill exception — so they feel cared for even if the policy cannot fully bend.',
  'partial',
  true
);
