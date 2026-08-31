# Visual shell live wave 10

Date: 2026-08-31

Branch: `work10/reio-visual-layers`

Base: `c607df360f68714e87b475ffbbc1a889abf93306`

Audit environment: Chromium, 1920×1080, 100% browser zoom, Windows 96 DPI, mouse and keyboard

Dev port: 5205

## Delivered layer shell

- F-072 Layer Manager exposes the integrated typed layer contract in the dockable Properties/Layers palette.
- F-073 through F-079 are wired to visible controls for current layer, on/off, freeze, lock, color, linetype, lineweight and plot.
- Create, rename and delete validate through the existing layer capability boundary and publish persisted revision read-back only after the commit is complete.
- Properties resolves selected entities through the existing ByLayer index and reports the effective color, linetype, lineweight and transparency sources.
- F-080 transparency is a typed appearance control; F-086 draw-order provides front/back connection points and stays disabled when there is no valid model-space selection.
- Layer rows support Arrow keys, Home/End, Enter, F2 and Delete. Palette width supports pointer and keyboard resizing and persists across dock, float and reload.
- Ribbon F-073 now performs actual active-layer on/off instead of a placeholder current-layer action.

No CAD core, geometry, DXF, print, package, scope, parity or score file was changed. No Autodesk logo or proprietary icon was used.

## Measured visual read-back

Primary shell at 1920×1080:

- title bar: 1920×30 at 0,0
- ribbon tabs: 1920×22 at 0,30
- ribbon: 1920×99 at 0,52
- document tabs: 1920×30 at 0,151
- Properties/Layers palette: 460×862 at 0,181
- command line: 600×50 at 468,985
- Model/Layout bar: 1920×37 at 0,1043
- status bar: 660×32 at 1260,1047

Layer capability read-back after reload:

- persisted revision: 21
- current layer: `layer-layer-1` / `A-WALL`
- imported layer 0: visible, unlocked, unfrozen, non-plottable
- appearance: `#ff0000`, true color, `HIDDEN_UI`, 0.35 mm, transparency 25
- draw order: `F46F01D4,F46F01D5,F46F01D6` → `F46F01D6,F46F01D4,F46F01D5`
- palette: docked, 476 px after keyboard resize and reload
- console/page errors: 0

Accessibility/readability:

- ribbon text contrast: 8.89:1
- product text contrast: 13.16:1
- keyboard focus outline: 2 px solid
- reduced motion: animation `none`, transition 0.01 ms
- 200% audit: effective viewport 960×540; the ribbon remains horizontally navigable and the palette remains usable
- all capture JSON files report zero console/page errors

## Screenshots

The six required states are captured in this directory:

- `visual-shell-empty-workspace.png` — SHA-256 `d730c6f292fc4c51dafb90442ad338bc2e676822e30f4ed7b1fe0c07ac1e62c3`
- `visual-shell-active-command.png` — SHA-256 `6861d67eca46740f8c78d2c9927b4c707fb34865bfd071b8b91c84f1868fe06c`
- `visual-shell-selected-properties.png` — SHA-256 `893d281ff6a58639459d980fbd3a1645d5c30f99307a0be052d9a1a6d579c35d`
- `visual-shell-layer-manager.png` — SHA-256 `da3f944327bce8c551d26204e447c092d9cb3bda8facff335103011aec7247d6`
- `visual-shell-layout-paper-space.png` — SHA-256 `e7bce47420d3616094c9bd5a69e9905f857aa6badb56a4fabf173c0a2172577e`
- `visual-shell-command-history.png` — SHA-256 `3bbdfd309f253c36fc1106857789ec11b9a9efe7c5be06c33edd89c1a342c2c8`

Additional evidence includes `visual-shell-context-menu.png`, `visual-shell-200-percent.png`, `visual-layer-core-after.png`, `visual-layer-core-readback.json`, DOM measurements and accessibility read-back. The before baseline is the matching six-state set in `../live-wave-8/`; this wave's after set is regenerated from the final code.

## Automated verification

- `npm run typecheck` — PASS
- `npm run lint` — PASS
- `npm run test` — PASS, 210 files / 1016 tests
- `npm run build` — PASS; Vite reports the existing >500 kB chunk advisory only
- `npm run test:mutation` — PASS, 17 files / 78 tests
- `npm run gate:dxf` — PASS, 21 files / 56 tests
- `npm run gate:pdf` — PASS, 7 files / 22 tests
- `npm run test:oracles` — fixture PASS; certification remains fail-closed because the run was not network-isolated
- exact port 5205 Playwright run — PASS, 15/15
- exact requested `npx playwright test e2e/visual-shell.spec.ts` — PASS, 15/15 immediately after the 5205 run
- `npm run visual:check` — PASS, baseline held at 60.7% / 1 of 6 paired states
- `node tools/provenance/scan-public-tree.mjs` — PASS, 1689 files
- Gitleaks 8.30.1 pinned scan — PASS, 0 findings
- `npm run license:check` — PASS, 119 installed packages audited
- `git diff --check` — PASS

## Unresolved parity state

The visual score remains **60.7%** and no F-row score changed. `npm run parity:kit:validate` still reports the repository-wide stale topology receipt and unmapped runtime/certification sources. `npm run parity:check` reports unchanged score data, then fails closed at the pre-existing F-022 current-source-hash coverage gate. These parity-owned files were intentionally not altered in this workstream.

All five local visual categories were measured, but the six states remain uncertified as paired parity states until equivalent AutoCAD 2024 captures and measurements exist.
