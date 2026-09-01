# Documents I/O integration contract

Second-wave source: `work2/reio-documents-io` from integrated commit `34683acfb1ab7a0546539cd6f72546ecb868011c`.

Third-wave live integration source: `work3/reio-documents-live` from integrator base `9af0b7b241ec28f6d5976ed69f79d973611f1c5b`.

Fourth-wave layout/plot shell source: `work4/reio-documents-live` from integrator base `6bd651bff79e40f0b21c11e178af74cd477e9d11`.

Fifth-wave document workspace source: `work5/reio-documents-live` from integrator base `dce6190f73d527b89d9f418a25f266243ebc2f41`.

Sixth-wave recovery/compaction source: `work6/reio-documents-live` from integrator base `2bbec19176b8a17bc88f6b3ff962e8caf2fb444e`.

Seventh-wave Model/Layout document-state source: `work7/reio-documents-live` from integrator base `bf203e8ac4681b206eacc9f19fcfe73378cdc56d`.

Eighth-wave PAPER SPACE document-state source: `work8/reio-documents-live` from integrator base `7bfa2bea649583129844444f9f5788a701ff21a4`.

F-110 DXF import hardening source: `work10/reio-documents-f110-import` from integrator base `c607df360f68714e87b475ffbbc1a889abf93306`.

F-110 anonymous dimension-block audit source: `work11/reio-documents-f110-audit` from integrator base `6d6213d9e1c59a2471a106bdb3985176b9a1f41c`.

This workstream deliberately does not modify `App.tsx`, `style.css`, package manifests, parity scores or security evidence. The integration owner must wire the following surfaces without weakening the existing F-097...F-107, F-109, F-111 and F-114 paths.

## Shared package exports

Already exported by `@kuubik/cad-dxf`:

- `openDxfDocument`
- `readBackOpenedDxf`
- `DxfOpenOptions`, `DxfOpenReadback`, `DxfOpenResult`
- `importDxf` accepts optional `targetUnits` and `preserveUnsupported`; its report exposes source/target units, deterministic insertion scale and preserved proxy handles
- F-110 typed import covers LINE/RAY/XLINE/LWPOLYLINE bulges/CIRCLE/ARC/ELLIPSE/SPLINE/TEXT/MTEXT/HATCH/linear-aligned DIMENSION and named BLOCK/INSERT
- Exported DIMENSION picture blocks are deterministically normalized to `*D1`, `*D2`, ... in document-entity order. DIMENSION group 70 includes the R13+ single-owner bit 32; the matching BLOCK group 70 has anonymous bit 1; BLOCK_RECORD, BLOCK and ENDBLK use one record handle. Import intentionally drops these AutoCAD-owned picture blocks and export regenerates the same normalized sequence.

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
- `dxf-import-transaction.ts`: parse-before-commit DXFIN composition; converts source units into the open document units, retains paper layouts, commits one append-only operation, then exports and reparses the persisted document before returning
- `dxf-import-harness.ts` and `.html`: real-Chromium IndexedDB import → Undo → Redo → unclean-session recovery read-back
- `documents-live-harness.ts`: deterministic F-115/F-128/F-133 crash/reload, stale-revision and corrupt-tail fixture; it is also published as `window.runKuubikDocumentsLiveHarness` when imported in a browser
- `documents-live-harness.html`: isolated real-Chromium IndexedDB runner; this test page is not part of `App.tsx`
- `layout-plot-shell.ts`: DOM-independent F-096...F-107/F-114/F-115 caller contract over live document revisions, Layout/PageSetup/Plot primitives, vector PDF and underlay read-back
- `layout-plot-shell-harness.ts` and `.html`: deterministic real-Chromium layout, rectangular viewport, scale/pan/twist/lock, page setup, named setup, publish, Undo/Redo and crash/reload fixture
- `document-workspace-shell.ts`: DOM-independent F-128/F-129/F-130 contract for document switching, per-document command context, persisted atomic history and PGP-like aliases
- `document-workspace-harness.ts` and `.html`: deterministic real-Chromium two-document isolation, undo-mark, crash/reload, stale-revision and alias roundtrip fixture
- `recovery-compaction-harness.ts` and `.html`: two-phase real-Chromium seed/reload fixture for multi-document compaction, interrupted session, incomplete operation tail and idempotent replay
- `document-layout-workspace.ts`: DOM-independent F-096/F-097 controller for atomic Model/Layout switch, create, copy, rename, delete, reorder, Undo/Redo and independent read-back
- `document-layout-workspace-harness.ts` and `.html`: three-phase real-Chromium crash/reload/second-reload fixture for persistent active space, tab order, monotonic ids and multi-document isolation
- `document-paper-workspace.ts`: DOM-independent F-098 controller for physical paper/page-setup state, Model/Paper switching and persisted Undo/Redo
- `document-paper-workspace-harness.ts` and `.html`: three-phase real-Chromium crash/reload/second-reload fixture for paper boundary, printable area, units, viewport ownership and multi-document isolation
- `indexed-db.ts`: schema v3 attachment, append-only snapshot/operation/compaction and crash-event methods

