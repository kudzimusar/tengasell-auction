# TENGASELL-PULSE-DESIGN-01 — AI, Critical Information and Commercial Governance Contract

**Version:** 1.0.0 / proposed design specification annex  
**Authority:** MASTER_PLAN.md; this document DOES NOT authorize tools, accounts, production LLMs, autonomous actions, messaging providers, paid campaigns or new database migrations.  
**Identity:** Use existing "Tenga AI" naming/context until official brand ownership approves any alternative; do not invent a replacement AI brand.

## A. Why AI is in Pulse, and what "running the system" actually means

Tenga AI should improve discoverability, explain the marketplace, summarize trusted state, guide sellers and help authorized operators notice and communicate critical events. It must NOT replace the deterministic auction engine, real-time session authority, settlement ledger, trust review, RBAC, incident process or human final decision. Automation is assistance, not a shadow market operator.

Two separate lanes, sharing design language but not authorization scopes:

| Lane | Who | Input | Possible outputs | Action restriction |
| --- | --- | --- | --- | --- |
| Customer Tenga AI | Anonymous/buyer/seller/business under their permissions | Published FAQ/policy + authorized public listing/status + own allowed saved data | Search suggestions, natural-language clarification, optional summary, guided listing steps, sourced explanations | Never bid/offer, charge, release funds, approve listing, access other users' data, assert unverified status |
| Operations Copilot | Authorized support/moderator/auction operator/commercial staff | Sanitized event metadata, approved health telemetry, authorized ticket/campaign status | Prioritized alert, source link, probable cause, suggested runbook, draft communication for human approval | Never make a real trade/finance/security decision or publish an external message without separate explicit permission |

No user personal data is used for provider model training without a separately reviewed legal basis and consent. Public promo targeting may not infer sensitive traits or reveal protected account characteristics.

## B. Source-of-truth and data-flow boundary

Future design-stage diagram must show:

1. Sources: TrailBase public projection and ACL, Trade Engine authority and Socket.IO events, approved communications inbox/reminder status, campaign approval state, provider health and incident register, approved documentation.
2. Ingestion: typed events + source ID + occurrence timestamp + ingestion timestamp + correlation/dedup key; separate protected versus public fields.
3. Deterministic policy engine: severity, eligibility, user/role access, thresholds, active/ended state and suppression rules are enforced WITHOUT LLM inference.
4. Redaction: strip private reserve, VIN, sensitive personal evidence, credentials, tokens, internal notes and financial secrets before AI prompts or public telemetry.
5. AI reasoning/summary: optional, uncertainty-aware, traceable; distinguish direct verified facts from an AI interpretation.
6. Destination: authenticated user-facing support view, restricted internal alert centre, approved in-app inbox, optional drafts for supervised outreach.
7. Audit: event, alert, source, model/version, redaction decision, human review/ack, delivery channel/result, suppression/retry/expiry; protected evidence in an access-controlled location.
8. Fallback: deterministic alert queue, documented runbook and normal marketplace search all remain operational with AI disabled or unresponsive.

A message is NOT a source of truth merely because Tenga AI generated it. Every live price, auction state, reserve status, qualification, verification status and payment state must originate from its canonical service.

## C. Critical event catalogue — sample proposed operational policy, not enabled triggers

