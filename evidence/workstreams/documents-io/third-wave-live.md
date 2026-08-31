# Documents I/O third-wave live harness

Base: `9af0b7b241ec28f6d5976ed69f79d973611f1c5b`.

Branch: `work3/reio-documents-live`.

Status: browser-ready integration and deterministic real-Chromium evidence complete; parity scores unchanged.

## F-115 atomic PDF persistence

- The live orchestrator accepts the PDF document revision into the tab/session view only after the IndexedDB transaction and independent stored-byte read-back pass.
- Real Chromium read-back: document revision `1`, operation count `1`, append-only snapshot revisions `[0, 1]`.
- Stored underlay SHA-256: `c012d7f843bf9bfbe128cb3862eaf8ca85bf2b3f5634c1c347aab42646a83e2c`.
- Stored underlay byte length: `218`.
- A checksum-mismatching byte mutation leaves document/session/tab revision at `0`, writes no operation and writes no attachment.

The independent certified PDF artifact remains `evidence/artifacts/F-114-independent-vector.pdf`, SHA-256 `4fb1ce37bf217841a7f7a0b88f82084a92339074d00cc6961a37d3781123f4c1`. Fresh third-wave read-back returned:

- pypdf: 2 unencrypted pages; MediaBoxes `1190.551181 x 841.889764` and `595.275591 x 841.889764` pt;
- pdfplumber: the same page sizes, searchable text length 61 on both pages and 0 image objects;
- Poppler 120 dpi: PNG SHA-256 `9094bd72b4e017b93321d4bd8647b3e57fafdf7de646599cc1930f2ae2c2921d` and `9611688a302f0760d8830b4041794a36dab4f8523360b2e6a46762239ef2602a`;
- visual read-back: both complete frames and vector geometry are present; the intentionally oversized A4 blue heading remains clipped at the right page edge.

This wave does not replace or alter the PDF artifact.

## F-128 live multi-document state

- Before simulated process loss: tab/session order `[alpha, beta]`, active document `beta`, alpha revision `1`, beta revision `2`.
- After reload: the same tab/session order and active document are restored; alpha is revision `1` and beta is the last valid revision `1`.
- An eight-document deterministic property matrix proves unique state for document, revision, entity handles, selection and viewport plus exact IndexedDB head read-back.
- No `App.tsx`, shell or style file was modified.

## F-133 crash/reload and reject boundaries

- The crash is simulated by closing the first browser database connection without recording clean events.
- The second browser session reports `browser-session-crashed` as unclean for both documents.
- A deliberately mutated `beta-line-2` after-SHA is retained append-only but quarantined; reload returns beta revision `1` and reports ignored operation id `beta-line-2`.
- A stale alpha operation with base revision `0` against stored revision `1` raises `StorageRevisionConflictError` and writes nothing.
- The reloaded clean-close path verifies exact current revision and every referenced attachment byte stream.

## Real browser execution

Development URL: `http://127.0.0.1:5204/src/features/documents/documents-live-harness.html`.

Browser: Codex in-app Chromium, real browser IndexedDB, isolated per-run database name, no console warnings or errors.

Harness result: `ok: true`, `staleRevision: true`, `corruptTail: true`.

## Final gates on 2026-08-31

- `npm run typecheck`: PASS.
- `npm run lint`: PASS.
- `npm run test`: 130 files / 716 tests PASS.
- `npm run gate:dxf`: 15 files / 50 tests PASS.
- `npm run gate:pdf`: 7 files / 22 tests PASS.
- `npm run build`: PASS; 118 modules transformed.
- `node tools/provenance/scan-public-tree.mjs`: 1404 files, no blocked artifacts or secret patterns.
- `npm run license:check`: 119 installed packages audited, PASS after a clean lockfile-pinned `npm ci`.
- `git diff --check`: PASS.

## Native boundary

F-112, F-113, F-117 and F-121 remain blocked by `NATIVE_SDK_UNAVAILABLE`: no licensed ODA Drawings SDK or Autodesk RealDWG runtime, auditable license evidence and approved native corpus are available. ODA File Converter, LibreDWG, FreeCAD and LibreCAD are not used as AutoCAD parity evidence.
