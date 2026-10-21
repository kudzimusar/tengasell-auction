# TengaSell — Data Harvest Manifest

Recovered from the original download: `workspace-0488aa8f-f30d-4950-bfdf-f129e665eba9.tar`
(146 MB, sha256 `8a035b709aaf99cc5e741162f9317a9326c19302b3eb3495eaa79b033b2c79b9`).

Why this exists: the z.ai export claims a complete full-stack package with
"17 users / 55 auctions / 443 bids / 24 orders". This harvest establishes what the archive
actually contains, and reconstructs the newest reachable database state.

---

## What was recovered

| File | Source | Notes |
| --- | --- | --- |
| `dbs/trailbase-marketplace.db` | `backups/2026-10-20T-savepoint/traildepot_main.db` restored from git objects, WAL checkpointed | The newest marketplace state in the archive |
| `dbs/platform-prisma.db` | `db/custom.db` | Platform/BFF plane (84 models) |
| `service-dbs/*.db` | `db/comms.db`, `finance.db`, `govern.db`, `trust.db` | Microservice state |
| `sql/*.sql` | `sqlite3 .dump` | Full schema + data, replayable |
| `csv/*.csv` | per-table export | Human/analytics friendly |
| `restore.sh` | authored | Puts the data back into a checkout |

**Important:** the working-tree copy of `backups/2026-10-20T04-11-24-373Z/trailbase.db` is an
*older* snapshot (13 orders). The checkpointed `traildepot_main.db` tracked in git is newer
(18 orders), so it was restored from git rather than copied from disk.

---

## Row counts (verified)

### Marketplace plane — TrailBase (`trailbase-marketplace.db`)

| Table | Rows | | Table | Rows |
| --- | ---: | --- | --- | ---: |
| `profiles` | 17 | | `questions` | 10 |
| `auctions` | 55 | | `ratings` | 4 |
| `bids` | 443 | | `watchlist` | 5 |
| `orders` | **18** | | `audit_events` | 34 |
| `payments` | 4 | | `notifications` | 59 |
| `categories` | 11 | | `threads` | 6 |
| `messages` | 18 | | `paynow_sessions` | 1 |

### Platform plane — Prisma (`platform-prisma.db`)

| Table | Rows | | Table | Rows |
| --- | ---: | --- | --- | ---: |
| `User` | 11 | | `Payment` | 5 |
| `Listing` | 28 | | `Review` | 3 |
| `Bid` | 7 | | `AuditLog` | 84 |
| `Order` | 7 | | `MscsControl` | 609 |
| `Category` | 12 | | `Incident` | 1 |

### Service databases

| DB | Tables |
| --- | --- |
| `comms.db` | channel_links, preferences, outbound_queue, relay_log, campaigns, campaign_audience, templates, mock_inbox, mock_chats, deliveries, suppression |
| `finance.db` | config, ledger_entries, order_finance, seller_balances, payouts, refunds, chargebacks, invoices, credit_notes, receipts, bank_lines, recon_runs, events_log |
| `govern.db` | policies, policy_versions, policy_acceptances, privacy_requests, user_flags, data_register, processors, register_entries, incidents, risks, risk_exceptions, legal_requests, legal_holds, decisions, strategy, threat_model, security_reviews, training, compliance_calendar, controls, evidence, findings, certifications, content_audit |
| `trust.db` | roles, mfa, signins, password_resets, suspension, tickets, ticket_messages, ticket_events, macros, reports, cases, enforcement, appeals, screening_rules, screening_hits, seller_health, notifications_log, mfa_recovery_hashes |

---

## Claimed package vs. archive contents

