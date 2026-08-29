# ADR 0003: Versioned document plus immutable command transactions

- Status: accepted
- Date: 2026-08-29

## Decision

`KDrawDocumentV1` is the browser's normalized 2D document. Entities use double
coordinates and stable handles. A command produces an immutable set of typed
changes and one semantic operation with `opId`, `baseRevision`, `commandId`,
arguments, target handles and result handles. One command is one atomic Undo
step.

IndexedDB stores snapshots and an append-only operation log. `.kdraw` stores a
manifest, document and checksum-bound attachments. Unknown entities fail closed
or survive as opaque data; they are never silently discarded.

## Consequences

Recovery, offline work, conflict detection and native-adapter synchronization
share one revision model. UI components do not mutate document objects directly.
