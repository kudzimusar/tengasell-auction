# MSCS 1.0 — stock-take

Assessment of TengaSell against the **MSCS 1.0 Master Software Capability Standard**
(framework custodian: 11-11 Tech, issued 2026-10-20).

- Controls in the registry: **609**
- Domains: **37**
- Floors: **M1** 157, **M2** 358, **M3** 62, **M4** 32
- Criticality: **C1** 49, **C2** 431, **C3** 129
- Domains by status: Partial 14, Implemented 19, Gap 4
- Controls by status: Partial 217, Implemented 341, Gap 51

## Method

Each control in `prisma/mscs-registry.json` was grouped by domain and assessed against
the running system and the repository evidence (code, routes, tests, reports, docs).
Status vocabulary:

| Status | Meaning |
| --- | --- |
| **Implemented** | Code, route and UI exist and were exercised on the live deployment |
| **Partial** | Present but incomplete, or blocked on an external credential/service |
| **Gap** | Not present in the product |

> This is an **engineering self-assessment**, not a certification. MSCS requires an
> independent moderator pass; that has not happened.

## Domain scorecard

| Domain | Name | Controls | C1 | Status | Evidence / gap |
| --- | --- | ---: | ---: | --- | --- |
| `STR` | Strategy & Business Model | 9 | 0 | **Partial** | README, PRODUCT_BLUEPRINT, worklog; no formal business plan/BMC in repo |
| `EXP` | Customer Experience & Product | 15 | 0 | **Implemented** | Full marketplace UI, EN/JA, dark mode, mobile shells |
| `IAM` | Identity & Access | 17 | 0 | **Implemented** | Auth, MFA state machine, recovery, RBAC, step-up, sessions |
| `ORG` | Organizations & Multi-Tenancy | 12 | 0 | **Gap** | Single-tenant only — no organisation model or tenant isolation |
| `MKT` | Marketplace | 30 | 0 | **Implemented** | Auctions, proxy bids, best offers, live rooms, watchlist, saved searches |
| `COM` | Commerce & Transactions | 24 | 0 | **Partial** | Orders/checkout/ledger exist; real Paynow credentials missing |
| `CMS` | Content Management | 30 | 0 | **Implemented** | Articles, versions, editorial workflow, media assets |
| `SRC` | Search & Discovery | 12 | 0 | **Implemented** | Search, suggest, filters, sort, category browse |
| `MSG` | Communications & Notifications | 15 | 0 | **Partial** | Internal threads + outbox work; WhatsApp/Meta/email keys missing |
| `CTL` | Administrative Control Plane | 25 | 0 | **Implemented** | Admin console, config, flags, approvals, reason codes |
| `SUP` | Customer Support / CRM | 15 | 0 | **Implemented** | Tickets, SLA, macros, CSAT, cases |
| `TNS` | Trust, Safety & Moderation | 14 | 0 | **Implemented** | Reports, enforcement, appeals, sanctions screening, seller health |
| `FIN` | Finance & Accounting | 20 | 0 | **Partial** | Ledger, invoices, payouts, recon; PSP settlement external |
| `CORP` | Corporate Administration | 15 | 0 | **Gap** | Corporate registers/policies partly seeded; no company administration process |
| `GRW` | Sales, Marketing & Growth | 16 | 0 | **Gap** | No growth/marketing automation beyond comms campaigns |
| `PRT` | Partners & Vendors | 12 | 0 | **Partial** | Partner model + registry seeded; no partner portal |
| `DAT` | Data Platform & Governance | 20 | 0 | **Partial** | Prisma/SQLite + audit; no warehouse, lineage or retention automation |
| `BI` | Analytics & Business Intelligence | 13 | 0 | **Partial** | MetricDaily and admin metrics only; no BI stack |
| `API` | API Platform | 20 | 0 | **Implemented** | 252 route handlers, public v1, keys, webhooks, docs |
| `DEV` | Developer Platform | 20 | 0 | **Implemented** | Developer portal, API keys, webhook endpoints, sandbox |
| `MCP` | AI / MCP / Agent Platform | 25 | 0 | **Implemented** | Trailbase MCP server, agent tokens, audit trail (source=mcp) |
| `INT` | Integrations & Event Architecture | 16 | 0 | **Implemented** | Webhooks + internal service bus; outbound providers pending keys |
| `SEC` | Cybersecurity | 25 | 0 | **Partial** | SAST/DAST evidence, CSP, headers, rate limits; no external pen test |
| `PRV` | Privacy | 18 | 0 | **Implemented** | DSAR, consents, retention rules, processor register, incidents |
| `LEG` | Legal | 15 | 0 | **Partial** | Policy pages shipped; contracts/DPA need counsel |
| `GOV` | Government & Regulation | 14 | 0 | **Partial** | Regulatory reporting + licences; POTRAZ registration pending |
| `ACC` | Accessibility | 10 | 0 | **Partial** | Semantic landmarks and contrast; no WCAG audit |
| `I18N` | Localization & Internationalization | 10 | 0 | **Implemented** | English + Japanese throughout |
| `INF` | Infrastructure & Cloud | 17 | 0 | **Partial** | Single Fly machine, SQLite, no IaC or multi-AZ |
| `ENG` | Engineering & SDLC | 20 | 0 | **Implemented** | CI, build, smoke, docs; lint/type debt tracked |
| `OPS` | Operations & Reliability | 18 | 0 | **Implemented** | Status page, incidents, backups, runbooks, smoke contract |
| `INC` | Incident Management | 12 | 0 | **Implemented** | Incident model, status events, public status API |
| `BCP` | Business Continuity & Disaster Recovery | 13 | 0 | **Partial** | BCP plans + restore test script; no live DR drill on current stack |
| `REL` | Release & Distribution | 12 | 0 | **Implemented** | Release records, SBOM, changelog; no signed artefacts |
| `DOC` | Documentation & Knowledge | 12 | 0 | **Implemented** | README, blueprint, runbooks, operations manual |
| `EXE` | Executive Governance | 8 | 0 | **Gap** | No board charter / executive governance artefacts |
| `RSK` | Risk, Audit & Assurance | 10 | 0 | **Partial** | Risk register, exceptions, internal audit; independent assurance open |

