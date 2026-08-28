# F-106 — Model-space print/PDF

F-106 owns plotting the Model tab to a physical vector SVG/PDF while retaining
the selected Model page setup in the CAD document.

## Included acceptance matrix

- Extents on ISO A4 portrait at fixed 1:50, centered.
- Window on ISO A3 landscape, Fit, with an explicit 4 mm / 6 mm offset.
- Display on ISO A4 portrait at fixed 1:100, centered, using the exact live
  1920×1080 model-canvas world rectangle.
- Media, orientation, area, scale, centering, origin and plot style persist in
  the Model layout through atomic global Undo/Redo and IndexedDB reload.
- Physical paper size, printable margins, source clip and source-to-paper
  transform are deterministic and use drawing units correctly.
- Production SVG and PDF are vector-only; text stays text and no image XObject
  or raster fallback is permitted.
- Empty Extents output is rejected with a visible status and without an
  unhandled browser error or empty download.
- Chromium downloads exactly match a second invocation of the production
  generator. `pypdf`, `pdfplumber` and Poppler independently read/render all
  three PDFs.
- AutoCAD 2024.1.2 performs equivalent Extents, Window and Display plots in an
  owned scratch process; the native DWG is reopened after refreshing plotter
  capabilities and all persisted Model page-setup fields are compared. For a
  centered plot AutoCAD derives `PlotOrigin` from the current view, so the
  persisted contract is `CenterPlot=true`, not equality of that transient
  coordinate.
- Native PDF LINE/CIRCLE paper lengths and positions are measured through
  `pdfplumber`, in addition to pypdf operators and Poppler pixels.

## Excluded rows

- Paper-space Page Setup authoring: F-102.
- Plot style semantics and CTB/STB behavior: F-103 and F-108.
- Layout vector output: F-104.
- Batch publish: F-105.
- Named page setups/templates: F-107.
- Native DWG/DWT import/export: F-112, F-113 and F-117.
