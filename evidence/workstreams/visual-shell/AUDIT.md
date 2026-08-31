# Kuubik Draw visual shell audit

Audit environment: Chromium, 1920×1080, 100% zoom equivalent, Windows 96 DPI target, mouse and keyboard. The 200% check uses the equivalent 960×540 CSS viewport. Browser console and page errors are captured in both E2E tests.

## Waves

| Wave | Before | After | Result |
|---|---|---|---|
| 1 — shell extraction, scoped ribbon, SVG language | `before/` | `wave-1-after/` | 6 states captured, 0 console errors |
| 2 — dock/float/auto-hide, saved workspaces, accessibility | `wave-1-after/` | `wave-2-after/` | 3 palette modes, 3 workspace presets, 200%, focus, contrast and reduced-motion checked |
| 3 — command/layout/status component boundary and recovery state | `wave-2-after/` | `wave-3-after/` | 6 states recaptured, 0 console errors; visual baseline ratchet held |

## Six audited states

1. `visual-shell-empty-workspace.png`
2. `visual-shell-active-command.png`
3. `visual-shell-selected-properties.png`
4. `visual-shell-layer-manager.png`
5. `visual-shell-layout-paper-space.png` plus `visual-shell-layout-tools-open.png`
6. `visual-shell-command-history.png` plus `visual-shell-context-menu.png`

Each state exists in every applicable wave directory. `visual-shell-states.json` contains the DOM and interaction read-back; `visual-shell-zones.json` contains the primary zone geometry.

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

## Honest boundaries

- F-122, F-127, F-131 and F-132 are complete in this visual-shell workstream.
- Selected commands with an existing application handler are enabled and expose their F-row.
- Selected commands owned by geometry workstreams expose a typed shell intent only; status precision modes remain disabled until a real adapter exists. They are not counted as functionally complete here.
- No AutoCAD or Autodesk pixels, logos or proprietary icons were added. All new icons are original inline SVG paths in `apps/web/src/icons/CadIcon.tsx`.
- No CAD core, DXF, print, document schema or geometry behavior was changed.
