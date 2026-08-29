# ADR 0005: Licensed native DWG adapter boundary

- Status: accepted, implementation deferred
- Date: 2026-08-29

## Decision

Native DWG/DWT/XREF and PC3/CTB/STB parity may be certified only through a
licensed ODA Drawings SDK, Autodesk RealDWG or a separately approved equivalent
that passes AutoCAD live roundtrip tests. LibreCAD, FreeCAD and LibreDWG are not
certification authorities for these rows.

The future adapter sits behind import, apply-operation, export, audit/recover,
xref and plot-profile interfaces. Unknown native data must survive roundtrip or
the affected row remains below `1.00`.

## Consequences

F-108, F-112, F-113, F-117 and F-121 remain honestly blocked until licensing,
SDK integration and an anonymized corpus exist. No open-source shortcut may be
used to claim 100%.