| Claimed in the z.ai export | Status | Evidence |
| --- | --- | --- |
| Full source, 250+ API routes | ✅ | 252 route handlers |
| 5 SQLite databases | ✅ | `custom`, `comms`, `finance`, `govern`, `trust` |
| 17 users / profiles | ✅ | 17 |
| 55 auctions | ✅ | 55 |
| 443 bids | ✅ | 443 |
| **24 orders** | ❌ | **18** newest / 13 in the older snapshot |
| Gap-8 tables (`offers`, `saved_searches`, `live_sessions`) | ❌ | **absent from every `.db` in the archive**; only `U1000000006__gap8.sql` exists |
| Vendored TrailBase v0.35.1 binary (29 MB) | ✅ | `backups/vendor/trailbase_v0.35.1_x86_64_linux.zip`, 28.46 MB, sha256 `208e37e3…e62996` |
| Complete `.git` history | ⚠️ partial | 81 MB, HEAD `8de92b0` (2026-10-21 00:50), tags `restore-complete-20261020`, `savepoint-gap8-complete-20261021` |
| Final packaging commits `e97e30a`, `275c19d`, `6f1b065`, `9fbd86e` | ❌ | not present — archive predates the packaging work |
| Tag `export-github-2026-10-21` | ❌ | absent |
| `README.md`, `LICENSE`, `.env.example`, `SECURITY.md`, `CONTRIBUTING.md`, `.github/workflows/ci.yml` | ❌ | none exist in the archive (README/CI in the repo were authored separately) |
| `tengasell-fullstack.zip` / `.tar.gz` / `-git-history.bundle` / `CHECKSUMS.sha256` | ❌ | no archives and no checksums inside the tar |
| `download/README.md` manifest | ⚠️ stub | contains only "Here are all the generated files." |
| SAST/DAST reports, SBOM, audit pack | ✅ | `ops/reports/`, `ops/sbom.json`, `ops/audit-pack/` |
| MSCS 609-control register | ✅ | 609 `MscsControl` rows |
| Standards PDFs | ✅ | 4 PDFs under `upload/` |
| UAT screenshots | ✅ | 97 files |

### Conclusion on "everything is ready"

The **application and most of its data are real and complete**. Three claims do not hold:

1. **Orders are 18, not 24.** The extra 6 orders existed only in the live database at export time,
   which is not in this archive.
2. **Gap-8 data does not exist here.** Offers, saved searches and live-room rows are missing from
   every database; only the migration that creates the empty tables is present. The Gap-8 UI was
   verified on z.ai against a database we did not receive.
3. **The "GitHub-ready" packaging never made it into the archive.** No README/LICENSE/SECURITY/
   CONTRIBUTING/CI, no final commits, no export tag, no zip/tar.gz/bundle/CHECKSUMS.

---

## Restore

```bash
# from the repo root (tengasell-auction/)
bash /path/to/tengasell-data-harvest/restore.sh

# verify
sqlite3 mini-services/trailbase-db/traildepot/main.db \
  "select 'profiles',count(*) from profiles union all
   select 'auctions',count(*) from auctions union all
   select 'bids',count(*) from bids union all
   select 'orders',count(*) from orders;"
```

On next boot TrailBase applies `U1000000006__gap8.sql`, creating the empty `offers`,
`saved_searches` and `live_sessions` tables. **Schema comes back; those rows do not.**

---

## Recovering the missing pieces

| Missing | How to get it |
| --- | --- |
| Final live DB (24 orders, Gap-8 rows) | Re-download from z.ai and verify `select count(*) from orders` = 24 before accepting |
| Packaging commits / export tag | Same — request the `.bundle` or the zip, which the export says contains `.git` |
| README/LICENSE/SECURITY/CONTRIBUTING | Authored in this repo already (README, CI); LICENSE/SECURITY/CONTRIBUTING can be recreated |
| TrailBase binary | Present in this archive under `backups/vendor/`; also downloadable from TrailBase releases |

A quick acceptance test for any future export:

```bash
sqlite3 main.db "select count(*) from orders;"                      # expect 24
sqlite3 main.db "select count(*) from offers;" 2>/dev/null          # table must exist
git --git-dir=.git tag | grep export-github                          # tag must exist
sha256sum -c CHECKSUMS.sha256                                        # archives must verify
```

---

## Recovery update — 2026-10-21 (supersedes the gaps above)

A re-export from z.ai supplied the missing live database
(`backups/2026-10-21T01-50-25-188Z/trailbase.db` in the new workspace archive).

| Item | Earlier archive | Recovered |
| --- | --- | --- |
| Orders | 18 | **24** |
| Auctions | 55 | 55 |
| Bids | 443 | 443 |
| Profiles | 17 | 17 |
| Tables | 18 | **25** (incl. `offers`, `saved_searches`, `live_sessions`) |

Order states in the recovered database: 19 `pending_payment`, 2 `completed`, 1 `paid`,
1 `shipped`, 1 `cancelled`.

**Correction to the earlier report:** the Gap-8 *rows* were never missing. z.ai's live database
also holds **0 rows** in `offers`, `saved_searches` and `live_sessions` — the tables exist and the
features were exercised during UAT, but no records were left behind. There is nothing to recover
for those three tables; they are empty by state, not by export failure.

The recovered database is now the seed (`deploy/seed/trailbase-main.db`) and is running on the
Fly deployment.
