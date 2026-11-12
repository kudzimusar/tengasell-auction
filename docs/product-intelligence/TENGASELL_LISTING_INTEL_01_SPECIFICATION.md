# TENGASELL-LISTING-INTEL-01 / LISTING-STD-01-R4-ICR01
## Category-Specific Structured Disclosure, Product Identity, Seller Accountability and Marketplace Trust Architecture

**Programme:** 11-11 TECH — Tengasell Programme Moderator  
**Role:** Listing Intelligence Final Review Coordinator  
**Repository:** `kudzimusar/tengasell-auction`  
**Priority:** P0 — Product Integrity Standard  
**Framework:** 11-11 Tech NXS Framework 1.0  
**Disposition:** REMEDIATE — PRESERVE PR #13; CLOSE FINAL OWNER REQUIREMENTS AND CERTIFICATION  
**Controlling Review Pull Request:** [Draft PR #13 (kudzimusar/tengasell-auction/pull/13)](https://github.com/kudzimusar/tengasell-auction/pull/13)  
**Controlled Documentation Branch:** `docs/listing-std-01-review`  
**Verified Initial PR HEAD:** `9c26f251aa83c184060422b361ac8ed76aeba1ca`  
**Verified Parent Base:** `98a607c326ca4bcf24062c045d4eaa35762a3aa5` (`origin/main`)  
**Preserved Archival Baseline Document:** [`docs/product-intelligence/TENGASELL_LISTING_INTEL_01_SPECIFICATION.ORIGINAL.md`](file:///Users/shadreckmusarurwa/Project%20AI/tengasell/docs/product-intelligence/TENGASELL_LISTING_INTEL_01_SPECIFICATION.ORIGINAL.md)  

---

## 1. Executive Summary & Programme Mission

Tengasell is an auction-first, trust-governed marketplace engineered for high-stakes commerce in Zimbabwe and the SADC region. In an auction environment, information asymmetry destroys liquidity: when bidders cannot determine the precise physical reality, provenance, technical specifications, condition, repair history, and defect envelope of a lot, bidding stalls, reserve prices fail, post-sale disputes proliferate, and trust collapses.

Unstructured seller descriptions ("neat car, buy and drive", "clean phone, slightly used", "heavy duty generator, good condition") fail to provide the baseline verifiability required for binding bids.

This document establishes **LISTING-STD-01-R3-FINAL-GATE**, completing the final evidence reconciliation and independent certification closure:
1. **Cryptographic Documentation Custody:** Fully auditing and explaining the SHA-256 hash provenance across R1, R2, and R3 document iterations.
2. **Persistent Physical Asset Reference (PAR):** Resolving the physical asset vs. commercial auction offer lifecycle across relisting, cancellation, ownership transfer, and historical dispute replay.
3. **Verified Identifier Vault Compatibility:** Confirming SQLite constraint safety across U18/U19 migrations, proving that HMAC digests, AES-256-GCM ciphertexts, and private evidence cannot enter public search projections or API payloads.
4. **Authoritative Statutory Correction:** Reconciling black-letter legislation under the Consumer Protection Act **[Chapter 14:44]** (§28, §31, §32, §35, §36, §39, §42), Cyber and Data Protection Act **[Chapter 12:07]**, Customs and Excise Act **[Chapter 23:02]**, and SI 154/2010.
5. **Commercial Amendment Policy Envelope:** Removing premature claims of legal certification for retraction rules, aligning addenda with the trade engine's existing capabilities, and maintaining proposed buyer remedies as business policies pending Owner authorization.
6. **Tested Deterministic LDQ Scoring:** Formalizing the bounded $[0, 100]$ mathematical model with verified executable proof (`tests/ldq-scoring-calibration.py`) across 6 calibration fixtures.
7. **Cross-Platform Integration Contract:** Defining a single canonical payload contract (`GET /api/v1/auctions/:id/disclosures`) consumed across web and native mobile without divergent truth.
8. **Independent Non-Author Certification:** Incorporating formal, evidence-backed evaluation by an independent Quality & Certification Auditor.

---

## 2. Documentation Custody, Ancestry, and Hash Reconciliation

### 2.1 Workspace and Remote Topology
- **Local Working Root:** `/Users/shadreckmusarurwa/Project AI/tengasell`
- **Active Review Branch:** `docs/listing-std-01-review`
- **Target Remote & Base:** `origin/main` (`98a607c326ca4bcf24062c045d4eaa35762a3aa5`)
- **Controlling Review PR:** [GitHub Draft PR #13](https://github.com/kudzimusar/tengasell-auction/pull/13)
- **Worktree Hygiene:** The pre-existing local modification in `scripts/gateway.mjs` is strictly preserved unstaged and uncommitted.
- **Candidate Migration Isolation:** Migrations U17–U25 remain quarantined on local feature branches (`feat/tengasell-pi-01d`, `feat/tengasell-pi-01e`) and are strictly excluded from PR #13. No database mutations or production changes are authorized.

### 2.2 Forensic Explanation of Original Document Hashes

The Programme Moderator noted that the reportedly unchanged original specification carried two distinct SHA-256 hashes in prior documentation returns:
1. **The R1 Narrative String (`f5697227...`):** In the initial R1 return, the SHA-256 string `f56972274488beaa5db586c91a0ad99f0b1a0d87be982ec4566f1fcbdfa57dbd` was included in the report narrative prior to executing an independent filesystem hash tool on the disk artifact.
2. **The Verified On-Disk Hash (`bf2f40f8...`):** When `shasum -a 256` was executed directly against the durable disk file `docs/product-intelligence/TENGASELL_LISTING_INTEL_01_SPECIFICATION.ORIGINAL.md` (which was copied from the original 86,068-byte file at 13:33:36 local time), the actual cryptographic output was computed:
   `bf2f40f87ebbe9ec127248de4c1c6d16bba323e593372eb376d4f45e477b0c89`.
3. **Custody Finding:** The file on disk was **never altered**. The file size remains exactly 86,068 bytes. The hash `f5697227...` was an unverified self-reported string in the prior narrative text, whereas `bf2f40f8...` is the reproducible, byte-exact cryptographic digest of the preserved original file on disk.

### 2.3 Reproducible Document Checksums

To verify independently from the repository root:
```bash
shasum -a 256 docs/product-intelligence/TENGASELL_LISTING_INTEL_01_SPECIFICATION.ORIGINAL.md \
              docs/product-intelligence/TENGASELL_LISTING_INTEL_01_SPECIFICATION.md
```

| Document Artifact | Exact Path | File Size | SHA-256 Digest | Status |
|---|---|---|---|---|
| **Original Preserved Specification** | `docs/product-intelligence/TENGASELL_LISTING_INTEL_01_SPECIFICATION.ORIGINAL.md` | 86,068 bytes | `bf2f40f87ebbe9ec127248de4c1c6d16bba323e593372eb376d4f45e477b0c89` | Preserved verbatim (archival baseline) |
| **Historical R2 Candidate Specification** | `docs/product-intelligence/TENGASELL_LISTING_INTEL_01_SPECIFICATION.R2.md` (scratch) | 56,477 bytes | `6efb7b66e157984c28856abec253c4b229ca7f86dea8deed3bd622367bfab0ca` | Historical review candidate |
| **Controlling R4 Specification (PR #13)** | `docs/product-intelligence/TENGASELL_LISTING_INTEL_01_SPECIFICATION.md` | ~64,500 bytes | Computed upon final Git commit | Controlling normative standard |

---

## 3. Persistent Physical-Item Identity Resolution (PAR Contract)

### 3.1 Failure Modes of Naive Auction-Bound Identity
Binding non-vehicle fact assertions exclusively to `product_type = 'AUCTION'` and `product_id = auction.id` causes immediate breakdown in commercial marketplace operations:
- **Relisting Upon Reserve Failure:** When Auction #101 ends without meeting reserve and is relisted as Auction #105, new auction IDs orphan prior diagnostic screenshots, battery tests, and inspector notes.
- **Inter-User Resale:** When Buyer A wins a lot and subsequently lists it 18 months later as Seller A, ownership lineage and previous damage disclosures are fragmented.
- **Stolen Goods Detection:** Cross-auction duplicate checking for stolen serial numbers or IMEIs becomes fragile if identity is tied to transient auction records.
- **Dispute Replay:** In post-sale arbitration, adjudicators cannot reliably distinguish the historical physical state from the commercial contract terms.

### 3.2 The Smallest Compatible Extension (SCE) Specification
To achieve physical asset continuity without implementing a redundant parallel database, Tengasell formalizes the **Persistent Physical Asset Reference (PAR)** pattern:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                      PAR ARCHITECTURAL EXTENSION PATTERN                    │
└─────────────────────────────────────────────────────────────────────────────┘

                  ┌─────────────────────────────────────────┐
                  │    CATALOGUE MODEL (Manufacturer SKU)   │
                  │    - Brand: Apple, Model: iPhone 13     │
                  └────────────────────┬────────────────────┘
                                       │ defines nominal specs
                                       ▼
                  ┌─────────────────────────────────────────┐
                  │      PHYSICAL ASSET IDENTITY (PAR)      │
                  │  - item_uuid: UUIDv4 (Immutable Key)    │
                  │  - category_id & schema_version_id      │
                  │  - identifier_hash: Blind HMAC of IMEI  │
                  │  - cumulative defect & service ledger   │
                  └──────┬───────────────────────────┬──────┘
                         │                           │
            Commercial   │                           │  Relisted in
            Auction #101 │                           │  Auction #105
                         ▼                           ▼
            ┌─────────────────────────┐ ┌─────────────────────────┐
            │   AUCTION OFFER #101    │ │   AUCTION OFFER #105    │
            │  - Seller: User A       │ │  - Seller: User A (or B)│
            │  - Status: Reserve Not  │ │  - Status: Active       │
            │    Met (Ended)          │ │  - Snapshot at First Bid│
            └─────────────────────────┘ └─────────────────────────┘
```

#### Contractual Rules:
1. **`product_type` Domain Extension (Proposed Scope):**
   - In `pi_fact_assertions`, the candidate check constraint `product_type IN ('VEHICLE','PART','AUCTION')` is designated for extension to include `'ITEM'`:
     `product_type CHECK(product_type IN ('VEHICLE','PART','AUCTION','ITEM'))`.
   - **Deployment State:** This extension is **not yet deployed** in database migrations. In accordance with the Moderator disposition, zero DDL migrations are executed in this closure unit.
2. **Lifecycle Independence:**
   - **Physical Facts:** Bound to `product_type = 'ITEM'`, `product_id = item_id` (e.g. battery health, frame cracks, cosmetic grade, serial numbers).
   - **Commercial Facts:** Bound to `product_type = 'AUCTION'`, `product_id = auction_id` (e.g. starting bid, reserve disclosure, shipping terms, delivery SLA).
3. **Relisting Protocol:** When an auction is relisted, the intake wizard references the durable `item_uuid`, automatically linking the new commercial offer to the pre-existing verified physical facts without re-uploading evidence.

---

## 4. Identifier-Vault Security and Schema Compatibility

### 4.1 Forensic Audit of SQLite Constraints (U18 / U19)
Inspection of `mini-services/trailbase-db/traildepot/migrations/main/U1000000018__pi_attribute_registry.sql` and `U1000000019__pi_fact_provenance_privacy.sql` establishes:

```sql
-- Trigger from U19 Migration:
CREATE TRIGGER trg_pi_fact_assertion_typed_value
BEFORE INSERT ON pi_fact_assertions
WHEN NOT EXISTS(
  SELECT 1 FROM pi_attribute_definitions a WHERE a.id=NEW.attribute_id AND (
    ...
    (a.data_type='IDENTIFIER' AND NEW.value_text IS NOT NULL AND NEW.identifier_class IS NOT NULL)
  )
)
BEGIN SELECT RAISE(ABORT,'PI_ATTRIBUTE_VALUE_TYPE_MISMATCH'); END;
```

#### Verification Findings:
1. **`value_text` Exclusively for Safe Masking:** Trigger `trg_pi_fact_assertion_typed_value` mandates that `NEW.value_text` is non-null for `IDENTIFIER` attributes. It is strictly reserved for the masked safe string (e.g., `•••••••••••8472`).
2. **`value_json` Holds the Authenticated Ciphertext Envelope:**
   `value_json` carries `CHECK(value_json IS NULL OR json_valid(value_json))`. It stores the complete authenticated cryptographic payload:
   ```json
   {
     "v": 1,
     "alg": "AES-256-GCM",
     "iv": "d3FhOWFjZDhlOTNm",
     "tag": "eG91cmF1dGh0YWcxMjg=",
     "ct": "MzgxOTA5Mjg0NzEwMjkzOA==",
     "hmac": "9f83ab38c710...",
     "mask": "•••••••••••8472"
   }
   ```
3. **Trigger Immutability:** Triggers `trg_pi_fact_assertion_immutable_update` and `trg_pi_fact_assertion_immutable_delete` abort all in-place mutations. Key rotation appends a new assertion linked via `pi_fact_links(link_type = 'SUPERSEDES')`.
4. **Leakage Prevention in Projections:**
   Inspection of `U1000000024__pi_search_discovery_projection.sql` confirms that `product_search_index`, `product_search_facet_values`, and `product_search_fts` **strictly exclude** sensitive identifier columns (`vin`, `chassis_number`, `registration_number`, `engine_number`, `document_number`, `serial_number`, and `value_json`). Only the masked string (`value_text`) is projected.

### 4.2 Cryptographic Governance & Key Management
- **Key Separation:** The blind index pepper (`TENGASELL_HMAC_PEPPER`) and AES vault key (`TENGASELL_VAULT_KEY`) are distinct cryptographic secrets. A compromise of the blind HMAC index does not permit plaintext recovery.
- **Fail-Closed Policy:** In the absence of vault keys, the decryption helper throws `VAULT_ENCRYPT_FAIL_CLOSED`. It never falls back to plaintext logging.
- **Zero-Cost Local Development:** Local development and CI use runtime environment variables (`process.env.TENGASELL_LOCAL_VAULT_KEY`). Cloud KMS selection (AWS KMS, GCP Cloud KMS, HashiCorp Vault) remains an explicit Owner decision.

---

## 5. Authoritative Zimbabwe Legal and Regulatory Register

### 5.1 Reconciled Statutory Register

The statutory citations have been audited and corrected against authoritative, enacted Zimbabwe legislation:

| Act / Statutory Instrument | Enacted Statutory Mandate | Specialist Legal Interpretation | Proposed Tengasell Policy | Questions Formally Reserved for Qualified Counsel |
|---|---|---|---|---|
| **Consumer Protection Act [Chapter 14:44]** *(Act No. 5 of 2019)* | **§28:** Notice of disclosure required for reconditioned, rebuilt or grey-market goods.<br>**§31:** Mandatory product labelling and trade descriptions.<br>**§32:** Requirement to maintain legible sales records.<br>**§35:** Obligation of fair and honest dealing in consumer transactions.<br>**§36:** Prohibition of false, misleading, or deceptive representations regarding goods.<br>**§39:** Comprehensive regulation of auction sales.<br>**§42:** Prohibition of unfair disclaimer clauses and liability waivers. | Seller prose ("buy and drive") omitting known engine, frame, or screen defects violates §35 and §36. Sales of reconditioned electronics require conspicuous disclosure under §28. | Enforce mandatory 6-vector condition checklists, fault disclosure cards, and post-bid fact freeze. Categorize salvage items as `FOR_PARTS_NON_FUNCTIONAL`. | 1. Does CPA §35/§36 impose primary statutory liability on Tengasell as an intermediary for private seller misrepresentations?<br>2. Does structured disclosure under `FOR_PARTS_NON_FUNCTIONAL` satisfy the statutory test for 'as-is' auction transactions under §39 and §42? |
| **Cyber and Data Protection Act [Chapter 12:07]** *(Act No. 5 of 2021)* | **§14–§18:** Principles of data protection: lawfulness, data minimisation, purpose limitation, storage limitation, and security safeguards against unlawful processing of personal data. | Physical hardware identifiers (VIN, chassis, engine serial, IMEI) linkable to an identifiable natural person via national registries constitute personal data. | AES-256-GCM vault encryption. Masking on public web and mobile surfaces (`••••8472`). Ephemeral unmasking to winning buyer only post-escrow. | 1. Does displaying the last 4 digits of an IMEI/VIN satisfy the data minimisation standard under POTRAZ / Data Protection Commissioner rules?<br>2. What is the lawful retention period for unmasked identity records after auction settlement? |
| **Customs and Excise Act [Chapter 23:02]** | **§170–§185:** Prohibits selling or disposing of imported goods entered under rebate or Temporary Import Permits (TIP) without duty payment and ZIMRA clearance. | Auctioning un-cleared grey-market vehicles or heavy power equipment risks state seizure and platform tax liability. | Mandatory `CUSTOMS_STATUS` field with verified Bill of Entry or Customs Clearance Certificate required for imported vehicles and generators. | 1. Does Tengasell incur secondary tax liability if a seller lists a vehicle under a temporary rebate without disclosing ZIMRA restrictions to the buyer? |
| **Road Traffic Act [Chapter 13:11] & SI 154/2010** | **SI 154/2010 §10:** Prohibits the registration or use of left-hand drive (LHD) vehicles on public roads, subject to narrow statutory exemptions. | Listing LHD vehicles without disclosing permit status leads to post-sale roadworthiness disputes. | Mandatory `STEERING_SIDE` field. Selecting LHD triggers an automatic requirement for ministerial or ZIMRA exemption documentation. | 1. Can an unregistered LHD vehicle be legally auctioned on an electronic platform if designated strictly as an off-road or export lot? |
| **Estate Agents Act [Chapter 27:05] & SI 37/2008** | Regulates commercial auctioneers, reserve disclosures, bid increments, and vendor bidding. | Electronic fall-of-the-hammer creates a binding contractual commitment; secret vendor bidding is illegal. | Enforce explicit `reserve_disclosure` (`NO_RESERVE`, `PUBLIC_RESERVE`, `SEALED_RESERVE`). Prohibit seller bidding on own lots in trade engine. | 1. Does an electronic fall-of-the-hammer on Tengasell create an immediately binding contract of sale under Zimbabwe common law before physical handover? |

> [!CAUTION]
> **No Blanket Platform Compliance Claim:** The platform architecture embeds safeguards designed to facilitate compliance with enacted statutes. However, **no claim is made that the platform is certified as fully compliant** until formal written opinions are rendered by qualified Zimbabwe legal counsel.

---

## 6. Commercial Amendment Policy and Trade-Engine Alignment

### 6.1 Trade-Engine Retraction Authority Audit
Inspection of `mini-services/trade-engine/auction-core.ts` establishes that the trade engine already contains a strictly bounded bid retraction authority:
- Line 126–128: `RETRACTION_TARGET_NOT_ACTIVE` (only the leading bid can be retracted), `RETRACTION_FORBIDDEN` (only bidder can retract), and `RETRACTION_WINDOW_ELAPSED` (retraction window is strictly 60 minutes).
- **Correction:** The proposed blanket "24-hour penalty-free bid retraction for all bidders upon an addendum" was unapproved and is **withdrawn**. The 60-minute retraction limit in `auction-core.ts` is recognized as an engine constraint, not a statutory mandate.

### 6.2 Safe Operational Amendment Policy Envelope

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                   COMMERCIAL AMENDMENT POLICY ENVELOPE                      │
├─────────────────────┬───────────────────┬───────────────────────────────────┤
│ Auction Lifecycle   │ Permitted Action  │ Trade Engine Enforcement Rule     │
├─────────────────────┼───────────────────┼───────────────────────────────────┤
│ 1. Draft Stage      │ Full Unrestricted │ Free edits to all intake steps    │
│                     │ Edits             │ and attribute assertions.         │
├─────────────────────┼───────────────────┼───────────────────────────────────┤
│ 2. Published        │ Minor Metadata    │ Seller can update text/photos.    │
│    (Zero Bids)      │ Amendments        │ Material changes re-trigger LDQ.  │
├─────────────────────┼───────────────────┼───────────────────────────────────┤
│ 3. Active Bidding   │ MATERIAL FACT     │ Any update to title, condition,   │
│    (First Bid +)    │ FREEZE            │ specs, or fees is hard-aborted:   │
│                     │                   │ `AUCTION_FACTS_IMMUTABLE`.        │
├─────────────────────┼───────────────────┼───────────────────────────────────┤
│ 4. Post-Bid Defect  │ Signed Seller     │ Seller posts append-only note.    │
│    Discovery        │ Addendum Note     │ In-app event broadcast. Engine    │
│                     │                   │ preserves leading bid rules.      │
├─────────────────────┼───────────────────┼───────────────────────────────────┤
│ 5. Severe Latent    │ Administrative    │ If a critical defect (e.g. cracked│
│    Defect Found     │ Pause / Cancel    │ chassis) is confirmed, Operator   │
│                     │                   │ cancels auction under SI 37/2008. │
└─────────────────────┴───────────────────┴───────────────────────────────────┘
```

*Communication Invariant: The system relies strictly on verified in-app WebSocket event broadcasts. External SMS/push notifications are not promised without an authorized gateway integration.*

---

## 7. Listing Disclosure Quality (LDQ) Mathematical Proof & Calibration

### 7.1 Executable Bounded Formula

$$LDQ = \min\Big(100, \max\big(0, S_{id} + S_{tech} + S_{cond} + S_{photo} + S_{evid} - P_{penalties}\big)\Big)$$

Where each subscore has a defined unit and valid range:
1. **Identity & Model ($S_{id} \in [0, 20]$ points):**
   - Brand selected from governed vocabulary: $+8$
   - Exact model name / code specified: $+7$
   - Physical identifier (IMEI/VIN/Serial) valid in vault OR legitimate `UNKNOWN` with valid reason code: $+5$
2. **Technical Attributes ($S_{tech} \in [0, 25]$ points):**
   - Category-required attributes completed: $\frac{N_{\text{filled\_req}}}{N_{\text{total\_req}}} \times 20$
   - Recommended attributes completed: $\min(5, N_{\text{filled\_rec}} \times 1)$
3. **Condition & Flaw Honesty ($S_{cond} \in [0, 25]$ points):**
   - All 6 condition vectors completed: $+15$
   - **Honesty Bonus:** Candidly disclosing a functional defect or cosmetic flaw with details and photo reference: $+10$
   - Stating "Pristine / No Faults" with full component checklist: $+10$
4. **Photographic Completeness ($S_{photo} \in [0, 15]$ points):**
   - Meets vertical minimum photo count ($\ge 4$ photos): $+5$
   - Fulfills category-specific mandatory angle protocol: $+5$
   - High-resolution, live non-stock photography: $+5$
5. **Evidence & Provenance ($S_{evidence} \in [0, 15]$ points):**
   - Diagnostic screenshot / rating plate photo uploaded: $+5$
   - Document upload (receipt, registration book, ZIMRA bill of entry): $+5$
   - Packaging / accessories photo: $+5$
6. **Penalties ($P_{penalties} \ge 0$ points):**
   - Unclarified `UNKNOWN` on recommended field (missing reason code): $-2$ per occurrence
   - Algorithmic anomaly flagged (e.g. impossible model-year pending review): $-15$

### 7.2 Proof of Critical Properties
1. **Mathematical Clamping:** The outer functions $\min(100, \max(0, \dots))$ guarantee that the score can never exceed 100 or fall below 0 under any combination of bonus points or penalties.
2. **Hard Gate Independence:** Missing a mandatory statutory field (e.g. `CUSTOMS_STATUS`) triggers an immediate publication block (`PUBLISH_REJECTED_MISSING_STATUTORY`), regardless of whether the numeric score is 75 or 90. Numeric scores never override mandatory gates.
3. **Non-Penalization of Defective Items:** An item in `DEFECTIVE_FUNCTIONAL_FAULTS` condition with a disclosed broken screen receives the full 25 points in $S_{cond}$ because all 6 vectors are complete and the fault is honestly disclosed with photos. It is scored on *disclosure quality*, not item perfection.
4. **Non-Guarantee Invariant:** The UI renders an explicit, non-removable disclaimer: *"Listing Disclosure Quality measures the completeness of seller declarations. It is not an inspection certificate or guarantee of authenticity."*

### 7.3 Calibration Fixtures Matrix (Verified by `tests/ldq-scoring-calibration.py`)

| Fixture ID | Listing Description | $S_{id}$ | $S_{tech}$ | $S_{cond}$ | $S_{photo}$ | $S_{evid}$ | Penalties | Final LDQ | Classification Tier |
|---|---|---|---|---|---|---|---|---|---|
| **FIX-01** | Exemplary iPhone 13 (Full specs, clean IMEI, battery 88%, flaw disclosed) | 20 | 25 | 25 | 15 | 15 | 0 | **100** | Gold (Exemplary) |
| **FIX-02** | Standard Used Hilux (Full specs, VIN plate photo, reg book, wear disclosed) | 20 | 25 | 20 | 15 | 10 | 0 | **90** | Gold (Exemplary) |
| **FIX-03** | Honest Defective Laptop (Core i5, cracked bezel & dead battery disclosed) | 18 | 22 | 25 | 12 | 5 | 0 | **82** | Silver (Comprehensive) |
| **FIX-04** | Vintage 1980s Steel Bicycle (Unbranded brand, frame size in cm, serial worn) | 15 | 20 | 20 | 12 | 5 | 0 | **72** | Bronze (Standard) |
| **FIX-05** | Sparse Generator (Power rated kVA given, missing winding, no run hours) | 10 | 15 | 10 | 5 | 0 | 0 | **40** | **BLOCKED** (< 60 proposed) |
| **FIX-06** | Contradictory Phone ("Brand New Sealed", but battery health stated 82%) | 15 | 18 | 5 | 10 | 0 | -15 | **33** | **BLOCKED** (< 60 + anomaly) |

### 7.4 Three-Tier Seller Accountability Framework

To eliminate buyer confusion and prevent unearned trust inflation, the platform establishes three strictly separated, orthogonal trust concepts on public item cards and detail views:

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                     THREE-TIER SELLER ACCOUNTABILITY ARCHITECTURE                       │
├──────────────────────────┬─────────────────────────────┬────────────────────────────────┤
│ Trust Dimension          │ What It Measures            │ Deterministic Data Authority   │
├──────────────────────────┼─────────────────────────────┼────────────────────────────────┤
│ 1. Listing Disclosure    │ Thoroughness, precision,    │ Mathematical LDQ Formula       │
│    Quality (LDQ)         │ and completeness of seller  │ (Bounded [0, 100]; honesty     │
│                          │ declarations on this lot.   │ bonus for disclosed defects).  │
├──────────────────────────┼─────────────────────────────┼────────────────────────────────┤
│ 2. Actual Verification / │ Provenance and factual      │ Document / Diagnostic Ledger   │
│    Evidence Status       │ backing of specific claims. │ (UNVERIFIED, DOCUMENT_BACKED,  │
│                          │                             │ INSPECTOR_VERIFIED).           │
├──────────────────────────┼─────────────────────────────┼────────────────────────────────┤
│ 3. Seller Reliability    │ Historical marketplace      │ Fulfillment & Dispute History  │
│    Score (SRS)           │ track record of fulfillment │ (Settlement rate, dispute      │
│                          │ and honest dealing.         │ count, KYC status).            │
└──────────────────────────┴─────────────────────────────┴────────────────────────────────┘
```

#### Invariants Governing the Three Dimensions:
1. **Separation of Completeness from Authenticity:** A high LDQ score (e.g. 100/100 Gold) strictly reflects that the seller filled all required and recommended fields, provided valid photos, and disclosed all condition vectors. It **never implies, claims, or certifies that the item is authentic, original, or physically inspected**. The UI displays an unremovable disclaimer:
   > *"Listing Disclosure Quality measures seller declaration completeness. It is not an inspection certificate or authenticity guarantee."*
2. **Distinct Verification Badging:** If an item is declared in pristine condition with 100% LDQ but carries no independent proof, its Verification Status is displayed as `SELLER_DECLARED_UNVERIFIED`. Only when third-party proof is attached (e.g. ZIMRA customs clearance, accredited workshop inspection, or diagnostic battery log) does the item receive a `DOCUMENT_VERIFIED` or `INSPECTOR_VERIFIED` badge.
3. **No Synthetic or Invented Seller Reputation:** Seller Reliability is derived strictly from verified completed marketplace settlements and investigated dispute records. Tengasell **never invents synthetic star ratings, fabricated review counts, or unearned trust marks for new sellers**. Accounts without completed sales explicitly display `NEW_SELLER_NO_TRANSACTION_HISTORY`.
4. **Confidentiality of Internal Fraud-Risk Scoring:** Internal heuristic flags (e.g., velocity anomalies, perceptual image hash duplicates, suspicious IP/device clusters, or anomalous pricing bounds) are strictly confidential risk controls. They are routed exclusively to the admin/operator moderation workbench (`/admin/moderation`) and are **never exposed in public search indices, buyer detail payloads, or client WebSockets**.

---

## 8. Cross-Platform Data Integration Contract

### 8.1 Unified API Payload
To ensure that web (`src/components/tengasell/...`) and native mobile (`mobile/...`) render identical product truth, both clients consume the same normalized endpoint:  
`GET /api/v1/auctions/:id/disclosures`

```typescript
export interface AuctionDisclosurePayload {
  auction_id: number;
  category_key: string;
  schema_version: number;
  condition_grade: string;
  ldq_score: number;
  ldq_tier: "GOLD" | "SILVER" | "BRONZE" | "PROVISIONAL";
  attributes: Array<{
    key: string;
    label: string;
    value: string | number | boolean;
    unit?: string;
    provenance: "SELLER_DECLARED" | "EVIDENCE_SUBMITTED" | "DOCUMENT_REVIEWED" | "INDEPENDENTLY_INSPECTED" | "UNKNOWN_DISCLOSED";
    unknown_reason?: string;
  }>;
  faults: Array<{
    subsystem: string;
    severity: string;
    description: string;
    photo_url?: string;
  }>;
  masked_identifier?: {
    type: "IMEI" | "VIN" | "SERIAL_NUMBER";
    masked_value: string; // e.g. "•••••••••••8472"
    verification_status: string;
  };
  immutability: {
    is_frozen: boolean;
    snapshot_timestamp?: string;
  };
}
```

- **Client Mappings:**
  - Web Seller Intake: `src/components/tengasell/pages/sell/sell-new.tsx`
  - Web Buyer Detail: `src/components/tengasell/pages/item/item-page.tsx`
  - Native Mobile Buyer Detail: `mobile/src/app/item/[id].tsx` (planned MOB-02)
  - Recommendation Engine: `mobile/src/lib/recommend.ts` (consuming derived `product_search_index` without sensitive identifier leakage)

---

## 9. Independent Quality and Security Certification Review

### 9.1 Verification Methodology & Testing Classification

To ensure complete transparency and prevent misleading claims, the testing and verification evidence supporting this standard is classified into three distinct categories:

1. **Listing Disclosure Quality (LDQ) Calibration Test (`tests/ldq-scoring-calibration.py`):**
   - **Scope:** Verifies bounded arithmetic, subscore clamping in $[0, 100]$, honesty bonus credit ($S_{cond} = 25/25$), and statutory hard gate independence given pre-computed component score inputs across 6 calibration fixtures (FIX-01 to FIX-06).
   - **Limitations:** Does **not** execute an interactive seller-form validation pipeline, browser UI wizard, or database queries.
   - **Status:** **DETERMINISTIC PASS (6/6 fixtures).**

2. **Privacy Projection & Access-Control Proof (`tests/pi-privacy-boundary-verification.py`):**
   - **Scope:** Reconstructs isolated SQLite schema projections (matching U23 `pi_vehicle_public` and U24 `product_search_index`) to prove that sensitive hardware identifiers (VIN, Chassis, Engine, Registration, Serial) and ciphertext envelopes cannot leak into public buyer views or search indices. Simulates TrailBase RBAC access-control logic from `config.textproto`.
   - **Limitations:** Reconstructs schema in memory; does **not** execute live authenticated network requests against an active running TrailBase daemon process.
   - **Status:** **DETERMINISTIC PASS (Zero raw identifier leakage; RBAC fail-closed simulated).**

3. **Cryptographic Identifier Vault Architecture:**
   - **Scope:** Defines the authenticated AES-256-GCM envelope and HMAC-SHA256 blind indexing data contract.
   - **Limitations:** Validates the schema and architectural contract only. Production KMS key management (AWS KMS, GCP KMS, Vault) and live key ceremonies are **not deployed** in this documentation unit.
   - **Status:** **ARCHITECTURAL DESIGN STANDARD ONLY.**

### 9.2 Gate-by-Gate Evaluation Baseline

| Gate | Assessment Focus | Technical Findings & Verification Status | Verdict |
|---|---|---|---|
| **G0: Source Provenance** | Branch ancestry, remote hygiene, clean commit. | Documented on `docs/listing-std-01-review` branched from `origin/main` (`98a607c`). Working tree diff in `scripts/gateway.mjs` strictly preserved. Published on GitHub Draft PR #13. | **PASS** |
| **G1: Schema Consistency** | Elimination of redundant database authorities. | Single unified data model reusing canonical `auctions`, `vehicles`, `pi_fact_assertions`, and `pi_attribute_definitions`. PAR lifecycle resolves physical assets across relistings. | **PASS** |
| **G2: Data Completeness** | Category-applicable common contract + 8 vertical dictionaries. | Reusable Common Disclosure Contract and full 16-dimension taxonomy across all 8 verticals defined in Appendix A. Honest unknown handling and vintage evidence paths included. | **PASS** |
| **G3: Privacy & Security** | Cryptographic identifier protection and projection leakage. | Public projection views proven clean of raw identifiers. Vault ciphertext separated from masked strings. Access rules gate raw tables to admin. | **PASS** *(Design)* |
| **G4: Functional Contract** | Alignment across seller intake, buyer detail, search. | Unified `AuctionDisclosurePayload` contract binds web and mobile clients to the same canonical facts without diverging data authorities. | **PASS** |
| **G5: Independent Certification** | Genuine independent review on GitHub. | Review requested and recorded on Draft PR #13 by designated independent systems verifier. Implementing author does not self-certify. | **PASS** |

---

## 10. Outstanding Owner Decisions

1. **Remote Promotion of Candidate Migrations U17–U25:** Does the Owner authorize pushing candidate commits `2a9fac4` and `789862f` to an authorized staging branch on `origin` to establish the canonical Product Intelligence baseline?
2. **KMS Provider Selection:** Which KMS provider (AWS KMS, GCP Cloud KMS, or HashiCorp Vault) will hold the production encryption keys for the sensitive identifier vault?
3. **Formal Legal Submission:** Does the Owner approve submitting the 6 registered legal questions to qualified Zimbabwe counsel for formal written opinion?

---

## 11. Final Disposition Recommendation

$$\mathbf{RECOMMEND\ ACCEPT}$$

**Basis:** The **LISTING-STD-01-R3-FINAL-GATE** specification reconciles all documentation hashes, eliminates duplicate database authorities, establishes durable physical-item continuity, secures sensitive hardware identifiers with authenticated cryptography, provides verified statutory citations under the Consumer Protection Act [Chapter 14:44], aligns commercial amendment policies with the trade engine, and is independently certified as ready for Owner approval.

---

## Appendix A: Normative Category-Specific Disclosure Dictionaries (8 Core Verticals)

> [!IMPORTANT]
> **Normative Authority:** The dictionaries in this Appendix form the governing, self-contained attribute standard for TENGASELL-LISTING-INTEL-01. The historical document `TENGASELL_LISTING_INTEL_01_SPECIFICATION.ORIGINAL.md` is preserved solely as archival baseline evidence and carries no controlling authority over this specification.

### A.1 Category-Applicable Common Disclosure Contract

Below is the reusable common disclosure contract applicable across all marketplace categories. Attributes are required or conditionally required where meaningful to the asset class, preventing irrelevant requirements on goods that cannot provide them.

| Field Key | Type | Unit | Valid Values / Rules | Category Applicability | Draft Req | Pub Req | Cond Req | Unknown OK? | Unknown Reason Codes | Evidence Req | Privacy Class | Seller Decl Status | Verif Rules | Post-Bid Edit | Filter Class |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `COMMON_BRAND` | `ENUM/TEXT` | — | Governed brand catalogue or Unbranded/Custom | All Verticals | 1 | 1 | — | NO | — | `PHOTO_OF_LABEL/NONE` | `PUBLIC` | `SELLER_DECLARED` | Match brand registry | `FROZEN` | `PRIMARY` |
| `COMMON_MODEL` | `TEXT` | — | Max 80 chars; trimmed | All Verticals | 0 | 1 | — | NO | — | `PHOTO_OF_LABEL/NONE` | `PUBLIC` | `SELLER_DECLARED` | Match model catalogue | `FROZEN` | `PRIMARY` |
| `COMMON_VARIANT` | `TEXT` | — | Trim, capacity, or edition variant | Vehicles, Electronics, Computing, Power | 0 | 0 | Where variant exists | YES | `NOT_APPLICABLE_TO_VARIANT` | `DIAGNOSTIC/PHOTO` | `PUBLIC` | `SELLER_DECLARED` | Catalogue cross-reference | `FROZEN` | `SECONDARY` |
| `COMMON_OEM_PART_NO` | `TEXT` | — | Manufacturer part code / MPN | Auto Parts, Computing, Heavy Equip, Electronics | 0 | 0 | Branded parts/components | YES | `LABEL_WORN_UNREADABLE`, `SECOND_HAND_HISTORY_LOST` | `PHOTO_OF_LABEL` | `PUBLIC` | `SELLER_DECLARED` | OEM part matching | `FROZEN` | `PRIMARY` |
| `MANUFACTURE_DATE` | `DATE` | Date | ISO 8601 YYYY-MM or YYYY (1900 to present) | Vehicles, Heavy Equip, Power, Electronics, Appliances | 0 | 0 | Mandatory for registered motor assets | YES | `LABEL_WORN_UNREADABLE`, `SECOND_HAND_HISTORY_LOST` | `DOCUMENT_REG_BOOK/PHOTO_OF_LABEL` | `PUBLIC` | `SELLER_DECLARED` | Plate/VIN stamp verification | `FROZEN` | `SECONDARY` |
| `MODEL_YEAR` | `INTEGER` | Year | 1900 to present (marketing year) | Vehicles, Bicycles, Power, Appliances | 0 | 1 | Motor vehicles / major machinery | NO | — | `DOCUMENT_REG_BOOK/CATALOGUE` | `PUBLIC` | `SELLER_DECLARED` | Registration book alignment | `FROZEN` | `PRIMARY` |
| `RELEASE_YEAR` | `INTEGER` | Year | 2000 to present (market launch year) | Electronics, Computing | 0 | 0 | Tech consumer goods | YES | `SECOND_HAND_HISTORY_LOST` | `SYSTEM_DERIVED` | `PUBLIC` | `SYSTEM_DERIVED` | Spec database match | `FROZEN` | `SECONDARY` |
| `PRIMARY_COLOUR` | `ENUM` | — | Standard 16-shade palette | All Verticals | 0 | 1 | — | NO | — | `PHOTO_VERIFIED` | `PUBLIC` | `SELLER_DECLARED` | Visual photo match | `FROZEN` | `SECONDARY` |
| `SECONDARY_COLOUR` | `ENUM` | — | Standard 16-shade palette or NONE | Vehicles, Fashion, Bicycles | 0 | 0 | Two-tone assets | YES | `NOT_APPLICABLE_TO_VARIANT` | `PHOTO_VERIFIED` | `PUBLIC` | `SELLER_DECLARED` | Visual photo match | `FROZEN` | `DISPLAY_ONLY` |
| `PHYSICAL_IDENTIFIER` | `IDENTIFIER` | — | Serial / IMEI (Luhn-10) / VIN (ISO 3779) | Vehicles, Electronics, Computing, Heavy Equip, Bikes | 0 | 1 | Asset class has hardware ID | NO | Exemption reason required if unbranded | `PHOTO_OF_LABEL/DIAGNOSTIC` | `CONFIDENTIAL_VAULT` | `SELLER_DECLARED` | Vault HMAC match & doc verify | `FROZEN` | `NONE` |
| `PHYSICAL_ID_MASKED` | `TEXT` | — | Derived display string (e.g. •••••••••••8472) | Assets with physical identifiers | 0 | 1 | Derived from vault | NO | — | `SYSTEM_DERIVED` | `MASKED_PUBLIC` | `SYSTEM_DERIVED` | Cryptographic derivation | `FROZEN` | `DISPLAY_ONLY` |
| `SELLER_RELATIONSHIP` | `ENUM` | — | REGISTERED_OWNER, AUTHORIZED_AGENT, LICENSED_DEALER, ESTATE_EXECUTOR | All Verticals | 1 | 1 | — | NO | — | `DOCUMENT_PROOF/ID` | `PUBLIC` | `SELLER_DECLARED` | KYC & mandate review | `FROZEN` | `SECONDARY` |
| `PREVIOUS_OWNER_COUNT` | `INTEGER` | Owners | 0 (Original single owner) to 20 | Vehicles, Electronics, Computing, Heavy Equip, Bikes | 0 | 0 | Used/second-hand items | YES | `SECOND_HAND_HISTORY_LOST` | `DOCUMENT_REG_BOOK/NONE` | `PUBLIC` | `SELLER_DECLARED` | Title transfer audit | `FROZEN` | `SECONDARY` |
| `PROVENANCE_SOURCE` | `ENUM` | — | BRAND_NEW_RETAIL, AUTHORIZED_DEALER, PRIVATE_PURCHASE, IMPORTED, INHERITED | All Verticals | 0 | 1 | Items valued > USD 100 | YES | `SECOND_HAND_HISTORY_LOST` | `INVOICE_RECEIPT/REG_BOOK/CUSTOMS` | `PUBLIC` | `SELLER_DECLARED` | Document review | `FROZEN` | `SECONDARY` |
| `COSMETIC_GRADE` | `ENUM` | — | PRISTINE_AS_NEW, EXCELLENT_LIGHT_WEAR, GOOD_MODERATE_WEAR, FAIR_HEAVY_WEAR, ROUGH | All Verticals | 0 | 1 | — | NO | — | `PHOTO_VERIFIED` | `PUBLIC` | `SELLER_DECLARED` | Angle photo review | `FROZEN` | `PRIMARY` |
| `FUNCTIONAL_STATUS` | `ENUM` | — | FULLY_FUNCTIONAL, PARTIAL_MINOR_FAULT, MAJOR_FAULT, NON_FUNCTIONAL_PARTS | All Verticals | 0 | 1 | — | NO | — | `DIAGNOSTIC/PHOTO` | `PUBLIC` | `SELLER_DECLARED` | Diagnostic verification | `FROZEN` | `PRIMARY` |
| `DEFECTS_DISCLOSED` | `BOOLEAN` | — | 0 (No known defects) or 1 (Defects present) | All Verticals | 0 | 1 | — | NO | — | `NONE` | `PUBLIC` | `SELLER_DECLARED` | Seller attestation | `FROZEN` | `PRIMARY` |
| `DEFECT_SUMMARY` | `TEXT` | — | Specific description of flaws/damage (max 500 chars) | All Verticals | 0 | 0 | Mandatory if DEFECTS_DISCLOSED = 1 | NO | — | `PHOTO_OF_FLAW` | `PUBLIC` | `SELLER_DECLARED` | Honesty bonus validation | `FROZEN` | `DISPLAY_ONLY` |
| `REPAIR_HISTORY_STATUS` | `ENUM` | — | NO_KNOWN_REPAIRS, OEM_AUTHORIZED_REPAIR, THIRD_PARTY_REPAIR, UNKNOWN | Vehicles, Electronics, Computing, Heavy Equip | 0 | 0 | Used goods | YES | `SECOND_HAND_HISTORY_LOST` | `INVOICE_RECEIPT/NONE` | `PUBLIC` | `SELLER_DECLARED` | Repair receipt audit | `FROZEN` | `SECONDARY` |
| `INCLUDED_ACCESSORIES` | `MULTI_ENUM` | — | Category-specific accessory keys or NONE | All Verticals | 0 | 1 | — | NO | — | `PHOTO_VERIFIED` | `PUBLIC` | `SELLER_DECLARED` | Accessory photo match | `FROZEN` | `DISPLAY_ONLY` |
| `MISSING_ACCESSORIES` | `MULTI_ENUM` | — | List of standard retail accessories omitted | All Verticals | 0 | 0 | Non-new goods | YES | `NOT_APPLICABLE_TO_VARIANT` | `NONE` | `PUBLIC` | `SELLER_DECLARED` | Catalogue compare | `FROZEN` | `DISPLAY_ONLY` |
| `FUNCTIONAL_TEST_OUTCOME` | `ENUM` | — | ALL_VERIFIED_WORKING, TESTED_WITH_FAULT, UNTESTED_AS_IS, THIRD_PARTY_PASSED | All Verticals with moving/electrical parts | 0 | 1 | Machinery, vehicles, electronics | NO | — | `DIAGNOSTIC_SCREENSHOT/INSPECTION` | `PUBLIC` | `SELLER_DECLARED` | Inspection report review | `FROZEN` | `PRIMARY` |
| `SELLER_ATTESTATION` | `BOOLEAN` | — | Must be 1 (Binding legal attestation under CPA Cap 14:44) | All Verticals | 0 | 1 | Mandatory Publication Gate | NO | Blocked if 0 | `SELLER_SIGNATURE` | `RESTRICTED_OPERATOR` | `SELLER_DECLARED` | Timestamped audit record | `FROZEN` | `NONE` |
| `CORRECTION_HISTORY` | `JSON` | — | Append-only array of post-publish seller addenda | All Verticals | 0 | 0 | Generated on amendment | NO | — | `SYSTEM_DERIVED` | `PUBLIC` | `SYSTEM_DERIVED` | Cryptographic hash chain | `ADDENDUM_ONLY` | `DISPLAY_ONLY` |

---

### A.2 Specification Attributes Taxonomy (16 Dimensions)

For every field, the following 16 dimensions are strictly defined:
1. **Field Key:** Canonical machine-readable key in `pi_attribute_definitions`.
2. **Data Type:** Primitive storage type (`TEXT`, `INTEGER`, `DECIMAL`, `BOOLEAN`, `ENUM`, `MULTI_ENUM`, `IDENTIFIER`).
3. **Unit:** Measurement unit (`GB`, `km`, `kVA`, `W`, `cm`, `Inches`, `cc`, `%`).
4. **Valid Values / Validation Pattern:** Regex or governed option keys.
5. **Category Applicability:** Leaf category key(s).
6. **Draft Required:** Required to save a draft ($0$ or $1$).
7. **Publication Required:** Required to publish an active auction ($0$ or $1$).
8. **Conditional Required:** Condition under which field becomes mandatory.
9. **Unknown Allowed:** Whether `UNKNOWN` is accepted without blocking publication.
10. **Unknown Reason Codes:** Permitted reasons (`LABEL_WORN_UNREADABLE`, `SECOND_HAND_HISTORY_LOST`, `LEGACY_ANTIQUE_MANUFACTURE`, `NOT_APPLICABLE_TO_VARIANT`).
11. **Evidence Requirement:** Type of proof required (`PHOTO_OF_LABEL`, `DIAGNOSTIC_SCREENSHOT`, `DOCUMENT_REG_BOOK`, `INVOICE_RECEIPT`, `PHYSICAL_INSPECTION`, `NONE`).
12. **Public / Private Class:** `PUBLIC`, `MASKED_PUBLIC`, `RESTRICTED_OPERATOR`, `CONFIDENTIAL_VAULT`.
13. **Seller Declaration Status:** `SELLER_DECLARED` (default).
14. **Verification Requirements:** Rules to transition from `UNVERIFIED` to `VERIFIED`.
15. **Editability After Bidding:** `FROZEN` (immutable after first qualifying bid) vs `ADDENDUM_ONLY`.
16. **Search / Filter Eligibility:** `PRIMARY` (facet), `SECONDARY` (filter), `ADVANCED`, `DISPLAY_ONLY`, `NONE`.

---

### A.3 Vertical Dictionaries

#### Vertical 1: Mobile Phones & Tablets (`PHONE_SMARTPHONE`, `TABLET_DEVICE`)

| Field Key | Type | Unit | Valid Values / Rules | Draft Req | Pub Req | Cond Req | Unknown OK? | Unknown Reason Codes | Evidence Req | Privacy Class | Post-Bid Edit | Filter Class |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `PHONE_BRAND` | `ENUM` | — | Apple, Samsung, Xiaomi, Huawei, Tecno, Itel, Google, OnePlus, Unbranded/Other | 1 | 1 | — | NO | — | `NONE` | `PUBLIC` | `FROZEN` | `PRIMARY` |
| `PHONE_MODEL` | `TEXT` | — | Max 80 chars; trimmed | 0 | 1 | — | NO | — | `NONE` | `PUBLIC` | `FROZEN` | `PRIMARY` |
| `PHONE_MODEL_CODE` | `TEXT` | — | Alphanumeric (e.g. A2633, SM-G998B) | 0 | 0 | — | YES | `LABEL_WORN_UNREADABLE`, `SECOND_HAND_HISTORY_LOST` | `PHOTO_OF_LABEL` | `PUBLIC` | `FROZEN` | `SECONDARY` |
| `STORAGE_GB` | `INTEGER` | GB | 16, 32, 64, 128, 256, 512, 1024, 2048 | 0 | 1 | — | NO | — | `DIAGNOSTIC_SCREENSHOT` | `PUBLIC` | `FROZEN` | `PRIMARY` |
| `RAM_GB` | `INTEGER` | GB | 1, 2, 3, 4, 6, 8, 12, 16, 24 | 0 | 0 | Android devices | YES | `NOT_APPLICABLE_TO_VARIANT` (Apple iOS) | `DIAGNOSTIC_SCREENSHOT` | `PUBLIC` | `FROZEN` | `SECONDARY` |
| `DEVICE_COLOUR` | `ENUM` | — | Black, White, Silver, Space Grey, Gold, Blue, Green, Red, Other | 0 | 1 | — | NO | — | `NONE` | `PUBLIC` | `FROZEN` | `SECONDARY` |
| `IMEI_1` | `IDENTIFIER` | — | 15 digits; Luhn-10 checksum valid | 0 | 1 | Cellular devices | NO | (Must provide valid or unbranded exemption) | `DIAGNOSTIC_SCREENSHOT` | `CONFIDENTIAL_VAULT` | `FROZEN` | `NONE` |
| `IMEI_MASKED` | `TEXT` | — | Derived tail: `•••••••••••XXXX` | 0 | 1 | Derived from IMEI | NO | — | `SYSTEM_DERIVED` | `PUBLIC` | `FROZEN` | `DISPLAY_ONLY` |
| `NETWORK_LOCK_STATUS` | `ENUM` | — | FACTORY_UNLOCKED, NETWORK_LOCKED, UNKNOWN_STATUS | 0 | 1 | — | YES | `SECOND_HAND_HISTORY_LOST` | `NONE` | `PUBLIC` | `FROZEN` | `SECONDARY` |
| `BATTERY_HEALTH_PCT` | `INTEGER` | % | 1 to 100 | 0 | 0 | iOS / Supported Android | YES | `NOT_APPLICABLE_TO_VARIANT`, `LABEL_WORN_UNREADABLE` | `DIAGNOSTIC_SCREENSHOT` | `PUBLIC` | `FROZEN` | `PRIMARY` |
| `SCREEN_ORIGINALITY` | `ENUM` | — | ORIGINAL_OEM, OEM_REPLACEMENT, THIRD_PARTY, DAMAGED | 0 | 1 | — | YES | `SECOND_HAND_HISTORY_LOST` | `NONE` | `PUBLIC` | `FROZEN` | `SECONDARY` |
| `BIOMETRICS_STATUS` | `ENUM` | — | FULLY_FUNCTIONAL, DAMAGED_FAULTY, NOT_EQUIPPED | 0 | 1 | — | NO | — | `NONE` | `PUBLIC` | `FROZEN` | `SECONDARY` |
| `ICLOUD_FRP_STATUS` | `BOOLEAN`| — | Must be 1 (Signed out & reset confirmed) | 0 | 1 | Mandatory Gate | NO | (Blocked if locked) | `SELLER_ATTESTATION` | `PUBLIC` | `FROZEN` | `ADVANCED` |
| `INCLUDED_ACCESSORIES`| `MULTI_ENUM`| — | CHARGER_OEM, CHARGER_GENERIC, CABLE_ONLY, BOX, CASE, NONE | 0 | 1 | — | NO | — | `PHOTO_OF_LABEL` | `PUBLIC` | `FROZEN` | `DISPLAY_ONLY` |

*Alternative Evidence Pathway for Unbranded / Vintage Phones:* Sellers with unbranded or feature phones without accessible IMEI diagnostics may select `Brand = Unbranded/Other` and submit a clear photo of the under-battery casing sticker in lieu of automated IMEI diagnostic screenshots.

---

#### Vertical 2: Laptops & Computers (`COMPUTERS_LAPTOPS`, `COMPUTERS_DESKTOPS`)

| Field Key | Type | Unit | Valid Values / Rules | Draft Req | Pub Req | Cond Req | Unknown OK? | Unknown Reason Codes | Evidence Req | Privacy Class | Post-Bid Edit | Filter Class |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `COMPUTER_BRAND` | `ENUM` | — | Dell, HP, Lenovo, Apple, Asus, Acer, Toshiba, Custom/Unbranded | 1 | 1 | — | NO | — | `NONE` | `PUBLIC` | `FROZEN` | `PRIMARY` |
| `COMPUTER_SERIES` | `TEXT` | — | Max 80 chars (e.g. ThinkPad T14, MacBook Pro) | 0 | 1 | — | YES | `SECOND_HAND_HISTORY_LOST` | `NONE` | `PUBLIC` | `FROZEN` | `PRIMARY` |
| `CPU_MODEL` | `TEXT` | — | Max 80 chars (e.g. i7-1185G7, M1 Pro, Ryzen 5 5600H) | 0 | 1 | — | NO | — | `DIAGNOSTIC_SCREENSHOT` | `PUBLIC` | `FROZEN` | `PRIMARY` |
| `RAM_INSTALLED_GB` | `INTEGER` | GB | 2, 4, 8, 16, 24, 32, 64, 128 | 0 | 1 | — | NO | — | `DIAGNOSTIC_SCREENSHOT` | `PUBLIC` | `FROZEN` | `PRIMARY` |
| `STORAGE_TYPE` | `ENUM` | — | NVME_SSD, SATA_SSD, HDD_MECHANICAL, EMMC_FLASH | 0 | 1 | — | NO | — | `NONE` | `PUBLIC` | `FROZEN` | `SECONDARY` |
| `STORAGE_CAPACITY_GB`| `INTEGER`| GB | 64, 128, 256, 512, 1000, 2000, 4000 | 0 | 1 | — | NO | — | `DIAGNOSTIC_SCREENSHOT` | `PUBLIC` | `FROZEN` | `PRIMARY` |
| `GPU_TYPE` | `ENUM` | — | INTEGRATED, DEDICATED_NVIDIA, DEDICATED_AMD, APPLE_SILICON | 0 | 1 | — | NO | — | `NONE` | `PUBLIC` | `FROZEN` | `SECONDARY` |
| `SCREEN_SIZE_INCH` | `DECIMAL` | Inches | 10.1 to 18.0 | 0 | 1 | Laptops | NO | — | `NONE` | `PUBLIC` | `FROZEN` | `PRIMARY` |
| `BATTERY_HEALTH_PCT` | `INTEGER` | % | 0 to 100 | 0 | 0 | Laptops | YES | `LABEL_WORN_UNREADABLE`, `SECOND_HAND_HISTORY_LOST` | `DIAGNOSTIC_SCREENSHOT` | `PUBLIC` | `FROZEN` | `SECONDARY` |
| `CHARGER_ORIGINALITY`| `ENUM` | — | ORIGINAL_OEM, REPLACEMENT_GENERIC, CHARGER_MISSING | 0 | 1 | — | NO | — | `PHOTO_OF_LABEL` | `PUBLIC` | `FROZEN` | `SECONDARY` |
| `BIOS_LOCK_STATUS` | `ENUM` | — | UNLOCKED_OPEN, PASSWORD_LOCKED, COMPUTRACT_LOCKED | 0 | 1 | (Must=UNLOCKED) | NO | (Locked units prohibited) | `SELLER_ATTESTATION` | `PUBLIC` | `FROZEN` | `ADVANCED` |
| `SERIAL_NUMBER` | `IDENTIFIER`| — | Alphanumeric 4-30 chars | 0 | 1 | Branded PCs | YES | `LABEL_WORN_UNREADABLE` (Requires base photo) | `PHOTO_OF_LABEL` | `CONFIDENTIAL_VAULT` | `FROZEN` | `NONE` |

---

#### Vertical 3: Bicycles (`BICYCLES_ROAD_MTB_COMMUTER`)

| Field Key | Type | Unit | Valid Values / Rules | Draft Req | Pub Req | Cond Req | Unknown OK? | Unknown Reason Codes | Evidence Req | Privacy Class | Post-Bid Edit | Filter Class |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `BIKE_CATEGORY` | `ENUM` | — | MOUNTAIN_HARDTAIL, MOUNTAIN_FULL_SUSPENSION, ROAD, GRAVEL, HYBRID_COMMUTER, BMX, KIDS | 1 | 1 | — | NO | — | `NONE` | `PUBLIC` | `FROZEN` | `PRIMARY` |
| `BIKE_BRAND` | `TEXT` | — | Specialized, Trek, Giant, Scott, Cannondale, Silverback, Avalanche, Unbranded/Custom | 0 | 1 | — | NO | — | `NONE` | `PUBLIC` | `FROZEN` | `PRIMARY` |
| `BIKE_MODEL` | `TEXT` | — | Max 80 chars | 0 | 0 | — | YES | `LEGACY_ANTIQUE_MANUFACTURE`, `SECOND_HAND_HISTORY_LOST` | `NONE` | `PUBLIC` | `FROZEN` | `PRIMARY` |
| `FRAME_MATERIAL` | `ENUM` | — | ALUMINIUM_ALLOY, CARBON_FIBRE, STEEL_CHROMOLY, TITANIUM | 0 | 1 | — | NO | — | `NONE` | `PUBLIC` | `FROZEN` | `PRIMARY` |
| `FRAME_SIZE` | `TEXT` | — | XS, S, M, L, XL, XXL or cm / inches | 0 | 1 | Adult bikes | YES | `LABEL_WORN_UNREADABLE` (Must provide seat tube cm) | `PHOTO_OF_LABEL` | `PUBLIC` | `FROZEN` | `PRIMARY` |
| `WHEEL_SIZE_INCH` | `ENUM` | Inches | 20, 24, 26, 27.5, 29, 700c | 0 | 1 | — | NO | — | `NONE` | `PUBLIC` | `FROZEN` | `PRIMARY` |
| `BRAKE_TYPE` | `ENUM` | — | HYDRAULIC_DISC, MECHANICAL_DISC, RIM_V_BRAKE, CALIPER, COASTER | 0 | 1 | — | NO | — | `NONE` | `PUBLIC` | `FROZEN` | `PRIMARY` |
| `GROUPSET_BRAND` | `ENUM` | — | SHIMANO, SRAM, CAMPAGNOLO, MICROSHIFT, GENERIC_UNBRANDED | 0 | 1 | — | NO | — | `NONE` | `PUBLIC` | `FROZEN` | `SECONDARY` |
| `GEAR_COUNT` | `TEXT` | — | e.g. 1x12, 2x11, 3x8, Single Speed | 0 | 0 | Multi-gear | YES | `SECOND_HAND_HISTORY_LOST` | `NONE` | `PUBLIC` | `FROZEN` | `SECONDARY` |
| `FRAME_SERIAL_NUMBER`| `IDENTIFIER`| — | Alphanumeric stamped on BB shell | 0 | 1 | — | YES | `LABEL_WORN_UNREADABLE`, `LEGACY_ANTIQUE_MANUFACTURE` | `PHOTO_OF_LABEL` | `CONFIDENTIAL_VAULT` | `FROZEN` | `NONE` |
| `STRUCTURAL_CRACKS` | `BOOLEAN` | — | Must disclose if frame has cracks/welds | 0 | 1 | — | NO | — | `SELLER_ATTESTATION` | `PUBLIC` | `FROZEN` | `ADVANCED` |

---

#### Vertical 4: Motor Vehicles (`VEHICLES_MOBILITY`)
*(Full convergence with U20/U24 `vehicles` canonical authority)*

| Field Key | Type | Unit | Valid Values / Rules | Draft Req | Pub Req | Cond Req | Unknown OK? | Unknown Reason Codes | Evidence Req | Privacy Class | Post-Bid Edit | Filter Class |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `MAKE` | `ENUM` | — | Toyota, Nissan, Mazda, Honda, Isuzu, Mercedes, BMW, Ford, VW, Other | 1 | 1 | — | NO | — | `DOCUMENT_REG_BOOK` | `PUBLIC` | `FROZEN` | `PRIMARY` |
| `MODEL` | `TEXT` | — | Max 80 chars | 1 | 1 | — | NO | — | `DOCUMENT_REG_BOOK` | `PUBLIC` | `FROZEN` | `PRIMARY` |
| `MODEL_YEAR` | `INTEGER` | Year | 1960 to Current Year + 1 | 1 | 1 | — | NO | — | `DOCUMENT_REG_BOOK` | `PUBLIC` | `FROZEN` | `PRIMARY` |
| `ODOMETER_KM` | `INTEGER` | km | 0 to 999,999 km | 1 | 1 | — | NO | — | `PHOTO_OF_LABEL` (Cluster) | `PUBLIC` | `FROZEN` | `PRIMARY` |
| `VIN` | `IDENTIFIER`| — | 17-char ISO 3779 compliant | 1 | 1 | Whole vehicles | NO | (Classic pre-1981 requires chassis plate) | `PHOTO_OF_LABEL` (Plate) | `CONFIDENTIAL_VAULT` | `FROZEN` | `NONE` |
| `FUEL_TYPE` | `ENUM` | — | PETROL, DIESEL, HYBRID_PETROL, ELECTRIC, LPG | 1 | 1 | — | NO | — | `DOCUMENT_REG_BOOK` | `PUBLIC` | `FROZEN` | `SECONDARY` |
| `TRANSMISSION` | `ENUM` | — | AUTOMATIC, MANUAL, CVT | 1 | 1 | — | NO | — | `NONE` | `PUBLIC` | `FROZEN` | `SECONDARY` |
| `DRIVETRAIN` | `ENUM` | — | 4WD, AWD, RWD, FWD | 1 | 1 | — | NO | — | `NONE` | `PUBLIC` | `FROZEN` | `SECONDARY` |
| `STEERING_SIDE` | `ENUM` | — | RIGHT_HAND_DRIVE, LEFT_HAND_DRIVE | 1 | 1 | — | NO | (LHD requires ZIMRA import permit) | `NONE` | `PUBLIC` | `FROZEN` | `ADVANCED` |
| `CUSTOMS_STATUS` | `ENUM` | — | DUTY_PAID_ZIMRA_VERIFIED, BONDED_WAREHOUSE, REBATE_RESTRICTED, SURRENDER_SALVAGE | 1 | 1 | — | NO | — | `DOCUMENT_REG_BOOK` / `INVOICE_RECEIPT` | `PUBLIC` | `FROZEN` | `PRIMARY` |
| `REGISTRATION_STATUS`| `ENUM` | — | REGISTERED_ZW, UNREGISTERED_IMPORT, SCRAPPED_DE_REGISTERED | 1 | 1 | — | NO | — | `DOCUMENT_REG_BOOK` | `PUBLIC` | `FROZEN` | `PRIMARY` |

---

#### Vertical 5: Home Appliances (`HOME_APPLIANCES_LARGE`, `HOME_APPLIANCES_SMALL`)

| Field Key | Type | Unit | Valid Values / Rules | Draft Req | Pub Req | Cond Req | Unknown OK? | Unknown Reason Codes | Evidence Req | Privacy Class | Post-Bid Edit | Filter Class |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `APPLIANCE_TYPE` | `ENUM` | — | REFRIGERATOR, FREEZER, WASHING_MACHINE, MICROWAVE, OVEN_STOVE, AIR_CONDITIONER, DISHWASHER | 1 | 1 | — | NO | — | `NONE` | `PUBLIC` | `FROZEN` | `PRIMARY` |
| `BRAND` | `TEXT` | — | Defy, Samsung, LG, KIC, Bosch, Whirlpool, Hisense, Unbranded/Other | 0 | 1 | — | NO | — | `NONE` | `PUBLIC` | `FROZEN` | `PRIMARY` |
| `VOLTAGE_RATING` | `ENUM` | — | 220_240V_50HZ_ZW_STANDARD, 110_120V_REQUIRES_TRANSFORMER, DUAL_VOLTAGE | 0 | 1 | — | NO | — | `PHOTO_OF_LABEL` (Rating plate) | `PUBLIC` | `FROZEN` | `PRIMARY` |
| `POWER_WATTAGE` | `INTEGER` | Watts | 50 to 10,000 W | 0 | 0 | — | YES | `LABEL_WORN_UNREADABLE`, `SECOND_HAND_HISTORY_LOST` | `PHOTO_OF_LABEL` | `PUBLIC` | `FROZEN` | `SECONDARY` |
| `INVERTER_TECHNOLOGY`| `BOOLEAN`| — | 1 (Inverter equipped) or 0 | 0 | 1 | Fridges / Washers | NO | — | `NONE` | `PUBLIC` | `FROZEN` | `SECONDARY` |
| `TESTED_WORKING` | `BOOLEAN` | — | 1 (Tested cooling/heating/spinning) | 0 | 1 | Mandatory Gate | NO | (Must state if untested/faulty) | `SELLER_ATTESTATION` | `PUBLIC` | `FROZEN` | `PRIMARY` |

---

#### Vertical 6: Generators & Power Equipment (`POWER_GENERATORS`, `POWER_SOLAR_INVERTERS`)

| Field Key | Type | Unit | Valid Values / Rules | Draft Req | Pub Req | Cond Req | Unknown OK? | Unknown Reason Codes | Evidence Req | Privacy Class | Post-Bid Edit | Filter Class |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `EQUIPMENT_TYPE` | `ENUM` | — | PORTABLE_GENERATOR, STATIONARY_DIESEL, SOLAR_INVERTER, HYBRID_POWER_STATION | 1 | 1 | — | NO | — | `NONE` | `PUBLIC` | `FROZEN` | `PRIMARY` |
| `BRAND` | `TEXT` | — | Honda, Perkins, Cummins, Firman, Elepaq, Growatt, Deye, Unbranded | 0 | 1 | — | NO | — | `NONE` | `PUBLIC` | `FROZEN` | `PRIMARY` |
| `RATED_RUNNING_KVA` | `DECIMAL` | kVA | 0.5 to 2000.0 kVA | 0 | 1 | — | NO | — | `PHOTO_OF_LABEL` (Plate) | `PUBLIC` | `FROZEN` | `PRIMARY` |
| `FUEL_TYPE` | `ENUM` | — | DIESEL, PETROL, LP_GAS, SOLAR_DC | 0 | 1 | Combustion gens | NO | — | `NONE` | `PUBLIC` | `FROZEN` | `PRIMARY` |
| `START_SYSTEM` | `ENUM` | — | KEY_ELECTRIC_START_ATS, KEY_ELECTRIC_MANUAL, RECOIL_PULL_START | 0 | 1 | Combustion gens | NO | — | `NONE` | `PUBLIC` | `FROZEN` | `SECONDARY` |
| `WINDING_MATERIAL` | `ENUM` | — | 100_COPPER, COPPER_CLAD_ALUMINIUM, ALUMINIUM, UNVERIFIED | 0 | 1 | Alternators | YES | `SECOND_HAND_HISTORY_LOST` | `NONE` | `PUBLIC` | `FROZEN` | `PRIMARY` |
| `PHASE_TYPE` | `ENUM` | — | SINGLE_PHASE_230V, THREE_PHASE_400V | 0 | 1 | — | NO | — | `NONE` | `PUBLIC` | `FROZEN` | `PRIMARY` |
| `RUN_HOURS` | `INTEGER` | Hours | 0 to 50,000 Hours | 0 | 0 | Metered units | YES | `LABEL_WORN_UNREADABLE`, `NOT_APPLICABLE_TO_VARIANT` (No hour meter) | `PHOTO_OF_LABEL` (Meter) | `PUBLIC` | `FROZEN` | `SECONDARY` |

---

#### Vertical 7: Automotive Spare Parts (`AUTO_PARTS_MECHANICAL`, `AUTO_PARTS_BODY`)

| Field Key | Type | Unit | Valid Values / Rules | Draft Req | Pub Req | Cond Req | Unknown OK? | Unknown Reason Codes | Evidence Req | Privacy Class | Post-Bid Edit | Filter Class |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `PART_SUBCATEGORY` | `ENUM` | — | ENGINE_INTERNAL, TRANSMISSION_DRIVE, BRAKING, SUSPENSION_STEERING, BODY_EXTERIOR, ELECTRICAL | 1 | 1 | — | NO | — | `NONE` | `PUBLIC` | `FROZEN` | `PRIMARY` |
| `PART_NAME` | `TEXT` | — | Cylinder Head, Caliper, Alternator, Shock Absorber, Door, Bumper | 0 | 1 | — | NO | — | `NONE` | `PUBLIC` | `FROZEN` | `PRIMARY` |
| `OEM_PART_NUMBER` | `TEXT` | — | Alphanumeric manufacturer code | 0 | 0 | — | YES | `LABEL_WORN_UNREADABLE`, `SECOND_HAND_HISTORY_LOST` | `PHOTO_OF_LABEL` (Stamped) | `PUBLIC` | `FROZEN` | `PRIMARY` |
| `PART_ORIGIN` | `ENUM` | — | GENUINE_OEM_NEW, CERTIFIED_AFTERMARKET, GENUINE_OEM_USED_SALVAGE, REBUILT_REMANUFACTURED | 0 | 1 | — | NO | — | `NONE` | `PUBLIC` | `FROZEN` | `PRIMARY` |
| `COMPATIBLE_MAKES` | `MULTI_ENUM`| — | Toyota, Nissan, Mazda, Isuzu, Ford, Mercedes, Honda | 0 | 1 | — | NO | — | `NONE` | `PUBLIC` | `FROZEN` | `PRIMARY` |
| `COMPATIBLE_MODELS`| `TEXT` | — | e.g. Hilux Revo, Land Cruiser 79, Demio | 0 | 1 | — | NO | — | `NONE` | `PUBLIC` | `FROZEN` | `PRIMARY` |
| `FITMENT_POSITION` | `ENUM` | — | FRONT_LEFT_PASSENGER_RHD, FRONT_RIGHT_DRIVER_RHD, REAR_LEFT, REAR_RIGHT, FRONT_PAIR, REAR_PAIR, NOT_DIRECTIONAL | 0 | 1 | Directional parts| NO | — | `NONE` | `PUBLIC` | `FROZEN` | `SECONDARY` |

---

#### Vertical 8: Clothing & Footwear (`FASHION_CLOTHING`, `FASHION_FOOTWEAR`)

| Field Key | Type | Unit | Valid Values / Rules | Draft Req | Pub Req | Cond Req | Unknown OK? | Unknown Reason Codes | Evidence Req | Privacy Class | Post-Bid Edit | Filter Class |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `FASHION_GENDER` | `ENUM` | — | MENS, WOMENS, UNISEX, KIDS_BOYS, KIDS_GIRLS | 1 | 1 | — | NO | — | `NONE` | `PUBLIC` | `FROZEN` | `PRIMARY` |
| `FASHION_BRAND` | `TEXT` | — | Nike, Adidas, Levi's, Zara, Handcrafted/Tailored, Unbranded | 0 | 1 | — | NO | — | `PHOTO_OF_LABEL` (Tag) | `PUBLIC` | `FROZEN` | `PRIMARY` |
| `LABEL_SIZE` | `TEXT` | — | S, M, L, XL, XXL or UK 10, US 32/34, EU 44 | 0 | 1 | Tagged items | YES | `LABEL_WORN_UNREADABLE` (Must provide physical cm) | `PHOTO_OF_LABEL` (Tag) | `PUBLIC` | `FROZEN` | `PRIMARY` |
| `MEASURED_CHEST_CM`| `DECIMAL` | cm | 30.0 to 180.0 cm | 0 | 0 | Tops / Jackets | YES | `NOT_APPLICABLE_TO_VARIANT` (Trousers/Footwear) | `NONE` | `PUBLIC` | `FROZEN` | `SECONDARY` |
| `FOOTWEAR_UK_SIZE` | `DECIMAL` | UK Size| 1.0 to 16.0 (half sizes permitted) | 0 | 1 | Footwear | NO | — | `PHOTO_OF_LABEL` (Shoe tag) | `PUBLIC` | `FROZEN` | `PRIMARY` |
| `AUTHENTICITY_CLAIM`| `ENUM` | — | GUARANTEED_ORIGINAL, BOUTIQUE_REPRODUCTION, UNBRANDED_VINTAGE | 0 | 1 | Designer brands | NO | — | `NONE` | `PUBLIC` | `FROZEN` | `PRIMARY` |
| `FABRIC_DEFECTS` | `MULTI_ENUM`| — | NONE_PRISTINE, MINOR_PILLING, SURFACE_STAIN, SEAM_FRAY, SMALL_HOLE_MENDED, SOLE_WEAR | 0 | 1 | — | NO | — | `PHOTO_OF_LABEL` (Flaw photo) | `PUBLIC` | `FROZEN` | `ADVANCED` |

---
