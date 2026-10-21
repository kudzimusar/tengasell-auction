# GAP8-F1 — gap8-f1-full-stack-developer — Work Record

## Task
Gap-8 Feature 1 UI for Tengasell (hash-router SPA): (F1a) "Save this search" on browse-page.tsx, (F1b) Saved-searches section on account page, (F1c) Sell-wizard "Optional boosts" (Best-Offer + Featured listing US$2+VAT). i18n keys only inside the marked F1 block of src/lib/tengasell/i18n.tsx.

## Files changed (exclusive ownership respected)
- `src/components/tengasell/pages/browse/browse-page.tsx` — Save button (BellPlus) in results toolbar, sign-in gate, criteria dialog, api.saveSearch + toast; session fix: `min-w-11` (44×44 at 390px, was 42×44).
- `src/components/tengasell/pages/account/saved-searches-section.tsx` — full section (useResource → LoadingGrid/ErrorState/EmptyState), cards with criteria chips, optimistic alert switch (api.setSearchAlerts), Run-search deep link matching browse URL parsing exactly, AlertDialog delete, >8-cards max-h-96 ts-scrollbar.
- `src/components/tengasell/pages/sell/sell-new.tsx` — Step-2 "Optional boosts" subgroup: Accept-offers switch + optional minimum-offer number input (validated ≥1 and < buy-now, inline errors), Featured switch; Step-3 review rows; submit passes allowOffers/offerMin then api.featureListing with never-lose-the-listing failure banner + Retry.
- `src/lib/tengasell/i18n.tsx` — 51 bilingual keys replacing the `searches.f1.anchor` placeholder inside the F1 block only.

## Verification (live, through Caddy :81, TrailBase live mode)
- Save dialog (query-only and category+price criteria) → POST saved_searches 200 → section card renders → alert PATCH on/off → run-search deep links (`?q=solar`, `?cat=solar-power&min=100&max=500`) land with seeded filters → AlertDialog delete removes card.
- Wizard E2E twice as rufaro: auctions 2008 (allow_offers=1, offer_min=12, featured=1) and 2009 (allow_offers=1, offer_min=5, featured=1); both feature fees charged; home "Featured this week" rail shows both. Validation errors verified (offer 0.5 → ≥US$1 msg; 45 vs buy-now 40 → below-buy-now msg). Success pill "Featured — showing in the home page rail". Failure→Retry banner code-verified (balance too healthy to trigger naturally; engine reasons already covered by ops/gap8 probes).
- EN + JA strings verified rendering (この検索を保存 / 保存する条件 / オプション / 注目出品にする — 2米ドル＋消費税 …). 390px targets 44px. 0 page errors.
- tsc filtered to the 4 files: 0 errors. eslint on the 4 files: 0 problems. Full lint: 0 errors (1080 pre-existing warnings unchanged).
- Screenshots: `screenshots/gap8-f1-{save-dialog-390,saved-searches-390,browse-desktop,sell-boosts,sell-review,sell-success}.png`.

## Infra / findings for other agents
- Platform dev server :3000 was dead on arrival; restored once via the repo's own restart-dev.ts pattern (setsid-detached). No other servers touched, no git commit.
- Pre-existing shared-code bug (NOT mine to fix): `I18nProvider` starts at "en" and never reads `ts_locale` back on mount → locale resets on reload (i18n.tsx ~line 2136).
- Pre-existing EN-only strings in browse-page (heading/sort/chips) and sell wizard (pricing/duration labels) — original authors' scope; all NEW Gap-8 strings are bilingual.
- F2 heads-up: `"itemoffer.minPre"` has an empty `ja` value in the F2 i18n block.
- Demo data left intentionally: listings 2008 + 2009 (live + featured, exercising the rail).

Full entry in `/home/z/my-project/worklog.md` (Task ID: GAP8-F1).