| ID | Source and condition (future verified contract) | Class | Authorized audience | Response |
| --- | --- | --- | --- | --- |
| AI-ALERT-01 | Private field found in world-readable public view | SEV0 candidate | Security lead + Moderator | Fail closed / incident triage; no public sensitive payload |
| AI-ALERT-02 | Bid or settlement status inconsistent between canonical ledgers | SEV0 candidate | Auction/finance on-call, restricted | Human incident; no automatic trade reversal |
| AI-ALERT-03 | Live event/session/current lot mismatch | SEV1 | Authorized auction operator | Show neutral live UI and actionable runbook |
| AI-ALERT-04 | Communication delivery/outbox backlog beyond approved threshold | SEV1 | Comms operations | Queue human triage; do not duplicate external sends |
| AI-ALERT-05 | Public listing or sponsor status becomes private/withdrawn | SEV1 | Content/trust and campaign operator | Deterministic public suppression, campaign investigation |
| AI-ALERT-06 | Production auth, payment/provider connectivity unavailable | SEV1, escalate on impact | On-call; finance/support as authorized | Public neutral status, incident notification |
| AI-ALERT-07 | Campaign expiry, spent budget or absent commercial approval | SEV2 | Business account manager | Pause/stop ads by deterministic rules; propose next steps |
| AI-ALERT-08 | Search or listing conversion changes outside approved baseline | SEV2 | Product analyst | Optional aggregate trend summary, not invented claims |
| AI-ALERT-09 | User saved-search match / watched lot nearing approved time | INFO | Consenting owner only | In-app notification subject to true listing state and channel policy |
| AI-ALERT-10 | Native bundle/installed binary provenance mismatch | SEV1 for release QA | Mobile/QA/Moderator | Block certification until exact metadata corroborates |

Thresholds, staffing and external escalation channels are UNDEFINED until operations policy approval. Do not invent SLAs or claim 24/7 monitoring. If staff are offline, queue and persist actionable records, escalate only through authorized channels.

## D. The alert data contract and workflow (design only)

Proposed fields: alert_id; source_service; event_type; entity_reference; source_event_id; occurred_at; observed_at; severity; schema_version; safe_public_summary; restricted_details_reference; scope/tenant; confidence/provenance; state; owner_role; status; deduplication_key; response_deadline_if_approved; ack_user/time; recommended_runbook; delivery_channel; consent/evidence; created_at; last_updated; expiry; resolved_by; resolution_reason.

State machine: DETECTED → VERIFIED_BY_RULES → ROUTED → ACKNOWLEDGED → RESOLVED / SUPPRESSED / EXPIRED. A human or deterministic service owns resolution; AI's suggested resolution is always separately labeled. Repeated source events deduplicate; recovery and replay must preserve audit correctness. No direct browser query for an unrestricted alert table.

Status tiers are semantic: critical P0 security/authority; high P1 live trade/communication reliability; medium P2 performance/commercial; INFO customer consented. High-severity events must surface accessibly without color alone.

## E. AI operational workflows for prototype

**Customer — discover:** user: "Show me reliable solar kits under my budget." Assistant retrieves approved public listings with explicit sorting and links; no guarantee of authenticity or reliability unless certified. Missing listings ⇒ honest no-results.

**Customer — understand:** "Why did my bid not win?" Assistant explains documented proxy-bid rules; account-specific status only after authentication; never independently judges bid result.

**Seller — publish:** user asks listing-photo/order/attribute questions; assistant suggests improved descriptions but never publishes, classifies as verified or exposes private documents without confirmation.

**Buyer — live:** "Is this auction actually live?" Assistant uses canonical session/event/current-lot read, cited timestamp; if stale, states unavailable rather than guessing.

**Business — promote:** merchant asks "Can I sponsor Solar Week?" Assistant explains proposed packages and prompts account authorization, showing no live price or payment link before Finance acceptance.

**Operator — critical:** event status and current lot mismatch. Deterministic engine raises alert. AI may summarize and propose inspect-reconnect-runbook, while a human acknowledges; bid controls are disabled by authoritative UI logic independently.

**Comms — triage:** reminder backlog detected. Summarize counts and safe source IDs, suggest investigate service health, never expose recipients, forge status or send external bulk notifications automatically.

**Moderator — delivery governance:** summarize stage/PR evidence and blockers from approved register and live source; explicitly state NOT_BASELINED if no authorized denominator; never approve its own code/review.

Prototype demonstrates **AI unavailable, malicious input, wrong-answer, delayed data and human rejection**. Responses must have source labels, recency and safe fallback. No LLM provider or extra paid plugin is selected by this spec.

