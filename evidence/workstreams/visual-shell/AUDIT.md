# Kuubik Draw visual shell audit

Audit environment: Chromium, 1920×1080, 100% zoom equivalent, Windows 96 DPI target, mouse and keyboard. The 200% check uses the equivalent 960×540 CSS viewport. Browser console and page errors are captured in both E2E tests.

## Waves

| Wave | Before | After | Result |
|---|---|---|---|
| 1 — shell extraction, scoped ribbon, SVG language | `before/` | `wave-1-after/` | 6 states captured, 0 console errors |
| 2 — dock/float/auto-hide, saved workspaces, accessibility | `wave-1-after/` | `wave-2-after/` | 3 palette modes, 3 workspace presets, 200%, focus, contrast and reduced-motion checked |
| 3 — command/layout/status component boundary and recovery state | `wave-2-after/` | `wave-3-after/` | 6 states recaptured, 0 console errors; visual baseline ratchet held |
| 4 — remove remaining shell font-glyph icons | `wave-3-after/` | `wave-4-after/` | palette, context, layout and viewport controls use original Kuubik SVG paths; 6 states recaptured |
| 5 — integrated runtime adapters | `wave-4-after/` | `integration-wave/` | real LINE, Undo/Redo, precision, layer and document workflows plus validated MTEXT/INSERT intents; 0 console errors |
| 6 — live shell contracts | `integration-wave/` | `live-wave/` | LINE/PLINE/CIRCLE/ARC and MTEXT/LEADER committed; F8 + command precision, controller-planned layer, ModelSpaceDocument tabs and honest disabled rows; 0 console errors |
| 7 — live CAD shell completion | `live-wave-4/` | `live-20260831/` | semantic snap cycling, persisted document workspaces, PGP aliases, complete dimension menu and TABLE style/create; 9/9 Chromium tests and 0 console errors |

## Six audited states

1. `visual-shell-empty-workspace.png`
2. `visual-shell-active-command.png`
3. `visual-shell-selected-properties.png`
4. `visual-shell-layer-manager.png`
5. `visual-shell-layout-paper-space.png` plus `visual-shell-layout-tools-open.png`
6. `visual-shell-command-history.png` plus `visual-shell-context-menu.png`

Each state exists in every applicable wave directory. `visual-shell-states.json` contains the DOM and interaction read-back; `visual-shell-zones.json` contains the primary zone geometry. The newest runtime read-back is in `live-wave/visual-shell-runtime-integration.json`. Port-specific reruns use `e2e/visual-shell.config.ts` on the reserved dev port 5225.

## Final measured read-back

Primary 1920×1080 zones:

| Zone | x | y | width | height |
|---|---:|---:|---:|---:|
| titlebar | 0 | 0 | 1920 | 30 |
| ribbon tabs | 0 | 30 | 1920 | 22 |
| ribbon | 0 | 52 | 1920 | 99 |
| document tabs | 0 | 151 | 1920 | 30 |
| docked palettes | 0 | 181 | 680 | 862 |
| command line | 688 | 985 | 600 | 50 |
| Model/Layout bar | 0 | 1043 | 1920 | 37 |
| status bar | 1260 | 1047 | 660 | 32 |

Additional measurements:

- floating palette: x 28, y 211, 520×780 px;
- auto-hide palette rail: 32 px;
- selected scene: 9757 blue selection pixels and 0 stale MOVE-preview pixels;
- selected typed fixture: POLYLINE `A1`, CIRCLE `A2`, TEXT `A3`;
- Properties: 680×862 px, nine 19 px General rows, Layer Manager bottom y 694;
- 200% equivalent: 960×540, document scroll 960×540, status bar intentionally condensed, ribbon horizontally scrollable;
- contrast: ribbon text 8.89:1, product text 13.16:1;
- keyboard focus: 2 px solid `rgb(112, 197, 244)`;
- reduced motion: caret animation `none`, transitions reduced to 0.01 ms;
- console/page errors: 0.

## Five visual categories

All five fixed categories were re-measured locally: shell zones; ribbon/palette density; command/status/layout; color/type/icons; interaction states. This is a Kuubik-side audit, not a new six-state AutoCAD paired certification. `npm run visual:check` therefore correctly holds the visual score at **60.7% with 1/6 paired states PASS**. No percentage was raised.

## Integration gate

- `npm run typecheck` — PASS
- `npm run lint` — PASS
- `npm run test` — PASS, 128 files / 711 tests
- `npm run build` — PASS
- `npx playwright test e2e/visual-shell.spec.ts --config e2e/visual-shell.config.ts` — PASS, 3/3 at port 5225; includes 1920×1080 and 200% equivalent
- `node tools/provenance/scan-public-tree.mjs` — PASS, 1412 files
- `npm run license:check` — PASS, 119 installed packages
- `npm run visual:check` — PASS, baseline held at 60.7% / 1 of 6 paired states
- `git diff --check` — PASS

Wave 6 also has an independent in-app-browser read-back: revision 4 with `circle,mtext,line`, two layers, GRID off, ORTHO on, one surviving `local` tab, F-088 disabled with the `Arenduses` reason and zero browser-console errors.

Wave 7 uses the reserved port 5205 via `e2e/visual-shell.playwright.config.ts`. Its measured read-back and current 172-file / 867-test gate are recorded in `live-20260831/REPORT.md`. The existing 60.7% visual score remains unchanged.

## Honest boundaries

- F-122, F-127, F-131 and F-132 are complete in this visual-shell workstream.
- Selected commands with an existing application handler are enabled and expose their F-row.
- LINE/PLINE/RECTANGLE/CIRCLE/ARC, MTEXT/LEADER, visible precision state and the controller-planned layer actions now have real shell commit/read-back paths. Other selected geometry, annotation and block commands are not promoted by this wave.
- No AutoCAD or Autodesk pixels, logos or proprietary icons were added. All new icons are original inline SVG paths in `apps/web/src/icons/CadIcon.tsx`.
- No CAD core, DXF, print, document schema or geometry behavior was changed.
- The live wave does not change the 60.7% visual parity score or certify any F-row at 1.00. MTEXT/LEADER commit evidence does not certify the remaining annotation matrix, blocks, DXF parity or AutoCAD paired behavior.