`KDrawIndexedDb(factory, databaseName?)` accepts an optional isolated database name for non-destructive browser fixtures. Production callers retain the default `kuubik-draw` name.

## Live integration surface

`DocumentLiveOrchestrator` is the approved F-115/F-128/F-133 integration boundary. Its `open`, `commit`, `attachPdf`, `activate`, view-context and `close` methods keep the pure tab state and the per-document `CadSession` synchronized. `commit` and `attachPdf` update the visible tab only after the candidate revision has been durably accepted. `close` records a clean boundary only after the exact revision and every referenced attachment have passed storage read-back.

`DocumentLayoutPlotShell` is the approved DOM-independent F-096...F-107/F-114/F-115 shell boundary. It delegates semantic changes to the existing core planners and accepts them only through `DocumentLiveOrchestrator.commit`. Layout create/rename/delete, rectangular viewport creation, viewport view/pan/twist/lock, Model/Paper page setup, named page setup, publish settings, vector PDF and underlay read-back therefore share one revision contract.

`DocumentLiveOrchestrator.undo`/`redo` use `DocumentSessionCoordinator.undoPersisted`/`redoPersisted`: a candidate history state is persisted before it replaces the accepted session. A failed storage callback leaves revision, document and Undo/Redo stacks unchanged. If an active layout is removed by a commit or Undo, the coordinator reconciles the session and tab to Model before callers select an adjacent paper layout.

`DocumentLayoutWorkspace` is the seventh-wave F-096/F-097 document-model boundary. Callers opt in with `DocumentLiveOrchestrator.open({ layoutWorkspace: "migrate" })`; existing certified callers that omit this flag keep their prior behavior. The opt-in guarantees exactly one Model layout, at least one paper Layout, a strict persisted `kuubik.layoutWorkspace.v1` extension, stable monotonic layout/viewport ids, exact tab order and an active-space value that matches the active layout kind. Layout collection and workspace extension are one atomic `CadChange` plan. The controller accepts the revision before synchronizing live tab/session state.

Legacy documents migrate deterministically and idempotently. A new fallback document is normalized before its first checkpoint. An already persisted legacy document receives an append-only `LAYOUT_WORKSPACE_MIGRATE` revision that is deliberately excluded from user Undo history. Missing paper state creates `layout-1`; malformed active ids, space kinds, tab permutations or allocation counters fail strict read and are repaired before session exposure. The repair never lowers allocation counters, so deleted `layout-N` and `viewport-N` ids are not reused. Named page-setup assignments and viewport definitions remain attached to their stable layout ids through copy/reorder/Undo/Redo.

`DocumentPaperWorkspace` is the eighth-wave F-098 document-model boundary. Callers opt in with `DocumentLiveOrchestrator.open({ paperWorkspace: "migrate" })`; this also validates/migrates the prerequisite layout workspace, while callers that omit the flag retain their certified behavior. The strict `kuubik.paperWorkspace.v1` extension binds each paper layout to millimeter boundary and printable-area rectangles, media/orientation, plot origin, named page-setup assignment and explicit `{ layoutId, viewportId }` ownership references. Its active context must equal the layout workspace context exactly.

`PaperWorkspaceReceiptV1` is deterministic and uses `PAPER_WORKSPACE_CURRENT`, `PAPER_WORKSPACE_MIGRATED` or `PAPER_WORKSPACE_REPAIRED`. Missing legacy state is checkpointed before first exposure or appended as a non-user-undoable `PAPER_WORKSPACE_MIGRATE` revision. Stale units, Model/Paper context, layout references, boundary, printable area, origin, orientation, page-setup assignment or viewport ownership fail strict read. Migration recomputes the state from the validated physical `CadLayout` collection and returns the exact ordered repair codes before exposing the session. Page setup and Model/Paper changes commit layout data, layout workspace and paper workspace in one durable revision.

The shell capability map is intentionally not a parity score. F-096...F-107/F-114 and F-115 are `candidate`; they still require the row-specific browser/AutoCAD/read-back chain before score changes. F-108 PC3/CTB/STB is `disabled`, while F-112/F-113/F-117/F-121 remain `disabled` with `NATIVE_SDK_UNAVAILABLE`.

