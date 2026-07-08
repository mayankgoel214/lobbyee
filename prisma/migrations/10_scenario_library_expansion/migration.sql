-- §5 Default scenario library expansion — 10 more research-grounded library
-- scenarios, each built around the emotional need beneath the surface complaint
-- (feeling heard, respect, trust restoration, control/safety, being valued).
-- Spread across resolvability (resolvable / partial / unwinnable) and difficulty
-- 2–5, covering the most common difficult-guest archetypes in hospitality
-- (noise, cleanliness, overbooking, billing, mechanical, accessibility, F&B
-- safety, loyalty, aggression, refund-leverage).
--
-- All are library rows: workspace_id NULL, is_library true → visible to every
-- workspace. Dollar-quoted ($$…$$) literals so apostrophes need no escaping.
-- Runs once via migrate deploy.

INSERT INTO "scenario"
  (id, workspace_id, title, situation, difficulty, success_criteria, underlying_need, resolution_path, resolvability, is_library)
VALUES

(gen_random_uuid(), NULL,
 $$Noisy neighbors, can't sleep$$,
 $$It's past midnight. An exhausted guest calls the front desk because the room next door is loud — talking, music, a door slamming. They've been trying to sleep for an hour and have an early start.$$,
 2,
 $$["Take ownership and act immediately, don't just note it down","Give a concrete next step and a timeframe","Follow up to confirm it's actually resolved"]$$,
 $$They feel powerless in the one place they're supposed to be able to rest, and they're afraid this will wreck their whole night with no one taking charge. It's less about the neighbors than about someone finally taking control so they can sleep.$$,
 $$Take the problem off their hands entirely — act on it right away (call the room or offer to move them), give a firm next step, and follow up so they can stop worrying and rest.$$,
 'resolvable', true),

(gen_random_uuid(), NULL,
 $$Dirty room at check-in$$,
 $$A guest opens their room to find it wasn't properly cleaned — an unmade section, hair in the bathroom, trash from the previous guest. They come back to the desk visibly put off.$$,
 3,
 $$["Apologize sincerely, no excuses about being short-staffed","Fix it now — a verified-clean room or immediate re-clean","Offer a gesture that signals this isn't your standard"]$$,
 $$A dirty room makes them question everything — is this place hygienic, was I handed a second-rate room, does anyone here care? What's really shaken is their trust that the hotel has standards and takes them seriously.$$,
 $$Restore trust fast: own it with a genuine apology, move them to a verified-clean room or re-clean immediately, and add a small gesture that says clearly, this is not who we are.$$,
 'resolvable', true),

(gen_random_uuid(), NULL,
 $$Overbooked — walked to another hotel$$,
 $$A guest with a confirmed, pre-paid reservation arrives at 11pm. The hotel is oversold and there is genuinely no room tonight — they must be walked to a partner property across town.$$,
 4,
 $$["Own the situation completely — never blame the system","Arrange and pay for everything: transport and any room-rate difference","Make a personal commitment for the rest of their stay"]$$,
 $$They did everything right and are being turned away — it feels like a betrayal, and underneath is real fear about being stranded late at night somewhere unfamiliar. They need to feel taken care of, not passed off.$$,
 $$Take total ownership: arrange and pay for the transfer, cover any rate difference, call ahead so they're expected and treated well, and personally guarantee their room here for the rest of the stay.$$,
 'partial', true),

(gen_random_uuid(), NULL,
 $$Surprise fees at checkout$$,
 $$At checkout a guest sees resort and parking fees they say were never disclosed at booking. The total is far higher than they expected and they're convinced they were misled.$$,
 3,
 $$["Acknowledge that surprise charges feel unfair before explaining","Walk through the folio transparently, line by line","Correct or waive anything that genuinely wasn't disclosed"]$$,
 $$The dollar amount matters less than the feeling of being tricked. What stings is the sense that the hotel was dishonest with them — this is about fairness and trust, not the fee itself.$$,
 $$Treat it as a fairness issue, not a math dispute: acknowledge the surprise, explain every charge openly, own any disclosure gap and waive what's fair, so they leave feeling the hotel dealt with them honestly.$$,
 'resolvable', true),

