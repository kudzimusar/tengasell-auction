# Changelog

Tengasell — Zimbabwe's auction marketplace (Yahoo Auctions functionality, eBay-grade operations).

## [Unreleased] MSCS 12 — Corporate Readiness Programme

Conformance to the 11-11 Tech **MSCS 1.0** (609 controls) + **UDPCS 1.0** standards. Target profile: **M2 Operationally Ready** with selected M4 controls elevated by Zimbabwe legal obligation (Cyber & Data Protection Act [Chapter 12:07], VAT [Chapter 23:12], Consumer Protection Act [Chapter 14:44], POTRAZ).

### Added — Finance plane (12-b)
- finance-service `:3006`: double-entry ledger (balanced-transaction integrity check), escrow hold/release on delivery + 7-day dispute window, final-value fee (8%, cap US$50) + VAT (15% on fee), seller balances, payout requests with dual controls (reason + GOV-009 sanctions confirmation; >US$100 requires a second admin to pay), full/partial refunds with proportional fee+VAT reversal, credit notes, chargeback register, bank-line matcher, reconciliation runs, VAT tax packs (CSV export).
- Finance console (admin): ledger · payouts · refunds · invoices · reconciliation · tax.
- Seller Earnings section: balance cards, payout requests (KYC ID required), payout history, order-level fee breakdown.
- Receipts card on order detail; trade-engine finance event wiring (order.paid / order.delivered / order.cancelled — engine stays healthy when finance is down).

### Added — Support & Trust plane (12-c)
- trust-service `:3007`: support tickets (SLA clocks, internal notes, macros, attachments, CSAT), abuse/fraud/illegal-content reports, trust cases with immutable evidence snapshots, enforcement ladder (warning → restriction → suspension → ban; dual approval; appeals; reinstatement), listing screening (14 Zimbabwe-relevant prohibited-goods rules + Scan now + takedown with buyer notification), role registry (admin/support/finance/moderator/compliance), seller health scoring, sign-in activity log, TOTP state + account-recovery code custody, suspension status gate (consumed by sign-in).
- Support & Trust console (admin): tickets · reports · enforcement · screening.
- User surfaces: Support tickets section, item Report button, order Open-dispute button (7-day window), help-page ticket intake.

### Added — Governance plane (12-d)
- govern-service `:3008`: versioned bilingual policy system (draft → review → approve → publish → rollback) with 8 published v1.0 policies (Terms of Service, Privacy Policy, Marketplace Rules, Seller Agreement, Acceptable Use, Refunds, IP/Copyright, Accessibility), Privacy Centre/DSAR engine (access, correction, deletion with legal-hold blocking + retention exceptions, portability, restriction, objection; 30-day statutory clock; export bundles), corporate registers (entity/ownership/directors/contracts/assets/licences/domains/insurance/procurement/vendors/approvals/compliance calendar…), incident management (severity, timeline, RCA, corrective actions), risk register + risk exceptions, legal requests + legal holds, decision records (ADRs), threat model, security reviews, training records, **MSCS 609-control conformance register** (imported from the master worksheet; status/evidence tracking; CSV export).
- Governance console (admin): policies · privacy · registers · incidents · risk.
- Compliance console (admin): the tick-every-box 609-control checklist with filters, per-row status updates and evidence notes.
- Public policy pages `#/policies/{key}` (EN/JA, version + effective date + acceptance records).
- Privacy Centre in My Tengasell; home page fully localized to Japanese (I18N-009 closed).

### Added — Platform plane (12-e)
- Gated sign-in: password → suspension gate (fail-open doctrine when trust is down) → **TOTP MFA challenge** (session held until the 6-digit code verifies; recovery codes shown once, sha256-hashed at rest) → session adoption. Forgot-password recovery flow (sandbox-visible code in mock mode). Change password. Sign-in activity log.
- Admin step-up (IAM-010): MFA re-verification for admins (30-minute window, signed cookie).
- Platform consoles (admin): Users (search/inspect/roles/suspend with reason), Marketplace (takedown/feature/relist/cancel), Audit log (filters + payload expand + CSV), System health (9 service cards + smoke checks 9/9 + test alerts), Analytics (marketplace/revenue/product/operational/funnel/monthly cohorts + metric dictionary + CSV), Configuration (feature flags with who/when/why audit).
- Registration requires Terms-of-service acceptance; acceptance recorded in the governance service.
- Onboarding checklist card in My Tengasell overview.
- Ops evidence: nightly-capable backup script (SQLite backup API + manifest with SHA-256), **restore test executed with evidence (BCP-005: 48/48 table-count checks ok)**, SBOM (ops/sbom.json), synthetic smoke checks, runbooks (on-call, credential compromise, break-glass, RPO 24h / RTO 1h, DR), `robots.txt` + `sitemap.xml`.
- `git tag v0.9.0-mcs` to be cut at certification (12-f).

### Changed
- Admin "Comms Console" renamed to **Operations Console** — six control-plane groups (Communications · Finance · Support & Trust · Governance · Compliance · Platform), 28 sections.
- Sign-in session adoption now mirrors into the API in-memory state (no reload needed after gated sign-in).
- Footer: Legal column with the six policy links.

### Verified (orchestrator E2E)
- Payout golden path: request (KYC ID) → approve (reason + sanctions confirm enforced) → pay (reference) → paid; ledger integrity "Balanced".
- DSAR golden path: export request → verify → process (bundle built) → completed; deletion blocked by legal hold with case reference; hold lifted → request closed.
- MFA golden path: enroll (secret + otpauth) → activate (RFC 6238 code) → recovery codes → sign-in challenge → correct code signs in / wrong code rejected; disable restores password-only sign-in.
- Dispute → urgent ticket + trust case; report → admin queue → case; screening takedown; enforcement with required reason codes.
- 390px: zero horizontal overflow on all new surfaces; 44px targets; teal/gold palette only (VLM-verified); lint 0; tsc 0.

## [11] TUCS — Tengasell Unified Communications System
Telegram/WhatsApp/Email/Messenger channel linking with double opt-in, preference matrix (event × channel), strict marketing consent + frequency caps + suppression + one-click unsubscribe; mediated user messaging with PII moderation; cross-channel replies (via WhatsApp/Telegram badges); campaign engine with segments, templates (EN/JA) and delivery/open/click analytics; admin Comms console with mock channel viewers, moderation queue, delivery log. NXS 1.0 certification: 95/100 PASS.

## [1–10] Marketplace core
TrailBase (Rust) backend; trade engine (Yahoo Auctions proxy bidding, anti-snipe soft close, buy-now with 48h payment SLA, Q&A, ratings); Paynow Zimbabwe integration + sandbox; GIS delivery mapping (OSM); search/browse/watch; sell wizard; buyer/seller order flows with tracking maps; AI assistant (Tenga AI); developer/MCP documentation; bilingual EN/JA UI.