## F. AI-specific safety / privacy / security acceptance

Mandatory future review cases:
- AI-SEC-01 user A cannot query B's saved searches, campaigns, bids or staff alerts.
- AI-SEC-02 prompt injection in a listing, screenshot, seller profile, or retrieved document cannot issue an instruction or bypass an ACL.
- AI-SEC-03 raw private reserve, protected identifiers, address, contact detail, tokens and moderation notes never appear in public AI response or logs.
- AI-SEC-04 AI hallucinated "LIVE", "VERIFIED", "SOLD", "PAID", funds-held or imminent event claims are blocked or corrected by canonical validation.
- AI-SEC-05 no connected tools can bid, make/reverse payments, reclassify listings, approve ads, deploy, mutate permissions or send provider messages without explicit authorized workflow and human confirmation.
- AI-SEC-06 role revocation, session expiry and stale event state invalidate previously authorized personalized responses/actions.
- AI-SEC-07 model/provider unavailable ⇒ deterministic notifications, search and safe account workflows survive.
- AI-SEC-08 consent revocation ⇒ no new optional marketing messages, and suppression state is audited.
- AI-SEC-09 model output carries uncertainty and sourcing for time-sensitive facts; sources cannot be forged by model text.
- AI-SEC-10 alerts have bounded retries, deduplication, authorization and human acknowledgement; no infinite escalation or duplicate provider sends.
- AI-SEC-11 abuse/rate limits and cost ceilings defined before production AI provider selection.
- AI-SEC-12 multilingual support undergoes translation and sensitive-topic evaluation; voice/transcription adds separate permission/data handling, not automatic implementation.

The design reviewer can accept visual AI affordances while marking technical implementation NOT PROVEN. All provider operations stay OFF.

## G. Commercial + AI separation

An LLM recommendation is not an ad-placement allocator or legal approval. If sponsored items appear in a conversational response, the paid placement must be plainly labeled and cannot be presented as unbiased organic selection. Campaign approval, eligibility, withdrawal and billing are deterministic server-governed workflows. AI may draft an advertiser-facing campaign brief, not approve charges or guarantee impressions.

Privacy-preserving metrics to propose: AI support containment rate (verified resolution, not absence of follow-up), qualified handoff, answer correction rate, hallucinated-status incidents, human acknowledgment latency, duplicate alert rate, channel opt-out, cost-per-safe-resolution. All baseline and target values remain UNBASELINED pending measurement.

## H. Design deliverables, owner decisions and gate

Design specialist returns:
1. Customer Tenga AI entry points for guest/buyer/seller/business, in desktop/tablet/mobile/native.
2. Operations alert centre IA with severity, source, ack/escalation and access state.
3. Two visual directions consistent with official NXS brand.
4. 6 AI prototype journeys plus at least 5 negative/safety states, integrated into the 30 Pulse screens without inflating redundant layouts.
5. Traceability map from each visible alert/answer to canonical data/role and safe fallback.
6. UX copy for "AI-generated suggestion", "Source", "Last verified", "Requires human approval", "Information unavailable".
7. Accessibility, localization, opt-in and privacy annotations.
8. Provider/cost/implementation dependencies explicitly deferred; no automatic external notifications.
9. Human-approval and audit prototype for critical actions.
10. Negative test demonstration for an injected malicious listing and contradictory bid claim.

**Gate:** Independent design review of source/prototype behavior, privacy and feasibility; then Owner selection. Subsequent AI engineering demands I0 authorization, security threat model, service contract, test dataset and exact-head independent review. The current code's AI and communications features must not be assumed certified by this document.

**Hard stops:** NO AUTONOMOUS BIDS/PAYMENTS · NO REAL NOTIFICATION SENDS · NO MODEL/PLUGIN COST · NO AI PROVIDER CREDENTIALS · NO PRODUCTION INGESTION · NO SECRET/PRIVATE DATA DISCLOSURE · NO RELEASE WITHOUT HUMAN APPROVAL.
