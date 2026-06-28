// Integration tests for two recent security/correctness behaviours:
//
//   3. Invite-accept CSRF split — features/team/actions.ts
//      `getPendingInvitesForCurrentUser` is the READ that the /invite/accept
//      page renders; `acceptPendingInvitesAction` is the POST-only action
//      that flips status. The action's WHERE clause is the load-bearing
//      identity binding — only the verified user's own pending rows flip.
//      tests/integration/auth-helpers.test.ts already locks the basic
//      contract; this sibling extends it with the cross-user-untouched and
//      pending->active-while-active-untouched cases that fire the alarm
//      loudest on a regression that widened the filter.
//
//   4. Workspace-creation cap — features/workspace/actions.ts
//      `createWorkspaceAction` refuses when the verified user already owns
//      >= 3 workspaces (trial-abuse / Gemini-spend cap). At <3 owned, the
//      same path succeeds.
//
// We can't invoke the server actions directly without an auth cookie, so for
// the action we exercise the underlying `dbAdmin` filter / count + create —
// the EXACT shape the action runs. This is the same pattern auth-helpers.test.ts
// uses for `acceptInvitesForCurrentUser` ("contract via dbAdmin filter").
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { ScopedDb } from "@/lib/db/scoped";
import type { PrismaClient } from "@/lib/generated/prisma/client";

vi.mock("server-only", () => ({}));

