# F-103 — Plot profile, lineweights and transparency

F-103 owns the per-layout Color, Monochrome and Grayscale plot profile,
the Plot Lineweights toggle, object/layer ByLayer versus explicit appearance,
and the Plot Transparency toggle from Canvas2D preview through SVG/PDF output.

## Included acceptance matrix

- Color preserves source red/green ink.
- Monochrome maps ACI ink to black while preserving TrueColor RGB, matching
  AutoCAD's stock color-dependent plot-style behavior.
- Grayscale matches AutoCAD 2024 stock `Grayscale.ctb` observations for the
  synthetic red and green fixture (`#4c4c4c` and `#959595`).
- Plot Lineweights ON preserves 0.70 mm ByLayer, 0.35 mm explicit width and
  explicit 0.00 mm; OFF emits AutoCAD's PDF width-zero device hairline.
- Plot Transparency ON preserves the fixture's 40% SOLID hatch as 0.60 alpha;
  OFF makes it opaque.
- Preview and output call the same typed resolver; the live browser matrix
  proves source preview OFF before switching the separate persisted Page Setup
  choice ON.
- PAGESETUP is one atomic revision with Undo/Redo and IndexedDB/KDRAW1
  persistence.
- AutoCAD live evidence uses an owned blank AutoCAD 2024.1.2 process, native
  PlotToFile profiles and DWG save/reopen. A tiny test-only managed command
  reads/writes native `Layout.PlotTransparency`; `PLOTTRANSPARENCYOVERRIDE=1`
  then proves AutoCAD honors that persisted Page Setup flag. All touched
  AutoCAD user settings are read back and restored before the owned process
  exits; `SECURELOAD` is never weakened by the harness.

## Excluded rows

- PC3/CTB/STB file management and arbitrary native plot-style editing: F-108.
- Pattern hatch generation beyond SOLID: F-066.
- Layer creation, management and viewport overrides: F-072…F-086 and F-105.
- Print area/scale/media/orientation: F-102.
- Publish and batch sheet sets: F-107.

Unsupported patterned hatches are reported in `skippedHandles`; they are never
silently printed as SOLID geometry.
