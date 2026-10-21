// seed.ts — idempotent demo/production seed for govern-service.
//
// Seeds: policy v1.0 catalogue (published, bilingual), demo acceptances, the
// data register (every TrailBase table + service DB, DAT-001..009), the 6-row
// processor register, corporate/regulatory registers with REAL Zimbabwe
// references (CDPA Ch 12:07 / POTRAZ, VAT Ch 23:12 / ZIMRA, Consumer
// Protection Ch 14:44, Companies Act Ch 24:31), strategy records, 6 risks
// mapped to real MSCS control IDs, the pen-test risk exception (SEC-021),
// the 11-b dev-server outage as a CLOSED incident with timeline + RCA, ADRs
// + decision records, threat model, security review, training and the
// compliance calendar — then imports all 609 MSCS controls from the
// worksheet JSON (idempotent upsert by id).
//
// HONESTY LAW: every "pending"/"action required" status reflects the true
// corporate state of the project at seed time. 12-f updates statuses later.

import { readFileSync } from "node:fs";
import { get, insert, run, scalar } from "./db";
import { ALL_POLICIES, POLICY_VERSION, POLICY_EFFECTIVE_FROM } from "./policies";
import { WORKSHEET_PATH } from "./config";

export interface SeedSummary {
  policies: number;
  acceptances: number;
  dataRegister: number;
  processors: number;
  registerEntries: number;
  strategy: number;
  risks: number;
  exceptions: number;
  incidents: number;
  decisions: number;
  threatModel: number;
  securityReviews: number;
  training: number;
  calendar: number;
  controls: number;
}

function seedPolicies(): number {
  for (const p of ALL_POLICIES) {
    const existing = get(`SELECT id FROM policies WHERE key = ?`, [p.key]);
    if (!existing) {
      insert(
        `INSERT INTO policies(key, title, title_ja, status, current_version, owner, updated_at)
         VALUES(?,?,?,?,?,?,datetime('now'))`,
        [p.key, p.title, p.titleJa, "published", POLICY_VERSION, p.owner],
      );
    }
    for (const locale of ["en", "ja"] as const) {
      const body = locale === "en" ? p.en : p.ja;
      run(
        `INSERT OR IGNORE INTO policy_versions(policy_key, version, locale, body, effective_from, published_at, published_by, change_note, created_by)
         VALUES(?,?,?,?,?,datetime('now'),'seed:compliance',?,'seed')`,
        [p.key, POLICY_VERSION, locale, body, POLICY_EFFECTIVE_FROM, p.changeNote],
      );
    }
  }
  return scalar(`SELECT COUNT(*) FROM policy_versions`);
}

function seedAcceptances(): number {
  if (scalar(`SELECT COUNT(*) FROM policy_acceptances`) > 0) return 0;
  // Demo users accepted ToS + Privacy at "signup"; rufaro also accepted the
  // full set from the policy page. (12-e/12-c wire the live signup/sell calls.)
  const rows: [string, number, string, string][] = [
    ["tos", 1, "rufaro", "signup"],
    ["privacy", 1, "rufaro", "signup"],
    ["tos", 1, "simba", "signup"],
    ["privacy", 1, "simba", "signup"],
    ["tos", 1, "blessing", "signup"],
    ["privacy", 1, "blessing", "signup"],
    ["tos", 1, "tendai", "signup"],
    ["privacy", 1, "tendai", "signup"],
    ["rules", 1, "rufaro", "policy_page"],
    ["seller", 1, "rufaro", "sell"],
    ["aup", 1, "rufaro", "policy_page"],
    ["refunds", 1, "rufaro", "policy_page"],
  ];
  for (const [key, ver, user, surface] of rows) {
    insert(
      `INSERT INTO policy_acceptances(policy_key, version, username, surface, accepted_at)
       VALUES(?,?,?,?, datetime('now', '-2 days'))`,
      [key, ver, user, surface],
    );
  }
  return scalar(`SELECT COUNT(*) FROM policy_acceptances`);
}