## What this means in practice

- **19 domains** are implemented end-to-end and were exercised on the live node.
- **14 domains** are partial — almost all for one reason: a third-party credential
  or an external assurance step, not missing product code.
- **4 domains** are genuine gaps: `ORG`, `CORP`, `GRW`, `EXE`.

## Blocking items, in order

| # | Item | Domain | Why it blocks |
| ---: | --- | --- | --- |
| 1 | Paynow merchant credentials | `COM/FIN` | No real payment can settle; checkout stays mock |
| 2 | Rotate/delete seeded demo accounts | `IAM` | 16 accounts share a password published in the repo |
| 3 | Meta/WhatsApp + email provider keys | `MSG` | Bid and order notifications cannot leave the building |
| 4 | External penetration test | `SEC` | No independent evidence for C3 controls |
| 5 | Independent MSCS moderator pass | `RSK` | Self-assessment cannot certify |
| 6 | Multi-tenant model | `ORG` | One marketplace per deployment only |
| 7 | Postgres + more than one machine | `INF` | SQLite pins the system to a single instance |
| 8 | WCAG audit | `ACC` | Accessibility claims are unverified |
| 9 | Counsel review of policies/DPA | `LEG` | Templates are not legal advice |
| 10 | Growth + corporate governance artefacts | `GRW/CORP/EXE` | Nothing in the repo to assess |

## Next 30 days — realistic

1. Paynow onboarding → sandbox → live payment, then re-run checkout and refund tests.
2. Close the account exposure: rotate every demo user or delete them; enforce staff MFA.
3. Wire one notification channel end-to-end (Telegram first, WhatsApp after Meta review).
4. Commission the penetration test; fix anything C3-rated before opening signups.
5. Move the database to Postgres and add a second machine before marketing traffic.
6. Book the independent moderator pass; publish the scorecard with evidence links.

