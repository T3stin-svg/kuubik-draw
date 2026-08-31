# F-133 append-only autosave and recovery candidate wave

Status: candidate implementation; no parity score change.

- IndexedDB schema v3 retains the v2 stores and adds append-only compaction records without deleting prior snapshots or operations.
- Every committed revision atomically writes the mutable head, an immutable snapshot and an operation record containing the complete after-document plus before/after SHA-256 chain.
- Recovery validates schema, document id, revision continuity, operation base revision and SHA chain before accepting each record.
- A corrupt operation tail is ignored from the first broken record onward; recovery returns the last valid revision and names ignored operation ids.
- Legacy v1 records fall back to the latest independently valid snapshot.
- An open event without a matching clean event is reported as an unclean session; normal close records the exact saved revision.
- The coordinator exposes open/checkpoint/commit/compact/close boundaries for App integration without changing App.tsx.
- Every recovery emits a deterministic Estonian user receipt and stable machine code.
- A corrupt compact snapshot/record falls back to the full operation chain; an incomplete tail fails closed at the compact replay boundary.

The isolated two-phase Chromium fixture now covers browser reload and storage-corruption read-back. Certification still requires an externally forced browser-process kill, platform quota-exhaustion run and owned AutoCAD autosave/recovery comparison.