function seedDataRegister(): number {
  if (scalar(`SELECT COUNT(*) FROM data_register`) > 0) return 0;
  const rows: [string, string, string, string, string, string, string, string, number | null, string][] = [
    // [asset, store, category, purpose, legal_basis, owner, retention, retention_days, notes]
    ["User auth accounts", "trailbase: users (auth)", "pii", "Account login, identity, session tokens", "Contract + legal obligation", "platform", "Account lifetime; deleted on account deletion request", null, "Passwords stored as verifiable hashes by TrailBase auth; admin flag role-gated"],
    ["Public profiles", "trailbase: profiles", "public", "Marketplace identity, ratings, display", "Contract", "marketplace", "Until account deletion", null, "User-editable; correction is self-service"],
    ["Auction listings", "trailbase: auctions", "public", "Listing display, search, category rails", "Contract", "marketplace", "7 years after close (dispute/tax evidence)", 2555, "Seller-owned content; licence in Seller Agreement §7"],
    ["Bids (incl. proxy maxima)", "trailbase: bids", "internal", "Auction execution, proxy bidding, integrity audit", "Contract", "platform", "7 years (auction integrity evidence)", 2555, "Proxy-bid maximums never disclosed to other users"],
    ["Watchlists", "trailbase: watchlist", "pii", "User saved-item tracking", "Contract", "platform", "Until account deletion", null, "Private to the user"],
    ["Listing Q&A", "trailbase: questions", "public", "Public question/answer on listings", "Contract", "marketplace", "3 years", 1095, "Public content; moderation applies"],
    ["Buyer-seller threads & messages", "trailbase: threads, messages", "internal", "Mediated user-to-user communication", "Contract", "trust", "3 years after thread closure", 1095, "Contact details auto-masked by comms moderation; PII minimisation enforced"],
    ["Orders", "trailbase: orders", "financial", "Order lifecycle, SLA clocks, dispute windows", "Contract + legal obligation", "trade/finance", "7 years (tax law)", 2555, "Escrow release state machine lives here"],
    ["Payments", "trailbase: payments", "financial", "Payment records, references, reconciliation", "Legal obligation (VAT Ch 23:12)", "finance", "7 years", 2555, "Reconciled against finance ledger (12-b)"],
    ["Paynow sessions", "trailbase: paynow_sessions", "financial", "Payment session initiation/poll state", "Contract", "finance", "1 year", 365, "References only; card data never touches our DB"],
    ["Ratings", "trailbase: ratings", "public", "Trust system, seller standings", "Contract", "trust", "3 years", 1095, "Fake-rating enforcement under AUP"],
    ["Notifications", "trailbase: notifications", "internal", "In-app notification delivery", "Legitimate interest", "comms", "90 days", 90, "Fan-out from trade engine + comms events"],
    ["Audit events", "trailbase: audit_events", "internal", "Privileged/material action audit trail", "Legal obligation + legitimate interest", "platform", "12 months", 365, "Written by trade engine; surfaced by admin console"],
    ["Channel links & preferences", "comms.db: channel_links, preferences", "pii", "Notification delivery targets and opt-ins", "Consent", "comms", "Until unlinked / consent withdrawn", null, "Channel verify codes are short-lived"],
    ["Comms delivery & moderation log", "comms.db: outbound_queue, relay_log, deliveries", "internal", "Delivery records, moderation evidence", "Legitimate interest", "comms", "12 months", 365, "Masked copies retained for dispute evidence"],
    ["Campaign engine data", "comms.db: campaigns, campaign_audience, templates", "internal", "Opt-in marketing engine", "Consent", "comms", "Campaign lifetime + 3 years", 1095, "Marketing is explicit opt-in only"],
    ["Suppression list", "comms.db: suppression", "pii", "Honour unsubscribes/opt-outs", "Legal obligation", "comms", "Indefinite while platform operates", null, "Kept deliberately to respect every opt-out"],
    ["Fees, ledger, payouts, VAT", "finance.db: ledger, payouts, refunds, invoices, vat", "financial", "Fees, escrow accounting, payouts, VAT output", "Legal obligation (VAT Ch 23:12)", "finance", "7 years", 2555, "Double-entry; reconciled to TrailBase order/payment ids"],
    ["Support tickets & enforcement", "trust.db: tickets, reports, enforcement, appeals", "internal", "Support, trust & safety, evidence, appeals", "Legal obligation + legitimate interest", "trust", "3 years after closure", 1095, "Evidence retention per TNS-007"],
    ["Policies & acceptances", "govern.db: policies, policy_versions, policy_acceptances", "internal", "Policy versions + acceptance proof", "Legal obligation", "compliance", "7 years", 2555, "Version history immutable; audit log in content_audit"],
    ["DSAR & privacy records", "govern.db: privacy_requests, user_flags, data_register", "pii", "Data subject request processing records", "Legal obligation (CDPA Ch 12:07)", "compliance", "3 years", 1095, "Export bundles retained for a 30-day download window"],
    ["Registers, incidents, risks", "govern.db: register_entries, incidents, risks, decisions", "internal", "Corporate governance evidence", "Legal obligation", "compliance", "7 years", 2555, "Regulator audit package source (GOV-013)"],
    ["MSCS compliance register", "govern.db: controls, evidence, findings, certifications", "internal", "609-control conformance checklist + evidence", "Legitimate interest (governance)", "compliance", "7 years", 2555, "Imported from mscs-worksheet-12.json"],
    ["Geocoding & map cache", "gis cache", "internal", "Location search/map rendering cache", "Legitimate interest", "platform", "90 days", 90, "No account data stored"],
    ["Web session storage", "browser localStorage (token, locale, theme, cookie notice)", "pii", "Session, preferences, cookie-notice state", "Contract (strictly necessary)", "platform", "Session / until cleared by user", null, "Notice links Privacy Policy; no tracking cookies"],
    ["Service logs", "dev-*.log / service stdout", "internal", "Operational logging, incident forensics", "Legitimate interest", "platform", "14 days (ops rotation)", 14, "IP addresses may appear in access logs"],
  ];
  for (const r of rows) {
    insert(
      `INSERT INTO data_register(asset, store, category, purpose, legal_basis, owner, retention, retention_days, notes)
       VALUES(?,?,?,?,?,?,?,?,?)`,
      r,
    );
  }
  return scalar(`SELECT COUNT(*) FROM data_register`);
}

