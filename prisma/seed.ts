// Tengasell comprehensive seed — run with: bunx bun prisma/seed.ts
import { PrismaClient } from "@prisma/client"
import { randomBytes, scryptSync } from "crypto"

const db = new PrismaClient()

function hash(pw: string) {
  const salt = randomBytes(16).toString("hex")
  return `${salt}:${scryptSync(pw, salt, 64).toString("hex")}`
}
const PW = "Tengasell#2025"
const D = (msAgo: number) => new Date(Date.now() - msAgo)
const IN_FUTURE = (ms: number) => new Date(Date.now() + ms)

async function main() {
  const count = await db.user.count()
  if (count > 0) {
    console.log("Seed: users exist — wiping for fresh seed")
    // Order matters for FKs; SQLite with Prisma deletes cascade only via onDelete, so wipe raw tables
    const tables = ["MscsCertification","MscsAssessment","MscsFinding","MscsEvidence","MscsControl","RestoreTest","BackupRun","BreakGlassAccess","BcpPlan","ReleaseRecord","ApiRequestLog","WebhookDelivery","WebhookEndpoint","DeveloperApp","ApiKey","MetricDaily","AppLog","Incident","StatusEvent","InternalAudit","RiskException","RiskItem","SanctionsScreening","LegalHold","RegulatoryReport","Licence","LegalRequest","PolicyAcceptance","Policy","PrivacyIncident","Processor","RetentionRule","DsarRequest","DataInventory","MonthlyClose","ReconciliationRun","TaxLine","Invoice","Payout","LedgerEntry","TicketMessage","Ticket","CampaignRecipient","EmailOutbox","Campaign","Template","Suppression","ConsentRecord","NotificationPref","Notification","Message","MessageThread","MediaAsset","ArticleVersion","Article","ReasonCode","ConfigSetting","FeatureFlag","AuditLog","ApprovalRequest","Appeal","Enforcement","AbuseReport","Dispute","Review","Refund","Payment","OrderEvent","Order","SavedSearch","Watch","Bid","ListingVersion","Listing","Category","SellerProfile","StaffGrant","StepUpToken","PasswordResetToken","AuthEvent","SessionRecord","User","Partner"]
    for (const t of tables) {
      await (db as any)[t.charAt(0).toLowerCase() + t.slice(1)].deleteMany({})
    }
  }

  // ── MSCS registry (609 controls) ──────────────────────────────
  const reg = JSON.parse(await Bun.file("prisma/mscs-registry.json").text())
  const NA_RULES: Record<string, string> = {
    ORG: "Single-tenant consumer marketplace — no B2B organizations/tenancy in v1 scope",
    MCP: "No AI/agent surface exposed in v1 (REST API only). API access never confers agent authority",
    PRT: "Partner registry operational for logistics/PSP partners; full partner platform deferred",
  }
  const NA_IDS = new Set<string>([
    "I18N-008", "GRW-008", "REL-002", "REL-003", "REL-004", "REL-005", "REL-010", "REL-011",
    "ORG-004", "ORG-005", "ORG-006", "ORG-007", "ORG-008", "ORG-009", "ORG-010", "ORG-011", "ORG-012",
    "SEC-015", "SEC-016", "GOV-012",
    "EXPr-008",
  ])
  const C_IDS = new Set<string>([
    "EXPr-008".replace("r", ""), "EXP-008", "EXP-012", "PRT-001", "PRT-002", "PRT-009", "PRT-011",
    "SEC-014", "SEC-018", "SEC-021", "SEC-22", "INF-007", "INF-008", "INF-009", "INF-010", "INF-011", "INF-012", "INF-013", "INF-014", "INF-015", "INF-016", "INF-017",
    "ENG-005", "ENG-006", "ENG-007", "ENG-008", "ENG-009", "ENG-010", "ENG-011", "ENG-012", "ENG-014",
    "GOV-010", "GOV-011", "PRV-018", "MCP-004",
    "PRT-003", "PRT-004", "PRT-005", "PRT-006", "PRT-007", "PRT-008", "PRT-010", "PRT-012",
    "DEV-004", "DEV-005", "DEV-006", "DEV-007", "DEV-008", "DEV-009", "DEV-010", "DEV-011", "DEV-012", "DEV-013", "DEV-014", "DEV-015", "DEV-016", "DEV-017", "DEV-018", "DEV-019", "DEV-020",
    "BI-012",
  ])
  const M4_SELECTED = new Set(["GOV-001", "GOV-002", "GOV-003", "GOV-004", "GOV-005", "GOV-006", "GOV-007", "GOV-008", "GOV-009", "GOV-013", "GOV-014", "PRV-017", "PRV-018", "LEG-014", "LEG-015", "RSK-006", "RSK-007", "RSK-009", "RSK-010", "EXE-006", "EXE-007", "EXE-008"])
  const FUTURE_FLOORS = new Set(["M3", "M4"])
  const owners: Record<string, string> = {
    STR: "Executive", EXP: "Product", IAM: "Security", ORG: "Product", MKT: "Marketplace Lead", COM: "Commerce Lead",
    CMS: "Content Lead", SRC: "Product", MSG: "Comms Lead", CTL: "Operations", SUP: "Support Lead", TNS: "Trust & Safety Lead",
    FIN: "Finance", CORP: "Corporate Admin", GRW: "Growth", PRT: "Partnerships", DAT: "Data Owner", BI: "Analytics",
    API: "API Platform", DEV: "Developer Relations", MCP: "AI Platform", INT: "Integration Lead", SEC: "Security",
    PRV: "Privacy Officer (DPO)", LEG: "Legal", GOV: "Compliance", ACC: "Design System", I18N: "Product",
    INF: "Infrastructure", ENG: "Engineering", OPS: "SRE", INC: "Incident Commander", BCP: "SRE", REL: "Release",
    DOC: "Documentation", EXE: "Executive", RSK: "Risk Owner",
  }
  for (const c of reg.controls) {
    let applicability = "R"
    let note: string | null = null
    if (NA_RULES[c.domain] && !["ORG-001", "ORG-002", "ORG-003", "MCP-001", "MCP-002", "MCP-003"].includes(c.id)) {
      applicability = "NA"; note = NA_RULES[c.domain]
    }
    if (NA_IDS.has(c.id)) { applicability = "NA"; note = note || "Documented N/A for v1 scope — see Project Declaration" }
    if (C_IDS.has(c.id)) { applicability = "C"; note = "Conditional — see applicability note in audit console" }
    if (FUTURE_FLOORS.has(c.floor) && applicability === "R" && !M4_SELECTED.has(c.id)) {
      applicability = "F"; note = `Floor ${c.floor} above declared M2 profile — out of declared scope`
    }
    if (M4_SELECTED.has(c.id)) { applicability = "R"; note = "Selected M4 control (declared in Project Declaration)" }
    await db.mscsControl.create({
      data: {
        id: c.id, domain: c.domain, domainName: c.domainName, name: c.name,
        floor: c.floor, criticality: c.criticality,
        evidenceFloor: JSON.stringify(c.evidenceFloor),
        applicability, applicabilityNote: note,
        status: "S10", statusNote: "In scope — pending assessment",
        ownerRole: owners[c.domain] || "Product",
      },
    })
  }
  console.log("MSCS registry seeded:", reg.controls.length)

  // ── MSCS Project Declaration (Template A) + assessment shell ──
  const declaration = {
    project: "Tengasell — Zimbabwe online auction marketplace",
    businessModel: "Marketplace (auction + buy-now) with seller commission and buyer-protection mediation",
    owner: "Tengasell (Pvt) Ltd — executive team",
    targetProfile: "M2 + selected M4 controls",
    markets: ["Zimbabwe", "International (EN/JA UI, USD pricing)"],
    userTypes: ["Buyers", "Sellers", "Support", "Moderation", "Finance", "Compliance", "Admin"],
    marketplace: "Yes", cms: "Yes", payments: "Yes (sandbox/mock PSP — production PSP is a launch condition)",
    externalDevelopers: "Yes (read API + webhooks)", aiMcp: "No (v1)", enterpriseTenancy: "No",
    regulatedDomain: "To be assessed — Cyber & Data Protection Act [Chapter 12:07], Consumer Protection Act, VAT (ZIMRA)",
    sourceAuthority: "Workdir /home/z/my-project (main); seed " + new Date().toISOString(),
    environmentAuthority: "Sandbox single-node: Next.js 16 :3000, SQLite db/custom.db, scheduler embedded",
    dataSensitivity: "Personal data (identity, contact, order, comms); no special-category data",
  }
  await db.mscsAssessment.create({
    data: {
      declaration: JSON.stringify(declaration), profile: "M2",
      scope: "All 37 domains; 609 canonical controls; applicability per Project Declaration",
      versionAuthority: "tengasell@post-reset-rebuild",
      environment: "sandbox",
      assessmentLead: "Z.ai Code (orchestrator)",
      status: "IN_PROGRESS",
      gates: JSON.stringify({ A: false, B: false, C: false, D: false }),
    },
  })

  // ── Users ─────────────────────────────────────────────────────
  const mkUser = (email: string, handle: string, name: string, role: string, opts: any = {}) =>
    db.user.create({
      data: {
        email, handle, name, role, passwordHash: hash(PW),
        status: opts.status || "ACTIVE", emailVerifiedAt: new Date(),
        locale: opts.locale || "en", city: opts.city || "Harare", isSeller: ["SELLER", "ADMIN"].includes(role),
        avatarEmoji: opts.avatar || "🙂", bio: opts.bio, mfaEnabled: opts.mfa || false,
        riskScore: opts.risk || 0,
      },
    })
  const admin = await mkUser("admin@tengasell.co.zw", "admin", "Tengasell Admin", "ADMIN", { avatar: "🛡️", mfa: true, bio: "Platform operations" })
  const compliance = await mkUser("compliance@tengasell.co.zw", "compliance", "Compliance Officer", "COMPLIANCE", { avatar: "⚖️", mfa: true, bio: "Legal, privacy & regulatory" })
  const finance = await mkUser("finance@tengasell.co.zw", "finance", "Finance Controller", "FINANCE", { avatar: "💼", mfa: true, bio: "Ledger, payouts, reconciliation" })
  const support = await mkUser("support@tengasell.co.zw", "support", "Support Lead", "SUPPORT", { avatar: "🎧" })
  const moderator = await mkUser("moderation@tengasell.co.zw", "moderation", "Moderator", "MODERATOR", { avatar: "🚨" })
  const simba = await mkUser("simba@tengasell.co.zw", "simba", "Simba Moyo", "SELLER", { avatar: "🦁", city: "Harare", bio: "Electronics & gadgets since 2020" })
  const rufaro = await mkUser("rufaro@tengasell.co.zw", "rufaro", "Rufaro Chikwanha", "SELLER", { avatar: "🌺", city: "Bulawayo", bio: "Cameras, music gear, collectibles" })
  const chipo = await mkUser("chipo@tengasell.co.zw", "chipo", "Chipo Ndlovu", "SELLER", { avatar: "🎨", city: "Mutare", bio: "Handmade crafts & art" })
  const tariro = await mkUser("tariro@example.com", "tariro", "Tariro Gumbo", "BUYER", { avatar: "🛒", city: "Harare" })
  const nyasha = await mkUser("nyasha@example.com", "nyasha", "Nyasha Dube", "BUYER", { avatar: "🧑‍💻", city: "Gweru" })

  const mkSeller = (userId: string, shopName: string, slug: string, bio: string, status: string, extra: any = {}) =>
    db.sellerProfile.create({
      data: {
        userId, shopName, slug, bio, status,
        identityVerified: status === "VERIFIED", businessVerified: status === "VERIFIED",
        taxVerified: status === "VERIFIED", payoutVerified: status === "VERIFIED",
        ratingAvg: extra.rating || 4.7, ratingCount: extra.count || 12, healthScore: extra.health || 95,
        payoutMethod: JSON.stringify({ type: "MOCK_BANK", bankName: "CBZ Bank", acctMask: "****4321" }),
        ...extra.passthrough,
      },
    })
  const simbaShop = await mkSeller(simba.id, "Simba Trading", "simba-trading", "Harare-based electronics & gadget store. Fast delivery, 7-day returns.", "VERIFIED", { rating: 4.8, count: 87, health: 96 })
  const rufaroShop = await mkSeller(rufaro.id, "Rufaro Tech & Collectibles", "rufaro-tech", "Cameras, instruments and rare finds from Bulawayo.", "VERIFIED", { rating: 4.6, count: 41, health: 92 })
  await mkSeller(chipo.id, "Chipo Crafts", "chipo-crafts", "Handmade Zimbabwean crafts, art and fabrics.", "PENDING", { rating: 5.0, count: 3, health: 85 })

  // ── Categories ────────────────────────────────────────────────
  const catData = [
    ["electronics", "Electronics", "エレクトロニクス", "📱"], ["fashion", "Fashion", "ファッション", "👗"],
    ["home", "Home & Living", "ホーム＆リビング", "🛋️"], ["vehicles", "Vehicles", "車両", "🚗"],
    ["art", "Art & Crafts", "アート＆クラフト", "🎨"], ["books", "Books & Media", "書籍＆メディア", "📚"],
    ["sports", "Sports & Outdoors", "スポーツ", "⚽"], ["toys", "Toys & Games", "おもちゃ＆ゲーム", "🧸"],
    ["beauty", "Beauty & Health", "美容＆健康", "💄"], ["music", "Music & Instruments", "音楽＆楽器", "🎸"],
    ["photography", "Photography", "写真・カメラ", "📷"], ["collectibles", "Collectibles", "コレクション", "🏺"],
  ]
  const cats: Record<string, string> = {}
  for (let i = 0; i < catData.length; i++) {
    const [slug, name, nameJa, icon] = catData[i]
    const c = await db.category.create({ data: { slug, name, nameJa, icon, sort: i } })
    cats[slug] = c.id
  }

  // ── Listings ──────────────────────────────────────────────────
  const H = 3600_000
  const listingData: any[] = [
    ["electronics", simba.id, "Samsung Galaxy S23 (Used, Excellent)", "SEALED glass, 512GB storage, everything works perfectly. Comes with original box.", "USED", "AUCTION", 450, 720, IN_FUTURE(26 * H), "phone.jpg", "s23"],
    ["electronics", simba.id, "HP Pavilion 15 Laptop i5 8GB RAM", "Business laptop, 512GB SSD, fresh Windows install. Battery 4+ hours.", "USED", "AUCTION", 320, 480, IN_FUTURE(50 * H), "laptop.jpg", "hp15"],
    ["electronics", simba.id, "Wireless ANC Headphones (New)", "Brand new in box. Active noise cancelling, 30h battery, USB-C.", "NEW", "BUY_NOW", 89, null, null, "headphones.jpg", "anc"],
    ["electronics", simba.id, "Sony Alpha A6000 + 16-50mm Kit", "Mirrorless camera, 24MP APS-C. Shutter count 8k. All accessories included.", "USED", "AUCTION", 580, 780, IN_FUTURE(5 * H), "camera.jpg", "a6000"],
    ["photography", rufaro.id, "Canon EOS 5D Mark III Body", "Professional full-frame body. Shutter 42k of 150k. Clean sensor.", "USED", "AUCTION", 900, 1350, IN_FUTURE(2 * H), "camera.jpg", "5d3"],
    ["photography", rufaro.id, "Film SLR — Nikon FM2 (Collector Grade)", "Classic 1982 film body, fully mechanical, recently CLA'd. A joy to shoot.", "USED", "AUCTION", 220, 340, IN_FUTURE(75 * H), "camera.jpg", "fm2"],
    ["music", rufaro.id, "Yamaha FG800 Acoustic Guitar", "Solid spruce top, great beginner-to-intermediate guitar. New strings.", "USED", "BUY_NOW", 165, null, null, "guitar.jpg", "fg800"],
    ["music", rufaro.id, "Vintage 1970s Stage Microphone", "Dynamic mic from a Harare theatre. Tested, warm tone. Collectible.", "USED", "AUCTION", 95, 150, IN_FUTURE(48 * H), "headphones.jpg", "mic70"],
    ["fashion", chipo.id, "African Print Wrap Dress (Handmade)", "Custom tailoring available. Shwe-shwe fabric, size 8-16 options.", "NEW", "BUY_NOW", 45, null, null, "dress.jpg", "wrapdress"],
    ["fashion", chipo.id, "Leather Sandals — Hand Stitched", "Genuine cowhide, Harare workshop. Sizes 36-45.", "NEW", "BUY_NOW", 28, null, null, "sneakers.jpg", "sandals"],
    ["fashion", simba.id, "Nike Air Force 1 (US9, Used)", "Worn a handful of times, soles clean. Original laces + box.", "USED", "AUCTION", 60, 95, IN_FUTURE(20 * H), "sneakers.jpg", "af1"],
    ["art", chipo.id, "Original Oil Painting — Great Zimbabwe Ruins", "60×80cm canvas by Mutare artist T. Ndlovu. Certificate included.", "NEW", "AUCTION", 180, 300, IN_FUTURE(30 * H), "painting.jpg", "gztone"],
    ["art", chipo.id, "Stone Sculpture — Springstone Family", "Hand-carved springstone, 35cm tall, one-of-a-kind.", "NEW", "AUCTION", 140, 240, IN_FUTURE(100 * H), "painting.jpg", "sculpt"],
    ["home", chipo.id, "Three-Seater Fabric Sofa (Charcoal)", "Solid frame, fresh professional cleaning. Delivery Harare only.", "USED", "BUY_NOW", 260, null, null, "sofa.jpg", "sofa"],
    ["home", simba.id, "Espresso Machine 15-Bar (Used)", "Makes great crema. Descaled last week. Includes milk frother jug.", "USED", "AUCTION", 70, 130, IN_FUTURE(8 * H), "headphones.jpg", "espresso"],
    ["books", rufaro.id, "Shona Proverbs & Stories — Illustrated (1974)", "First edition hardcover, dust jacket protected. Rare Zimbabweana.", "USED", "AUCTION", 45, 80, IN_FUTURE(40 * H), "books.jpg", "shona74"],
    ["books", rufaro.id, "Complete Set: Commercial Law ZWE (2023 ed.)", "6 volumes, updated to 2023 legislation. Barely used.", "USED", "BUY_NOW", 120, null, null, "books.jpg", "lawset"],
    ["sports", simba.id, "Mountain Bike 26\" — 21 Speed", "Serviced, new brake pads + tyres. Suitable for trails & commute.", "USED", "AUCTION", 190, 280, IN_FUTURE(12 * H), "bicycle.jpg", "mtb"],
    ["sports", simba.id, "Vintage Road Racer (Reynolds 531 Frame)", "1980s steel racer, fully restored. Rides beautifully.", "USED", "AUCTION", 420, 600, IN_FUTURE(60 * H), "bicycle.jpg", "racer"],
    ["electronics", simba.id, "Smartwatch Fitness Tracker", "IP68, heart-rate + SpO2, 2 straps included.", "NEW", "BUY_NOW", 39, null, null, "watch.jpg", "fitwatch"],
    ["electronics", simba.id, "Mechanical Watch — Automatic, Sapphire", "Exhibition caseback, 40h reserve. With wooden gift box.", "NEW", "AUCTION", 120, 185, IN_FUTURE(18 * H), "watch.jpg", "mechwatch"],
    ["toys", chipo.id, "Wooden Toy Set — Hand Carved Animals", "Zimbabwean hardwood, non-toxic finish. 12 pieces.", "NEW", "BUY_NOW", 35, null, null, "books.jpg", "woodtoys"],
    ["beauty", chipo.id, "Natural Baobab Skincare Gift Set", "Locally made, organic certified. Set of 4.", "NEW", "BUY_NOW", 30, null, null, "dress.jpg", "baobab"],
    ["collectibles", rufaro.id, "Rhodesiana Stamps Collection (1890-1923)", "35 stamps incl. rare 1910 SPECIMEN overprint. Certificate of authenticity.", "USED", "AUCTION", 350, 550, IN_FUTURE(90 * H), "books.jpg", "stamps"],
  ]
  const listings: Record<string, string> = {}
  for (const [cat, sellerId, title, desc, cond, type, start, buyNow, endsAt, img, key] of listingData) {
    const l = await db.listing.create({
      data: {
        sellerId, categoryId: cats[cat], title, description: desc, condition: cond, type,
        startingPrice: start, buyNowPrice: buyNow, currentPrice: start, images: JSON.stringify([`/items/${img}`]),
        status: "ACTIVE", endsAt: endsAt as any, publishedAt: D(72 * H), stock: type === "BUY_NOW" ? 5 : 1,
      },
    })
    listings[key] = l.id
    await db.listingVersion.create({ data: { listingId: l.id, version: 1, snapshot: JSON.stringify({ title, desc, start, buyNow }), changedBy: sellerId, changeNote: "Initial listing" } })
  }
  // Moderation-queue demo listings
  const pend1 = await db.listing.create({ data: { sellerId: chipo.id, categoryId: cats.art, title: "Genuine Diamond Ring (Cert 0.5ct)", description: "Certified diamond — please note payment must be off-platform via bank transfer only.", condition: "NEW", type: "BUY_NOW", startingPrice: 999, buyNowPrice: 999, currentPrice: 999, images: JSON.stringify(["/items/watch.jpg"]), status: "PENDING_REVIEW" } })
  const pend2 = await db.listing.create({ data: { sellerId: simba.id, categoryId: cats.electronics, title: "iPhone 15 Pro Max 256GB", description: "Like new. Battery 96%. Includes AppleCare until 2026.", condition: "USED", type: "AUCTION", startingPrice: 950, buyNowPrice: 1400, currentPrice: 950, images: JSON.stringify(["/items/phone.jpg"]), status: "PENDING_REVIEW", endsAt: IN_FUTURE(36 * H) } })
  const susp = await db.listing.create({ data: { sellerId: rufaro.id, categoryId: cats.electronics, title: "Generic 'Beats by Dre' Studio Headphones", description: "Brand new replica quality sound.", condition: "NEW", type: "BUY_NOW", startingPrice: 25, buyNowPrice: 25, currentPrice: 25, images: JSON.stringify(["/items/headphones.jpg"]), status: "SUSPENDED", rejectReason: "Suspected counterfeit — awaiting seller response" } })

  // Bids history on the closing auction (a6000)
  await db.bid.create({ data: { listingId: listings.a6000, bidderId: tariro.id, amount: 600, isActive: true } })
  await db.bid.create({ data: { listingId: listings.a6000, bidderId: nyasha.id, amount: 630, isActive: true } })
  await db.bid.create({ data: { listingId: listings.a6000, bidderId: tariro.id, amount: 655, isActive: true } })
  await db.listing.update({ where: { id: listings.a6000 }, data: { currentPrice: 655, bidCount: 3, watchCount: 7 } })
  await db.bid.create({ data: { listingId: listings.s23, bidderId: nyasha.id, amount: 470, isActive: true } })
  await db.listing.update({ where: { id: listings.s23 }, data: { currentPrice: 470, bidCount: 1, watchCount: 11 } })
  await db.bid.create({ data: { listingId: listings.mtb, bidderId: tariro.id, amount: 200, isActive: true } })
  await db.listing.update({ where: { id: listings.mtb }, data: { currentPrice: 200, bidCount: 1 } })
  await db.watch.create({ data: { userId: tariro.id, listingId: listings.s23 } })
  await db.watch.create({ data: { userId: tariro.id, listingId: listings.fg800 } })
  await db.watch.create({ data: { userId: nyasha.id, listingId: listings.a6000 } })
  await db.savedSearch.create({ data: { userId: tariro.id, label: "Camera auctions < $700", query: "camera" } })

  // ── Demo orders (lifecycle history) ────────────────────────────
  const fee = (a: number) => Math.round(a * 0.05 * 100) / 100
  const vat = (a: number) => Math.round(a * 0.15 * 100) / 100
  // Completed order with review
  const o1 = await db.order.create({
    data: {
      listingId: listings.fg800, buyerId: tariro.id, sellerId: rufaro.id, type: "BUY_NOW",
      amount: 165, sellerFee: fee(165), vatAmount: vat(165), totalCharged: 165, status: "COMPLETED",
      paymentMethod: "MOCK_CARD", placedAt: D(10 * 24 * H), paidAt: D(10 * 24 * H), shippedAt: D(9 * 24 * H),
      deliveredAt: D(8 * 24 * H), completedAt: D(7 * 24 * H),
      shippingAddress: JSON.stringify({ name: "Tariro Gumbo", phone: "+263 77 000 0001", city: "Harare", street: "12 Samora Machel Ave" }),
    },
  })
  await db.payment.create({ data: { orderId: o1.id, method: "MOCK_CARD", status: "CAPTURED", authRef: "auth_demo_o1", captureRef: "cap_demo_o1", amount: 165, idempotencyKey: "idem-o1" } })
  await db.orderEvent.create({ data: { orderId: o1.id, type: "PLACED", actorId: tariro.id } })
  await db.orderEvent.create({ data: { orderId: o1.id, type: "PAID", actorId: tariro.id } })
  await db.orderEvent.create({ data: { orderId: o1.id, type: "SHIPPED", actorId: rufaro.id, data: JSON.stringify({ carrier: "ZIMPOST", trackingCode: "ZP123456789" }) } })
  await db.orderEvent.create({ data: { orderId: o1.id, type: "DELIVERED", actorId: tariro.id } })
  await db.review.create({ data: { orderId: o1.id, listingId: listings.fg800, authorId: tariro.id, sellerId: rufaro.id, rating: 5, title: "Beautiful guitar, exactly as described", body: "Packaged with care, sounds wonderful. Recommended seller!" } })
  await db.taxLine.create({ data: { orderId: o1.id, amount: vat(165) } })
  await db.invoice.create({ data: { number: "INV-2026-0001", orderId: o1.id, toUserId: tariro.id, lines: JSON.stringify([{ label: "Yamaha FG800", amount: 165 }]), total: 165, vatAmount: vat(165) } })
  await db.ledgerEntry.create({ data: { orderRef: o1.id, account: "BUYER_PAYMENTS", direction: "DEBIT", amount: 165, memo: "Payment captured (mock)", refs: JSON.stringify({ orderId: o1.id }) } })
  await db.ledgerEntry.create({ data: { orderRef: o1.id, account: "SELLER_PAYABLE", direction: "CREDIT", amount: 165 - fee(165) - vat(165), memo: "Seller proceeds net of commission+VAT", refs: JSON.stringify({ orderId: o1.id, sellerId: rufaro.id }) } })
  await db.ledgerEntry.create({ data: { orderRef: o1.id, account: "PLATFORM_REVENUE", direction: "CREDIT", amount: fee(165), memo: "Commission 5%", refs: JSON.stringify({ orderId: o1.id }) } })
  await db.ledgerEntry.create({ data: { orderRef: o1.id, account: "VAT_PAYABLE", direction: "CREDIT", amount: vat(165), memo: "VAT 15% (ZIMRA)", refs: JSON.stringify({ orderId: o1.id }) } })
  // Paid/shipped order + open dispute
  const o2 = await db.order.create({
    data: {
      listingId: listings.espresso, buyerId: nyasha.id, sellerId: simba.id, type: "AUCTION",
      amount: 100, sellerFee: fee(100), vatAmount: vat(100), totalCharged: 100, status: "DISPUTED",
      paymentMethod: "MOCK_ECOCASH", placedAt: D(3 * 24 * H), paidAt: D(3 * 24 * H),
      shippingAddress: JSON.stringify({ name: "Nyasha Dube", city: "Gweru", street: "5 Mkoba South" }),
    },
  })
  await db.payment.create({ data: { orderId: o2.id, method: "MOCK_ECOCASH", status: "CAPTURED", authRef: "auth_demo_o2", captureRef: "cap_demo_o2", amount: 100, idempotencyKey: "idem-o2" } })
  await db.orderEvent.create({ data: { orderId: o2.id, type: "PLACED", actorId: nyasha.id } })
  await db.dispute.create({ data: { orderId: o2.id, openedBy: nyasha.id, reason: "ITEM_NOT_AS_DESCRIBED", details: "Machine leaks water from the group head; not mentioned in listing." } })
  await db.notification.create({ data: { userId: simba.id, type: "DISPUTE_OPENED", params: JSON.stringify({ orderId: o2.id }) } })

  // ── Trust & safety demo data ──────────────────────────────────
  const r1 = await db.abuseReport.create({ data: { reporterId: tariro.id, targetType: "LISTING", targetId: susp.id, reason: "COUNTERFEIT", details: "Obvious replica being sold as genuine.", status: "ACTIONED", handledBy: moderator.id, actionTaken: "LISTING_SUSPENDED" } })
  await db.abuseReport.create({ data: { reporterId: nyasha.id, targetType: "USER", targetId: chipo.id, reason: "OTHER", details: "Asked me to pay via direct bank transfer off-platform.", status: "OPEN" } })
  const enforcement = await db.enforcement.create({ data: { userId: rufaro.id, level: "WARNING", reason: "COUNTERFEIT_LISTING", reportId: r1.id, issuedBy: moderator.id, notes: "First offence — listing suspended, seller educated." } })
  await db.appeal.create({ data: { enforcementId: enforcement.id, userId: rufaro.id, statement: "I did not know these were replicas; my supplier assured me they were genuine. I will remove them.", status: "UNDER_REVIEW" } })

  // ── Comms: threads, templates, campaigns, outbox ──────────────
  const th1 = await db.messageThread.create({ data: { listingId: listings.a6000, buyerId: tariro.id, sellerId: rufaro.id, subject: "Q: shutter count & charger included?", status: "OPEN", lastMessageAt: D(2 * H) } })
  await db.message.create({ data: { threadId: th1.id, senderId: tariro.id, senderRole: "BUYER", body: "Hi! Is the charger and original strap included with the A6000?", createdAt: D(3 * H) } })
  await db.message.create({ data: { threadId: th1.id, senderId: rufaro.id, senderRole: "SELLER", body: "Yes — charger, strap and 2 batteries. Contact me on whatsapp 0771234567 for faster deals.", redacted: true, moderationNote: "PII auto-redacted", createdAt: D(2 * H) } })
  const th2 = await db.messageThread.create({ data: { listingId: listings.s23, buyerId: nyasha.id, sellerId: simba.id, subject: "Shipping to Gweru possible?", status: "MEDIATED", assignedTo: moderator.id, lastMessageAt: D(5 * H) } })
  await db.message.create({ data: { threadId: th2.id, senderId: nyasha.id, senderRole: "BUYER", body: "Do you ship to Gweru? And can we do pickup?" } })
  await db.message.create({ data: { threadId: th2.id, senderId: null, senderRole: "COMPANY", body: "Tengasell mediation note: all deals must complete on-platform. Payment outside Tengasell voids buyer protection.", createdAt: D(5 * H) } })

  const tplData = [
    ["welcome", "Welcome to Tengasell 🦁", "Tengasellへようこそ 🦁", "Hi {{name}}, welcome to Tengasell — Zimbabwe's online auction marketplace. Explore deals: {{link}}", "こんにちは{{name}}さん、Tengasellへようこそ。お得なオークションを探しましょう: {{link}}"],
    ["outbid", "You've been outbid on {{title}}", "「{{title}}」で入札されました", "Someone bid {{amount}} on {{title}}. Bid again before it ends: {{link}}", "{{title}}に{{amount}}が入札されました。終了前に再入札を: {{link}}"],
    ["auction_won", "You won: {{title}} 🎉", "落札しました: {{title}} 🎉", "Congratulations! You won {{title}} for {{amount}}. Complete payment within 48h: {{link}}", "おめでとうございます！{{title}}を{{amount}}で落札しました。48時間以内にお支払いください: {{link}}"],
    ["order_paid", "Payment received for {{title}}", "お支払いを確認しました: {{title}}", "We received your payment of {{amount}}. The seller will ship shortly.", "{{amount}}のお支払いを受け付けました。出品者がまもなく発送します。"],
    ["order_shipped", "Your order has shipped 📦", "注文が発送されました 📦", "Good news — {{title}} is on its way. Tracking: {{tracking}}", "「{{title}}」が発送されました。追跡番号: {{tracking}}"],
    ["dispute_opened", "Dispute opened on order {{orderId}}", "注文{{orderId}}で紛争が開始されました", "A dispute was opened. Our team will mediate within 24h.", "紛争が開始されました。24時間以内に対応します。"],
    ["ticket_reply", "Update on your support ticket", "サポートチケットの更新", "Hi {{name}}, we replied to ticket {{ref}}: {{link}}", "{{name}}様、チケット{{ref}}に返信しました: {{link}}"],
    ["marketing_digest", "This week's best auctions 🔥", "今週の注目オークション 🔥", "Check out handpicked auctions ending soon — electronics, art and more. Unsubscribe anytime: {{unsub}}", "まもなく終了する厳選オークションをご覧ください。いつでも配信停止できます: {{unsub}}"],
  ]
  for (const [key, sen, sja, ben, bja] of tplData) {
    await db.template.create({ data: { key, type: key.startsWith("marketing") ? "MARKETING" : "TRANSACTIONAL", subjectEn: sen, subjectJa: sja, bodyEn: ben, bodyJa: bja } })
  }
  const sentCamp = await db.campaign.create({ data: { name: "October Auctions Digest", segment: JSON.stringify({ optInOnly: true }), channel: "EMAIL", templateKey: "marketing_digest", status: "SENT", sentAt: D(30 * H), createdBy: admin.id, approvedBy: admin.id, stats: JSON.stringify({ queued: 2, sent: 2, suppressed: 1, opened: 2, clicked: 1, unsubscribed: 0 }) } })
  await db.campaignRecipient.create({ data: { campaignId: sentCamp.id, userId: tariro.id, email: tariro.email, status: "SENT" } })
  await db.campaignRecipient.create({ data: { campaignId: sentCamp.id, userId: nyasha.id, email: nyasha.email, status: "SENT" } })
  await db.emailOutbox.create({ data: { toEmail: tariro.email, userId: tariro.id, subject: "This week's best auctions 🔥", body: "Handpicked auctions ending soon — log in to bid.", templateKey: "marketing_digest", campaignId: sentCamp.id, kind: "MARKETING", status: "SENT", providerRef: "mock_sent1", sentAt: D(30 * H), openedAt: D(29 * H), clickedAt: D(29 * H), unsubToken: "unsub_demo_tariro" } })
  await db.emailOutbox.create({ data: { toEmail: nyasha.email, userId: nyasha.id, subject: "This week's best auctions 🔥", body: "Handpicked auctions ending soon — log in to bid.", templateKey: "marketing_digest", campaignId: sentCamp.id, kind: "MARKETING", status: "SENT", providerRef: "mock_sent2", sentAt: D(30 * H), openedAt: D(28 * H) } })
  await db.emailOutbox.create({ data: { toEmail: tariro.email, userId: tariro.id, subject: "Welcome to Tengasell 🦁", body: "Welcome aboard! Start exploring.", templateKey: "welcome", kind: "TRANSACTIONAL", status: "SENT", providerRef: "mock_sent3", sentAt: D(20 * 24 * H) } })
  // One queued transactional (dispatched live during UAT by scheduler)
  await db.emailOutbox.create({ data: { toEmail: nyasha.email, userId: nyasha.id, subject: "Dispute opened on order " + o2.id.slice(-6), body: "Our team will mediate within 24h.", templateKey: "dispute_opened", kind: "TRANSACTIONAL", status: "QUEUED" } })
  // A campaign scheduled to fire during UAT
  await db.campaign.create({ data: { name: "Flash: Camera auctions end tonight", segment: JSON.stringify({ optInOnly: true }), channel: "EMAIL", templateKey: "marketing_digest", status: "SCHEDULED", scheduledAt: IN_FUTURE(90_000), createdBy: admin.id, approvedBy: admin.id } })
  // Suppression demo (simba opted out)
  await db.suppression.create({ data: { userId: simba.id, email: simba.email, reason: "UNSUBSCRIBE_LINK", token: "unsub_demo_simba" } })
  // Consent records
  await db.consentRecord.create({ data: { userId: tariro.id, purpose: "MARKETING", granted: true, source: "account_center", grantedAt: D(9 * 24 * H), evidence: "toggle:comms-center" } })
  await db.consentRecord.create({ data: { userId: nyasha.id, purpose: "MARKETING", granted: true, source: "account_center", grantedAt: D(9 * 24 * H), evidence: "toggle:comms-center" } })
  await db.consentRecord.create({ data: { userId: simba.id, purpose: "MARKETING", granted: false, source: "unsubscribe_link", withdrawnAt: D(15 * 24 * H), evidence: "unsub_token:unsub_demo_simba" } })
  // Notification prefs (marketing ON for tariro/nyasha; OFF for others)
  for (const u of [tariro, nyasha]) {
    for (const ev of ["OUTBID", "WIN", "ORDER", "SHIP", "MSG", "MARKETING"]) {
      for (const ch of ["EMAIL", "INAPP"]) {
        await db.notificationPref.create({ data: { userId: u.id, channel: ch, event: ev, enabled: true } }).catch(() => undefined)
      }
    }
  }
  for (const u of [simba, rufaro, chipo]) {
    for (const ev of ["OUTBID", "WIN", "ORDER", "SHIP", "MSG"]) {
      for (const ch of ["EMAIL", "INAPP"]) {
        await db.notificationPref.create({ data: { userId: u.id, channel: ch, event: ev, enabled: true } }).catch(() => undefined)
      }
    }
  }
  await db.notification.create({ data: { userId: tariro.id, type: "OUTBID", params: JSON.stringify({ listingId: listings.a6000, title: "Sony Alpha A6000 + 16-50mm Kit", amount: 655 }) } })
  await db.notification.create({ data: { userId: nyasha.id, type: "OUTBID", params: JSON.stringify({ listingId: listings.a6000, title: "Sony Alpha A6000 + 16-50mm Kit", amount: 655 }) } })

  // ── CMS articles ───────────────────────────────────────────────
  const article = (slug: string, type: string, title: string, titleJa: string, body: string, bodyJa: string, status: string, extra: any = {}) =>
    db.article.create({ data: { slug, type, title, titleJa, body, bodyJa, status, authorId: extra.author || compliance.id, reviewerId: extra.reviewer, publisherId: status === "PUBLISHED" ? compliance.id : null, publishedAt: status === "PUBLISHED" ? D(6 * 24 * H) : null, scheduledFor: extra.scheduledFor, category: extra.category, seoDescription: extra.seo, ...extra.more } })
  await article("getting-started-buying", "HELP", "Getting started: buying & bidding", "はじめての入札ガイド", "# Bidding on Tengasell\n\n1. **Find** an item via search or categories.\n2. **Watch** it to track price moves.\n3. **Bid** — enter your maximum; we notify you when outbid.\n4. **Win & pay** within 48 hours to complete the order.\n5. Items ship; you confirm delivery and leave a review.\n\nBuyer protection covers all on-platform payments.", "入札の流れ：検索→ウォッチ→入札→48時間以内に支払い→受け取り確認→評価。", "PUBLISHED")
  await article("getting-started-selling", "SELLER_DOC", "Seller academy: your first listing", "セラーアカデミー：初めての出品", "# Your first listing\n\n- Honest photos and descriptions sell faster.\n- Auction vs Buy-Now: auctions build excitement; Buy-Now suits stock items.\n- Commission is 5% (see Seller Terms).\n- Ship within 3 days of payment to protect your health score.", "正直な写真と説明が売れるコツ。手数料は5%。", "PUBLISHED")
  await article("fees-explained", "HELP", "Fees explained", "手数料について", "# Fees\n\n| Fee | Amount |\n|---|---|\n| Listing | Free |\n| Seller commission | 5% of sale |\n| VAT | 15% (ZW, where applicable) |\n| Buyer fee | $0 during launch |", "出品無料、落札手数料5%、VAT15%。", "PUBLISHED")
  await article("how-disputes-work", "HELP", "How disputes & refunds work", "紛争と返金の仕組み", "# Disputes\n\nIf an item is not as described, open a dispute within 48h of delivery. Tengasell mediates between buyer and seller. Confirmed breaches trigger refunds from seller proceeds.\n\nFull policy: [Refund Policy](/policy/refunds).", "商品が説明と違う場合、受け取り後48時間以内に紛争を開けます。", "PUBLISHED")
  await article("account-safety", "HELP", "Keeping your account safe", "アカウントの安全", "# Account safety\n\n- Strong, unique password.\n- Never share verification codes.\n- All payments stay on Tengasell — off-platform deals void protection.", "支払いは必ずTengasell内で。", "PUBLISHED")
  await article("shipping-guide", "SELLER_DOC", "Fulfilment & shipping playbook", "配送プレイブック", "# Shipping\n\n- ZIMPOST + courier partners.\n- Always add tracking; buyers confirm delivery in-app.\n- Proof of delivery protects you in disputes.", "追跡番号を必ず入力してください。", "PUBLISHED")
  await article("payout-guide", "SELLER_DOC", "Getting paid: payouts", "受取ガイド", "# Payouts\n\nProceeds land in your seller balance after delivery confirmation. Payouts are batched twice weekly to your verified account. Finance reviews hold unusual payouts.", "受取は購入者確認後、週2回バッチ処理。", "PUBLISHED")
  await article("runbook-incident-sev1", "RUNBOOK", "Runbook: SEV1 incident", "ランブック: SEV1", "# SEV1 response\n\n1. Declare incident (admin → Ops → Incidents).\n2. Assign commander; open bridge.\n3. Mitigate: rollback feature flags first.\n4. Post status event; notify customers if > 30 min.\n5. Postmortem within 72h; corrective actions tracked.", "SEV1対応手順。", "PUBLISHED", { category: "ops" })
  await article("runbook-restore", "RUNBOOK", "Runbook: backup & restore", "ランブック: バックアップと復元", "# Restore procedure\n\n1. Admin → Ops → Backups: pick latest OK run.\n2. Run restore test against the backup copy.\n3. Verify: user count, listing count, ledger balance.\n4. Only designated admins may promote a backup to production DB — dual approval required.", "復元テストの手順。", "PUBLISHED", { category: "ops" })
  await article("kb-internal-support-macros", "KB", "Support macros (internal)", "サポートマクロ（内部）", "# Macros\n\n- `refund-explain`: refund timelines & policy link.\n- `payout-explain`: payout batches.\n- `verify-id`: identity verification steps for DSAR.", "サポート用宏。", "PUBLISHED", { category: "internal" })
  await article("adr-001-monolithic-nextjs", "ADR", "ADR-001: Modular monolith on Next.js", "ADR-001", "# Context\nSingle product team, quick iteration.\n# Decision\nDeploy as a modular monolith (Next.js App Router + Prisma/SQLite) with clean domain boundaries.\n# Consequences\nSimple ops; extraction to services later if scale demands.", "モジュラーモノリスを採用。", "PUBLISHED", { category: "eng" })
  await article("adr-002-mock-psp", "ADR", "ADR-002: Sandbox payment provider", "ADR-002", "# Context\nLaunch requires a licensed PSP for ZW market.\n# Decision\nProvider interface with MOCK adapter (authorise/capture/refund/reverse) until PSP contract signed; adapter swap is config-only.\n# Consequences\nGolden-path money flows are fully testable; production cutover is a launch condition (RiskException RSK-EX-002).", "サンドボックス決済アダプターの決定。", "PUBLISHED", { category: "eng" })
  await article("changelog-2026-10", "CHANGELOG", "Changelog — October 2026", "変更履歴", "# October 2026\n\n- Auction marketplace GA (bids, watchlists, buy-now)\n- Mediated messaging with PII redaction\n- Finance console: ledger, reconciliation, payouts\n- MSCS 1.0 registry & audit console\n- Privacy centre: DSAR, consent, data inventory", "10月の変更点。", "PUBLISHED", { category: "eng" })
  await article("ann-harare-launch", "ANNOUNCEMENT", "Tengasell Harare community meetup — Nov 12", "ハラレコミュニティミートアップ", "Join sellers and buyers at Harare Gardens, 14:00. Free verification sessions for sellers!", "11月12日ハラレでイベント開催。", "PUBLISHED")
  // CMS workflow demo states
  await article("draft-stores-pilot", "ANNOUNCEMENT", "Pilot: Bulawayo pickup points", "ブラワヨ受け取り拠点", "We are piloting pickup points in Bulawayo.", "パイロット開始予定。", "DRAFT")
  await article("scheduled-blackfriday", "ANNOUNCEMENT", "Black Friday auctions schedule", "ブラックフライデー開催予定", "Curated auctions every hour.", "毎時オークション。", "SCHEDULED", { scheduledFor: IN_FUTURE(2 * 24 * H) })
  await article("inreview-prohibited-update", "POLICY", "Prohibited goods — 2027 update draft", "禁止商品2027改訂案", "Adds new restrictions on lithium batteries shipping.", "リチウム電池規制を追加。", "IN_REVIEW", { reviewer: compliance.id })

  // ── Policies (Policy register with acceptance evidence) ───────
  const pol = (key: string, title: string, body: string, acceptance: boolean) =>
    db.policy.create({ data: { key, title, body, status: "PUBLISHED", acceptanceRequired: acceptance, version: 1 } })
  await pol("terms", "Terms of Service", "Tengasell marketplace terms: accounts, bidding, orders, prohibited conduct, liability, governing law (Zimbabwe).", true)
  await pol("privacy", "Privacy Policy", "How Tengasell collects, uses, retains and protects personal data; data rights; processors; contact DPO.", true)
  await pol("aup", "Acceptable Use Policy", "No counterfeit, illegal, or unsafe goods; no off-platform payment solicitation; no scraping without API terms.", true)
  await pol("refunds", "Refund & Cancellation Policy", "48h delivery dispute window; refund routes; seller breach consequences; VAT invoice handling.", false)
  await pol("seller", "Seller Agreement", "Seller obligations, commission 5%, verification, payouts, enforcement ladder.", true)
  await pol("prohibited", "Prohibited & Restricted Goods", "Weapons, drugs, wildlife items, counterfeit, PII-selling, currency; takedown + appeal process.", true)
  await pol("accessibility", "Accessibility Statement (WCAG 2.2 AA target)", "Conformance target, known issues, contact route.", false)
  await pol("api-terms", "Developer API Terms", "Scopes, rate limits, no bulk scraping, revocation rights.", true)
  await pol("cookies", "Cookie & Tracking Notice", "Session cookie + analytics (consent-gated); no third-party ad trackers.", false)
  for (const u of [tariro, nyasha, simba, rufaro]) {
    for (const k of ["terms", "privacy", "aup", "seller", "prohibited"]) {
      await db.policyAcceptance.create({ data: { policyKey: k, userId: u.id, version: 1, acceptedAt: D(30 * 24 * H), ip: "127.0.0.1" } })
    }
  }

  // ── Compliance / governance registers ─────────────────────────
  const di = (asset: string, category: string, fields: string[], purpose: string, basis: string, retention: string) =>
    db.dataInventory.create({ data: { asset, category, fields: JSON.stringify(fields), purpose, legalBasis: basis, retention, owner: "Privacy Officer", systems: JSON.stringify(["SQLite db/custom.db", "Backups"]) } })
  await di("Account identity", "IDENTITY", ["name", "email", "handle", "passwordHash", "locale"], "Account management, authentication", "Contract (Art. 6(1)(b))", "Life of account + 30 days")
  await di("Contact data", "CONTACT", ["email", "phone (optional)"], "Order fulfilment, notifications", "Contract", "3 years after last order")
  await di("Financial records", "FINANCIAL", ["orders", "payments", "invoices", "payouts"], "Legal accounting obligation", "Legal obligation", "7 years (ZIMRA)")
  await di("User content", "CONTENT", ["listings", "reviews", "messages"], "Service delivery", "Contract", "3 years")
  await di("Behavioural/telemetry", "BEHAVIOURAL", ["app logs", "metrics", "api request logs"], "Security, reliability, analytics", "Legitimate interest", "90 days (log retention)")
  await di("Technical security logs", "TECHNICAL", ["auth events", "audit log", "session records"], "Fraud prevention, audit", "Legal obligation", "1 year minimum")
  await di("Marketing consents", "BEHAVIOURAL", ["consent records", "notification prefs"], "Marketing (opt-in only)", "Consent", "Until withdrawn + 3y proof")
  await db.dsarRequest.create({ data: { userId: tariro.id, type: "ACCESS", details: "Please provide a copy of my data.", status: "IN_PROGRESS", identityVerified: true, assignedTo: compliance.id, dueAt: IN_FUTURE(25 * 24 * H) } })
  await db.dsarRequest.create({ data: { userId: simba.id, type: "CORRECTION", details: "My city is wrong (Mutare, not Harare).", status: "COMPLETED", identityVerified: true, assignedTo: compliance.id, dueAt: D(-1 * 24 * H), completedAt: D(-2 * 24 * H), resultRef: "Profile city updated" } })
  await db.retentionRule.create({ data: { dataType: "App/security logs", keepDays: 90, basis: "Legitimate interest" } })
  await db.retentionRule.create({ data: { dataType: "Financial records", keepDays: 2555, basis: "ZIMRA 7-year rule", legalHold: false } })
  await db.retentionRule.create({ data: { dataType: "Deleted accounts (anonymised)", keepDays: 30, basis: "Erasure pipeline grace" } })
  await db.retentionRule.create({ data: { dataType: "Message content", keepDays: 1095, basis: "Dispute window" } })
  await db.processor.create({ data: { name: "Cloud host (sandbox)", purpose: "Application & database hosting", dataCategories: JSON.stringify(["all platform data"]), country: "EU/US cloud region", contractRef: "hosting-agreement-2026", subprocessors: JSON.stringify([]) } })
  await db.processor.create({ data: { name: "Email delivery provider (mock in sandbox)", purpose: "Transactional + consented marketing email", dataCategories: JSON.stringify(["email", "name"]), country: "Ireland", contractRef: "dpa-on-file", subprocessors: JSON.stringify([]) } })
  await db.processor.create({ data: { name: "Payment service provider (post-launch)", purpose: "Payment processing", dataCategories: JSON.stringify(["financial"]), country: "Zimbabwe", contractRef: "pending-signature", subprocessors: JSON.stringify(["card networks"]) } })
  await db.licence.create({ data: { name: "Company registration (Pvt) Ltd", authority: "Companies Office (Zimbabwe)", jurisdiction: "ZW", number: "CR-2026-TGS", status: "ACTIVE", issuedAt: D(120 * 24 * H), expiresAt: null, evidenceRef: "cert-of-incorporation.pdf", owner: "Corporate Admin" } })
  await db.licence.create({ data: { name: "Data Protection Registration (Cyber & Data Protection Act)", authority: "POTRAZ / Data Protection Authority", jurisdiction: "ZW", number: "DPA-PENDING", status: "PENDING_RENEWAL", issuedAt: D(60 * 24 * H), expiresAt: IN_FUTURE(30 * 24 * H), evidenceRef: "application-receipt.pdf", owner: "Compliance" } })
  await db.licence.create({ data: { name: "Marketplace operator licence (consumer protection)", authority: "Consumer Protection Commission", jurisdiction: "ZW", number: "CPC-APP-2026", status: "PENDING_RENEWAL", issuedAt: D(90 * 24 * H), expiresAt: IN_FUTURE(60 * 24 * H), evidenceRef: "cpc-application.pdf", owner: "Compliance" } })
  await db.legalRequest.create({ data: { ref: "LR-2026-001", receivedFrom: "Zimbabwe Republic Police — Commercial Crimes Unit", type: "LAW_ENFORCEMENT", description: "Request for seller records relating to listing complaint ref CC-114.", status: "UNDER_REVIEW", reviewer: compliance.id, scopeNote: "Scope to the specific listing + seller identity only", minimizationNote: "Data minimisation applied; no bulk export", dueAt: IN_FUTURE(20 * 24 * H) } })
  await db.regulatoryReport.create({ data: { kind: "TAX", period: "2026-Q3", status: "DRAFT", payload: JSON.stringify({ VAT: vat(165) + vat(100), orders: 2, note: "Draft — finance review" }), generatedBy: finance.id } })
  await db.legalHold.create({ data: { subject: "Order " + o2.id, scope: "order, payments, messages, dispute evidence", orderedBy: compliance.id, note: "Hold pending dispute resolution + possible LR-2026-001 overlap" } })
  for (const [type, id] of [["USER", simba.id], ["USER", rufaro.id], ["SELLER", chipo.id], ["USER", nyasha.id]] as [string, string][]) {
    await db.sanctionsScreening.create({ data: { subjectType: type, subjectId: id, result: "CLEAR", source: "INTERNAL_LIST", note: "Screened at onboarding" } })
  }
  const riskData = [
    ["Counterfeit goods sold on marketplace", "MARKETPLACE", "Listings + moderation queue + sanctions/brand-report flow; takedown < 24h SLA", 3, 4, ["TNS-004", "MKT-008", "MKT-029"]],
    ["Off-platform payment solicitation", "MARKETPLACE", "PII redaction in messages + buyer education + enforcement ladder", 4, 3, ["MSG-012", "TNS-009", "MKT-015"]],
    ["PSP licence not yet secured (sandbox payments)", "FINANCIAL", "Mock adapter isolates real money; launch gated on PSP contract (RSK-EX-002)", 2, 5, ["COM-007", "COM-017"]],
    ["No independent penetration test yet", "SECURITY", "Dependency scan + lint gate + security logging; test scheduled (RSK-EX-001)", 3, 4, ["SEC-021", "SEC-012"]],
    ["Data protection registration pending", "LEGAL", "Application filed; compliance officer tracks expiry (Licence register)", 2, 4, ["GOV-002"]],
    ["Single-node deployment dependency", "OPERATIONAL", "Daily backups + restore tests + documented RTO/RTO targets; migration runbook", 2, 4, ["BCP-004", "BCP-005", "INF-005"]],
  ]
  for (const [title, cat, description, l, i, controls] of riskData as any[]) {
    await db.riskItem.create({ data: { title, category: cat, description, likelihood: l, impact: i, controlsMapped: JSON.stringify(controls), status: "OPEN", owner: "Risk Owner", reviewAt: IN_FUTURE(30 * 24 * H) } })
  }
  await db.riskException.create({ data: { exceptionId: "RSK-EX-001", controls: JSON.stringify(["SEC-021"]), reason: "No external penetration test vendor engaged in sandbox phase", riskStatement: "Unfound vulnerabilities may exist in deployed surface", criticality: "C3", compensating: JSON.stringify(["SEC-009 dependency scanning", "SEC-010 SAST-equivalent lint gate", "SEC-017 security logging", "SEC-024 secure configuration checklist"]), owner: "Security", approver: "Compliance", expiry: IN_FUTURE(90 * 24 * H), monitoring: "Re-test before public launch; weekly security-log review", status: "ACTIVE" } })
  await db.riskException.create({ data: { exceptionId: "RSK-EX-002", controls: JSON.stringify(["COM-007", "COM-008", "COM-017", "COM-023", "FIN-010"]), reason: "Production PSP not yet contracted (sandbox mock adapter)", riskStatement: "Real money movement impossible in sandbox; production launch must contract licensed ZW PSP", criticality: "C3", compensating: JSON.stringify["Mock adapter mirrors full authorize/capture/refund/reverse lifecycle", "Ledger reconciliation against mock transactions", "PSP cutover runbook"], owner: "Commerce Lead", approver: "Compliance", expiry: IN_FUTURE(120 * 24 * H), monitoring: "Launch gate: no public launch without PSP contract", status: "ACTIVE" } })
  await db.internalAudit.create({ data: { scope: "M1/M2 control spot-check (auth, audit log, refund dual-approval, backup)", performedBy: "Compliance", findings: JSON.stringify([{ controlId: "CTL-021", code: "F-EVD", note: "Dual approval verified on seeded refund request" }]) } })
  await db.partner.create({ data: { name: "ZIMPOST", kind: "LOGISTICS", contact: "partners@zimpost.co.zw", contractRef: "logistics-2026-q4" } })
  await db.partner.create({ data: { name: "Mock PSP (sandbox)", kind: "PAYMENT", contact: "sandbox@psp.mock", contractRef: "sandbox-only", notes: "Replaced by licensed PSP at launch (RSK-EX-002)" } })

  // ── Ops: metrics, incidents, status, BCP ───────────────────────
  const base = { gmv: 940, orders: 2, users: 10, newUsers: 1, activeListings: 24, bids: 3, disputes: 0, tickets: 1, availabilityPct: 99.9, latencyP95Ms: 180, errorRate: 0.2 }
  for (let d = 13; d >= 0; d--) {
    const date = new Date(Date.now() - d * 24 * H).toISOString().slice(0, 10)
    const jitter = (k: number, m: number) => Math.round((k * m) * (0.8 + 0.4 * Math.random()))
    await db.metricDaily.create({
      data: {
        date, gmv: jitter(base.gmv, 1 + (13 - d) / 20), orders: jitter(base.orders, 1 + (13 - d) / 18),
        users: 10, newUsers: jitter(1, 1.4), activeListings: 22 + jitter(4, 1), bids: jitter(3, 1.5),
        disputes: d % 9 === 0 ? 1 : 0, tickets: jitter(1, 1.2), availabilityPct: 99.7 + Math.random() * 0.3,
        latencyP95Ms: 150 + jitter(60, 1), errorRate: Math.round((0.1 + Math.random() * 0.4) * 100) / 100,
      },
    }).catch(() => undefined)
  }
  const inc = await db.incident.create({
    data: {
      ref: "INC-001", severity: "SEV3", status: "RESOLVED", commander: "Admin",
      title: "Search latency spike after index rebuild", summary: "Category chips query missing index caused 900ms p95.",
      impact: "Slow browsing for ~40 min; no data loss.", startedAt: D(20 * 24 * H), detectedAt: D(20 * 24 * H),
      mitigatedAt: D(20 * 24 * H + 25 * 60000), resolvedAt: D(20 * 24 * H + 40 * 60000),
      postmortemRef: "PM-001", notifications: JSON.stringify([{ channel: "status-page", when: D(20 * 24 * H).toISOString() }]),
    },
  })
  await db.statusEvent.create({ data: { component: "core", status: "OPERATIONAL", message: "All systems operational" } })
  await db.statusEvent.create({ data: { component: "core", status: "DEGRADED", message: "Search latency elevated", startedAt: D(20 * 24 * H), endedAt: D(20 * 24 * H + 40 * 60000) } })
  const bcp = (scenario: string, rpo: number | null, rto: number | null, steps: string[], lastEx: number | null = null) =>
    db.bcpPlan.create({ data: { scenario, rpoMinutes: rpo, rtoMinutes: rto, owner: "SRE", steps: JSON.stringify(steps), lastExerciseAt: lastEx ? D(lastEx * 24 * H) : null } })
  await bcp("RPO_RTO", 1440, 240, ["RPO 24h via daily scheduled backups", "RTO 4h via single-node rebuild runbook"], 3)
  await bcp("REGION_FAILURE", null, null, ["Single-node: restore on alternate host from latest backup (db/backups/*)", "DNS repoint procedure documented"], null)
  await bcp("CREDENTIAL_COMPROMISE", 0, 60, ["Rotate NEXTAUTH_SECRET", "Revoke API keys (admin)", "Invalidate sessions (SessionRecord revoke-all)", "Force password reset for affected users"], null)
  await bcp("PROVIDER_OUTAGE", null, 120, ["Mock PSP: feature flag payments.off stops checkout gracefully", "Real PSP: status event + customer notification template ready"], null)
  await bcp("ALTERNATE_COMMS", null, null, ["Status page is separate view; email queue retries with backoff", "Support reachable via support@tengasell.co.zw"], null)
  await bcp("EMERGENCY_ACCESS", 0, 15, ["Break-glass request via admin console (approval + audit)", "Expires automatically; post-incident review mandatory"], null)
  await db.releaseRecord.create({
    data: {
      version: "2026.10.0", notes: "Post-reset rebuild: marketplace GA + MSCS 1.0 registry + full control plane",
      artifacts: JSON.stringify(["Next.js 16.1 (App Router)", "Prisma 6 / SQLite", "shadcn-ui"]),
      sbom: JSON.stringify([{ name: "next", version: "16.1.1" }, { name: "prisma", version: "6.11.1" }, { name: "next-auth", version: "4.24.11" }, { name: "zod", version: "4.0.2" }, { name: "zustand", version: "5.0.6" }]),
      approvedBy: admin.id,
    },
  })

  // ── Feature flags, config, reason codes ───────────────────────
  const flag = (key: string, description: string, enabled: boolean) => db.featureFlag.create({ data: { key, description, enabled, updatedBy: "admin@tengasell.co.zw" } })
  await flag("auctions.enabled", "Master switch for auction bidding", true)
  await flag("buy_now.enabled", "Buy-now checkout", true)
  await flag("payments.maintenance", "Emergency: pause checkout (shows maintenance notice)", false)
  await flag("new_buyer_fee", "Buyer fee (launch special: off)", false)
  await flag("marketing.campaigns", "Campaign dispatching", true)
  const cfg = (key: string, value: any, description: string, approval = false) => db.configSetting.create({ data: { key, value: JSON.stringify(value), description, requiresApproval: approval, updatedBy: admin.id } })
  await cfg("vat_rate", 15, "VAT % applied at checkout (ZW)", true)
  await cfg("seller_fee_pct", 5, "Seller commission %", true)
  await cfg("buyer_fee_pct", 0, "Buyer fee % (launch: 0)")
  await cfg("bid_increment", 1, "Minimum bid increment USD")
  await cfg("payout_hold_hours", 72, "Payout hold after delivery confirmation")
  await cfg("auto_approve_categories", [], "Categories with auto-approve for listings")
  const rc = (key: string, label: string, labelJa: string, category: string) => db.reasonCode.create({ data: { key, label, labelJa, category } })
  rc("seller.education", "Seller education (no sanction)", "出品者教育（制裁なし）", "TNS")
  rc("prohibited_goods", "Prohibited goods", "禁止商品", "TNS")
  rc("counterfeit", "Counterfeit / IP", "偽造品・知的財産", "TNS")
  rc("off_platform", "Off-platform payment solicitation", "プラットフォーム外取引の勧誘", "TNS")
  rc("buyer_rematch", "Buyer rematched after seller cancel", "出品者キャンセル後の再マッチ", "CTL")
  rc("duplicate_listing", "Duplicate listing", "重複出品", "MKT")

  // ── Support tickets ────────────────────────────────────────────
  const t1 = await db.ticket.create({ data: { userId: nyasha.id, subject: "Espresso machine dispute — refund?", category: "ORDER", status: "IN_PROGRESS", priority: "HIGH", assignedTo: support.id, slaDueAt: IN_FUTURE(12 * H), identityVerified: true } })
  await db.ticketMessage.create({ data: { ticketId: t1.id, role: "USER", body: "The machine leaks water. I opened a dispute — how fast can I get a refund?" } })
  await db.ticketMessage.create({ data: { ticketId: t1.id, authorId: support.id, role: "SUPPORT", body: "Dispute received. Mediation typically resolves within 24h; refund routes through the dispute outcome." } })
  await db.ticketMessage.create({ data: { ticketId: t1.id, authorId: support.id, role: "SUPPORT", internal: true, body: "Internal: listing photos look fine but seller note omits leak — lean buyer-side on evidence." } })
  const t2 = await db.ticket.create({ data: { userId: simba.id, subject: "Payout timing after Bulawayo sale", category: "PAYOUT", status: "CLOSED", priority: "NORMAL", assignedTo: support.id, slaDueAt: D(-5 * 24 * H), firstResponseAt: D(-5 * 24 * H + 3600_000), resolvedAt: D(-4 * 24 * H), satisfaction: 5 } })
  await db.ticketMessage.create({ data: { ticketId: t2.id, role: "USER", body: "When do payouts batch?" } })
  await db.ticketMessage.create({ data: { ticketId: t2.id, authorId: support.id, role: "SUPPORT", body: "Twice weekly (Tue/Fri) after the 72h hold. Check Finance console for your balance." } })

  // ── Approval request demo (refund dual approval) ───────────────
  const ap1 = await db.approvalRequest.create({ data: { type: "REFUND", payload: JSON.stringify({ orderId: o2.id, refundId: "see-refund-below", amount: 100, type: "FULL", reason: "ITEM_NOT_AS_DESCRIBED (dispute upheld draft)" }), requestedBy: support.id, status: "PENDING" } })
  await db.refund.create({ data: { orderId: o2.id, amount: 100, type: "FULL", reason: "ITEM_NOT_AS_DESCRIBED", status: "REQUESTED", requestedBy: support.id } })

  // ── Webhooks (developer demo) ──────────────────────────────────
  const wh = await db.webhookEndpoint.create({ data: { userId: simba.id, url: "https://example.mock/hook", secret: "whsec_demo", events: JSON.stringify(["bid.placed", "order.paid"]) } })
  await db.webhookDelivery.create({ data: { endpointId: wh.id, event: "bid.placed", payload: JSON.stringify({ listingId: listings.a6000, amount: 655 }), status: "PENDING", nextRetryAt: IN_FUTURE(60000) } })
  await db.webhookDelivery.create({ data: { endpointId: wh.id, event: "order.paid", payload: JSON.stringify({ orderId: o1.id }), status: "DELIVERED", attempts: 1, responseCode: 200, lastAttemptAt: D(10 * 24 * H) } })

  // ── MSCS evidence anchors (static E1/E4 records) ──────────────
  await db.mscsEvidence.create({ data: { evidenceClass: "E1", description: "Prisma schema (37-domain data model) + API routes tree", source: "prisma/schema.prisma; src/app/api/**", authority: "post-reset rebuild", observed: "Single authoritative SQLite schema with FK integrity", expected: "Authoritative data model per DAT-001/002", capturedBy: "orchestrator" } })
  await db.mscsEvidence.create({ data: { evidenceClass: "E4", description: "Backup & restore runbook + scheduled backup job", source: "scheduler.ts runBackup; runbook-restore article", authority: "sandbox", observed: "Daily backup to db/backups with checksum; restore test procedure defined", expected: "BCP-004/005 operational evidence", capturedBy: "orchestrator" } })

  console.log("Seed complete:", {
    users: await db.user.count(), listings: await db.listing.count(), orders: await db.order.count(),
    articles: await db.article.count(), policies: await db.policy.count(), mscs: await db.mscsControl.count(),
  })
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => db.$disconnect())
