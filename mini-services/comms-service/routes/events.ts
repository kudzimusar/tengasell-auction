// Internal endpoints — POST /events (BFF/trade-engine fan-out) and
// POST /relay/out (mediated user→user messaging with the moderation pipeline).

import { HttpError, bodyStr, bodyObj, bodyOptStr, type AddRoute } from "../http";
import { emitEvent } from "../emit";
import { moderateAndLog } from "../relay";
import { EVENT_KEYS } from "../taxonomy";
import { snippetOf } from "../util";

export function registerEventRoutes(on: AddRoute): void {
  // POST /events {userId,eventKey,params,locale?,threadId?,deepLink?} → {queued,channels}
  on("POST", "/events", async (ctx) => {
    const userId = bodyStr(ctx, "userId", { required: true, max: 100 });
    const eventKey = bodyStr(ctx, "eventKey", { required: true, max: 60 });
    if (!EVENT_KEYS.has(eventKey)) {
      throw new HttpError(400, `unknown eventKey: ${eventKey}`, "unknown_event_key");
    }
    const rawParams = ctx.body?.params;
    if (rawParams != null && (typeof rawParams !== "object" || Array.isArray(rawParams))) {
      throw new HttpError(400, "params must be an object", "bad_params");
    }
    const params: Record<string, string | number | null | undefined> = {};
    for (const [k, v] of Object.entries(bodyObj(ctx, "params"))) {
      if (v == null || typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
        params[k] = typeof v === "boolean" ? String(v) : (v as string | number | null);
      }
    }
    const locale = bodyOptStr(ctx, "locale") ?? "en";
    const threadId = bodyOptStr(ctx, "threadId");
    const deepLink = bodyOptStr(ctx, "deepLink");
    const out = await emitEvent({ userId, eventKey, params, locale, threadId, deepLink });
    return { queued: out.queued, channels: out.channels };
  });

  // POST /relay/out {threadId,fromUserId,fromLabel,toUserId,content,locale?,deepLink?}
  //   → {moderation:{status,maskedContent?,flags}, queued, relayed}
  on("POST", "/relay/out", async (ctx) => {
    const threadId = bodyStr(ctx, "threadId", { required: true, max: 120 });
    const fromUserId = bodyStr(ctx, "fromUserId", { required: true, max: 100 });
    const toUserId = bodyStr(ctx, "toUserId", { required: true, max: 100 });
    const content = bodyStr(ctx, "content", { required: true, max: 100_000 });
    const fromLabel = bodyOptStr(ctx, "fromLabel") ?? fromUserId;
    const locale = bodyOptStr(ctx, "locale") ?? "en";
    const deepLink = bodyOptStr(ctx, "deepLink");

    // Moderation pipeline (contract section D) — relay_log row ALWAYS written.
    const mod = moderateAndLog(content, {
      direction: "out",
      threadId,
      fromUserId,
      toUserId,
      senderId: fromUserId,
    });

    let queued = 0;
    let relayed = false;
    if (mod.status === "clean" || mod.status === "masked") {
      relayed = true;
      const out = await emitEvent({
        userId: toUserId,
        eventKey: "message.received",
        params: { fromLabel, snippet: snippetOf(mod.maskedContent, 140) },
        locale,
        threadId,
        deepLink,
      });
      queued = out.queued;
    }

    const moderation: Record<string, unknown> = { status: mod.status, flags: mod.flags };
    if (mod.maskedContent !== content) moderation.maskedContent = mod.maskedContent;
    return { moderation, queued, relayed, relayLogId: mod.logId };
  });
}
