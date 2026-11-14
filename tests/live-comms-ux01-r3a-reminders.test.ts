// tests/live-comms-ux01-r3a-reminders.test.ts
// Unit & Database Integration Proof for TUCS R3A First-Party Reminders & Subscriptions
// Framework: Bun test (DATABASE_INTEGRATION + UNIT_TEST + SECURITY_GATES)

import { describe, expect, test, beforeAll, afterAll, beforeEach } from "bun:test";
import fs from "node:fs";
import path from "node:path";

// Ensure a dedicated test comms DB is used
const TEST_DB_PATH = path.resolve(import.meta.dir, "../db/comms-test-r3a.db");
process.env.COMMS_DB_PATH = TEST_DB_PATH;
process.env.COMMS_ALLOW_EXTERNAL_R4 = "0"; // Strict R3A external provider lock ($0 spend)
const TEST_INTERNAL_SECRET = "tgs_sec_r3a_test_credential_32chars_long";
process.env.INTERNAL_COMMS_SECRET = TEST_INTERNAL_SECRET;

import { db, run, all, get, execute, insert } from "../mini-services/comms-service/db";
import { EVENTS, EVENT_KEYS, eventDef } from "../mini-services/comms-service/taxonomy";
import { getTemplate, seedTemplates } from "../mini-services/comms-service/templates";
import {
  type CanonicalTarget,
  CanonicalAuthorityUnavailableError,
  evaluateDueReminders,
  listReminderLedger,
  listSubscriptions,
  R3A_EXTERNAL_LOCK,
  unsubscribeTarget,
  upsertSubscription,
  setCustomTargetResolver,
  recordFirstPartyReminderTx,
} from "../mini-services/comms-service/subscriptions";
import { isMock, providerLabels } from "../mini-services/comms-service/providers";
import { emitEvent } from "../mini-services/comms-service/emit";
import { handleRequest } from "../mini-services/comms-service/index";
import {
  BANNED_LEGACY_SECRETS,
  getInternalCommsSecret,
  isInternalSecretConfigured,
  verifyInternalSecret,
} from "../mini-services/comms-service/config";

// Isolated test fixture catalogue strictly for unit tests in isolation
const TEST_FIXTURE_CATALOGUE: Record<string, CanonicalTarget> = {
  "event:901": {
    targetType: "event",
    targetId: "901",
    eventId: 901,
    lotId: null,
    sessionId: 1,
    auctionId: null,
    title: "Harare Executive & Utility Fleet Live Auction",
    startsAt: "2026-11-20T10:00:00Z",
    status: "SCHEDULED",
    isLive: false,
  },
  "event:902": {
    targetType: "event",
    targetId: "902",
    eventId: 902,
    lotId: null,
    sessionId: 2,
    auctionId: null,
    title: "Weekend Hybrid & Passenger Showcase",
    startsAt: "2026-11-21T10:00:00Z",
    status: "SCHEDULED",
    isLive: false,
  },
  "event:903": {
    targetType: "event",
    targetId: "903",
    eventId: 903,
    lotId: null,
    sessionId: null,
    auctionId: null,
    title: "Event Cancelled Demonstration",
    startsAt: "2026-11-22T10:00:00Z",
    status: "CANCELLED",
    isLive: false,
  },
  "lot:9401": {
    targetType: "lot",
    targetId: "9401",
    eventId: 901,
    lotId: 9401,
    sessionId: 1,
    auctionId: 9101,
    title: "Lot #1 · 2021 Toyota Hilux Double Cab",
    startsAt: "2026-11-20T10:00:00Z",
    status: "READY",
    isLive: false,
  },
  "lot:9101": {
    targetType: "lot",
    targetId: "9101",
    eventId: 901,
    lotId: 9401,
    sessionId: 1,
    auctionId: 9101,
    title: "Lot #1 · 2021 Toyota Hilux Double Cab",
    startsAt: "2026-11-20T10:00:00Z",
    status: "READY",
    isLive: false,
  },
  "lot:9402": {
    targetType: "lot",
    targetId: "9402",
    eventId: 901,
    lotId: 9402,
    sessionId: 1,
    auctionId: 9102,
    title: "Lot #2 · 2022 Isuzu D-Max 3.0 Ddi V-Cross",
    startsAt: "2026-11-20T10:30:00Z",
    status: "READY",
    isLive: false,
  },
  "lot:9102": {
    targetType: "lot",
    targetId: "9102",
    eventId: 901,
    lotId: 9402,
    sessionId: 1,
    auctionId: 9102,
    title: "Lot #2 · 2022 Isuzu D-Max 3.0 Ddi V-Cross",
    startsAt: "2026-11-20T10:30:00Z",
    status: "READY",
    isLive: false,
  },
  "auction:9101": {
    targetType: "auction",
    targetId: "9101",
    eventId: null,
    lotId: null,
    sessionId: 1,
    auctionId: 9101,
    title: "2021 Toyota Hilux Double Cab 2.8 GD-6 4x4",
    startsAt: "2026-11-20T10:00:00Z",
    status: "live",
    isLive: true,
  },
};

