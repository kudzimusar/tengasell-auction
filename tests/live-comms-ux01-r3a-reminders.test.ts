// tests/live-comms-ux01-r3a-reminders.test.ts
// Unit & Database Integration Proof for TUCS R3A First-Party Reminders & Subscriptions
// Framework: Bun test (DATABASE_INTEGRATION + UNIT_TEST)

import { describe, expect, test, beforeAll, afterAll, beforeEach } from "bun:test";
import fs from "node:fs";
import path from "node:path";

// Ensure a dedicated test comms DB is used
const TEST_DB_PATH = path.resolve(import.meta.dir, "../db/comms-test-r3a.db");
process.env.COMMS_DB_PATH = TEST_DB_PATH;
process.env.COMMS_ALLOW_EXTERNAL_R4 = "0"; // Strict R3A external provider lock ($0 spend)

import { db, run, all, get } from "../mini-services/comms-service/db";
import { EVENTS, EVENT_KEYS, eventDef } from "../mini-services/comms-service/taxonomy";
import { getTemplate, seedTemplates } from "../mini-services/comms-service/templates";
import {
  evaluateDueReminders,
  listReminderLedger,
  listSubscriptions,
  R3A_EXTERNAL_LOCK,
  unsubscribeTarget,
  upsertSubscription,
} from "../mini-services/comms-service/subscriptions";
import { isMock, providerLabels } from "../mini-services/comms-service/providers";

