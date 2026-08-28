# F-105 — Batch publish layouts

F-105 owns the ordered publishing of selected paper layouts to one
multi-page PDF or to one PDF per selected layout.

## Included acceptance matrix

- A named publish set contains every current paper layout exactly once, with
  explicit order and inclusion state.
- Order, inclusion, output mode and base filename persist in the CAD document.
- Display page setups carry a finite per-layout captured paper-space source into
  batch output, including while that layout is inactive.
- Every settings change is one atomic transaction with global Undo/Redo.
- One multi-page PDF follows publish-set order rather than alphabetical layout
  name order.
- Excluded layouts do not appear in the output and can be restored.
- Separate output creates deterministic, sanitized and collision-safe names in
  publish-set order, rejects Windows device names and stays within the 255-code-
  unit file-component limit without splitting a Unicode code point.
- Browser download, production package output, `pypdf`, `pdfplumber` and
  Poppler render all agree on page count, physical A4 size, order and content.
- AutoCAD 2024.1.2 performs the equivalent native ordered sheet publish in an
  owned scratch process; a deliberately non-alphabetic request is compared with
  native PDF creation order and independently parsed page titles.

## Excluded rows

- Page Setup media, orientation, plot area and scale authoring: F-102.
- CTB/STB/lineweight/transparency semantics: F-103.
- Single-layout vector SVG/PDF detail: F-104.
- Model-space print/PDF: F-106.
- Named page setups and templates: F-107.
- PC3/CTB/STB file management: F-108.
- Native DWG/DWT import/export: F-112, F-113 and F-117.
