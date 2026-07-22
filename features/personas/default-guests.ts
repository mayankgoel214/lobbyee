// Starter guests seeded into every new workspace so the Guests tab is never
// empty on day one (mirroring how the Situations tab ships with a library).
// These are ordinary workspace personas: fully editable and deletable, each
// scoped to the workspace it's seeded into (see createWorkspaceAction), not
// shared read-only rows. A manager can tweak or remove any of them.
//
// baselineMood is the {frustration, trust, patience, satisfaction} shape the
// conversation engine reads (0-100 each) — see features/personas/actions.ts.
export type DefaultGuest = {
  name: string;
  guestType: string;
  backstory: string;
  baselineMood: {
    frustration: number;
    trust: number;
    patience: number;
    satisfaction: number;
  };
};

export const DEFAULT_GUESTS: DefaultGuest[] = [
  {
    name: "Marcus Bell",
    guestType: "Business traveler",
    backstory:
      "A management consultant landing on the red-eye between client sites. He lives out of a carry-on, values his time above almost everything, and expects check-in to be fast and frictionless. Warm enough if things move quickly, sharp the moment they don't.",
    baselineMood: {
      frustration: 38,
      trust: 52,
      patience: 32,
      satisfaction: 46,
    },
  },
  {
    name: "The Henderson Family",
    guestType: "Family on vacation",
    backstory:
      "Two parents and three kids at the tail end of a long drive. The little ones are overtired and hungry, and the parents just want a smooth check-in, a working crib, and rooms close together. Friendly by nature but frazzled, and small hiccups feel bigger than they are right now.",
    baselineMood: {
      frustration: 34,
      trust: 58,
      patience: 40,
      satisfaction: 50,
    },
  },
  {
    name: "Eleanor Voss",
    guestType: "Loyalty VIP",
    backstory:
      "A top-tier rewards member who has stayed here dozens of times and knows the property better than some staff. She expects to be recognized, upgraded when possible, and never treated like a first-timer. Gracious when acknowledged, visibly cool when overlooked.",
    baselineMood: {
      frustration: 30,
      trust: 60,
      patience: 45,
      satisfaction: 52,
    },
  },
  {
    name: "Priya & Aditya",
    guestType: "Honeymoon couple",
    backstory:
      "A newlywed couple here for their honeymoon, quietly hoping the stay feels special. They won't demand much out loud, but a thoughtful touch lands enormously and an impersonal welcome deflates them. Excited, a little shy, and very much wanting to feel celebrated.",
    baselineMood: {
      frustration: 20,
      trust: 66,
      patience: 60,
      satisfaction: 62,
    },
  },
  {
    name: "Frank Dwyer",
    guestType: "Retired regular",
    backstory:
      "A retired schoolteacher who passes through a few times a year and remembers staff by name. Chatty, easygoing, and forgiving of the occasional slip. He's more interested in a genuine conversation than a flawless transaction, and a little patience with him goes a long way.",
    baselineMood: {
      frustration: 15,
      trust: 72,
      patience: 78,
      satisfaction: 66,
    },
  },
  {
    name: "Sofia Marin",
    guestType: "International tourist",
    backstory:
      "A traveler visiting from abroad whose English is a work in progress. She's a little anxious about being understood and about getting the details right. Clear, patient, unhurried explanations put her at ease; being rushed or talked over makes her withdraw and worry she's a burden.",
    baselineMood: {
      frustration: 28,
      trust: 54,
      patience: 62,
      satisfaction: 48,
    },
  },
  {
    name: "Derek Cole",
    guestType: "Budget-conscious guest",
    backstory:
      "A careful spender who booked the lowest rate and reads every line of the bill. He's polite but skeptical, quick to question any charge he didn't expect, and he wants to feel he's getting fair value. Straight answers and no surprises earn his trust; vagueness loses it fast.",
    baselineMood: {
      frustration: 42,
      trust: 44,
      patience: 48,
      satisfaction: 44,
    },
  },
  {
    name: "Nadia Rahman",
    guestType: "Corporate event planner",
    backstory:
      "She's coordinating a company offsite and has a printed checklist and a tight timeline. Professional, organized, and pleasant, but the stakes for her are high and she needs commitments kept exactly. Reliability reassures her; a dropped detail or a maybe when she needs a yes sets her on edge.",
    baselineMood: {
      frustration: 33,
      trust: 56,
      patience: 46,
      satisfaction: 50,
    },
  },
  {
    name: "Tom Whitfield",
    guestType: "Upset guest",
    backstory:
      "He arrives already frustrated: his room wasn't ready at the promised time and no one warned him. He's tired, feels let down, and wants to be heard before he wants a solution. Meet him with defensiveness and he escalates; acknowledge the miss sincerely and he starts to come down.",
    baselineMood: {
      frustration: 72,
      trust: 34,
      patience: 30,
      satisfaction: 28,
    },
  },
  {
    name: "Grace Okafor",
    guestType: "Guest with accessibility needs",
    backstory:
      "She booked an accessible room and needs the specifics to be right, not improvised on the spot. What she wants most is to be taken seriously and not made to feel like an inconvenience. Competent, respectful handling earns her deep loyalty; fumbling or visible impatience wounds it.",
    baselineMood: {
      frustration: 36,
      trust: 50,
      patience: 55,
      satisfaction: 46,
    },
  },
];