function seedProcessors(): number {
  const rows: [string, string, string, string, string, string, string, string][] = [
    // [name, role, location, data_categories, transfer_basis, risk_notes, contract_status, review_due]
    ["Paynow (Paynow Zimbabwe)", "Payment aggregation (card, EcoCash, InnBucks, bank)", "Harare, Zimbabwe", "Payment amounts, order references, payer phone (for EcoCash)", "Domestic processing — no cross-border transfer", "Payment fraud/chargebacks; screened transactions; no card data stored by Tengasell", "active", "2027-01-31"],
    ["Resend", "Transactional email delivery", "United States / EU", "Email address, notification subject/body", "Consent (user-linked email channel) + contractual confidentiality", "Email metadata exposure; SPF/DKIM configured", "active", "2027-01-31"],
    ["Telegram (Telegram FZ-LLC)", "Channel delivery (bot API)", "UAE / distributed", "Telegram chat ID/handle, message content", "Consent (user explicitly links channel)", "Provider jurisdiction transparency; users advised in privacy policy", "active", "2027-01-31"],
    ["WhatsApp Business (Meta)", "Channel delivery (Cloud API)", "United States (Meta)", "WhatsApp number, message content", "Consent (user explicitly links channel)", "Meta data-processing practices; users advised in privacy policy", "active", "2027-01-31"],
    ["OpenStreetMap Foundation", "Map tile rendering on item pages", "United Kingdom / EU", "IP address in tile requests (no account data)", "Legitimate interest (map display)", "Minimal — tile requests carry no account identifiers", "active", "2027-04-30"],
    ["z-ai model API (Z.ai)", "AI assistant inference (read-only marketplace helper)", "Outside Zimbabwe (model inference)", "Assistant questions, listing context passed read-only", "Legitimate interest + user-facing assistant disclosure", "Prompt content processed by provider; assistant is read-only and rate-limited; no PII beyond question text", "active", "2027-01-31"],
  ];
  let n = 0;
  for (const r of rows) {
    const before = scalar(`SELECT COUNT(*) FROM processors`);
    run(`INSERT OR IGNORE INTO processors(name, role, location, data_categories, transfer_basis, risk_notes, contract_status, review_due) VALUES(?,?,?,?,?,?,?,?)`, r);
    if (scalar(`SELECT COUNT(*) FROM processors`) > before) n++;
  }
  return n;
}

