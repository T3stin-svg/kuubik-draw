# Documents I/O seventh-wave Model/Layout workspace

Base: `bf203e8ac4681b206eacc9f19fcfe73378cdc56d`.

Branch: `work7/reio-documents-live`.

Status: F-096/F-097 document-model state and real-browser persistence fixture complete; parity scores unchanged.

## Implemented boundary

- `kuubik.layoutWorkspace.v1` persists active layout, active Model/Paper space, exact tab order and monotonic layout/viewport allocation counters.
- Strict read requires exactly one Model layout, at least one paper Layout, an exact tab permutation, matching active space and safe allocation counters.
- Legacy and semantically corrupt documents repair deterministically before session exposure; the same valid document migrates idempotently.
- Persisted legacy repair is an append-only `LAYOUT_WORKSPACE_MIGRATE` revision outside user Undo history.
- Create/copy/rename/delete/reorder/switch commit layout collection and workspace metadata atomically through `DocumentLiveOrchestrator`.
- Copy preserves page setup, viewport properties and named page-setup assignment while issuing stable new layout/viewport ids.
- Deleted ids are not reused. The last paper Layout and Model layout remain protected.
- Undo/Redo restores active space and tab order in the same revision and remains isolated per document.

## Regression boundary

The feature is explicit opt-in through `layoutWorkspace: "migrate"`. Existing Layout/Page Setup/PDF/DXF callers are unchanged. `App.tsx`, `style.css`, CAD shell, geometry, annotation/blocks, DXF/PDF adapters, package files, scope/parity scores and security evidence were not modified.

## Real browser read-back

URL: `http://127.0.0.1:5207/src/features/documents/document-layout-workspace-harness.html`.

- `seed`: PASS; alpha revision 9 and beta revision 1.
- alpha before crash: active `layout-3`, paper space, order `model/layout-3/layout-1/layout-2`, next counters 5/5.
- surviving layout ids/viewports: `layout-3/viewport-3`, `layout-1/viewport-1`, `layout-2/viewport-2`; deleted `layout-4/viewport-4` were not reused.
- `recover`: PASS from operation log; both receipts report unclean session `layout-workspace-crashed`.
- Undo: alpha revision 10, Model active, Model space.
- Redo: alpha revision 11, `layout-3` active, paper space.
- beta stayed revision 1 with active `layout-1`; alpha Undo/Redo did not change beta.
- `verify`: PASS; revisions 11/1 and operation counts 11/1; no repeat migration.

## Automated evidence

- Core unit tests cover migration, invalid-state repair, stable/non-reused ids, final-layout guards, atomic Undo/Redo and page setup/viewport preservation.
- Mutation tests independently corrupt active id, active-space kind, tab permutation and allocation counters; strict read fails closed and migration repairs each case.
- Web tests cover fallback and persisted legacy paths, SHA-valid semantic corruption, multi-document isolation and reload golden state.
- Wiring ratchets require explicit migration opt-in, validation before session exposure and durable commit before live active-layout synchronization.

## Honest limit

This wave closes the document-model contract only. It does not claim visible CAD-shell integration or AutoCAD parity, and it does not change feature scores. F-112/F-113/F-117/F-121 remain blocked by `NATIVE_SDK_UNAVAILABLE`; no LibreDWG, LibreCAD or FreeCAD result is treated as licensed native evidence.

## Final gates

- `npm run typecheck`: PASS.
- `npm run lint`: PASS.
- `npm run test`: PASS, 188 files / 919 tests.
- `npm run gate:dxf`: PASS, 20 files / 55 tests.
- `npm run gate:pdf`: PASS, 7 files / 22 tests.
- `npm run build`: PASS, 144 modules transformed; existing chunk-size advisory only.
- `node tools/provenance/scan-public-tree.mjs`: PASS, 1536 files.
- `npm run license:check`: PASS, 119 installed packages audited.
- `git diff --check`: PASS.
