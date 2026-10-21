// GET /api/comms/admin/mock/chats?channel=&chatId=&limit=
//   → GET :3005/admin/mock/chats → {messages:[…]} (TG/WA/messenger transcripts)

import type { NextRequest } from "next/server";
import { adminCommsProxy } from "@/lib/server/comms";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const CHANNELS = new Set(["telegram", "whatsapp", "messenger"]);

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const channel = sp.get("channel") ?? "";
  const chatId = sp.get("chatId") ?? "";
  const limit = sp.get("limit") ?? "500";
  const parts = [`limit=${encodeURIComponent(limit)}`];
  if (channel && CHANNELS.has(channel)) parts.push(`channel=${encodeURIComponent(channel)}`);
  if (chatId) parts.push(`chatId=${encodeURIComponent(chatId)}`);
  return adminCommsProxy(req, `/admin/mock/chats?${parts.join("&")}`);
}
