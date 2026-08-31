# Documents I/O fourth-wave layout/plot shell

Base: `6bd651bff79e40f0b21c11e178af74cd477e9d11`.

Branch: `work4/reio-documents-live`.

Status: DOM-independent shell contract and real-Chromium fixture complete; parity scores unchanged.

## Covered candidate rows

- F-096: Model document remains the same versioned document/session root.
- F-097/F-098: paper layout create, rename, delete, active-layout reconciliation and exact paper read-back.
- F-099/F-100/F-101: rectangular viewport, scale, rotated pan, twist and display lock.
- F-102/F-103/F-106: Model/Paper page setup, area, Fit/custom scale, orientation and vendor-neutral plot style.
- F-104/F-105/F-114: deterministic single/batch vector PDF through stored layout publish settings.
- F-107: named page setup save and apply through document metadata plus layout revision.
- F-115: atomic PDF-underlay SHA/byte read-back through the same recovered document.

All rows remain candidates. `App.tsx` and shell/UI files were outside the write scope, and no row score was changed.

## Atomic revision and history

- Every shell mutation uses a core plan plus one `DocumentLiveOrchestrator.commit`.
- Persistent Undo/Redo stores the candidate document and generated operation before accepting the candidate session.
- A failed Undo/Redo persistence callback leaves document, revision and both history stacks unchanged.
- Deleting the active layout reconciles the accepted session/tab to Model before selecting the adjacent paper layout.
- The crash fixture restores revision 12 from the SHA-chained operation log and reports `layout-plot-crashed` as unclean.

## Real Chromium read-back

URL: `http://127.0.0.1:5204/src/features/documents/layout-plot-shell-harness.html`.

- Harness status: `passed`; browser console warnings/errors: 0/0.
- Recovered sheet: `SHEET A - ISSUE 1`, ISO A3 landscape, 420 x 297 mm.
- Plot contract: Layout, exact 1:1, origin 0,0, monochrome, lineweights/transparency enabled.
- Rectangular viewport: 380 x 257 mm, scale `1:100`, twist `0.5235987755982988` rad, locked.
- Undo/Redo: rename revision 9; Undo revision 10 restored `SHEET A`; Redo revision 11 restored `SHEET A - ISSUE 1`.
- PDF underlay: SHA-256 `c012d7f843bf9bfbe128cb3862eaf8ca85bf2b3f5634c1c347aab42646a83e2c`, 218 bytes, stable across reload.

## Independent vector-PDF read-back

Transient QA artifact: `C:\temp\kuubik-draw-wt4-f104-shell-contract.pdf`. The PDF is not committed because the repository's explicit synthetic-fixture allowlist is outside this workstream's write scope; the independent hashes and parser/render read-backs below are retained as evidence.

- Shell/browser SHA-256 and file SHA-256: `04575368863904885670462cf42b43dc621e8418f74780ba9481fd5f19b2b10c`.
- Size: 1100 bytes; deterministic before/after crash.
- Internal shell summary: PDF 1.4, 1 page, 2 vector stroke commands, valid xref offsets.
- pypdf: 1 unencrypted page, MediaBox `1190.551181 x 841.889764` pt.
- pdfplumber: same page size, 0 images, 1 line and 1 curve.
- Poppler 120 dpi PNG SHA-256: `6797c164a15d8bc181b7ada50068c2503493bc91df71c6fa4cde0b83b03df964`.
- Visual read-back: the complete diagonal line and circle are visible on the A3 landscape sheet with no clipping or raster fallback.

## Honest disabled capabilities

- F-108 native PC3/CTB/STB: disabled; licensed native plot-profile adapter and AutoCAD evidence are absent.
- F-112/F-113/F-117/F-121: disabled by `NATIVE_SDK_UNAVAILABLE`.
- No ODA File Converter, LibreDWG, FreeCAD or LibreCAD result is used as AutoCAD parity evidence.

## Final gates

- `npm run typecheck`: PASS.
- `npm run lint`: PASS.
- `npm run test`: PASS, 143 files / 761 tests.
- `npm run gate:dxf`: PASS, 16 files / 51 tests.
- `npm run gate:pdf`: PASS, 7 files / 22 tests.
- `npm run build`: PASS, 119 modules transformed.
- `node tools/provenance/scan-public-tree.mjs`: PASS, 1430 files.
- `npm run license:check`: PASS, 119 installed packages audited.
- `git diff --check`: PASS.
