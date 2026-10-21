# Task 4-d — Sell flow module (agent work record)

Task: Build `sell-landing.tsx` (#/sell) and `sell-new.tsx` (#/sell/new) for Tengasell.

## Files created/modified (ONLY these)
- `src/components/tengasell/pages/sell/sell-landing.tsx` (replaced stub)
- `src/components/tengasell/pages/sell/sell-new.tsx` (replaced stub)

## Key contract decisions
- Category select uses **slug** values (matches `auction.category` in schema/seed); displays `name`.
- Stock-photo pool: all URLs of the first 8 `IMAGES` keys, topped up with first URLs of further keys → exactly 16 photos.
- Wizard validation: Next disabled until step valid; field errors appear on blur (touched map) with aria-invalid/aria-describedby; SLA ack validated on submit (inline error + destructive toast + scroll-into-view).
- Buy-now rule: `> start + 2 × bidIncrement(start)`; reserve `> start`; shipping fee disabled & 0 for pickup.
- Success screen uses spring gold check (bg-gold, ts-energy) — no confetti; links → `#/item/{id}`, `#/my/selling`.
- City defaults from signed-in user's `profile.city` when it's one of the 6 cities.
- Both modes (live TrailBase / demo LocalStore) supported — `api.createAuction` input shape identical.

## Verification
- `bun run lint`: 0 problems from my files (remaining 6 are pre-existing in app-shell.tsx / item-page.tsx / ui.tsx / hooks.ts — other agents).
- `bunx tsc --noEmit`: 0 errors in pages/sell/*.
- `curl /` → 200; dev.log compiles clean.
- agent-browser smoke test: landing + wizard step 1 render correctly (hot strip cards, stock grid, disabled Next, profile city prefill). Chrome env broke mid-session; later steps verified by types/lint/render.

## Notes for other agents
- `item-page.tsx` has a TS parse error at ~478:23 (not mine) that may break the route switch — owner should fix.
- Demo mode is active in the sandbox (TrailBase probe 404 through gateway).