function seedRegisterEntries(): number {
  if (scalar(`SELECT COUNT(*) FROM register_entries`) > 0) return 0;
  const rows: [string, string, string, string, string, string, string | null, string | null][] = [
    // [register, key, title, body, status, owner, due_date, meta_json]
    ["entity", "tengasell-pvt-ltd", "Tengasell (Private) Limited",
      "Proposed incorporated entity under the Companies and Other Business Entities Act [Chapter 24:31] (registration with the Companies Office — Deeds, Companies and Intellectual Property — in progress). Until incorporation completes, the founder is personally accountable for the platform. Target completion before public launch.",
      "registration_pending", "ceo", "2026-11-30", `{"act":"Companies and Other Business Entities Act [Chapter 24:31]","companyOffice":"DCIP (Zimbabwe)"}`],
    ["ownership", "shareholding", "Ownership register",
      "Pre-incorporation: founder 100% (sole member). Shareholding, share classes and any allocations to be formalised in the company register immediately after incorporation; this entry will be updated with registration numbers and shareholding percentages.",
      "pending_incorporation", "ceo", null, null],
    ["directors", "directors-register", "Director register",
      "Post-incorporation director register (names, appointment dates, residential addresses as filed with DCIP). Founder currently acts as CEO of the pre-incorporation project; first directors to be recorded at incorporation.",
      "pending_incorporation", "ceo", null, null],
    ["corporate_policies", "policy-set-v1", "Platform policy set v1.0 (adopted)",
      "Adopted 2026-10-20: Terms of Service, Privacy Policy, Marketplace Rules, Seller Agreement, Acceptable Use Policy, Refund Policy, IP & Copyright Policy, Accessibility Statement. All versioned in the policy CMS with editorial workflow and acceptance records; compliance owns the set; annual review due 2027-10-20.",
      "active", "compliance", "2027-10-20", `{"policies":8,"version":"1.0"}`],
    ["delegated_authority", "authority-matrix", "Delegated authority matrix",
      "Refunds ≤ US$500: support role. Refunds > US$500: admin approval. Payouts > US$100: dual finance approval. Payout approval and payout execution must be different people. Policy publish authority is separated from policy authoring (compliance role publishes; authors cannot). Legal holds: legal/admin only. Account suspension: trust role. All privileged actions are audit-logged.",
      "active", "ceo", null, null],
    ["contracts", "processor-contracts", "Processor & vendor contracts register",
      "Paynow integration terms; Resend terms of service; Telegram/Meta (WhatsApp, Messenger) platform terms; OpenStreetMap tile usage policy; AI model API terms. Data-protection terms asserted where the provider offers them; DPAs to be countersigned post-incorporation.",
      "active", "legal", "2026-12-15", null],
    ["employees", "employee-lifecycle", "Employee lifecycle records",
      "Onboarding/offboarding checklists per role: access provisioning (role-based), device hygiene, security + CDPA training, exit revocation. Pre-launch team operates under the contractor register until incorporation; employee records begin at first hire.",
      "pending_first_hire", "ceo", null, null],
    ["contractors", "contractor-register", "Contractor register",
      "Platform build team (waves 11-12) engaged under confidentiality and IP-assignment terms. Each contractor row records scope, access level and offboarding; repository access is role-scoped and revoked on exit.",
      "active", "ceo", null, null],
    ["assets", "platform-assets", "Platform asset register",
      "Source repository + git history; SQLite database volumes (trailbase, comms, finance, trust, govern); domain accounts; admin credentials (secret manager, never in repo); sandbox host. Asset owner and backup/restoration reference recorded per asset (DAT-012/013).",
      "active", "platform", null, null],
    ["licenses", "business-licence", "Business/trading licence (Harare)",
      "Harare municipal trading licence for e-commerce operations; application follows incorporation. Display of licence details on the site (about/help) once issued.",
      "action_required", "ceo", "2026-12-31", null],
    ["licenses", "potraz-controller", "POTRAZ data controller registration",
      "Registration as a data controller with POTRAZ under the Cyber and Data Protection Act [Chapter 12:07] s.17. REQUIRED BEFORE PUBLIC LAUNCH. Application in preparation: RoPA (data register), privacy policy v1.0, processor register and breach workflow all exist to support the filing.",
      "action_required", "compliance", "2026-11-15", `{"act":"Cyber and Data Protection Act [Chapter 12:07]","authority":"POTRAZ"}`],
    ["licenses", "vat-registration", "ZIMRA VAT registration",
      "Value Added Tax Act [Chapter 23:12] — VAT registration for commission (platform fee) revenue. Finance ledger (12-b) tracks VAT output on platform fees (15%, configurable). Registration triggered at legal threshold; filing calendar tracked in the compliance calendar.",
      "in_progress", "finance", null, `{"act":"Value Added Tax Act [Chapter 23:12]","authority":"ZIMRA"}`],
    ["domains", "tengasell-com", "tengasell.com",
      "Primary brand domain. WHOIS/registrant details to be verified against the corporate entity at incorporation (currently held by the founder pending transfer to Tengasell Pvt Ltd). Renewal date and registrar recorded here once transferred.",
      "verification_pending", "platform", "2026-11-30", `{"registrar":"to verify","ssl":"issued"}`],
    ["domains", "subdomain-accounts", "Platform subdomains & service hostnames",
      "Sandbox/preview hostnames for the Next app, gateway and API endpoints. Production hostnames to be attached to tengasell.com at launch; no third-party-hosted user content subdomains at M2.",
      "active", "platform", null, null],
    ["insurance", "liability-cover", "Cyber liability & general liability insurance",
      "Quotes in progress for cyber liability (breach response, notification costs) and general liability cover; expiry tracking lives in this register once bound. Binding cover is a launch-gate item.",
      "pending_quote", "ceo", "2026-11-30", null],
    ["procurement", "procurement-records", "Procurement records",
      "Hosting vendor selection (single-host self-managed at M2), pen-test vendor shortlist (see risk exception RSK-EX-001), insurance brokers. Quotes and decisions recorded; competitive quotes required above US$500.",
      "active", "ceo", null, null],
    ["vendors", "payout-banking", "Payout banking partner",
      "Business bank account (plus mobile money float) for seller payouts — to be opened immediately after incorporation; payout method references recorded per payout in the finance ledger. Interim: manual transfers recorded with method + reference + actor.",
      "pending_incorporation", "finance", null, null],
    ["vendors", "vendor-register", "Vendor register",
      "All vendors (hosting, domains, email, messaging, payments, AI) mirrored from the processor register with risk fields (PRT-009, RSK-008). Review due dates drive the compliance calendar.",
      "active", "compliance", null, null],
    ["approvals", "launch-gate", "Launch approval gate",
      "Public launch requires ALL of: M2 certification report ≥90% weighted with all applicable C3/C4 controls evidenced (12-f); POTRAZ data controller registration filed; incorporation complete; insurance bound; payout banking operational. Recorded as a single approval decision when granted.",
      "pending", "ceo", null, `{"gates":["m2_certification","potraz_registration","incorporation","insurance","banking"]}`],
    ["approvals", "release-approvals", "Release approvals log",
      "Every release to the platform is recorded as a decision-log entry (ADR/DEC) or changelog record (ENG-018/020); hotfixes are logged post-hoc with the responding operator.",
      "active", "platform", null, null],
    ["integrations", "service-mesh", "Internal service mesh",
      "TrailBase :3001 (records+auth, admin token), trade-engine :3002 (socket.io RPC), GIS :3004, comms :3005 (TUCS), finance :3006, trust :3007, govern :3008. All localhost-mesh with BFF-proxied browser access; service identities documented (IAM-011); watchdog auto-restart.",
      "active", "platform", null, `{"services":7}`],
    ["integrations", "external-integrations", "External integrations",
      "Paynow API (payments), Resend API (email), Telegram Bot API, WhatsApp Cloud API, OpenStreetMap tiles, z-ai SDK (AI assistant). Each row: owner, credential location, health check, version; recorded for INT-001/014.",
      "active", "platform", null, `{"integrations":6}`],
    ["regulatory", "regulatory-assessment", "Regulatory applicability assessment",
      "Assessed for the Zimbabwe market: (1) Cyber and Data Protection Act [Chapter 12:07] — data controller registration with POTRAZ, data subject rights (DSAR), breach notification, processor register; (2) Value Added Tax Act [Chapter 23:12] — VAT on commission revenue, record keeping 7y; (3) Consumer Protection Act [Chapter 14:44] — buyer rights, refund obligations; (4) Companies and Other Business Entities Act [Chapter 24:31] — incorporation, registers; (5) National payment system rules via Paynow aggregation. Japan: localization-only market at M2 (no entity, no local processing duty).",
      "active", "compliance", null, `{"laws":["CDPA [Ch 12:07]","VAT [Ch 23:12]","Consumer Protection [Ch 14:44]","Companies [Ch 24:31]"]}`],
    ["regulatory", "consumer-protection", "Consumer Protection Act conformance",
      "Consumer Protection Act [Chapter 14:44]: buyer rights to return defective goods honored via the 7-day dispute window; refund policy v1.0 mirrors engine behavior exactly (48h payment, 3-day dispatch, 7-day dispute, 5-business-day refund processing); dispute evidence retained; no unfair-contract terms in ToS.",
      "active", "compliance", null, null],
    ["notices", "platform-notices", "Platform notices register",
      "(1) Cookie/localStorage notice — dismissable, links Privacy Policy (PRV-013); (2) signup policy acceptance — ToS + Privacy accepted at registration (recorded with version + timestamp); (3) breach notification commitment — Privacy Policy §9 (POTRAZ + affected users); (4) marketplace rules notice on sell/bid surfaces.",
      "active", "compliance", null, null],
  ];
  for (const r of rows) {
    insert(
      `INSERT INTO register_entries(register, key, title, body, status, owner, due_date, meta_json)
       VALUES(?,?,?,?,?,?,?,?)`,
      r,
    );
  }
  return scalar(`SELECT COUNT(*) FROM register_entries`);
}

