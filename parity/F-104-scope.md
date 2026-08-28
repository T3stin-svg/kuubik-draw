# F-104 — Layout vector PDF/SVG output

F-104 owns the end-to-end vector export of one paper layout containing more
than one independently configured model-space viewport.

## Included acceptance matrix

- ISO A3 landscape paper with Layout plot area at paper-space 1:1.
- One locked rectangular viewport at 1:50 and one locked polygon-clipped
  viewport at 1:100, with independent model targets.
- Paper-space border, divider and title text remain paper geometry rather than
  model-space content.
- Kuubik exports deterministic physical-size SVG and one-page PDF from the
  same persisted `KDrawDocumentV1`.
- The PDF contains vector path/text operators, two viewport clips, physical
  lineweights and transparency state, and no image XObjects.
- Chromium reload preserves both viewport cameras and produces byte-identical
  SVG/PDF output with zero console or page errors.
- `pypdf`, `pdfplumber`, XML inspection, Poppler PDF pixels and a Chromium
  raster of the actual SVG independently read the browser download and
  production-package output.
- AutoCAD 2024.1.2 creates the equivalent native A3 layout, 1:50/1:100 locked
  viewports and `VPCLIP`, plots with `DWG To PDF.pc3`, saves/reopens DWG, and
  plots the reopened document again in an owned scratch process.
- AutoCAD's stock PDF writer duplicates `/PageMode` in its catalog. The strict
  parser rejection is preserved as evidence; tolerant `pypdf`, `pdfplumber`
  and Poppler all independently confirm the one-page vector result.

AutoCAD 2024 has no native SVG plotter in this workflow. Kuubik's SVG is the
deterministic web-vector companion of the same layout that is certified by the
native AutoCAD PDF workflow.

## Excluded rows

- Page Setup media, orientation, plot area and scale authoring: F-102.
- CTB/STB/lineweight/transparency profile semantics: F-103.
- Batch publish of multiple layouts: F-105.
- Model-space print/PDF: F-106.
- Named page setups and templates: F-107.
- PC3/CTB/STB file management: F-108.
- Native DWG/DWT import/export: F-112, F-113 and F-117.