(gen_random_uuid(), NULL,
 $$Broken A/C on a fully-booked hot night$$,
 $$On a hot night a guest's air conditioning has failed. Engineering can't fix it until morning and the hotel is fully booked, so there's no room to move them to.$$,
 3,
 $$["Convey urgency and genuine concern, not a shrug","Be honest about the constraint without hiding behind it","Offer real mitigation — fans, a comp, a priority move tomorrow"]$$,
 $$They're facing a miserable, sleepless night, and their real fear is being brushed off and left to suffer. Even if it can't be fully fixed tonight, they need to feel the hotel is genuinely trying and is on their side.$$,
 $$Show you take it seriously: bring fans/cooling now, be honest that a full fix is tomorrow, offer a meaningful goodwill gesture and a guaranteed early move, and check back — because the fix can't be complete, the care has to be visible.$$,
 'partial', true),

(gen_random_uuid(), NULL,
 $$Guest shouting and insulting staff$$,
 $$A guest is at the desk raising their voice and hurling insults over a service failure earlier in their stay. Other guests in the lobby are starting to notice.$$,
 5,
 $$["Stay calm and never mirror the hostility","Set a respectful boundary while still addressing the real issue","De-escalate first, solve second"]$$,
 $$Under the aggression is someone who feels completely unheard and has escalated to the only volume they think will get them taken seriously. They need to feel genuinely listened to — but not at the cost of the staff being abused.$$,
 $$De-escalate by showing you're truly listening and taking the underlying issue seriously, while calmly holding a boundary against the abuse. You won't be thanked warmly, but you can bring them from raging to heard-and-handled.$$,
 'partial', true),

(gen_random_uuid(), NULL,
 $$Accessible room not provided$$,
 $$A guest who booked a wheelchair-accessible room is told at check-in it was given away, and only a standard room is available tonight. They rely on the accessible features.$$,
 4,
 $$["Treat it as a genuine need, never a preference or an upgrade","Show real urgency to find a workable solution","Never minimize it or make them explain why they need it"]$$,
 $$This isn't an inconvenience, it's their independence and dignity on the line — plus real anxiety about how they'll manage the night. What wounds most is any hint that their need wasn't taken seriously.$$,
 $$Treat it with the seriousness it deserves: urgent, genuine effort to secure an accessible room — theirs, a sister property, whatever it takes — never minimize it, and if it truly can't happen tonight, move mountains to keep them safe and comfortable.$$,
 'partial', true),

(gen_random_uuid(), NULL,
 $$Allergy ignored in the restaurant$$,
 $$In the restaurant, a guest who clearly flagged a dairy allergy has been served a dish containing dairy. They caught it in time, but they're shaken and angry.$$,
 4,
 $$["Treat it as a safety issue immediately, not a picky preference","Lead with genuine concern for their wellbeing","Fix it and explain concretely how you'll prevent a repeat"]$$,
 $$This frightened them — it could have been dangerous — and what they need is to feel their safety is taken seriously. Their trust that they can eat here safely has been broken.$$,
 $$Lead with genuine concern for their wellbeing, treat it as the safety matter it is, remake the dish with visible care, and explain concretely how you'll make sure it can't happen again — rebuilding their trust that they're safe here.$$,
 'resolvable', true),

(gen_random_uuid(), NULL,
 $$Loyalty status not honored$$,
 $$A long-time loyalty member finds the free-night award or upgrade they expected isn't on their reservation, and the system shows them as a standard guest.$$,
 2,
 $$["Recognize their loyalty and history explicitly","Fix the award/upgrade, or own it and escalate on their behalf","Reaffirm that the relationship is valued"]$$,
 $$After years of choosing this brand, being treated like a stranger makes the loyalty feel one-sided and unappreciated. This is about being valued for the relationship, not really about the points.$$,
 $$Lead by recognizing their loyalty warmly, fix the award or own it and escalate on their behalf, and add a gesture that says we know you and we value you — repairing the relationship, not just the reservation.$$,
 'resolvable', true),

(gen_random_uuid(), NULL,
 $$Refund demand with a review threat$$,
 $$A guest whose stay went essentially as expected is demanding a full refund at checkout, threatening a scathing online review if they don't get it. There's no real service failure to point to.$$,
 5,
 $$["Stay warm and composed, never defensive or intimidated","Acknowledge any genuine small miss and offer what's fair","Hold the line on a full refund without escalating the conflict"]$$,
 $$The threat is really about power and wanting to win. There may be a small genuine gripe underneath, but the refund demand is leverage — and caving is neither fair nor good service. They want to feel they had control of the situation.$$,
 $$Stay warm and unshakeable: hear them out, fix or comp anything genuinely amiss, and offer what's fair — but decline a full refund for a delivered stay calmly and without defensiveness, so they feel heard even though they don't get the win they wanted.$$,
 'unwinnable', true);
