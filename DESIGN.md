# Drive My Home · 居民預測報告 — DESIGN.md

Design system for the resident prediction website. Derived from the 屋企在途中拍賣日 auction catalog (`0. Document/Workshop_PPT_20MAR2026/assets/auction_game_html`).

## 1. Visual Theme & Atmosphere

Gallery-quiet. A white room where the photographs of the nests carry all the colour. The interface recedes: hairline rules, light type, generous whitespace, no decoration. The index is a single cover-flow of photo cards floating in white space; report pages read like an exhibition wall label set long-form.

## 2. Color Palette & Roles

| Token | Hex | Role |
|-------|-----|------|
| `--bg-0` | `#ffffff` | Page canvas, card backs |
| `--bg-1` | `#f5f5f5` | Hover surface, image placeholder |
| `--accent` | `#333333` | Titles, active borders |
| `--accent-soft` | `#666666` | Secondary text |
| `--text` | `#222222` | Body |
| `--muted` | `#999999` | Meta labels, ids, captions |
| `--line` | `rgba(0,0,0,0.1)` | Hairline grids and rules |
| `--panel` | `rgba(255,255,255,0.88)` | Floating controls (with 12px blur) |

No brand accent colour. Photos supply colour.

## 3. Typography Rules

Family: `"Segoe UI", "Helvetica Neue", Arial, "Microsoft JhengHei", "PingFang HK", "Noto Sans TC", sans-serif`.

| Level | Size | Weight | Tracking |
|-------|------|--------|----------|
| Brand title | `clamp(1.1rem, 2.2vw, 1.6rem)` | 300 | 0.04em |
| Section heading | 1rem | 400 | 0.06em |
| Body (CJK) | 0.92rem / line-height 1.9 | 300 | 0.02em |
| Meta label / id | 0.68rem | 400 | 0.12em, uppercase for Latin |
| Subtitle | 0.78rem | 300 | — |

## 4. Component Stylings

- **Logo lockup**: fixed top-left, keyhole cart icon (36px) + 屋企在途中 wordmark (22px), gap 8px. Respects safe-area insets.
- **Buttons**: transparent, 1px `--line` border, radius 4px, weight 300. Hover/focus: border becomes `--accent`. Minimum 44px tap target.
- **Grid cells**: 1px gap on a `--line` background so cells read as a hairline table (auction lot grid).
- **Tables**: hairline rows, muted header, no zebra striping.
- **Cover-flow card**: 3:4 photo plane, white back, very soft contact shadow below; no gloss.

## 5. Layout Principles

- Max content width 1100px, padding `72px 24px 64px` (top clears the logo).
- Report pages: two-column image pair (cover + top view) collapsing to one column under 720px.
- Spacing scale: 4, 8, 12, 16, 24, 32, 48, 64.

## 6. Depth & Elevation

Flat. Depth exists only in the 3D cover-flow (rotation and position) and the frosted control panel. No drop shadows on HTML elements.

## 7. Do's and Don'ts

- Do keep the 藝術詮釋／非診斷 disclaimer visible on every report.
- Do label photos only as `相片 NN`; never show source filenames.
- Don't add accent colours, gradients, or heavy weights.
- Don't animate longer than ~300ms; motion is feedback, not spectacle.

## 8. Responsive Behavior

- Below 720px: report images stack, cover-flow tightens spacing and shows fewer neighbours.
- Pointer, touch and wheel all drive the cover-flow.
- `prefers-reduced-motion`: no easing, no fade-up.
- No WebGL: horizontal snap-scroll of covers.

## 9. Agent Prompt Guide

"White gallery page, hairline 1px grey rules, Segoe UI weight 300 with Traditional Chinese fallbacks, near-black text #222, muted #999 labels, no accent colours, photos carry colour, top-left fixed logo, micro motions under 300ms."