`DocumentWorkspaceShell` is the F-128/F-129/F-130 integration boundary. It keeps selection, viewport, active layout and command history on each document entry, rejects an expected revision before recording or mutating a command, and routes committed changes, explicit undo marks, Undo and Redo through `DocumentLiveOrchestrator`.

`PgpAliasMapping` accepts UTF-8 `ALIAS, *COMMAND` text up to 1 MiB. Canonical command names are reserved and always win. Imported aliases override built-ins; repeated imported aliases use the last valid declaration and report each changed mapping as `incoming-wins`. Unknown commands, malformed lines, canonical-name replacement and invalid alias tokens reject the entire import before replacing the active map. Export is uppercase, alias-sorted CRLF text with a final CRLF, so export -> import -> export is bit-identical.

Each enhanced operation record stores the post-operation `CadSessionHistoryState` and its own SHA-256 beside the existing document SHA chain in the same IndexedDB transaction. Recovery accepts history only from the last valid operation-log record. A history-only mutation quarantines that operation tail even if document revision and document SHA remain valid. Legacy records without history remain readable but return `sessionHistory: null` and do not claim recoverable Undo/Redo.

Schema v3 adds an append-only `compactions` store. `compactDocument` accepts only a non-degraded recovered head and a positive minimum-operation policy, atomically appends a SHA-bound snapshot plus compaction record, and independently reads both back. It never deletes operation or snapshot history. Recovery may use the newest valid compaction as a replay floor, restores its exact `CadSessionHistoryState`, and validates every later operation through the existing document/history SHA chains. A missing or mutated compact snapshot/record is reported and falls back to the complete operation log.

Every recovery returns a deterministic `RecoveryReceipt` with a stable code, source, revision, ignored operation ids, corrupt snapshot/compaction keys, unclean session ids, selected compaction key and Estonian summary. `DocumentLiveOrchestrator.readBack` forwards this receipt without reducing the earlier F-128/F-129/F-130 session or alias data. `StoragePersistenceError` exposes stable quota, transaction-abort and generic request codes; an aborted append keeps document head, snapshots and operations unchanged.

The fifth-wave browser fixture is available at `/src/features/documents/document-workspace-harness.html`. It proves two isolated document contexts, an explicit SCALE undo mark, LINE/CIRCLE history separation, crash recovery, two Undo steps plus Redo, stale-revision rejection and bit-identical PGP alias export/import. F-128/F-129/F-130 remain `candidate`: `App.tsx`, visible keyboard routing and the owned AutoCAD comparison are outside this worktree.

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

F-115 atomic persistence and crash/reload wiring now have real-Chromium read-back, and the owned AutoCAD 2024 scratch comparison is recorded under `evidence/workstreams/documents-io/f115/`. Full F-115 parity remains a candidate until the integration reaches the production App route and a general PDF.js page renderer is live-tested. The current object surface is a safe visual fallback for traditional uncompressed PDFs; compressed object streams and inherited page boxes fail closed.

### F-115 visible underlay integration (work13)

Source branch: `work13/reio-documents-f115-pdf-underlay` from exact base `21acae84e847bf59f7b1307b66df6afc42d83e77`.

New integration surfaces, intentionally kept outside `App.tsx`:

- `PdfUnderlayAttachPanel`: visible file chooser, page selector, insertion X/Y, scale, rotation, opacity, fade and rectangular clip input.
- `PdfUnderlayWorkspace`: attach, update, immutable-source reload, detach, Undo/Redo and SHA/page-count/layer read-back over `DocumentLiveOrchestrator`.
- `PdfUnderlayView`: pointer-disabled clipped image surface using effective opacity `opacity * (1 - fade / 100)`.
- `renderPdfUnderlayPageSvg`: inert SVG fallback for explicit uncompressed page/content objects. Compressed streams and inherited page boxes fail closed pending PDF.js.
- `pdf-underlay-visible-harness.html`: isolated production-Chromium integration fixture; not part of the user-facing route.

Exact integrator patch required in the owner-controlled `App.tsx`:

