# Visual shell live wave 8

Date: 2026-08-31

Branch: `work8/reio-visual-live`

Base: `7bfa2bea649583129844444f9f5788a701ff21a4`

Audit environment: Chromium, 1920×1080, 100% browser zoom, Windows 96 DPI, mouse and keyboard

Dev port: 5205

## Delivered shell bindings

- F-007 ELLIPSE: ribbon and `EL`/`ELLIPSE` command-line binding, both core construction modes, full/arc shape, CW/CCW direction, one complete planner for ghost and commit, atomic persisted entity read-back.
- F-053 UNITS: all five length formats, all five angle formats, six drawing/insertion units, both decimal separators, precision, clockwise and base angle. A drawing-unit change with existing geometry requires an explicit preserve-coordinates confirmation; read-back is coordinate scale 1.
- F-096/F-097 Model/Layout: migrated document workspace, keyboard switch, create, copy, rename, delete and reorder through the existing workspace planners. Active layout, active space, monotonic ids and tab order persist and replay from IndexedDB.
- The open Layout tool popover now enters the top shell stacking layer; palette controls no longer intercept its pointer events.

No geometry, DXF, PDF, package, scope, parity or score file was changed.

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

Wave controls:

- ELLIPSE typed prompt: 1436×130 at 468,878; bottom 1008
- UNITS dialog: 650×375 at 635,150; bottom 525
- Layout tab strip: 297.59×25 at 8,1053 after create/copy/rename/reorder
- Layout paper sheet: 985.75×697 at 480,229

Accessibility/readability:

- ribbon text contrast: 8.89:1
- product text contrast: 13.16:1
- keyboard focus outline: 2 px solid
- reduced motion: caret animation `none`, transition 0.01 ms
- 200% audit: effective viewport 960×540; ribbon scrolls horizontally and status bar collapses as designed
- all capture JSON files report zero console/page errors

## Screenshots and hashes

- `visual-live-ellipse-before.png` — typed ghost — SHA-256 `9e3226f7496e89814da12d94719f8a5e0bf6cdf37f565bfad0c7f8df424a6328`
- `visual-live-ellipse-after.png` — committed/reloaded entity — SHA-256 `c87f467350b2caa34f44fd0e3c281c3bc6a4f34852e700f60a8e5ffd638e7c16`
- `visual-live-units-confirmation.png` — preserve-coordinates gate — SHA-256 `18fe9f92207e445a8bb48868fbc6878d2f1661bb5b9c87b4a9cc07d2f5dfed74`
- `visual-live-layout-workspace.png` — renamed/reordered paper layout after reload — SHA-256 `fadac1edbbb78dac9325f6d60b1ab9ba8984a5688bc81dc13a15ef4646f85c2c`
- The folder also retains the six requested shell states, context menu, command history, 200% view, recovery, snap, document history and measurement JSON files.
- Before baseline: `../live-wave-7/visual-live-polygon-preview.png` and the prior six-state capture set. Wave 8 after-state is represented by the four files above plus the regenerated six-state set in this folder.

## Automated verification

- `npm run typecheck` — PASS
- `npm run lint` — PASS
- `npm run test` — PASS, 198 files / 970 tests
- `npm run build` — PASS; Vite reports the existing >500 kB chunk advisory only
- `npx playwright test visual-shell.spec.ts --config=e2e/visual-shell.playwright.config.ts` — PASS twice after final edits, 14/14 each run
- `npm run visual:check` — PASS, baseline held at 60.7% / 1 of 6 paired states
- `node tools/provenance/scan-public-tree.mjs` — PASS, 1634 files
- `npm run license:check` — PASS, 119 installed packages audited
- `git diff --check` — PASS

## Unresolved parity state

The visual score remains **60.7%** and no F-row score changed. This wave measures the Kuubik implementation only; it does not add new paired AutoCAD 2024 evidence. All five local visual categories were re-read from the generated measurements, but the six requested states remain uncertified as paired parity states until equivalent AutoCAD captures and measurements exist for empty workspace, active command, selected object/Properties, Layer Manager, paper space and command history/context menu.