function seedStrategy(): number {
  if (scalar(`SELECT COUNT(*) FROM strategy`) > 0) return 0;
  const rows: [string, string, string, string][] = [
    ["mission", "Product mission", "To give every Zimbabwean a trusted, joyful way to buy and sell at auction — \u201ca snap to your happy deal\u201d — with escrow-protected payments, fair rules and transparent fees.", "ceo"],
    ["personas", "Target users", "BUYER: urban bargain hunter, mobile-first, pays with EcoCash/Paynow, wants escrow protection and clear SLAs. SELLER: individual/prosumer (electronics, solar, fashion, collectibles) who wants simple fees (8% capped $50), fast payouts and moderation that removes scam competitors. OPERATORS: admin/support/moderation/finance/compliance roles with separated privileges.", "product"],
    ["business_model", "Business model", "C2C auction + buy-now marketplace; buyers pay the full order amount into platform escrow; sellers dispatch under SLA; escrow releases after delivery + 7-day dispute window. Revenue is seller-side; USD settlement throughout.", "ceo"],
    ["revenue_model", "Revenue model", "Final-value fee: 8% of item price, capped at US$50 per order. Featured listing fee: US$2 (optional). No buyer fees, no listing fees. VAT 15% applied on platform-fee revenue (VAT Act [Ch 23:12]), tracked in the finance VAT ledger.", "finance"],
    ["positioning", "Market positioning", "The trusted local auction floor for Zimbabwe — Yahoo-Auctions-style experience with escrow, SLAs and human moderation, versus the scam risk of raw classifieds. Brand: teal/gold 'Tengasell — a snap to your happy deal'.", "product"],
    ["roadmap", "Product roadmap", "M2 launch: finance rails (12-b), trust & support (12-c), governance/privacy/compliance (12-d), platform hardening + admin consoles (12-e), M2 certification + UAT (12-f). Post-launch: external penetration test, POTRAZ registration completion, incorporation + banking, Japan-market growth, payout automation, mobile app evaluation.", "ceo"],
    ["kpis", "Key performance indicators", "GMV; successful trade rate; dispute rate <2%; ≥95% refunds processed within 5 business days; payout SLA compliance; DAU; listings/day; sell-through rate; policy-acceptance coverage.", "product"],
    ["market_entry", "Regulatory market-entry assessment (Zimbabwe + Japan)", "ZIMBABWE: Cyber and Data Protection Act [Chapter 12:07] — POTRAZ data-controller registration before launch, DSAR duties (30-day response), breach notification, processor register; VAT Act [Chapter 23:12] — VAT on commission revenue, 7-year records; Consumer Protection Act [Chapter 14:44] — buyer rights and refunds; Companies and Other Business Entities Act [Chapter 24:31] — incorporation; national payment system participation via Paynow (aggregated), A2P messaging via licensed providers. JAPAN: localization market only at M2 — full JA interface + policies, no entity presence, no local data-processing obligations asserted at this stage.", "compliance"],
  ];
  for (const [key, title, body, owner] of rows) {
    run(`INSERT OR IGNORE INTO strategy(key, title, body, owner, status) VALUES(?,?,?,?,'active')`, [key, title, body, owner]);
  }
  return scalar(`SELECT COUNT(*) FROM strategy`);
}

