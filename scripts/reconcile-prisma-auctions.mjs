#!/usr/bin/env node
import fs from "node:fs/promises"
import process from "node:process"
import { PrismaClient } from "@prisma/client"
import { reconcileSnapshot } from "./lib/prisma-auction-reconciliation.mjs"

const args = process.argv.slice(2)
const value = (flag) => {
  const i = args.indexOf(flag)
  return i >= 0 ? args[i + 1] : null
}
const fixture = value("--fixture")
const out = value("--out")

if (args.includes("--apply")) {
  process.stderr.write("ERROR: --apply is forbidden; reconciliation is non-destructive dry-run only.\n")
  process.exit(2)
}

async function fromFixture(path) {
  return JSON.parse(await fs.readFile(path, "utf8"))
}

async function trailbaseToken() {
  const base = process.env.TRAILBASE_URL ?? "http://localhost:3001"
  const res = await fetch(`${base}/api/auth/v1/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: process.env.ADMIN_USERNAME ?? "admin",
      password: process.env.ADMIN_PASSWORD ?? "Tengasell#2025",
    }),
    signal: AbortSignal.timeout(8000),
  })
  if (!res.ok) throw new Error(`TrailBase admin login failed: ${res.status}`)
  const data = await res.json()
  if (!data.auth_token) throw new Error("TrailBase admin login returned no auth_token")
  return { base, token: data.auth_token }
}

async function tbAll(collection, auth) {
  const rows = []
  let cursor = null
  for (let page = 0; page < 1000; page++) {
    const qs = new URLSearchParams({ limit: "200", order: "id" })
    if (cursor) qs.set("cursor", cursor)
    const res = await fetch(
      `${auth.base}/api/records/v1/${collection}?${qs}`,
      { headers: { Authorization: `Bearer ${auth.token}` }, signal: AbortSignal.timeout(10000) },
    )
    if (!res.ok) throw new Error(`TrailBase ${collection} read failed: ${res.status}`)
    const body = await res.json()
    const pageRows = body.records ?? []
    rows.push(...pageRows)
    cursor = body.cursor ?? body.next_cursor ?? null
    if (!cursor || pageRows.length === 0) break
  }
  return rows
}

async function liveSnapshot() {
  const prisma = new PrismaClient()
  try {
    const [legacyListings, legacyOrders, auth] = await Promise.all([
      prisma.listing.findMany({ where: { type: "AUCTION" }, orderBy: { createdAt: "asc" } }),
      prisma.order.findMany({ where: { type: "AUCTION" }, orderBy: { placedAt: "asc" } }),
      trailbaseToken(),
    ])
    const [canonicalAuctions, canonicalOrders, mappings] = await Promise.all([
      tbAll("auctions", auth),
      tbAll("orders", auth),
      tbAll("legacy_auction_mappings", auth),
    ])
    return { legacyListings, legacyOrders, canonicalAuctions, canonicalOrders, mappings }
  } finally {
    await prisma.$disconnect()
  }
}

const snapshot = fixture ? await fromFixture(fixture) : await liveSnapshot()
const report = reconcileSnapshot(snapshot)
const json = JSON.stringify(report, null, 2) + "\n"

if (out) await fs.writeFile(out, json, "utf8")
process.stdout.write(json)

