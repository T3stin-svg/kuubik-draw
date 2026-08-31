# F-133 append-only autosave and recovery candidate wave

Status: candidate implementation; no parity score change.

- IndexedDB schema v2 adds indexed append-only snapshots and recovery open/clean events without deleting v1 stores.
- Every committed revision atomically writes the mutable head, an immutable snapshot and an operation record containing the complete after-document plus before/after SHA-256 chain.
- Recovery validates schema, document id, revision continuity, operation base revision and SHA chain before accepting each record.
- A corrupt operation tail is ignored from the first broken record onward; recovery returns the last valid revision and names ignored operation ids.
- Legacy v1 records fall back to the latest independently valid snapshot.
- An open event without a matching clean event is reported as an unclean session; normal close records the exact saved revision.
- The coordinator exposes open/checkpoint/commit/close boundaries for App integration without changing App.tsx.

Certification still requires a real Chromium kill/restart workflow, storage corruption fixture read-back and owned AutoCAD autosave/recovery comparison.