const testFixtureResolver = (type: string, id: string) => TEST_FIXTURE_CATALOGUE[`${type}:${id}`] ?? null;

describe("TENGASELL-LIVE-COMMS-UX-01 R3A First-Party Reminders & Subscriptions", () => {
  beforeAll(() => {
    seedTemplates();
  });

  beforeEach(() => {
    run("DELETE FROM auction_subscriptions;");
    run("DELETE FROM reminder_dispatch_ledger;");
    run("DELETE FROM outbound_queue;");
    setCustomTargetResolver(testFixtureResolver);
  });

  afterAll(() => {
    try {
      db.close();
      if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
    } catch {}
  });

  test("1. Taxonomy & Templates Completeness (8 canonical R3A keys)", () => {
    const r3aKeys = [
      "auction.event.FollowConfirmed",
      "auction.event.Starting24h",
      "auction.event.Starting1h",
      "auction.event.LiveNow",
      "auction.lot.UpNext",
      "auction.lot.OpenNow",
      "auction.live.Outbid",
      "auction.live.Result",
    ];

    for (const key of r3aKeys) {
      expect(EVENT_KEYS.has(key)).toBe(true);
      const def = eventDef(key);
      expect(def).not.toBeNull();
      expect(def!.group).toBe("Auctions");
      expect(def!.labelEn.length).toBeGreaterThan(0);
      expect(def!.labelJa.length).toBeGreaterThan(0);

      // Defaults must be off (explicit opt-in / first-party subscription driven)
      expect(def!.defaults.email).toBe(0);
      expect(def!.defaults.telegram).toBe(0);
      expect(def!.defaults.whatsapp).toBe(0);
      expect(def!.defaults.messenger).toBe(0);

      // Verify both 'en' and 'ja' template registrations
      const enTpl = getTemplate(key, "short", "en");
      expect(enTpl).not.toBeNull();
      expect(enTpl!.subject).toBeTruthy();
      expect(enTpl!.short_text).toBeTruthy();

      const jaTpl = getTemplate(key, "short", "ja");
      expect(jaTpl).not.toBeNull();
      expect(jaTpl!.subject).toBeTruthy();
      expect(jaTpl!.short_text).toBeTruthy();
    }
  });

  test("2. Subscription CRUD, Initial Follow Confirmation, and Status Semantics (R3A-STATUS-01)", async () => {
    const userId = "test-buyer-nyasha";

    // Follow Event 901
    const res1 = await upsertSubscription(userId, {
      targetType: "event",
      targetId: "901",
      notify24h: true,
      notify1h: true,
      notifyLive: true,
    });

    expect(res1.subscription).toBeDefined();
    expect(res1.subscription.userId).toBe(userId);
    expect(res1.subscription.targetType).toBe("event");
    expect(res1.subscription.targetId).toBe("901");
    expect(res1.subscription.status).toBe("active");
    expect(res1.subscription.channels).toEqual(["in_app"]);
    expect(res1.confirmDispatched).toBe(true);

    // Verify outbound_queue received first-party follow confirmation with status='queued' (R3A-STATUS-01)
    const queueRows = all<{ id: number; template_key: string; channel: string; status: string }>(
      `SELECT * FROM outbound_queue WHERE user_id = ?`,
      [userId],
    );
    expect(queueRows.length).toBe(1);
    expect(queueRows[0].template_key).toBe("auction.event.FollowConfirmed");
    expect(queueRows[0].channel).toBe("in_app");
    expect(["queued", "available"]).toContain(queueRows[0].status);

    // Verify reminder_dispatch_ledger recorded the dedupe_key
    const ledger = listReminderLedger(userId);
    expect(ledger.length).toBe(1);
    expect(ledger[0].dedupe_key).toBe(`${userId}:event:901:follow_confirmed`);
    expect(ledger[0].channel).toBe("in_app");

    // Idempotent re-follow: updating preferences does not duplicate confirmation notification
    const res2 = await upsertSubscription(userId, {
      targetType: "event",
      targetId: "901",
      notify24h: true,
      notify1h: false,
    });
    expect(res2.confirmDispatched).toBe(false);

    const subs = listSubscriptions(userId);
    expect(subs.length).toBe(1);
    expect(subs[0].notify1h).toBe(false);

    // Queue count must still be 1 (no duplicate spam)
    const queueRowsAfter = all(`SELECT id FROM outbound_queue WHERE user_id = ?`, [userId]);
    expect(queueRowsAfter.length).toBe(1);
  });

  test("3. Idempotent Reminder Stage Evaluation (24h, 1h, Live, Lot UpNext/Open)", async () => {
    const userId = "test-buyer-simba";
    const baseTime = Date.parse("2026-11-15T10:00:00Z");

    let event902State = {
      targetType: "event" as const,
      targetId: "902",
      eventId: 902,
      lotId: null,
      sessionId: 2,
      auctionId: null,
      title: "Weekend Hybrid & Passenger Showcase",
      startsAt: new Date(baseTime + 3 * 3600_000).toISOString(),
      status: "SCHEDULED",
      isLive: false,
    };

    let lot9401State = {
      targetType: "lot" as const,
      targetId: "9401",
      eventId: 901,
      lotId: 9401,
      sessionId: 1,
      auctionId: 9101,
      title: "2021 Toyota Hilux Double Cab",
      startsAt: new Date(baseTime).toISOString(),
      status: "QUEUED",
      isLive: false,
    };

    setCustomTargetResolver((type, id) => {
      if (type === "event" && id === "902") return event902State;
      if (type === "lot" && id === "9401") return lot9401State;
      return null;
    });

    // Subscribe to Event 902 starting in 3 hours (inside 24h window)
    await upsertSubscription(userId, {
      targetType: "event",
      targetId: "902",
      notify24h: true,
      notify1h: true,
      notifyLive: true,
    });

    // Subscribe to Lot 9401 on Event 901
    await upsertSubscription(userId, {
      targetType: "lot",
      targetId: "9401",
    });

    // ── First evaluation run at baseTime: starting_24h due for Event 902
    const eval1 = await evaluateDueReminders({
      nowIso: new Date(baseTime).toISOString(),
      userId,
    });
    expect(eval1.evaluatedSubscriptions).toBe(2);
    expect(eval1.dispatched).toBe(1);
    expect(eval1.skippedDuplicates).toBe(0);
    expect(eval1.items[0].eventKey).toBe("auction.event.Starting24h");
    expect(eval1.items[0].channel).toBe("in_app");

    // ── Duplicate evaluation run at same time: zero dispatched, 1 skipped duplicate!
    const eval1Repeat = await evaluateDueReminders({
      nowIso: new Date(baseTime).toISOString(),
      userId,
    });
    expect(eval1Repeat.dispatched).toBe(0);
    expect(eval1Repeat.skippedDuplicates).toBe(1);

    // ── Fast-forward to 30 mins before start (inside 1h window): starting_1h due
    const eval2 = await evaluateDueReminders({
      nowIso: new Date(baseTime + 2.5 * 3600_000).toISOString(),
      userId,
    });
    expect(eval2.dispatched).toBe(1);
    expect(eval2.items[0].eventKey).toBe("auction.event.Starting1h");

    // ── Duplicate check for 1h window
    const eval2Repeat = await evaluateDueReminders({
      nowIso: new Date(baseTime + 2.5 * 3600_000).toISOString(),
      userId,
    });
    expect(eval2Repeat.dispatched).toBe(0);
    expect(eval2Repeat.skippedDuplicates).toBe(1);

    // ── Server transitions Event 902 to LIVE and Lot 9401 to READY (UpNext)
    event902State.status = "LIVE";
    event902State.isLive = true;
    lot9401State.status = "READY";

    const eval3 = await evaluateDueReminders({
      nowIso: new Date(baseTime + 3.1 * 3600_000).toISOString(),
      userId,
    });
    expect(eval3.dispatched).toBe(2);
    const stages = eval3.items.map((i) => i.stage);
    expect(stages).toContain("live_now");
    expect(stages).toContain("lot_up_next");

    // Duplicate check for live start + up next
    const eval3Repeat = await evaluateDueReminders({
      nowIso: new Date(baseTime + 3.1 * 3600_000).toISOString(),
      userId,
    });
    expect(eval3Repeat.dispatched).toBe(0);
    expect(eval3Repeat.skippedDuplicates).toBe(2);

    // ── Lot opens on live floor: lot_open_now due
    lot9401State.status = "LIVE";
    lot9401State.isLive = true;

    const eval4 = await evaluateDueReminders({
      nowIso: new Date(baseTime + 3.2 * 3600_000).toISOString(),
      userId,
    });
    expect(eval4.dispatched).toBe(1);
    expect(eval4.items[0].stage).toBe("lot_open_now");

    // ── First-party live events: outbid and result
    const outbidRec = recordFirstPartyReminderTx({
      dedupeKey: `${userId}:lot:9401:live_outbid:bid-901-2`,
      subscriptionId: null,
      userId,
      targetType: "lot",
      targetId: "9401",
      stage: "live_outbid",
      eventKey: "auction.live.Outbid",
      params: { title: lot9401State.title, amount: "US$28,500" },
      deepLink: "http://localhost/live/1",
      locale: "en",
      now: new Date(baseTime + 3.3 * 3600_000).toISOString(),
    });
    expect(outbidRec.dispatched).toBe(true);
    expect(outbidRec.queueId).not.toBeNull();

    const resultRec = recordFirstPartyReminderTx({
      dedupeKey: `${userId}:lot:9401:live_result`,
      subscriptionId: null,
      userId,
      targetType: "lot",
      targetId: "9401",
      stage: "live_result",
      eventKey: "auction.live.Result",
      params: { title: lot9401State.title, outcome: "WON" },
      deepLink: "http://localhost/live/1",
      locale: "en",
      now: new Date(baseTime + 3.4 * 3600_000).toISOString(),
    });
    expect(resultRec.dispatched).toBe(true);
    expect(resultRec.queueId).not.toBeNull();
  });

  test("4. Unsubscribed Target Suppression", async () => {
    const userId = "test-buyer-unsub";

    await upsertSubscription(userId, {
      targetType: "event",
      targetId: "902",
    });

    const unres = unsubscribeTarget(userId, "event", "902");
    expect(unres.ok).toBe(true);
    expect(unres.updated).toBe(true);

    const activeList = listSubscriptions(userId, false);
    expect(activeList.length).toBe(0);

    const fullList = listSubscriptions(userId, true);
    expect(fullList.length).toBe(1);
    expect(fullList[0].status).toBe("unsubscribed");

    // Evaluation run suppresses unsubscribed targets
    const evalResult = await evaluateDueReminders({
      nowIso: "2026-11-21T10:05:00Z",
      userId,
    });
    expect(evalResult.dispatched).toBe(0);
    expect(evalResult.suppressedUnsubscribed).toBe(1);
  });

  test("5. P0-A Reminder Truth & Non-Authoritative Client Rejection (R3A-TRUTH-01)", async () => {
    const userId = "test-truth-actor";
    const baseTime = Date.parse("2026-11-15T10:00:00Z");

    let eventState = {
      targetType: "event" as const,
      targetId: "902",
      eventId: 902,
      lotId: null,
      sessionId: 2,
      auctionId: null,
      title: "Demonstration Event",
      startsAt: new Date(baseTime + 1000).toISOString(),
      status: "SCHEDULED", // Clock has passed, but host has NOT opened the floor!
      isLive: false,
    };

    setCustomTargetResolver((type, id) => {
      if (type === "event" && id === "902") return eventState;
      return null;
    });

    await upsertSubscription(userId, {
      targetType: "event",
      targetId: "902",
      notifyLive: true,
    });

    // Fast-forward past startsAt: clock is past start time, but server status is still SCHEDULED.
    // LiveNow MUST NOT be emitted by clock passage alone!
    const clockPastEval = await evaluateDueReminders({
      nowIso: new Date(baseTime + 5000).toISOString(),
      userId,
    });
    expect(clockPastEval.dispatched).toBe(0);

    // Only when canonical server record transitions to LIVE is LiveNow dispatched
    eventState.status = "LIVE";
    eventState.isLive = true;

    const liveEval = await evaluateDueReminders({
      nowIso: new Date(baseTime + 6000).toISOString(),
      userId,
    });
    expect(liveEval.dispatched).toBe(1);
    expect(liveEval.items[0].stage).toBe("live_now");
  });

  test("6. P0-B Network Boundary & Service Authentication (R3A-AUTH-01 & R4A-COMMS-AUTH-01)", async () => {
    // A. Secret Hygiene & Constant-Time Validation
    expect(isInternalSecretConfigured()).toBe(true);
    expect(getInternalCommsSecret()).toBe(TEST_INTERNAL_SECRET);
    expect(verifyInternalSecret(TEST_INTERNAL_SECRET)).toBe(true);
    expect(verifyInternalSecret("")).toBe(false);
    expect(verifyInternalSecret(null)).toBe(false);
    expect(verifyInternalSecret(undefined)).toBe(false);
    expect(verifyInternalSecret("wrong_secret_1234567890")).toBe(false);

    // Banned legacy secrets must fail closed
    for (const banned of BANNED_LEGACY_SECRETS) {
      process.env.INTERNAL_COMMS_SECRET = banned;
      expect(isInternalSecretConfigured()).toBe(false);
      expect(getInternalCommsSecret()).toBeNull();
      expect(verifyInternalSecret(banned)).toBe(false);
    }

    // Short secret (< 16 chars) must fail closed
    process.env.INTERNAL_COMMS_SECRET = "short_secret_12";
    expect(isInternalSecretConfigured()).toBe(false);
    expect(getInternalCommsSecret()).toBeNull();
    expect(verifyInternalSecret("short_secret_12")).toBe(false);

    // Unset secret must fail closed
    delete process.env.INTERNAL_COMMS_SECRET;
    expect(isInternalSecretConfigured()).toBe(false);
    expect(getInternalCommsSecret()).toBeNull();
    expect(verifyInternalSecret(TEST_INTERNAL_SECRET)).toBe(false);

    // Restore valid secret for request boundary verification
    process.env.INTERNAL_COMMS_SECRET = TEST_INTERNAL_SECRET;
    expect(isInternalSecretConfigured()).toBe(true);

    // B. Request Boundary: Missing internal token -> 401
    const unauthedReq = new Request("http://127.0.0.1:3005/me/subscriptions", {
      headers: { "x-tgs-user": "takudzwa" },
    });
    const unauthedRes = await handleRequest(unauthedReq);
    expect(unauthedRes.status).toBe(401);

    // Direct call with forged admin header and no internal token -> 401
    const forgedAdminReq = new Request("http://127.0.0.1:3005/admin/queue", {
      headers: { "x-tgs-user": "anonymous", "x-tgs-admin": "1" },
    });
    const forgedAdminRes = await handleRequest(forgedAdminReq);
    expect(forgedAdminRes.status).toBe(401);

    // Direct call with invalid internal token -> 401
    const invalidSecretReq = new Request("http://127.0.0.1:3005/me/subscriptions", {
      headers: { "x-tgs-user": "takudzwa", "x-tgs-internal-token": "wrong_secret_123" },
    });
    const invalidSecretRes = await handleRequest(invalidSecretReq);
    expect(invalidSecretRes.status).toBe(401);

    // Valid internal token but missing x-tgs-user on /me/* -> 401
    const missingUserReq = new Request("http://127.0.0.1:3005/me/subscriptions", {
      headers: { "x-tgs-internal-token": TEST_INTERNAL_SECRET },
    });
    const missingUserRes = await handleRequest(missingUserReq);
    expect(missingUserRes.status).toBe(401);

    // Valid internal token + non-admin on /admin/* -> 401
    const nonAdminReq = new Request("http://127.0.0.1:3005/admin/queue", {
      headers: { "x-tgs-user": "normal_user", "x-tgs-internal-token": TEST_INTERNAL_SECRET },
    });
    const nonAdminRes = await handleRequest(nonAdminReq);
    expect(nonAdminRes.status).toBe(401);

    // Legitimate authenticated BFF user request -> 200
    const validReq = new Request("http://127.0.0.1:3005/me/subscriptions", {
      headers: {
        "x-tgs-user": "takudzwa",
        "x-tgs-internal-token": TEST_INTERNAL_SECRET,
      },
    });
    const validRes = await handleRequest(validReq);
    expect(validRes.status).toBe(200);

    // Legitimate authenticated BFF admin request -> 200
    const validAdminReq = new Request("http://127.0.0.1:3005/admin/queue", {
      headers: {
        "x-tgs-user": "admin_user",
        "x-tgs-admin": "1",
        "x-tgs-internal-token": TEST_INTERNAL_SECRET,
      },
    });
    const validAdminRes = await handleRequest(validAdminReq);
    expect(validAdminRes.status).toBe(200);

    // Public health check does not require secret -> 200
    const healthReq = new Request("http://127.0.0.1:3005/health");
    const healthRes = await handleRequest(healthReq);
    expect(healthRes.status).toBe(200);
  });

  test("7. P1-C Reminder Ledger & Outbound Queue Write Atomicity (R3A-LEDGER-01)", () => {
    const userId = "test-atomic-actor";
    const dedupeKey = `${userId}:event:901:test_atomic`;

    // Attempt writing when a failure is triggered during the transaction
    let threw = false;
    try {
      db.transaction(() => {
        execute(
          `INSERT INTO reminder_dispatch_ledger(
             dedupe_key, subscription_id, user_id, target_type, target_id,
             reminder_stage, event_key, channel, status, payload_json, dispatched_at
           ) VALUES(?, NULL, ?, 'event', '901', 'test_stage', 'test_key', 'in_app', 'queued', '{}', '2026-11-15T10:00:00Z')`,
          [dedupeKey, userId],
        );

        // Inject intentional failure before queue insert commits
        throw new Error("INTENTIONAL_INJECTED_QUEUE_FAILURE");
      })();
    } catch (err: any) {
      if (err.message === "INTENTIONAL_INJECTED_QUEUE_FAILURE") {
        threw = true;
      }
    }
    expect(threw).toBe(true);

    // Verify transaction rollback: reminder_dispatch_ledger MUST have 0 rows for this dedupe_key!
    const ledgerRows = all(
      `SELECT * FROM reminder_dispatch_ledger WHERE dedupe_key = ?`,
      [dedupeKey],
    );
    expect(ledgerRows.length).toBe(0);

    // Outbound queue also has 0 rows
    const queueRows = all(
      `SELECT * FROM outbound_queue WHERE provider_msg_id = ?`,
      [`first-party:${dedupeKey}`],
    );
    expect(queueRows.length).toBe(0);

    // On healthy retry without failure, write succeeds and commits both tables
    const healthyRec = recordFirstPartyReminderTx({
      dedupeKey,
      subscriptionId: null,
      userId,
      targetType: "event",
      targetId: "901",
      stage: "test_stage",
      eventKey: "auction.event.FollowConfirmed",
      params: { title: "Test Event" },
      deepLink: "http://localhost/event/901",
      locale: "en",
      now: "2026-11-15T10:00:00Z",
    });
    expect(healthyRec.dispatched).toBe(true);
    expect(healthyRec.queueId).not.toBeNull();

    // Verify both rows now exist
    expect(all(`SELECT id FROM reminder_dispatch_ledger WHERE dedupe_key = ?`, [dedupeKey]).length).toBe(1);
    expect(all(`SELECT id FROM outbound_queue WHERE id = ?`, [healthyRec.queueId!]).length).toBe(1);
  });

  test("8. P1-D Target Canonicalization & Accessibility Gates (R3A-TARGET-01)", async () => {
    const userId = "test-target-actor";

    // Non-existent target must reject
    let notFoundError = false;
    try {
      await upsertSubscription(userId, {
        targetType: "event",
        targetId: "999999",
      });
    } catch {
      notFoundError = true;
    }
    expect(notFoundError).toBe(true);

    // Target in draft/private state must reject
    setCustomTargetResolver((type, id) => {
      if (id === "903-draft") return null; // Private draft is not returned by canonical resolver
      return null;
    });

    let draftError = false;
    try {
      await upsertSubscription(userId, {
        targetType: "event",
        targetId: "903-draft",
      });
    } catch {
      draftError = true;
    }
    expect(draftError).toBe(true);

    // Valid target derives canonical title, schedule, and IDs
    setCustomTargetResolver(testFixtureResolver); // Return to test fixture resolver
    const validSub = await upsertSubscription(userId, {
      targetType: "event",
      targetId: "901",
    });
    expect(validSub.subscription.title).toBe("Harare Executive & Utility Fleet Live Auction");
    expect(validSub.subscription.startsAt).toBe("2026-11-20T10:00:00Z");
  });

  test("9. External Provider Isolation Gate ($0 External Spend)", () => {
    expect(R3A_EXTERNAL_LOCK).toBe(true);

    const labels = providerLabels();
    expect(labels.email).toBe("mock");
    expect(labels.telegram).toBe("mock");
    expect(labels.whatsapp).toBe("mock");
    expect(labels.messenger).toBe("mock");

    expect(isMock("email")).toBe(true);
    expect(isMock("telegram")).toBe(true);
    expect(isMock("whatsapp")).toBe(true);
    expect(isMock("messenger")).toBe(true);

    // Verify all reminder outbound_queue records are strictly 'in_app'
    const nonInApp = all(
      `SELECT id, channel FROM outbound_queue WHERE template_key LIKE 'auction.event.%' AND channel != 'in_app'`,
    );
    expect(nonInApp.length).toBe(0);
  });

  test("10. Database Safety Gate (TrailBase U1..U16 strict frozen count)", () => {
    const migrationsDir = path.resolve(
      import.meta.dir,
      "../mini-services/trailbase-db/traildepot/migrations/main",
    );
    const files = fs
      .readdirSync(migrationsDir)
      .filter((f) => f.endsWith(".sql") && !f.startsWith("."));
    expect(files.length).toBe(16);
    expect(files.some((f) => f.includes("U1000000017"))).toBe(false);
    expect(files.some((f) => f.includes("U1000000025"))).toBe(false);
  });

  test("11. Webhook Isolation & Provider Callbacks Security", async () => {
    // Mock telegram callback without internal token -> 401
    const untrustedMockReq = new Request("http://127.0.0.1:3005/hooks/mock/telegram/123", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "START" }),
    });
    const untrustedMockRes = await handleRequest(untrustedMockReq);
    expect(untrustedMockRes.status).toBe(401);

    // Delivery callback without internal token -> 401
    const untrustedDeliveryReq = new Request("http://127.0.0.1:3005/hooks/delivery", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ queueId: 1, event: "delivered" }),
    });
    const untrustedDeliveryRes = await handleRequest(untrustedDeliveryReq);
    expect(untrustedDeliveryRes.status).toBe(401);

    // External WhatsApp webhook with no WHATSAPP_APP_SECRET configured -> 403 provider_disabled
    const waReq = new Request("http://127.0.0.1:3005/hooks/whatsapp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entry: [] }),
    });
    const waRes = await handleRequest(waReq);
    expect(waRes.status).toBe(403);

    // External Telegram webhook in mock mode -> 403 provider_disabled
    const tgReq = new Request("http://127.0.0.1:3005/hooks/telegram", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ update_id: 1 }),
    });
    const tgRes = await handleRequest(tgReq);
    expect(tgRes.status).toBe(403);
  });

  test("12. P0 Canonical Authority Failure Semantics & Outage Deferral (R4A-REMINDER-TRUTH-02)", async () => {
    const userId = "test-authority-actor";

    // 1. TrailBase 503 / Network Failure during subscription upsert -> fails with 503
    setCustomTargetResolver(() => {
      throw new CanonicalAuthorityUnavailableError("TrailBase HTTP 503 Service Unavailable");
    });

    let upsertStatus = 0;
    try {
      await upsertSubscription(userId, {
        targetType: "event",
        targetId: "901",
      });
    } catch (err: any) {
      upsertStatus = err.status || 0;
    }
    expect(upsertStatus).toBe(503);

    // 2. TrailBase 503 during reminder evaluation -> evaluation is DEFERRED, never dispatches from stale metadata
    // First, insert an active subscription directly to test evaluation behavior during outage
    const now = "2026-11-15T10:00:00Z";
    insert(
      `INSERT INTO auction_subscriptions(
         user_id, target_type, target_id, title, starts_at, status, channels_json, notify_24h, notify_1h, notify_live, created_at, updated_at
       ) VALUES(?, 'event', '901', 'Test Event', '2026-11-15T10:30:00Z', 'active', '["in_app"]', 1, 1, 1, ?, ?)`,
      [userId, now, now],
    );

    // Running evaluateDueReminders while TrailBase is throwing CanonicalAuthorityUnavailableError
    const deferredEval = await evaluateDueReminders({
      nowIso: "2026-11-15T10:05:00Z",
      userId,
    });
    expect(deferredEval.dispatched).toBe(0);
    expect(deferredEval.items.length).toBe(1);
    expect(deferredEval.items[0].stage).toBe("deferred_upstream_unavailable");
    expect(deferredEval.items[0].dispatched).toBe(false);

    // 3. Target returning null (404, or DRAFT/CANCELLED/WITHDRAWN) -> suppressed, never dispatched
    setCustomTargetResolver(() => null);
    const suppressedEval = await evaluateDueReminders({
      nowIso: "2026-11-15T10:05:00Z",
      userId,
    });
    expect(suppressedEval.dispatched).toBe(0);
    expect(suppressedEval.suppressedUnsubscribed).toBe(1);

    // 4. Outage Recovery -> TrailBase recovers and returns fresh canonical record
    setCustomTargetResolver((type, id) => ({
      targetType: "event",
      targetId: "901",
      eventId: 901,
      lotId: null,
      sessionId: 1,
      auctionId: null,
      title: "Recovered Event Authority",
      startsAt: "2026-11-15T10:30:00Z", // 25 mins away -> starting_1h
      status: "SCHEDULED",
      isLive: false,
    }));

    const recoveredEval = await evaluateDueReminders({
      nowIso: "2026-11-15T10:05:00Z",
      userId,
    });
    expect(recoveredEval.dispatched).toBe(1);
    expect(recoveredEval.items[0].stage).toBe("starting_1h");
  });

  test("13. Authoritative Server Clock Enforcement on Customer Endpoint (R4A-REMINDER-CLOCK-03)", async () => {
    const userId = "test-clock-actor";
    const eventTime = new Date(Date.now() + 5 * 24 * 3600_000).toISOString(); // 5 days in future

    setCustomTargetResolver((type, id) => ({
      targetType: "event",
      targetId: "905",
      eventId: 905,
      lotId: null,
      sessionId: 1,
      auctionId: null,
      title: "Far Future Event",
      startsAt: eventTime,
      status: "SCHEDULED",
      isLive: false,
    }));

    await upsertSubscription(userId, {
      targetType: "event",
      targetId: "905",
      notify1h: true,
      notify24h: true,
      notifyLive: true,
    });

    // Customer attempts to inject a future nowIso into POST /me/reminders/evaluate to trigger reminders prematurely
    const clientTimeTravelReq = new Request("http://127.0.0.1:3005/me/reminders/evaluate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-tgs-user": userId,
        "x-tgs-internal-token": TEST_INTERNAL_SECRET,
      },
      body: JSON.stringify({
        nowIso: new Date(Date.now() + 5 * 24 * 3600_000 - 30 * 60_000).toISOString(), // 30 min before start
      }),
    });

    const res = await handleRequest(clientTimeTravelReq);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    // Because customer-supplied nowIso was ignored and the authoritative server clock was used, 0 reminders were dispatched
    expect(body.dispatched).toBe(0);
  });
});
