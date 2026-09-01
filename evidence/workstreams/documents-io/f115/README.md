# F-115 PDF underlay closure wave

Status: candidate implementation and three-way evidence; parity score unchanged.

## Shared synthetic source

- Generator: `tools/pdf/create-f115-synthetic.py`
- PDF is generated into ignored `tmp/f115/f115-synthetic-underlay.pdf`; no customer files are used or committed.
- Byte length: `3238`
- SHA-256: `9cf657664947127909cb3246dd3a78fe88666073b3ac8190422dac780da16043`
- Pages: A4 portrait, A3 landscape and a small custom portrait page.

## AutoCAD 2024.1.2 reference

`tools/autocad/run-f115-reference.ps1` created a new, empty, unsaved `Drawing1.dwg`, refused any non-empty/non-scratch target, issued `-PDFATTACH`, and read ModelSpace back independently.

- Runtime: `24.3s (LMS Tech)` / AutoCAD 2024.1.2 reference line.
- Object: `AcDbPdfReference` on `F115_PDF_REFERENCE`.
- Page `2`; position `[25, 40, 0]`; scale `0.5`; rotation `0.5235987755982988` rad (30°).
- File path and source SHA match the synthetic PDF.
- Fade changed from `0` to `25` and was read back as `25`.
- The scratch drawing was never saved. No user DWG was addressed, and no owned scratch AutoCAD process remained after read-back.

Exact machine read-back is in `autocad-readback.json`.

## Production Chromium workflow

The visible harness uses a real file input and button-driven attach flow. It does not seed the placement through page evaluation or a DOM-only shortcut.

- Upload -> inspect -> page 2 -> X/Y `25/40` -> scale `0.5` -> rotation `30°` -> opacity `0.8` -> fade `25` -> rectangular clip.
- Stored source path, SHA, byte length and three-page count are read from IndexedDB.
- Reload restores the same page, transform, clip, reference path and bytes.
- Fade update `40%`, Undo, Redo, locked-edit rejection, off-layer hiding and frozen-layer hiding are exercised through visible controls.
- `F-115-browser-underlay.png` and `F-115-browser-readback.json` are produced by the Playwright capture run.

## Independent PDF read-back

`tools/pdf/readback-f115.py` independently verifies the same PDF with pypdf, pdfplumber and Poppler.

- pypdf: 3 pages, unencrypted, page boxes `595.2756 × 841.8898`, `1190.551 × 841.8898`, `216 × 360` pt.
- pdfplumber: matching three page sizes, searchable synthetic labels, zero image objects.
- Poppler at 120 dpi: three PNGs; SHA-256 values are recorded in `readback.json`.
- All three rendered pages were visually checked; complete frames, diagonals and labels are present.

## Limits

The small built-in renderer is intentionally limited to traditional uncompressed PDFs. Compressed/object-stream and inherited-page-box inputs fail closed pending a production PDF.js adapter. AutoCAD clip-shape parity is not claimed. Therefore this wave does not change the F-115 parity score.

## Validation

- `npm run typecheck`, `npm run lint`, `npm run test` (263 files / 1184 tests), `npm run gate:dxf` (29 / 73), `npm run gate:pdf` (7 / 24), `npm run build`, provenance scan, license check and `git diff --check`: pass.
- F-115 targeted Chromium E2E with this exact synthetic PDF: 1 / 1 pass; no console errors.
- The repository-wide Playwright run is not a green gate at this base: 20 / 128 pass. Most unrelated tests open IndexedDB schema version 1 after the app has created version 3 and fail with `VersionError`; other shared `/d/local` tests collide under the existing six-worker configuration. No out-of-scope E2E files were changed in this F-115 wave.
