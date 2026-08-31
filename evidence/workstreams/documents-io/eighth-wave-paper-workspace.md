# Documents I/O eighth-wave PAPER SPACE workspace

Base: `7bfa2bea649583129844444f9f5788a701ff21a4`.

Branch: `work8/reio-documents-live`.

Status: F-098 document-model hardening and real-browser persistence fixture complete; the existing visible-sheet certification and parity scores are unchanged.

## Implemented boundary

- `kuubik.paperWorkspace.v1` persists millimeter paper units, active Model/Paper context and one exact state record per paper layout.
- Each paper record binds the layout id to a zero-origin physical boundary, positive printable-area rectangle, media/orientation, plot origin, named page-setup assignment and explicit layout-owned viewport references.
- Strict read derives the physical truth from validated `CadLayout` data and rejects any stale or malformed duplicate state.
- `PAPER_WORKSPACE_CURRENT`, `PAPER_WORKSPACE_MIGRATED` and `PAPER_WORKSPACE_REPAIRED` receipts carry deterministic ordered repair codes.
- Fallback legacy state is normalized before its first checkpoint. Persisted legacy migration is append-only and excluded from user Undo history.
- Page setup and Model/Paper switch operations persist layout data, layout workspace and paper workspace in the same atomic revision before live session state changes.
- Existing F-097 create/copy/delete/reorder planners refresh paper state when the extension is present; copied named page-setup and viewport ownership references remain valid.
- Undo/Redo restores active context and physical paper state and remains isolated per document.

## Fail-closed matrix

Unit and mutation tests independently corrupt:

- paper units;
- active layout/space context;
- paper layout association;
- boundary and printable-area geometry;
- plot origin and orientation/media;
- named page-setup assignment;
- viewport id and viewport owner layout.

`readPaperWorkspace` rejects every mutant. `migratePaperWorkspace` recomputes the canonical state and returns the matching repair receipt before the document is opened into a live session. A malformed underlying layout/page-setup collection remains a hard error rather than being silently invented.

## Real browser read-back

URL: `http://127.0.0.1:5208/src/features/documents/document-paper-workspace-harness.html`.

- `seed`: PASS; alpha revision 6 and beta revision 1.
- alpha `layout-1`: ISO A3 portrait, boundary `297 x 420 mm`, printable `277 x 400 mm`, `viewport-1` owned by `layout-1`.
- alpha `layout-2`: ISO A4 portrait, boundary `210 x 297 mm`, printable `190 x 277 mm`, `viewport-2` owned by `layout-2`.
- alpha crashed with `layout-2` active in paper space; beta had `layout-1` active in paper space.
- `recover`: PASS from operation log; both receipts report `paper-workspace-crashed`.
- Undo: alpha revision 7, Model active; both physical paper records unchanged.
- Redo: alpha revision 8, `layout-2` active in paper space.
- beta stayed revision 1 and unchanged through alpha Undo/Redo.
- `verify`: PASS; revisions 8/1, operation counts 8/1 and no repeat migration.

## Regression boundary

This is an explicit opt-in document layer. `App.tsx`, `style.css`, CAD shell, geometry, annotation/blocks, DXF/PDF adapters, package files, scope/parity files and security evidence were not modified. No score or deployment state changed.

## Final gates

- `npm run typecheck`: PASS.
- `npm run lint`: PASS.
- `npm run test`: PASS, 203 files / 990 tests.
- `npm run gate:dxf`: PASS, 21 files / 56 tests.
- `npm run gate:pdf`: PASS, 7 files / 22 tests.
- `npm run build`: PASS, 150 modules transformed; existing chunk-size advisory only.
- `node tools/provenance/scan-public-tree.mjs`: PASS, 1611 files.
- `npm run license:check`: PASS, 119 installed packages audited.
- `git diff --check`: PASS.
