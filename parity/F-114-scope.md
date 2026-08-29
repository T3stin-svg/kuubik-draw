# F-114 — PDF vector output

F-114 owns the exact production path from two persisted paper layouts to one
mixed-size multi-page PDF. The fixed Kuubik document contains an ISO A3
landscape layout with a red 40% transparent model line and an ISO A4 portrait
detail with a blue model circle. Both pages contain paper-space borders and
searchable title text.

Certification requires:

- the visible 1920×1080 Chromium `/d/local` workflow to open the A3 layout,
  publish both layouts, inspect the A4 layout, reload IndexedDB and download
  byte-identical output again with zero console/page errors;
- one strict PDF 1.4 containing exactly two pages in A3-then-A4 order, correct
  physical MediaBoxes, searchable `F-114` title text, vector stroke/curve/text
  operators, an ExtGState for transparency and zero image XObjects;
- exact agreement between the Chromium download and a fresh invocation of the
  built production `cad-print` path;
- strict `pypdf`, `pdfplumber` and Poppler read-back of both pages, including
  page sizes, text, exact `/CA` and `/ca` alpha, transformed line endpoints,
  all four circle Bézier segments, red/blue content and unclipped black-border
  bboxes with explicit point/pixel tolerances;
- mutation proof through that same semantic contract for page order, geometry,
  alpha and a valid referenced image XObject;
- a fresh owned AutoCAD 2024.1.2 A3 layout plot through `DWG To PDF.pc3`, native
  DWG save/reopen and second vector plot, with both PDFs independently reopened
  and rendered and the pre-existing AutoCAD process set restored;
- independent P0/P1 review and green public CI.

The AutoCAD portion intentionally reuses the already fixed F-104 native A3
layout harness because the locked audit row defines AutoCAD as a one-page A3
vector-output reference, while Kuubik's differentiating acceptance matrix is
the mixed A3/A4 two-page output. AutoCAD's known duplicate `/PageMode` catalog
key remains explicitly recorded: strict `pypdf` rejects that native catalog,
while tolerant `pypdf`, `pdfplumber` and Poppler must all reopen it. Kuubik's
own PDF must parse in strict mode.

F-114 does not certify PDF import/underlay (F-115/F-116), batch-publish state
semantics already owned by F-105, native PC3/CTB/STB parity (F-108), arbitrary
Unicode font embedding or unsupported entity kinds.
