# Visual shell live integration — 2026-08-31

Branch: `work6/reio-visual-live`

Start commit: `2bbec19176b8a17bc88f6b3ff962e8caf2fb444e`

Environment: Chromium, 1920×1080, 100% browser zoom equivalent, Windows 96 DPI target, mouse and keyboard. The 200% audit uses a 960×540 CSS viewport. Dev server: `127.0.0.1:5205`.

## Integrated states

- Complete semantic OSNAP stack is visible and keyboard-cyclable with `Tab` / `Shift+Tab`; captured read-back has 4 candidates and a 13×13 px endpoint marker.
- PGP import/export and alias routing are visible in Kuubik Text Window. The captured alias is `ZZ -> LINE`; the per-document history is `ZZ 0,0 80,0 | U | REDO`.
- Per-document selection, viewport, command history and persisted Undo/Redo are owned by `DocumentWorkspaceShell` read-back.
- Ribbon exposes Linear, Aligned, Angular, Radius, Diameter, Continue, Baseline and Dimension Style workflows. TABLE style/create is active and its captured document contains three dimensions plus one TABLE proxy.
- Conditional DIMSTYLE and TABLE prompt fields remain required only on their active branch; skipped inactive fields never mutate geometry.

## Measured shell

| Zone | x | y | width | height |
|---|---:|---:|---:|---:|
| Title bar | 0 | 0 | 1920 | 30 |
| Ribbon tabs | 0 | 30 | 1920 | 22 |
| Ribbon | 0 | 52 | 1920 | 99 |
| Document tabs | 0 | 151 | 1920 | 30 |
| Docked palettes | 0 | 181 | 680 | 862 |
| Command line | 688 | 985 | 600 | 50 |
| Model/Layout bar | 0 | 1043 | 1920 | 37 |
| Status bar | 1260 | 1047 | 660 | 32 |

## Screenshots and read-back

- `visual-shell-empty-workspace.png` through `visual-shell-context-menu.png`: the six required shell states.
- `visual-shell-200-percent.png` and `visual-shell-accessibility.json`: 200%, keyboard focus, contrast and reduced-motion checks.
- `visual-live-snap-cycle.png` / `.json`: semantic candidate marker and cycle read-back.
- `visual-live-workspace-history.png` / `.json`: alias, active document and persisted history.
- `visual-live-table-dimensions.png` / `.json`: dimension menu plus TABLE result.
- Every JSON capture reports an empty `consoleErrors` array.

## Verification

- `npm run typecheck` — PASS
- `npm run lint` — PASS
- `npm run test` — PASS, 172 files / 867 tests
- `npm run build` — PASS
- `npx playwright test e2e/visual-shell.spec.ts --config=e2e/visual-shell.playwright.config.ts` — PASS, 9/9 on port 5205
- `node tools/provenance/scan-public-tree.mjs` — PASS, 1530 files
- `npm run license:check` — PASS, 119 installed packages
- `npm run visual:check` — PASS, baseline held at 60.7% / 1 of 6 paired states
- `git diff --check` — PASS

No visual percentage or F-row score was changed. No CAD core, DXF, PDF/print, schema, package or geometry behavior file was modified.
