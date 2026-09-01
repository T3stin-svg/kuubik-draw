# F-115 PDF underlay threat model

Status: candidate boundary, no parity score change.

## Accepted input

- PDF header and final EOF marker are mandatory; trailing bytes fail closed.
- Maximum accepted size is 128 MiB.
- Encrypted files fail closed.
- `/JavaScript`, `/JS`, `/Launch`, `/OpenAction`, `/AA`, `/RichMedia`, `/SubmitForm`, `/ImportData` and `/EmbeddedFile` fail closed before attachment persistence.
- Attachment bytes are copied, SHA-256 bound and stored append-only. A reload creates a new immutable attachment id; the prior bytes remain available for Undo and crash recovery.
- The browser-visible fallback accepts only explicit, uncompressed page dictionaries and uncompressed content streams. Compressed streams, object streams and inherited page boxes require the future PDF.js adapter and currently fail closed.

## Rendering boundary

`renderPdfUnderlayPageSvg` interprets a small inert graphics/text operator allowlist and XML-escapes all PDF strings. It never evaluates PDF actions, JavaScript or embedded files. The resulting SVG is loaded as an image beneath pointer-disabled CAD geometry.

## Document and layer boundary

- Page, insertion point, physical size/scale, rotation, opacity, fade, clip polygon, reference path/mode and layer id are persisted in `kuubik.pdfUnderlays.v1`.
- Off or frozen layers neither render nor participate in selection/editing.
- Locked layers remain visible/selectable but reject edits, detach and reload.
- Attachment reference and placement metadata are one atomic Undo/Redo revision.
- IndexedDB commit, snapshot, operation record and attachment bytes are one transaction; stored bytes and SHA are independently read back before the visible document advances.

## Known limit

This work does not claim general PDF.js fidelity, transparency-group parity, font parity, annotation rendering or AutoCAD clip-shape parity. Those remain certification blockers for full F-115 scoring.
