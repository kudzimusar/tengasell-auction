#!/usr/bin/env node
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

function walk(dir) {
  const out = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(full))
    else if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(entry.name)) out.push(full)
  }
  return out
}

const methods = (src, model) =>
  [...src.matchAll(new RegExp(`\\b(?:db|tx)\\.${model}\\.([A-Za-z0-9_]+)`, "g"))]
    .map((m) => m[1])

export function inventoryPrismaAuctionConsumers(root = "src") {
  const rows = []
  for (const file of walk(root)) {
    const src = fs.readFileSync(file, "utf8")
    const listing = methods(src, "listing")
    const bid = methods(src, "bid")
    const order = methods(src, "order")
    if (!listing.length && !bid.length && !order.length) continue

    const rel = file.split(path.sep).join("/")
    const mutationMethods = new Set(["create","createMany","update","updateMany","delete","deleteMany","upsert"])
    const all = [...listing, ...bid, ...order]
    rows.push({
      file: rel,
      listing: [...new Set(listing)].sort(),
      bid: [...new Set(bid)].sort(),
      order: [...new Set(order)].sort(),
      mutationCapable: all.some((m) => mutationMethods.has(m)),
      explicitAuctionGuard:
        src.includes("isLegacyPrismaAuction") ||
        src.includes("CANONICAL_AUCTION_REQUIRED") ||
        src.includes('type !== "BUY_NOW"') ||
        src.includes('type === "BUY_NOW"'),
      mentionsAuction: src.includes("AUCTION"),
    })
  }
  return rows.sort((a, b) => a.file.localeCompare(b.file))
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  const rows = inventoryPrismaAuctionConsumers(process.argv[2] || "src")
  process.stdout.write(JSON.stringify({
    generatedAt: new Date().toISOString(),
    scope: "Prisma Listing/Bid/Order source consumers (full executable source superset)",
    count: rows.length,
    rows,
  }, null, 2) + "\n")
}