describe("TENGASELL-LIVE-COMMS-UX-01 R3A First-Party Reminders & Subscriptions", () => {
  beforeAll(() => {
    seedTemplates();
  });

  beforeEach(() => {
    run("DELETE FROM auction_subscriptions;");
    run("DELETE FROM reminder_dispatch_ledger;");
    run("DELETE FROM outbound_queue;");
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

  test("2. Subscription CRUD and Initial Follow Confirmation", () => {
    const userId = "test-buyer-nyasha";

    // Follow Event 901
    const res1 = upsertSubscription(userId, {
      targetType: "event",
      targetId: "901",
      eventId: 901,
      title: "Harare Executive Fleet Auction",
      startsAt: "2026-11-20T10:00:00Z",
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

    // Verify outbound_queue received the first-party follow confirmation
    const queueRows = all<{ id: number; template_key: string; channel: string; status: string }>(
      `SELECT * FROM outbound_queue WHERE user_id = ?`,
      [userId],
    );
    expect(queueRows.length).toBe(1);
    expect(queueRows[0].template_key).toBe("auction.event.FollowConfirmed");
    expect(queueRows[0].channel).toBe("in_app");
    expect(queueRows[0].status).toBe("sent");

    // Verify reminder_dispatch_ledger recorded the dedupe_key
    const ledger = listReminderLedger(userId);
    expect(ledger.length).toBe(1);
    expect(ledger[0].dedupe_key).toBe(`${userId}:event:901:follow_confirmed`);
    expect(ledger[0].channel).toBe("in_app");

    // Idempotent re-follow: updating preferences does not duplicate confirmation notification
    const res2 = upsertSubscription(userId, {
      targetType: "event",
      targetId: "901",
      eventId: 901,
      title: "Harare Executive Fleet Auction (Updated)",
      notify24h: true,
      notify1h: false,
    });
    expect(res2.confirmDispatched).toBe(false);

    const subs = listSubscriptions(userId);
    expect(subs.length).toBe(1);
    expect(subs[0].title).toBe("Harare Executive Fleet Auction (Updated)");
    expect(subs[0].notify1h).toBe(false);

    // Queue count must still be 1 (no duplicate spam)
    const queueRowsAfter = all(`SELECT id FROM outbound_queue WHERE user_id = ?`, [userId]);
    expect(queueRowsAfter.length).toBe(1);
  });

  test("3. Idempotent Reminder Stage Evaluation (24h, 1h, Live, Lot UpNext/Open)", () => {
    const userId = "test-buyer-simba";
    const baseTime = Date.parse("2026-11-15T10:00:00Z");

    // Subscribe to Event 902 starting in 3 hours (inside 24h window)
    upsertSubscription(userId, {
      targetType: "event",
      targetId: "902",
      eventId: 902,
      title: "Bulawayo Construction & Mining Auction",
      startsAt: new Date(baseTime + 3 * 3600_000).toISOString(),
    });

    // Subscribe to Lot 9401 on Event 901
    upsertSubscription(userId, {
      targetType: "lot",
      targetId: "9401",
      eventId: 901,
      lotId: 9401,
      auctionId: 9101,
      title: "2021 Toyota Hilux Double Cab",
    });

    // ── First evaluation run at baseTime: starting_24h due for Event 902
    const eval1 = evaluateDueReminders({
      nowIso: new Date(baseTime).toISOString(),
      userId,
    });
    expect(eval1.evaluatedSubscriptions).toBe(2);
    expect(eval1.dispatched).toBe(1);
    expect(eval1.skippedDuplicates).toBe(0);
    expect(eval1.items[0].eventKey).toBe("auction.event.Starting24h");
    expect(eval1.items[0].channel).toBe("in_app");

    // ── Duplicate evaluation run at same time: zero dispatched, 1 skipped duplicate!
    const eval1Repeat = evaluateDueReminders({
      nowIso: new Date(baseTime).toISOString(),
      userId,
    });
    expect(eval1Repeat.dispatched).toBe(0);
    expect(eval1Repeat.skippedDuplicates).toBe(1);

    // ── Fast-forward to 30 mins before start (inside 1h window): starting_1h due
    const eval2 = evaluateDueReminders({
      nowIso: new Date(baseTime + 2.5 * 3600_000).toISOString(),
      userId,
    });
    expect(eval2.dispatched).toBe(1);
    expect(eval2.items[0].eventKey).toBe("auction.event.Starting1h");

    // ── Duplicate check for 1h window
    const eval2Repeat = evaluateDueReminders({
      nowIso: new Date(baseTime + 2.5 * 3600_000).toISOString(),
      userId,
    });
    expect(eval2Repeat.dispatched).toBe(0);
    expect(eval2Repeat.skippedDuplicates).toBe(1);

    // ── Fast-forward to live start: live_now due + lot up_next due
    const eval3 = evaluateDueReminders({
      nowIso: new Date(baseTime + 3.1 * 3600_000).toISOString(),
      userId,
      targets: [
        { targetType: "event", targetId: "902", isLive: true },
        { targetType: "lot", targetId: "9401", lotStatus: "READY", upNext: true },
      ],
    });
    expect(eval3.dispatched).toBe(2);
    const stages = eval3.items.map((i) => i.stage);
    expect(stages).toContain("live_now");
    expect(stages).toContain("lot_up_next");

    // Duplicate check for live start + up next
    const eval3Repeat = evaluateDueReminders({
      nowIso: new Date(baseTime + 3.1 * 3600_000).toISOString(),
      userId,
      targets: [
        { targetType: "event", targetId: "902", isLive: true },
        { targetType: "lot", targetId: "9401", lotStatus: "READY", upNext: true },
      ],
    });
    expect(eval3Repeat.dispatched).toBe(0);
    expect(eval3Repeat.skippedDuplicates).toBe(2);

    // ── Lot opens on live floor: lot_open_now due
    const eval4 = evaluateDueReminders({
      nowIso: new Date(baseTime + 3.2 * 3600_000).toISOString(),
      userId,
      targets: [{ targetType: "lot", targetId: "9401", lotStatus: "LIVE", openNow: true }],
    });
    expect(eval4.dispatched).toBe(1);
    expect(eval4.items[0].stage).toBe("lot_open_now");

    // ── Live floor outbid: outbid due with cycle key
    const eval5 = evaluateDueReminders({
      nowIso: new Date(baseTime + 3.3 * 3600_000).toISOString(),
      userId,
      targets: [
        {
          targetType: "lot",
          targetId: "9401",
          outbid: true,
          outbidAmount: "US$28,500",
          cycleKey: "bid-901-2",
        },
      ],
    });
    expect(eval5.dispatched).toBe(1);
    expect(eval5.items[0].stage).toBe("live_outbid");

    // Duplicate outbid check with same cycleKey
    const eval5Repeat = evaluateDueReminders({
      nowIso: new Date(baseTime + 3.3 * 3600_000).toISOString(),
      userId,
      targets: [
        {
          targetType: "lot",
          targetId: "9401",
          outbid: true,
          outbidAmount: "US$28,500",
          cycleKey: "bid-901-2",
        },
      ],
    });
    expect(eval5Repeat.dispatched).toBe(0);
    expect(eval5Repeat.skippedDuplicates).toBeGreaterThanOrEqual(1);
  });

  test("4. Unsubscribed Target Suppression", () => {
    const userId = "test-buyer-unsub";

    upsertSubscription(userId, {
      targetType: "event",
      targetId: "999",
      eventId: 999,
      title: "Temporary Sale",
      startsAt: "2026-11-14T10:00:00Z",
    });

    const unres = unsubscribeTarget(userId, "event", "999");
    expect(unres.ok).toBe(true);
    expect(unres.updated).toBe(true);

    const activeList = listSubscriptions(userId, false);
    expect(activeList.length).toBe(0);

    const fullList = listSubscriptions(userId, true);
    expect(fullList.length).toBe(1);
    expect(fullList[0].status).toBe("unsubscribed");

    // Evaluation run suppresses unsubscribed targets
    const evalResult = evaluateDueReminders({
      nowIso: "2026-11-14T10:05:00Z",
      userId,
      targets: [{ targetType: "event", targetId: "999", isLive: true }],
    });
    expect(evalResult.dispatched).toBe(0);
    expect(evalResult.suppressedUnsubscribed).toBe(1);
  });

  test("5. External Provider Isolation Gate ($0 External Spend)", () => {
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

  test("6. Database Safety Gate (TrailBase U1..U16 strict frozen count)", () => {
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
});
