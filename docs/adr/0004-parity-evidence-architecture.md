# ADR 0004: Declarative parity kit and content-addressed evidence

- Status: accepted
- Date: 2026-08-29

## Decision

The immutable 133-row manifest and `local-certifications.json` remain the score
authorities. `parity/rows.mjs` separately declares source groups, three evidence
descriptors and executable stages for every locally certified row.

The parity kit provides:

- a source-file to F-row dependency graph;
- fail-closed coverage for every production runtime source;
- one row-pipeline command;
- exact existing SHA verification plus a second semantic content address that
  ignores timestamps and a narrow allowlist of provenance-only SHA fields but
  retains semantic hashes, measured geometry and behavior;
- semantic `.kdraw` addressing over decoded container members, so document
  metadata timestamps do not change geometry identity;
- source addresses normalize CRLF and LF to the same canonical LF bytes, so the
  ratchet is stable across Windows and Linux runners;
- fast, row-specific and full CI levels.

LibreCAD/FreeCAD reports always carry `certificationAuthority:false`. Missing
oracle or licensed AutoCAD infrastructure is `NOT_RUN`/`skipped`, never `PASS`.

## Consequences

A row-relevant source change names the evidence that must be regenerated.
Timestamp-only JSON or `.kdraw` reruns do not create false semantic changes,
while the old exact-byte ratchet continues to detect any unchecked artifact
mutation. Other binary formats remain exact until a format-specific semantic
normalizer is independently validated.
