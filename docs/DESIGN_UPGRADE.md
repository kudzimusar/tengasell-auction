# Design upgrade — web, before the native app

## Shipped in this pass

| Issue | Fix |
| --- | --- |
| **Footer links 404'd** ("This page took a gap year") | The hash router treated the second `#` as part of the route: `/help#fees` became the segment `help#fees` → no route. Fragments are now parsed as anchors, and the target section scrolls into view after navigation. |
| **Register button clipped at narrow widths** | Added `shrink-0`, `whitespace-nowrap`, `leading-none`, tighter padding, a min-width guard (`≥380px`) and press feedback, so it can't wrap or squash. |
| **Footer looked like a link dump** | Reworked hierarchy: larger grid gap, uppercase gold section labels, hover rule that grows from each link, social handles as outlined pills, brand block with a constrained measure. |
| **Deep links into Help** | `/help#protection|sla|fees|payments|about|contact` now land on the right section. |

## Design system — current state

Tokens live in `src/app/globals.css` and `tailwind.config.ts`:

- **Colour** — teal (primary), gold (accent), `teal-deep` (footer/dark bands), `raised`, `section`
- **Radius** — `rounded-control` (buttons/inputs), `rounded-pill` (search, chips)
- **Type** — `text-label`, `text-caption` utilities over a 4-step scale
- **Motion** — route transitions (framer-motion), 150–220 ms, honours reduced motion

## Next, in priority order

1. **Type + space scale** — define 6 sizes and a 4 px spacing rhythm as utilities; today several pages hand-pick `text-[13px]`/`gap-3.5`. Removes the drift visible between pages.
2. **Component contracts** — one Button (4 variants × 3 sizes), one Field, one Card, one Pill. Guarantees the Register-button bug can't recur elsewhere.
3. **Card system** — image ratio 4:3, fixed text rows (title 2 lines, price, meta), so grids stop jumping between auction states.
4. **Mobile header** — logo + search icon + account; move language/theme into the sheet. Matches the pattern the native app will use.
5. **Empty/error states** — the 404 page is good; reuse that tone for empty search, no bids, paused auctions.
6. **Accessibility pass** — focus-visible everywhere, 44 px targets, contrast check on `white/60` footer text.
7. **Native hand-off** — the tokens above become the app's theme; the hash routes map 1:1 to native screens.

## Carried into the native app

- Bottom tab bar (Home · Search · Sell · Messages · Account) already exists on mobile web
- Sheet-based filters and menus
- Same auction card anatomy and countdown treatment
