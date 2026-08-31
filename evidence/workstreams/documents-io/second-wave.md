# Documents I/O second wave

Integrated base: `34683acfb1ab7a0546539cd6f72546ecb868011c`.

Status: implementation and deterministic regression evidence complete; parity scores unchanged.

## F-115 atomic attachment closure

- `CadChange` has immutable `put-attachment` and `delete-attachment` variants with exact inverse ordering.
- Attachment reference plus PDF placement is one `CadSession` revision and one Undo/Redo step.
- Document head, snapshot, operation and SHA-verified PDF bytes commit in one IndexedDB transaction.
- Corrupt input, missing stored bytes, corrupt stored bytes and non-durable clean close fail closed.
- Attachment bytes remain append-only after document detach or Undo.

## F-128 session coordinator

- Every `documentId` owns an independent `CadSession`, selection, renderer viewport and active Model/Layout id.
- A failed persistence callback leaves the accepted session and revision unchanged.
- Undo/Redo and close/adjacent activation affect only the addressed document.

## F-133 recovery ratchet

- An unmatched open event is reported as an interrupted session.
- Recovery accepts the last valid SHA-chained revision and appends a quarantine boundary for corrupt tail operation ids.
- The corrupt records remain append-only; a new operation chain can continue from the recovered revision.
- Chronological open/clean depth prevents an early clean event from concealing a later crash.
- Clean close requires the exact mutable revision and readable SHA-matching attachment bytes.

## Native boundary

F-112, F-113, F-117 and F-121 remain blocked by `NATIVE_SDK_UNAVAILABLE`. No ODA File Converter, LibreDWG, FreeCAD or LibreCAD output is used as native AutoCAD parity evidence.

## Final read-back on 2026-08-31

- Typecheck, lint and production build: PASS.
- Full Vitest: 117 files / 662 tests PASS.
- DXF gate: 15 files / 50 tests PASS.
- PDF gate: 7 files / 22 tests PASS.
- Public-tree: 1361 files, no blocked artifacts or secret patterns.
- License gate: 119 installed packages audited, PASS.
- `git diff --check`: PASS.
- Independent ezdxf read-back: AC1018, millimetres, 40 entities, 0 audit errors, SHA-256 `28DE58B3AA9E7A2C44BCF4D17B297B1CC64B08FBBBEA448A33720B0D14C601AC`.
- Independent pypdf/pdfplumber read-back: 2 unencrypted vector pages, 0 image objects, SHA-256 `4FB1CE37BF217841A7F7A0B88F82084A92339074D00CC6961A37D3781123F4C1`.
- Fresh Poppler 120 dpi PNG hashes: `9094BD72B4E017B93321D4BD8647B3E57FAFDF7DE646599CC1930F2AE2C2921D` and `9611688A302F0760D8830B4041794A36DAB4F8523360B2E6A46762239EF2602A`; both page frames and vector geometry were visually read back. The source A4 fixture's intentionally oversized heading remains clipped at the page edge.