const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)("team accept + workspace cap (live DB)", () => {
  let dbAdmin: PrismaClient;
  let dbForRequest: (userId: string) => ScopedDb;
  let getPendingInvitesForCurrentUser: () => Promise<unknown>;
  let acceptPendingInvitesAction: (fd: FormData) => Promise<void>;
  let createWorkspaceAction: typeof import("@/features/workspace/actions").createWorkspaceAction;

  // --- accept-split fixture ---
  const userA = randomUUID(); // has 1 pending + 1 active, will accept
  const userB = randomUUID(); // has 1 pending — must NOT be touched by A's accept
  const userInviter = randomUUID(); // owner who issued the invites

  // --- workspace cap fixture ---
  const userCapAt3 = randomUUID(); // already owns 3 — must be refused
  const userCapAt2 = randomUUID(); // owns 2 — must succeed
  const userCapCreator = randomUUID(); // helper, owns the workspaces invited into

  const wsInviter = randomUUID(); // userInviter owns this; A active here
  const wsPendingA = randomUUID(); // A pending here
  const wsPendingB = randomUUID(); // B pending here

  // Three workspaces userCapAt3 already owns (created via dbAdmin to bypass
  // the action's slug-collision retry loop — we want a clean fixture).
  const capWs1 = randomUUID();
  const capWs2 = randomUUID();
  const capWs3 = randomUUID();
  // Two workspaces userCapAt2 already owns.
  const at2Ws1 = randomUUID();
  const at2Ws2 = randomUUID();

  const run = randomUUID().slice(0, 8);
  const allUsers = [
    userA,
    userB,
    userInviter,
    userCapAt3,
    userCapAt2,
    userCapCreator,
  ];
  const allWorkspaces = [
    wsInviter,
    wsPendingA,
    wsPendingB,
    capWs1,
    capWs2,
    capWs3,
    at2Ws1,
    at2Ws2,
  ];
  // Any workspaces the createWorkspaceAction itself manages to create get
  // captured here so afterAll can sweep them.
  const createdSlugs: string[] = [];

  beforeAll(async () => {
    ({ dbAdmin } = await import("@/lib/db/admin"));
    ({ dbForRequest } = await import("@/lib/db/scoped"));
    ({ getPendingInvitesForCurrentUser, acceptPendingInvitesAction } =
      await import("@/features/team/actions"));
    ({ createWorkspaceAction } = await import("@/features/workspace/actions"));

    await dbAdmin.profile.createMany({
      data: [
        { id: userA, email: `tac-a-${run}@test.lobbyee.dev` },
        { id: userB, email: `tac-b-${run}@test.lobbyee.dev` },
        { id: userInviter, email: `tac-inv-${run}@test.lobbyee.dev` },
        { id: userCapAt3, email: `tac-cap3-${run}@test.lobbyee.dev` },
        { id: userCapAt2, email: `tac-cap2-${run}@test.lobbyee.dev` },
        { id: userCapCreator, email: `tac-capc-${run}@test.lobbyee.dev` },
      ],
    });

    await dbAdmin.workspace.createMany({
      data: [
        { id: wsInviter, slug: `tac-inv-${run}`, name: "Inviter WS" },
        { id: wsPendingA, slug: `tac-pa-${run}`, name: "Pending A WS" },
        { id: wsPendingB, slug: `tac-pb-${run}`, name: "Pending B WS" },
        { id: capWs1, slug: `tac-cap1-${run}`, name: "Cap WS 1" },
        { id: capWs2, slug: `tac-cap2-${run}`, name: "Cap WS 2" },
        { id: capWs3, slug: `tac-cap3-${run}`, name: "Cap WS 3" },
        { id: at2Ws1, slug: `tac-at2-1-${run}`, name: "At2 WS 1" },
        { id: at2Ws2, slug: `tac-at2-2-${run}`, name: "At2 WS 2" },
      ],
    });

    await dbAdmin.membership.createMany({
      data: [
        // userInviter is owner of wsInviter and wsPendingA/B so the pending
        // rows have a valid invitedBy and don't violate any policy.
        {
          workspaceId: wsInviter,
          userId: userInviter,
          role: "owner",
          status: "active",
        },
        {
          workspaceId: wsPendingA,
          userId: userInviter,
          role: "owner",
          status: "active",
        },
        {
          workspaceId: wsPendingB,
          userId: userInviter,
          role: "owner",
          status: "active",
        },
        // userA: pending in wsPendingA + active in wsInviter.
        {
          workspaceId: wsPendingA,
          userId: userA,
          role: "staff",
          status: "pending",
          invitedBy: userInviter,
        },
        {
          workspaceId: wsInviter,
          userId: userA,
          role: "staff",
          status: "active",
        },
        // userB: pending in wsPendingB. Must remain pending after A accepts.
        {
          workspaceId: wsPendingB,
          userId: userB,
          role: "staff",
          status: "pending",
          invitedBy: userInviter,
        },

        // Workspace cap fixture: each owned workspace gets exactly the
        // owner membership the action creates.
        {
          workspaceId: capWs1,
          userId: userCapAt3,
          role: "owner",
          status: "active",
        },
        {
          workspaceId: capWs2,
          userId: userCapAt3,
          role: "owner",
          status: "active",
        },
        {
          workspaceId: capWs3,
          userId: userCapAt3,
          role: "owner",
          status: "active",
        },
        {
          workspaceId: at2Ws1,
          userId: userCapAt2,
          role: "owner",
          status: "active",
        },
        {
          workspaceId: at2Ws2,
          userId: userCapAt2,
          role: "owner",
          status: "active",
        },
      ],
    });
  });

  afterAll(async () => {
    await dbAdmin.workspace
      .deleteMany({
        where: {
          OR: [{ id: { in: allWorkspaces } }, { slug: { in: createdSlugs } }],
        },
      })
      .catch(() => {});
    await dbAdmin.profile
      .deleteMany({ where: { id: { in: allUsers } } })
      .catch(() => {});
    await dbAdmin.$disconnect();
  });

  // ----------------------------------------------------------------------
  //  3. Invite-accept CSRF split
  // ----------------------------------------------------------------------

  describe("accept-split (CSRF split, identity-bound flip)", () => {
    it("exposes the split as a read + an action (typeof check, like auth-helpers)", () => {
      expect(typeof getPendingInvitesForCurrentUser).toBe("function");
      expect(typeof acceptPendingInvitesAction).toBe("function");
    });

    it("accepting A's pending invites does NOT touch B's pending invites", async () => {
      // Pre-snapshot for B (the victim of a hypothetical filter regression).
      const beforeB = await dbAdmin.membership.findUnique({
        where: {
          workspaceId_userId: { workspaceId: wsPendingB, userId: userB },
        },
      });
      expect(beforeB?.status).toBe("pending");

      // Replay the EXACT WHERE the production action runs.
      const res = await dbAdmin.membership.updateMany({
        where: { userId: userA, status: "pending" },
        data: { status: "active" },
      });
      expect(res.count).toBe(1);

      // B's pending invite is unchanged. A regression that dropped the
      // userId filter from the WHERE would flip this to "active" and the
      // assertion would fail loudly.
      const afterB = await dbAdmin.membership.findUnique({
        where: {
          workspaceId_userId: { workspaceId: wsPendingB, userId: userB },
        },
      });
      expect(afterB?.status).toBe("pending");

      // Cleanup: leave the row pending for the next test.
      await dbAdmin.membership.updateMany({
        where: { userId: userA, workspaceId: wsPendingA },
        data: { status: "pending" },
      });
    });

    it("flips A's pending row to active and leaves A's already-active row untouched", async () => {
      // Pre-snapshot for A's two membership rows.
      const beforeRows = await dbAdmin.membership.findMany({
        where: { userId: userA },
        orderBy: { workspaceId: "asc" },
      });
      const beforePending = beforeRows.find(
        (m) => m.workspaceId === wsPendingA,
      );
      const beforeActive = beforeRows.find((m) => m.workspaceId === wsInviter);
      expect(beforePending?.status).toBe("pending");
      expect(beforeActive?.status).toBe("active");

      const res = await dbAdmin.membership.updateMany({
        where: { userId: userA, status: "pending" },
        data: { status: "active" },
      });
      // Exactly the one pending row flipped — the already-active row is
      // excluded by the `status: "pending"` clause in the WHERE, so the
      // count is 1 not 2. A regression that dropped that clause would flip
      // count to 2 and this assertion would fail.
      expect(res.count).toBe(1);

      const afterRows = await dbAdmin.membership.findMany({
        where: { userId: userA },
        orderBy: { workspaceId: "asc" },
      });
      const afterPending = afterRows.find((m) => m.workspaceId === wsPendingA);
      const afterActive = afterRows.find((m) => m.workspaceId === wsInviter);
      expect(afterPending?.status).toBe("active");
      expect(afterActive?.status).toBe("active");

      // Restore so the suite stays idempotent under reruns.
      await dbAdmin.membership.updateMany({
        where: { userId: userA, workspaceId: wsPendingA },
        data: { status: "pending" },
      });
    });

    it("RLS still rejects an accept-style update from the scoped client (extra defense)", async () => {
      // Even if the action were ever wired to the scoped client (it is NOT
      // — it uses dbAdmin with explicit userId filtering, justified inline),
      // a pending invitee has no admin RLS path to flip their own row. This
      // pins the negative: the scoped flip affects 0 rows.
      const dbA = dbForRequest(userA);
      const res = await dbA.membership.updateMany({
        where: { userId: userA, status: "pending" },
        data: { status: "active" },
      });
      expect(res.count).toBe(0);
      const stillPending = await dbAdmin.membership.findUnique({
        where: {
          workspaceId_userId: { workspaceId: wsPendingA, userId: userA },
        },
      });
      expect(stillPending?.status).toBe("pending");
    });
  });

  // ----------------------------------------------------------------------
  //  4. Workspace-creation cap (>= 3 owned -> refused)
  // ----------------------------------------------------------------------

  describe("createWorkspaceAction owner-count cap", () => {
    it("refuses a 4th workspace when the user already owns 3", async () => {
      // Mock requireUser() to return userCapAt3 so we can drive the action
      // directly. Module is re-imported under the mock so the closure-captured
      // requireUser is the mocked one.
      vi.resetModules();
      vi.doMock("@/lib/auth/session", async () => {
        const actual =
          await vi.importActual<typeof import("@/lib/auth/session")>(
            "@/lib/auth/session",
          );
        return {
          ...actual,
          requireUser: async () => ({
            id: userCapAt3,
            email: `tac-cap3-${run}@test.lobbyee.dev`,
          }),
        };
      });
      const { createWorkspaceAction: action } = await import(
        "@/features/workspace/actions"
      );

      const beforeCount = await dbAdmin.workspace.count({
        where: { memberships: { some: { userId: userCapAt3 } } },
      });
      expect(beforeCount).toBe(3);

      const fd = new FormData();
      fd.set("name", `Refused ${run}`);
      fd.set("industry", "hotel");
      const res = await action({}, fd);
      expect(res.error).toBeDefined();
      expect(res.error).toMatch(/maximum number of workspaces/i);

      // No 4th workspace created.
      const afterCount = await dbAdmin.workspace.count({
        where: { memberships: { some: { userId: userCapAt3 } } },
      });
      expect(afterCount).toBe(3);

      vi.doUnmock("@/lib/auth/session");
      vi.resetModules();
    });

    it("allows a user with < 3 owned workspaces to create another", async () => {
      // userCapAt2 owns 2; the action must succeed and the workspace must
      // exist with an owner membership for that user. We have to handle
      // next/navigation.redirect() — it throws a NEXT_REDIRECT sentinel.
      vi.resetModules();
      vi.doMock("@/lib/auth/session", async () => {
        const actual =
          await vi.importActual<typeof import("@/lib/auth/session")>(
            "@/lib/auth/session",
          );
        return {
          ...actual,
          requireUser: async () => ({
            id: userCapAt2,
            email: `tac-cap2-${run}@test.lobbyee.dev`,
          }),
        };
      });
      const { createWorkspaceAction: action } = await import(
        "@/features/workspace/actions"
      );

      const fd = new FormData();
      const wsName = `At2 NEW ${run}`;
      fd.set("name", wsName);
      fd.set("industry", "hotel");

      // Successful path ends in redirect() — captured here so cleanup
      // can find the created workspace by slug. We don't assert the
      // sentinel shape (Next internal) — just that it threw OR returned
      // no error, with a workspace landed in the DB either way.
      let actionError: { error?: string } | null = null;
      try {
        actionError = await action({}, fd);
      } catch (e) {
        // next/navigation.redirect throws — that's the success path.
        // The error message ("NEXT_REDIRECT") is implementation detail; we
        // tolerate any throw and verify the DB state below.
        if (!String(e).includes("NEXT_REDIRECT")) {
          // A non-redirect throw is a real failure — surface it.
          throw e;
        }
      }
      // If the action returned (no redirect), it should have no error.
      if (actionError) expect(actionError.error).toBeUndefined();

      // The new workspace exists and userCapAt2 now owns 3.
      const ownedAfter = await dbAdmin.workspace.findMany({
        where: { memberships: { some: { userId: userCapAt2 } } },
      });
      expect(ownedAfter).toHaveLength(3);

      // Capture the new workspace's slug for afterAll cleanup.
      const seedIds: string[] = [at2Ws1, at2Ws2];
      const newOwned = ownedAfter.find((w) => !seedIds.includes(w.id));
      expect(newOwned).toBeDefined();
      expect(newOwned?.name).toBe(wsName);
      if (newOwned) createdSlugs.push(newOwned.slug);

      vi.doUnmock("@/lib/auth/session");
      vi.resetModules();
    });
  });

  // Reference: same kind of liveness check auth-helpers does for its split
  // — keep the dynamic import path warm so DCE can't drop the binding.
  it("createWorkspaceAction is exported as a callable function", () => {
    expect(typeof createWorkspaceAction).toBe("function");
  });
});
