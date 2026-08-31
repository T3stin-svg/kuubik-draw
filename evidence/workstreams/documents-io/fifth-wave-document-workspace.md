# Documents I/O fifth-wave document workspace

Base: `dce6190f73d527b89d9f418a25f266243ebc2f41`.

Branch: `work5/reio-documents-live`.

Status: DOM-independent F-128/F-129/F-130 candidate contract complete; parity scores unchanged.

## Candidate rows

- F-128: two-document tab/session switching with isolated selection, viewport, active layout, revision and command history.
- F-129: per-document atomic command Undo/Redo, explicit undo marks, durable history and SHA-bound crash recovery.
- F-130: validated PGP-like alias import/export, canonical command protection, deterministic precedence and conflict read-back.

These are implementation candidates, not certification. `App.tsx`, visible keyboard routing and an owned AutoCAD 2024 multi-document/Undo/PGP comparison are outside the allowed write scope.

## Deterministic alias contract

Precedence is `canonical > imported > built-in`.

- Canonical names cannot be remapped.
- Imported mappings replace built-ins.
- Repeated imported mappings use the last valid declaration and report `incoming-wins`.
- A malformed line, unknown command, invalid alias or canonical conflict rejects the whole import without replacing the active mapping.
- Canonical export is alias-sorted uppercase UTF-8, CRLF terminated and bit-identical after import/export.

Browser export read-back:

- text: `L, *LAYOUT\r\nZZ, *LINE\r\n`;
- byte length: 23;
- SHA-256: `631baca2b9608a6d029ab6ecd022720a01634fb112bdef1a4218f4c81f3b7f8a`;
- changed conflicts: built-in `L: LINE -> LAYOUT`, then imported `ZZ: ZOOM -> LINE`;
- export/import/export bytes: identical.

## Atomic history and crash recovery

Each enhanced operation record stores document before/after SHA values plus `CadSessionHistoryState` and its SHA-256 in the same IndexedDB transaction. Recovery validates both chains before exposing history.

- alpha crashed at revision 2 with next Undo `SCALE`; beta crashed at revision 1 with next Undo `CIRCLE`.
- reload reported `workspace-crashed` for both and restored both independent stacks.
- first alpha Undo consumed only the SCALE undo mark: revision 3, handles `A0,A1`.
- second alpha Undo consumed LINE: revision 4, handle `A0`.
- alpha Redo restored LINE: revision 5, handles `A0,A1`.
- beta remained revision 1 throughout.
- an alpha base-revision-0 mutation was rejected against revision 5 before command history or document mutation.
- a mutation of only stored history bytes, without updating history SHA, quarantined the operation and recovered the revision-0 checkpoint with `sessionHistory: null`.

## Real Chromium read-back

URL: `http://127.0.0.1:5205/src/features/documents/document-workspace-harness.html`.

- visible status: `passed`;
- before crash active tab: alpha; order `alpha,beta`;
- alpha selection/viewport/history: `A0`, 800 x 600 at DPR 1, `ZZ...` then `SC 1`;
- beta selection/viewport/history: `B0`, 1200 x 900 at DPR 2, `C 5,5 2`;
- after reload: operation-log revisions 2/1, independent next-Undo values SCALE/CIRCLE;
- stale revision rejected: true;
- PGP bit-exact roundtrip: true.

## Verification

- `npm run typecheck`: PASS.
- `npm run lint`: PASS.
- `npm run test`: PASS, 156 files / 799 tests.
- targeted F-128/F-129/F-130 plus transaction/layout regression suite: PASS, 7 files / 36 tests.
- `npm run gate:dxf`: PASS, 17 files / 52 tests.
- `npm run gate:pdf`: PASS, 7 files / 22 tests.
- `npm run build`: PASS, 124 modules transformed; the pre-existing >500 kB chunk warning remains.
- `node tools/provenance/scan-public-tree.mjs`: PASS, 1469 files.
- `npm run license:check`: PASS, 119 installed packages audited.
- `git diff --check`: PASS.
