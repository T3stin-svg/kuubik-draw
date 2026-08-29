# ADR 0001: GPL application and MIT document-schema boundary

- Status: accepted
- Date: 2026-08-29

## Decision

Kuubik Draw is `GPL-2.0-only`. The independently versioned
`T3stin-svg/kuubik-cad-schema` package remains MIT so the `.kdraw` contract is
not locked to one application license. Every selected upstream port records
project, commit, source path, source hash, license, authors, local module and
modifications in `upstream-provenance.json`.

LibreCAD and FreeCAD are developer/CI oracles. Their UI, icons, Qt/OCCT object
models and whole modules are not vendored into the browser application.

## Consequences

The public application can accept controlled GPL-compatible ports while the
neutral interchange schema remains reusable. License and provenance checks are
release-blocking.