1. Create one `PdfUnderlayWorkspace(liveOrchestrator, activeDocumentId, "app-pdf")` for the active document.
2. Open `PdfUnderlayAttachPanel` from the existing Import/PDF command and pass the active layer id. Its `onAttach` callback must call `liveOrchestrator.attachPdf` (or `PdfUnderlayWorkspace.attach`) with a revision-bound `PDFATTACH` operation.
3. For every `readPdfUnderlays(activeDocument)` placement, call `resolvePdfUnderlayLayerState`; skip off/frozen/hidden placements.
4. Load bytes with `liveOrchestrator.readPdf`, call `renderPdfUnderlayPageSvg(bytes, placement.pageNumber)`, create an `image/svg+xml` object URL, and render `PdfUnderlayView` beneath editable CAD geometry.
5. Revoke each object URL when the placement, document or active tab changes.
6. Route property edits through `PdfUnderlayWorkspace.update`, reload through `.reload`, detach through `.detach`, and global Undo/Redo through the existing persisted live-orchestrator commands. Never mutate metadata or IndexedDB directly.
7. Surface the renderer's fail-closed PDF.js requirement to the user; do not silently replace an unsupported page with a blank rectangle.

The work13 evidence uses one shared synthetic PDF across AutoCAD 2024, visible Chromium and independent pypdf/pdfplumber/Poppler read-back. The score remains unchanged because the production `App.tsx` route and general PDF.js renderer are outside this worktree.

## Recovery boundary

A corrupt operation tail is never deleted. `DocumentAutosaveRecovery.open` appends a `recover` event that records the ignored operation ids and rewinds only the mutable head to the last valid SHA-chained document. Later commits reuse that revision with unique append-only snapshot keys; replay filters only explicitly quarantined operation ids. Open/clean pairing is chronological, so an early or duplicate clean event cannot hide a later interrupted session.

The sixth-wave fixture is available at `/src/features/documents/recovery-compaction-harness.html`. Load `?phase=seed`, then navigate or reload with `?phase=recover` against the same browser profile. The seed phase creates alpha revision 2 and beta revision 1, compacts alpha, appends an intentionally incomplete alpha revision-3 tail and closes without clean events. The recover phase must return alpha revision 2 from compaction with the incomplete tail named, beta revision 1 from the operation log, unchanged operation counts 3/1, `browser-crashed` on both receipts and a byte-identical repeated alpha document/receipt.

The seventh-wave fixture is available at `/src/features/documents/document-layout-workspace-harness.html`. Run `?phase=seed`, `?phase=recover`, then `?phase=verify` in the same browser profile. Alpha performs nine atomic operations covering Model/Paper switching and paper create/copy/rename/delete/reorder, then crashes at revision 9. Reload must restore active `layout-3`, paper space, tab order `model/layout-3/layout-1/layout-2`, counters 5/5 and report `layout-workspace-crashed`. Undo persists revision 10 with Model active; Redo persists revision 11 with `layout-3` active. Beta remains revision 1 throughout. The verify phase must keep revisions 11/1, operation counts 11/1 and report no repeat migration.

The eighth-wave fixture is available at `/src/features/documents/document-paper-workspace-harness.html`. Run `?phase=seed`, `?phase=recover`, then `?phase=verify` in one browser profile. Alpha crashes at revision 6 with active `layout-2`: `layout-1` is ISO A3 portrait with a `297 x 420 mm` boundary and `277 x 400 mm` printable area; `layout-2` is ISO A4 portrait with a `210 x 297 mm` boundary and `190 x 277 mm` printable area. Their ownership references remain `layout-1/viewport-1` and `layout-2/viewport-2`. Reload restores revision 6 and names `paper-workspace-crashed`; Undo persists revision 7 with Model active and Redo persists revision 8 with `layout-2` active. Beta remains revision 1. Verify must retain revisions 8/1, operation counts 8/1 and no repeat migration.

Threat boundary: SHA-256 detects accidental/corruption-fixture mutation but is not a signature against an attacker able to rewrite both payload and digest. IndexedDB origin isolation, browser quota policy and physical process-kill durability remain browser/platform responsibilities. Compaction is a replay optimization and audit checkpoint, not destructive garbage collection. It refuses degraded recovery state, preserves every prior record and never upgrades a recovery result into certification evidence by itself.

## Native boundary

`tools/native/contracts.ts` must remain blocked until `assertLicensedNativeCapability` receives auditable ODA Drawings SDK or Autodesk RealDWG license evidence and a pinned runtime SHA-256. ODA File Converter, LibreDWG, LibreCAD and FreeCAD cannot unlock F-112/F-113/F-117/F-121.

## Integration acceptance

- Existing certified Layout/Page Setup/PDF/DXF tests remain byte-stable.
- DXF Open creates a new Model document; DXFIN continues to replace only active drawing content.
- Two documents retain independent revision, Undo/Redo, active layout, selection and viewport state.
- PDF bytes read back with the stored SHA-256 and do not become editable CAD geometry.
- A forced Chromium termination restores the last valid SHA-chained revision and visibly reports the unclean session.
- No native row is scored `1.00` without licensed adapter plus owned AutoCAD live roundtrip evidence.