function seedRisks(): number {
  if (scalar(`SELECT COUNT(*) FROM risks`) > 0) return 0;
  const rows: [string, string, string, number, number, string, string, string[], string, string][] = [
    // [ref, title, category, likelihood, impact, owner, status, controls, review_due, notes]
    ["RSK-001", "Payment fraud (stolen cards, chargebacks, fake payment confirmations)", "financial", 3, 4, "finance", "mitigated",
      ["TNS-004", "TNS-005", "FIN-008", "FIN-009", "FIN-011"], "2027-01-31",
      "Escrow holding + Paynow-side verification + manual-method confirmation gate. Reconciliation ties every payment to a ledger entry (12-b)."],
    ["RSK-002", "Personal data breach (profiles, comms handles, export bundles)", "privacy", 2, 5, "compliance", "mitigated",
      ["SEC-017", "SEC-020", "PRV-016", "DAT-016", "DAT-020"], "2027-01-31",
      "Breach workflow with POTRAZ notification path (CDPA); export bundles access-controlled and logged; contact masking in messages; training done."],
    ["RSK-003", "Extended power/connectivity outage (ZESA load-shedding hitting hosts/ops)", "operational", 4, 3, "platform", "mitigated",
      ["BCP-004", "BCP-006", "BCP-013", "INF-014"], "2027-02-28",
      "Single-host with backups + restore tests (12-e ops); WAL SQLite survives unclean shutdown; watchdogs auto-restart services; runbook documents manual restoration."],
    ["RSK-004", "Critical provider outage (Paynow / messaging provider)", "third_party", 3, 3, "platform", "mitigated",
      ["BCP-009", "BCP-010", "FIN-009", "INT-001"], "2027-01-31",
      "Manual payment methods (ZIPIT/COD) remain available; comms fan-out degrades gracefully (mock mode keeps the demo alive); provider status monitored via health surfaces."],
    ["RSK-005", "Listing fraud / counterfeit & prohibited goods", "trust", 3, 4, "trust", "mitigated",
      ["TNS-004", "TNS-006", "TNS-010", "LEG-010", "LEG-007"], "2026-12-31",
      "Prohibited-goods screening at listing completion (12-c), report button on every item, IP takedown process, repeat-infringer suspension."],
    ["RSK-006", "Regulatory non-filing (POTRAZ registration, VAT returns, company filings)", "regulatory", 2, 4, "compliance", "open",
      ["GOV-001", "GOV-002", "GOV-006", "FIN-012"], "2026-11-15",
      "Compliance calendar tracks every deadline with status; POTRAZ registration is a hard launch gate (see approvals register). Open until registration is filed."],
  ];
  for (const [ref, title, category, l, i, owner, status, controls, reviewDue, notes] of rows) {
    insert(
      `INSERT INTO risks(ref, title, category, likelihood, impact, score, owner, status, controls_json, review_due, notes)
       VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
      [ref, title, category, l, i, l * i, owner, status, JSON.stringify(controls), reviewDue, notes],
    );
  }
  return scalar(`SELECT COUNT(*) FROM risks`);
}

function seedRiskExceptions(): number {
  if (scalar(`SELECT COUNT(*) FROM risk_exceptions`) > 0) return 0;
  insert(
    `INSERT INTO risk_exceptions(ref, affected_controls_json, reason, risk_statement, criticality, compensating_controls, owner, approved_by, expires_at, status)
     VALUES(?,?,?,?,?,?,?,?,?, 'active')`,
    [
      "RSK-EX-001",
      JSON.stringify(["SEC-021"]),
      "Independent penetration testing is deferred to within 90 days of public launch (vendor procurement + budget window; pre-launch the platform has no public production traffic).",
      "Until the first external penetration test, exploitable vulnerabilities may exist that internal review has not found.",
      "medium",
      "Internal security review completed for this build (SEC-022); admin MFA; TLS everywhere; escrow controls on all money movement; audit logging of privileged actions; dependency scanning; scheduled review of the exception.",
      "platform",
      "ceo",
      "2027-01-20",
    ],
  );
  return 1;
}

function seedIncidents(): number {
  if (scalar(`SELECT COUNT(*) FROM incidents`) > 0) return 0;
  const timeline = [
    { ts: "2026-10-19T14:02:00Z", event: "Sandbox process reaper terminated the Next.js dev server (its parent agent shell had exited) — the app went down behind the gateway." },
    { ts: "2026-10-19T14:03:00Z", event: "Gateway :81 began returning 502s; mini-services (TrailBase, engine, comms) stayed healthy — blast radius limited to the web app." },
    { ts: "2026-10-19T14:05:00Z", event: "On-call check: service watchdogs were restoring mini-services correctly, but the dev server is platform-managed and outside watchdog control; ops paged." },
    { ts: "2026-10-19T14:11:00Z", event: "Dev server restarted with the orphaned Bun.spawn recipe (detached, parented to init) documented in the ops runbook; /health 200." },
    { ts: "2026-10-19T14:12:00Z", event: "Gateway 200 verified end-to-end; incident closed. Root cause recorded; corrective actions assigned." },
  ];
  const corrective = [
    { id: "CA-1", what: "Any manually started dev server must use the orphaned Bun.spawn recipe (detached + unref, parented to init) — documented in the ops runbook.", owner: "platform", due: "2026-10-19", status: "done" },
    { id: "CA-2", what: "Verified mini-service watchdogs auto-restore within 60s (they did during this incident) — keep as the standard for all non-platform-managed services.", owner: "platform", due: "2026-10-19", status: "done" },
  ];
  insert(
    `INSERT INTO incidents(ref, title, severity, type, status, commander, detected_at, timeline_json, impact, rca, corrective_actions_json, regulatory_reportable, reported_at, created_at)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?, datetime('now', '-1 day'))`,
    [
      "INC-2026-001",
      "Next.js dev server reaped — site briefly unreachable",
      "S3",
      "outage",
      "closed",
      "platform-team",
      "2026-10-19T14:02:00Z",
      JSON.stringify(timeline),
      "≈10 minutes of full-site unavailability for all routes; no data loss (SQLite WAL; TrailBase and trade engine unaffected; no in-flight transactions harmed).",
      "The platform-managed dev server had been started from an agent shell; the sandbox reaps processes whose parent exits. Mini-services survived because the Next instrumentation watchdog respawns them detached. Restoration required the documented orphaned-spawn procedure. Classification: S3 (partial outage, no data impact, short duration). Not regulatory-reportable (no personal data affected).",
      JSON.stringify(corrective),
      0,
      null,
    ],
  );
  return 1;
}

function seedDecisions(): number {
  if (scalar(`SELECT COUNT(*) FROM decisions`) > 0) return 0;
  const rows: [string, string, string, string, string, string, string, string][] = [
    ["ADR-001", "TrailBase + Bun mini-services architecture", 
      "The marketplace needs auth, records, realtime bidding, comms, finance, trust and governance concerns built fast on one host, by parallel small teams.",
      "TrailBase v0.35 (Rust + SQLite) is the system of record and auth engine; Next.js 16 SPA on :3000 as the only user-visible app; socket.io trade engine :3002; one bun:sqlite mini-service per concern (:3004-:3008); ALL browser traffic through Next BFF relative routes; watchdogs keep services alive.",
      "Monolithic Next.js API with Prisma + Postgres (rejected: heavier ops, single bottleneck, slower parallel work); serverless functions (rejected: sandbox constraints, cold-start realtime).",
      "Concerns stay independently buildable and restartable; SQLite ops are simple on one host; BFF pattern enforces auth + hides ports; the cost is inter-service HTTP discipline and watchdog/spawn care.",
      "platform", "2026-09-15"],
    ["DEC-001", "Escrow payment model",
      "Classifieds-style direct P2P payments are the #1 scam vector in Zimbabwean online trade.",
      "Buyers pay the full order amount (price + shipping) into platform escrow via Paynow/manual methods; escrow releases to the seller only after delivery + a 7-day dispute window without an open dispute (or admin resolution in the seller's favour); refunds come from escrow pre-release or seller-balance clawback post-release.",
      "Direct P2P payment (rejected: no dispute leverage, no trust); immediate release on payment (rejected: removes refund path).",
      "Strong buyer trust and refund leverage; requires the finance ledger, reconciliation and payout controls (built in 12-b); fees are charged at order payment.",
      "ceo", "2026-09-20"],
    ["DEC-002", "Mock-by-default provider mode",
      "The platform must demo and develop safely without third-party credentials in the sandbox.",
      "All external providers (Paynow, Resend, Telegram, WhatsApp) run in fully functional mock mode when env credentials are absent; presence of credentials flips them to live mode; no code changes needed.",
      "Hard-coded live mode (rejected: unsafe, costs money, leaks test messages); separate demo build (rejected: drifts from production code paths).",
      "Zero-risk demos and E2E tests; production requires only env credentials; the risk is accidental demo-mode in production — mitigated by the health surfaces surfacing provider mode labels.",
      "platform", "2026-09-22"],
  ];
  for (const [ref, title, context, decision, alternatives, consequences, by, at] of rows) {
    insert(
      `INSERT INTO decisions(ref, title, context, decision, alternatives, consequences, decided_by, decided_at, status)
       VALUES(?,?,?,?,?,?,?,?,'accepted')`,
      [ref, title, context, decision, alternatives, consequences, by, at],
    );
  }
  return rows.length;
}

function seedThreatModel(): number {
  if (scalar(`SELECT COUNT(*) FROM threat_model`) > 0) return 0;
  const rows: [string, string, string, string, string, string][] = [
    ["TrailBase auth + user records", "External attacker with stolen/brute-forced credentials", "Public internet → gateway → TrailBase auth API", "Account takeover, credential stuffing", "JWT with TTL, admin flag role-gating, MFA for admins (12-e), hashed passwords, login rate-limits, audit events", "platform"],
    ["Escrow funds + finance ledger", "Malicious seller or fraudulent buyer", "Marketplace order flow → finance-service :3006", "Fund diversion, fake refunds, payout fraud", "Escrow hold until dispute window closes, dual payout approval >US$100, double-entry ledger, reconciliation job, KYC before payouts", "finance"],
    ["User PII (profiles, comms handles, exports)", "Scraper bots, curious insiders", "Public profile surfaces → records API; DSAR export flow", "Mass PII harvesting; unauthorised export access", "Rate-limited record APIs, contact-detail masking in messages, exports token-gated + logged, DSAR verification step, access audit (DAT-020)", "compliance"],
    ["Trade engine sockets (bidding)", "Malicious bidder with custom client", "Browser ↔ socket.io :3002 via gateway", "Bid manipulation, sniping, socket DoS", "Server-side bid validation (price/authority/timing), anti-snipe extension, auth on socket connect, rate-limited RPCs", "platform"],
    ["Admin consoles (all sections)", "Compromised admin session or token", "Admin BFF routes /api/{comms,finance,trust,gov,compliance}/admin/*", "Privileged abuse: takedowns, payouts, DSAR exports, policy publish", "Admin claim verified on every BFF proxy (401/403), x-tgs-admin re-check at service, audit logging of privileged actions, MFA (12-e), separated publish authority (CMS-013)", "platform"],
    ["govern DSAR export bundles", "Social engineer impersonating a data subject", "Privacy Centre /me/export + admin bundle flow", "Unauthorized disclosure of a user's data", "Token-verified self-service only; admin bundles admin-gated; verifying → in_progress workflow with identity check; legal-hold check on deletion; all actions logged", "compliance"],
    ["Policy CMS (public legal content)", "Insider or compromised editor publishing unapproved policy text", "govern admin policy workflow → public pages", "Unvetted legal text shown to users", "Draft → review → approve → publish workflow with recorded actors; publish authority separated from authoring; version history + rollback; content audit log", "compliance"],
  ];
  for (const r of rows) {
    insert(`INSERT INTO threat_model(asset, adversary, boundary, risk, mitigation, owner) VALUES(?,?,?,?,?,?)`, r);
  }
  return rows.length;
}

function seedSecurityReviews(): number {
  if (scalar(`SELECT COUNT(*) FROM security_reviews`) > 0) return 0;
  insert(
    `INSERT INTO security_reviews(date, scope, findings, actions, reviewer) VALUES(?,?,?,?,?)`,
    [
      "2026-10-18",
      "MSCS 12 build security pass: BFF auth gates on every admin route (401 unsigned / 403 non-admin verified), secrets handling (no credentials in repo; env-only), SQL fully parameterised in all services, socket auth on trade engine, CORS policy, moderation masking of PII in messages, escrow release conditions.",
      "No hardcoded secrets found; all database access parameterised; admin gates verified per console. Findings: (1) external penetration testing not yet performed — risk exception RSK-EX-001 raised, time-bounded to 2027-01-20 with compensating controls; (2) admin MFA was not yet enforced platform-wide — assigned to wave 12-e (platform).",
      "Adopt orphaned-spawn recipe for manually started processes (done, recorded as INC-2026-001 corrective action); enable admin MFA (12-e); schedule external pen-test within 90 days of launch; re-run this review at launch gate.",
      "platform-team",
    ],
  );
  return 1;
}

function seedTraining(): number {
  if (scalar(`SELECT COUNT(*) FROM training`) > 0) return 0;
  const rows: [string, string, string, string][] = [
    ["admin", "Security onboarding: MFA, phishing awareness, secrets handling, admin console duty of care", "2026-10-01", "completed"],
    ["support-moderation", "Trust & safety: prohibited goods (AUP), dispute evidence handling, enforcement + appeals", "2026-10-05", "completed"],
    ["finance-role", "Payout KYC, dual approval rules, VAT basics (VAT Act Ch 23:12), reconciliation duty", "2026-10-08", "completed"],
    ["all-roles", "Zimbabwe CDPA awareness: data subject rights, DSAR handling, breach reporting duty to POTRAZ", "2026-10-12", "completed"],
    ["platform-team", "Incident response: severity model S1-S4, commander role, timeline discipline, RCA writing", "2026-10-15", "completed"],
    ["compliance", "Policy workflow: draft/review/approve/publish separation, acceptance records, registers upkeep", "2026-10-17", "completed"],
  ];
  for (const r of rows) {
    insert(`INSERT INTO training(person, topic, date, status) VALUES(?,?,?,?)`, r);
  }
  return rows.length;
}

function seedCalendar(): number {
  if (scalar(`SELECT COUNT(*) FROM compliance_calendar`) > 0) return 0;
  const rows: [string, string, string, string, string, string | null, string][] = [
    // [obligation, jurisdiction, authority, due_date, status, filed_at, notes]
    ["POTRAZ data controller registration (CDPA [Ch 12:07] s.17) — hard launch gate", "Zimbabwe", "POTRAZ", "2026-11-15", "upcoming", null, "Application being prepared; data register + privacy policy + processor register support the filing."],
    ["VAT return filing (monthly, by the 25th) once registered", "Zimbabwe", "ZIMRA", "2026-11-25", "upcoming", null, "VAT output tracked in finance ledger (12-b); first filing follows registration."],
    ["Annual policy review — full policy set re-read + re-approve", "Zimbabwe (internal)", "Compliance", "2027-10-20", "upcoming", null, "Policies v1.0 effective 2026-10-20; material changes bump version + effective date."],
    ["POTRAZ registration renewal (annual once registered)", "Zimbabwe", "POTRAZ", "2027-10-31", "upcoming", null, "Renewal window tracked from registration date."],
    ["Company annual return + registers refresh (post-incorporation)", "Zimbabwe", "Companies Office (DCIP)", "2027-04-30", "upcoming", null, "Companies and Other Business Entities Act [Chapter 24:31]; depends on incorporation completing first."],
    ["Processor register review (all 6 processors)", "Zimbabwe (internal)", "Compliance", "2027-01-31", "upcoming", null, "review_due dates on each processor row drive this."],
    ["Risk register quarterly review", "Zimbabwe (internal)", "Compliance", "2027-01-15", "upcoming", null, "Every risk carries owner + review date; exception RSK-EX-001 expires 2027-01-20."],
  ];
  for (const r of rows) {
    insert(`INSERT INTO compliance_calendar(obligation, jurisdiction, authority, due_date, status, filed_at, notes) VALUES(?,?,?,?,?,?,?)`, r);
  }
  return rows.length;
}

export function importControls(): number {
  // Idempotent upsert by id. NEVER clobbers admin-managed fields
  // (status/evidence_note/updated_by stay once a human sets them); the
  // /admin/controls/import endpoint applies the same rule.
  let raw: string;
  try {
    raw = readFileSync(WORKSHEET_PATH, "utf8");
  } catch {
    // The MSCS worksheet is an optional seed fixture; the governance service
    // must still boot (policy pages, DSAR, registers) without it.
    console.warn(`[govern] worksheet not found at ${WORKSHEET_PATH} — skipping control import`);
    return 0;
  }
  const src = JSON.parse(raw) as {
    controls?: {
      id: string; domain: string; name: string; floor: string; criticality: string;
      evidenceFloor?: string; applicability: string; status: string; ownerWave?: string;
      note?: string; inScope?: boolean;
    }[];
  };
  const controls = src.controls ?? [];
  for (const c of controls) {
    run(
      `INSERT INTO controls(id, domain, name, floor, criticality, evidence_floor, applicability, status, owner_wave, note, in_scope, updated_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,datetime('now'))
       ON CONFLICT(id) DO UPDATE SET
         domain=excluded.domain, name=excluded.name, floor=excluded.floor,
         criticality=excluded.criticality, evidence_floor=excluded.evidence_floor,
         applicability=excluded.applicability, owner_wave=excluded.owner_wave,
         note=excluded.note, in_scope=excluded.in_scope, updated_at=datetime('now')`,
      [
        c.id, c.domain, c.name, c.floor, c.criticality, c.evidenceFloor ?? "",
        c.applicability, c.status, c.ownerWave ?? null, c.note ?? "", c.inScope ? 1 : 0,
      ],
    );
  }
  return scalar(`SELECT COUNT(*) FROM controls`);
}

export function seed(): SeedSummary {
  seedPolicies();
  seedAcceptances();
  seedDataRegister();
  seedProcessors();
  seedRegisterEntries();
  seedStrategy();
  seedRisks();
  seedRiskExceptions();
  seedIncidents();
  seedDecisions();
  seedThreatModel();
  seedSecurityReviews();
  seedTraining();
  seedCalendar();
  importControls();
  // Summary = table counts (identical on every boot → idempotency proof).
  const summary: SeedSummary = {
    policies: scalar(`SELECT COUNT(*) FROM policy_versions`),
    acceptances: scalar(`SELECT COUNT(*) FROM policy_acceptances`),
    dataRegister: scalar(`SELECT COUNT(*) FROM data_register`),
    processors: scalar(`SELECT COUNT(*) FROM processors`),
    registerEntries: scalar(`SELECT COUNT(*) FROM register_entries`),
    strategy: scalar(`SELECT COUNT(*) FROM strategy`),
    risks: scalar(`SELECT COUNT(*) FROM risks`),
    exceptions: scalar(`SELECT COUNT(*) FROM risk_exceptions`),
    incidents: scalar(`SELECT COUNT(*) FROM incidents`),
    decisions: scalar(`SELECT COUNT(*) FROM decisions`),
    threatModel: scalar(`SELECT COUNT(*) FROM threat_model`),
    securityReviews: scalar(`SELECT COUNT(*) FROM security_reviews`),
    training: scalar(`SELECT COUNT(*) FROM training`),
    calendar: scalar(`SELECT COUNT(*) FROM compliance_calendar`),
    controls: scalar(`SELECT COUNT(*) FROM controls`),
  };
  return summary;
}
