# Documents I/O integration contract

Second-wave source: `work2/reio-documents-io` from integrated commit `34683acfb1ab7a0546539cd6f72546ecb868011c`.

Third-wave live integration source: `work3/reio-documents-live` from integrator base `9af0b7b241ec28f6d5976ed69f79d973611f1c5b`.

This workstream deliberately does not modify `App.tsx`, `style.css`, package manifests, parity scores or security evidence. The integration owner must wire the following surfaces without weakening the existing F-097...F-107, F-109, F-111 and F-114 paths.

## Shared package exports

Already exported by `@kuubik/cad-dxf`:

- `openDxfDocument`
- `readBackOpenedDxf`
- `DxfOpenOptions`, `DxfOpenReadback`, `DxfOpenResult`

Already exported by `@kuubik/cad-print`:

- `inspectPdfUnderlay`
- `preparePdfUnderlay`
- `createPdfUnderlayPlacement`
- `PdfUnderlayError` and related types

Core integration module, exported by the integrated `@kuubik/cad-core` barrel before this worktree:

- `packages/cad-core/src/pdf-underlays.ts`
- exports required from `@kuubik/cad-core`: `addPdfUnderlay`, `readPdfUnderlays`, `assertPdfUnderlayPlacement`, `PDF_UNDERLAY_EXTENSION_KEY` and related types

The transaction module also exports `put-attachment` and `delete-attachment` `CadChange` variants. Attachment ids are immutable; replacement requires a new id.

## Web document modules

- `model-space.ts`: `createNewModelSpaceDocument`, `openDxfInModelSpace`, `readBackModelSpaceDocument`
- `document-tabs.ts`: pure open/activate/update/save/layout/reorder/close/read-back state functions
- `DocumentTabs.tsx`: tab UI using the existing document-tab class names
- `PdfUnderlayView.tsx`: pointer-disabled, transformed browser PDF-object surface
- `autosave-recovery.ts`: `DocumentAutosaveRecovery` open/checkpoint/commit/close lifecycle
- `document-session-coordinator.ts`: one isolated `CadSession`, viewport, selection and active layout per `documentId`
- `pdf-underlay-transaction.ts`: atomic attachment-byte/document commit and fail-closed stored-byte read-back
- `document-live-orchestrator.ts`: browser-ready composition root that exposes a document only after session, tab, append-only storage and attachment read-back agree
- `documents-live-harness.ts`: deterministic F-115/F-128/F-133 crash/reload, stale-revision and corrupt-tail fixture; it is also published as `window.runKuubikDocumentsLiveHarness` when imported in a browser
- `documents-live-harness.html`: isolated real-Chromium IndexedDB runner; this test page is not part of `App.tsx`
- `indexed-db.ts`: schema v2 attachment, append-only snapshot/operation and crash-event methods

`KDrawIndexedDb(factory, databaseName?)` accepts an optional isolated database name for non-destructive browser fixtures. Production callers retain the default `kuubik-draw` name.

## Live integration surface

`DocumentLiveOrchestrator` is the approved F-115/F-128/F-133 integration boundary. Its `open`, `commit`, `attachPdf`, `activate`, view-context and `close` methods keep the pure tab state and the per-document `CadSession` synchronized. `commit` and `attachPdf` update the visible tab only after the candidate revision has been durably accepted. `close` records a clean boundary only after the exact revision and every referenced attachment have passed storage read-back.

The deterministic browser fixture is available during development at `/src/features/documents/documents-live-harness.html`. Each run uses a fresh isolated database name, creates two documents, persists a PDF underlay atomically, simulates process loss by closing the database without clean events, corrupts one operation-log tail, reloads both documents and proves:

- alpha returns at revision 1 with exact PDF SHA-256 and byte length;
- beta returns at the last valid revision 1 and reports `beta-line-2` as ignored;
- both documents report the interrupted `browser-session-crashed` session;
- an operation with base revision 0 is rejected against alpha revision 1;
- multi-document tab, session, selection, viewport and revision state remain isolated.

## Legacy/manual App wiring order

1. Replace the single visible tab shell with `DocumentTabs`, while retaining one `CadSession` per `documentId` and deriving the renderer document/layout from the active tab.
2. Route New/Open DXF through `createNewModelSpaceDocument` or `openDxfInModelSpace`; keep the existing DXFIN command unchanged for replacing content in the active document.
3. On each command, call `DocumentSessionCoordinator.commitPersisted`; it accepts the candidate `CadSession` only after durable storage succeeds.
4. Open each restored tab through the recovery coordinator before exposing it. Display unclean-session and ignored-tail information; never silently call a corrupt tail recovered.
5. PDF import order: `preparePdfUnderlay` -> `commitPdfUnderlayAttachment` -> independent `readStoredPdfUnderlay` -> `PdfUnderlayView` beneath editable CAD geometry.
6. Close a dirty tab only after Save or an explicit discard decision. Record `clean` only after the exact current revision and all attachment writes are durable.

## Atomic attachment contract

`planAddPdfUnderlay` returns attachment-ref and placement-metadata changes for one `CadSession` revision. Their generated inverse changes remove both in one Undo; Redo restores both. `planRemovePdfUnderlay` removes the final unused attachment ref with its placement in the same way, while shared attachment refs remain until their final placement is detached.

`commitRevisionWithAttachment` writes document head, immutable snapshot, operation record and attachment bytes in one IndexedDB transaction. A checksum mismatch, duplicate append-only attachment id or revision conflict aborts every store. Clean close additionally verifies every referenced attachment byte stream and metadata. No attachment store delete is provided; Undo removes only the document reference.

F-115 atomic persistence and crash/reload wiring now have real-Chromium read-back. Full F-115 parity remains a candidate until the owned AutoCAD PDFATTACH comparison and PDF.js page renderer are live-tested. The current object surface is a safe visual fallback for traditional uncompressed PDFs; compressed object streams and inherited page boxes fail closed.

## Recovery boundary

A corrupt operation tail is never deleted. `DocumentAutosaveRecovery.open` appends a `recover` event that records the ignored operation ids and rewinds only the mutable head to the last valid SHA-chained document. Later commits reuse that revision with unique append-only snapshot keys; replay filters only explicitly quarantined operation ids. Open/clean pairing is chronological, so an early or duplicate clean event cannot hide a later interrupted session.

## Native boundary

`tools/native/contracts.ts` must remain blocked until `assertLicensedNativeCapability` receives auditable ODA Drawings SDK or Autodesk RealDWG license evidence and a pinned runtime SHA-256. ODA File Converter, LibreDWG, LibreCAD and FreeCAD cannot unlock F-112/F-113/F-117/F-121.

## Integration acceptance

- Existing certified Layout/Page Setup/PDF/DXF tests remain byte-stable.
- DXF Open creates a new Model document; DXFIN continues to replace only active drawing content.
- Two documents retain independent revision, Undo/Redo, active layout, selection and viewport state.
- PDF bytes read back with the stored SHA-256 and do not become editable CAD geometry.
- A forced Chromium termination restores the last valid SHA-chained revision and visibly reports the unclean session.
- No native row is scored `1.00` without licensed adapter plus owned AutoCAD live roundtrip evidence.
