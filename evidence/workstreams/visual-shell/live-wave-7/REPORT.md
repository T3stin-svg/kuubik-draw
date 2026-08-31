# Visual shell live wave 7 — 2026-08-31

Branch: `work7/reio-visual-live`

Start commit: `d8612fafb79cf2218afc3744ce30b444673c2dfc`

Integrated annotation commit: `9063878` (cherry-picked as `d354675`)

Environment: Chromium, 1920×1080, 100% browser zoom equivalent, Windows 96 DPI target, mouse and keyboard. The 200% audit uses a 960×540 CSS viewport. Dev server: `127.0.0.1:5205`.

## Functional evidence

- F-006 POLYGON is active in the scope ribbon. Ribbon typed options and the `POL`/`POLYGON` command line both use the exported core `prepareCompletePolygonCommand` planner.
- The visible ghost and atomic commit share the same prepared entity. Read-back records sides, construction mode, rotation-input mode, orientation and signed area.
- F-133 renders the real `RecoveryReceipt`. The browser test corrupts a compacted snapshot, appends an incomplete operation, reloads twice and verifies one quarantined operation, one corrupt snapshot, one corrupt compaction, the unchanged recovered revision and two stored operations.
- The recovery UI never reports PASS and never claims that quarantined data was deleted.
- The annotation integration regression was fixed in the shell adapter: STYLE `create/update/apply` now skips only inactive typed fields. The per-document selection test is stable.

## Measured density change

The before reference is `../live-20260831/visual-shell-selected-properties.png` and its measured report.

| Element | Before | After |
|---|---:|---:|
| Docked palette width | 680 px | 460 px |
| Layer Manager height | 513 px | 326 px |
| Property row height | 19 px | 18 px |
| Command line x | 688 px | 468 px |
| Drawing width clear of palette | 1240 px | 1460 px |

After-state measurements:

- POLYGON prompt: x 468, y 833, 1436×175 px.
- Recovery panel: x 1464, y 193, 440×310 px.
- Model/Layout bar: 1920×37 px with roving Left/Right/Home/End keyboard focus.
- Focus outline: 2 px solid `rgb(112, 197, 244)`.
- Contrast: ribbon text 8.89:1; product text 13.16:1.
- Reduced motion: caret animation `none`; transition duration `0.01 ms`.
- 200% effective viewport: 960×540, no document overflow, ribbon remains horizontally scrollable.

## Screenshots and read-back

- `visual-live-polygon-preview.png` / `.json`: typed options, real preview and shell geometry.
- `visual-live-recovery-panel.png` / `.json`: degraded receipt after the second reload.
- `visual-shell-selected-properties.png` and `visual-shell-layer-manager.png`: compact palette measurements.
- `visual-shell-200-percent.png` and `visual-shell-accessibility.json`: 200%, keyboard focus, contrast and reduced-motion checks.
- `visual-shell-empty-workspace.png` through `visual-shell-context-menu.png`: the existing six required shell states, re-captured after this wave.
- Every JSON capture reports an empty `consoleErrors` array.

## Score boundary

The repository visual score remains 60.7%. This wave does not claim six paired AutoCAD states and does not modify scope, parity or score files. A score increase remains blocked until all six current Kuubik/AutoCAD state pairs have complete measured evidence.

## Verification

- Playwright run 1: 11/11 PASS.
- Playwright run 2 with evidence capture: 11/11 PASS.
- `npm run typecheck` — PASS.
- `npm run lint` — PASS.
- `npm run test` — PASS, 184 files / 912 tests.
- `npm run build` — PASS; Vite produced the production bundle. The existing >500 kB chunk advisory remains non-blocking.
- `node tools/provenance/scan-public-tree.mjs` — PASS, 1577 files.
- `npm run license:check` — PASS, 119 installed packages.
- `npm run visual:check` — PASS, baseline held at 60.7% / 1 of 6 paired states.
- `git diff --check` — PASS.
