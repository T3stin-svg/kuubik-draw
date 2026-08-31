# Visual/live shell wave 4 evidence

Baseline before this integration wave is the immediately preceding capture in `../live-wave/`. The matching after-state files in this directory keep the same names, viewport and state order so image comparison remains direct. No private AutoCAD pixels are copied into this public evidence tree.

## Six required states

- `visual-shell-empty-workspace.png`
- `visual-shell-active-command.png`
- `visual-shell-selected-properties.png`
- `visual-shell-layer-manager.png`
- `visual-shell-layout-paper-space.png`
- `visual-shell-command-history.png` plus `visual-shell-context-menu.png`

`visual-shell-states.json` contains the DOM geometry and computed visual state for the same capture. `visual-shell-zones.json` records the eight primary shell zones at 1920x1080 and 100% zoom.

## Accessibility and recovery

- `visual-shell-200-percent.png`: effective 960x540 viewport at 200% zoom.
- `visual-shell-accessibility.json`: ribbon contrast 8.89:1, product text 13.16:1, 2 px visible focus outline, reduced-motion animation disabled and zero console/page errors.
- `browser-live-readback.json`: independent in-app browser read-back at 1920x1080, including the focused DIMLINEAR typed prompt and the `DocumentLiveOrchestrator` recovery boundary.

## Workflow gate

Six Playwright tests pass. Three added workflows prove:

1. DIMSTYLE, DIMLINEAR and associative HATCH atomic commit/read-back.
2. BLOCK, ATTRIB, BEDIT, INSERT and EXPLODE atomic commit/read-back.
3. Real precision candidates, document tabs/recovery and PDF-underlay byte/checksum read-back.

The AutoCAD paired visual audit was not rerun, so the visual ratchet remains 60.7%.
