# F-111 — DXF roundtrip fidelity

F-111 owns the exact production path `DXF import -> editable KDraw model -> DXF
export`. Its fixed source is the already certified F-109 R2004/AC1018 fixture:
40 model-space entities, millimetres, five DXF layer records (the mandatory `0`
layer plus JOONED, TELJED, SEINAD and VIIRUTUS), two custom linetypes, two text
styles and one Standard dimension style.

The audited fixture path accepts ASCII ANSI_1252 DXF and converts its supported
records into schema-validated immutable entities. It preserves the fixture's
exact DXF handles, all-on/unfrozen/unlocked/plottable layers, layer/entity ACI
and TrueColor semantics, ISO lineweights, linetypes, transparency, Unicode
escapes, two LWPOLYLINE bulges, seven single straight closed outer HATCH loops
and the one aligned DIMENSION's definition points. That exact matrix does not
claim arbitrary layer-state combinations, polyline widths, HATCH holes/bulged
or edge-path boundaries, associative HATCH references, custom pattern
definitions, or linear DIMENSION parity. The importer rejects those lossy
HATCH variants, unsupported entities, paper-space DXF entities, malformed
pairs, duplicate global handles, missing references, unsupported units and
structure-budget overflows before the visible workflow changes the document.
Partial import is forbidden.

The accepted HATCH grammar is the complete deterministic F-109 record, not a
best-effort boundary parser: owner/subclass markers, zero origin, world-Z
extrusion, pattern flags, straight closed polyline loops and the full pattern
tail are consumed in order. Unknown preamble data, non-default extrusion,
bulges, edge paths, source handles and unconsumed pattern data fail closed.
Handles are globally unique across TABLES, BLOCKS, OBJECTS and ENTITIES.

Opening a DXF replaces only drawing content (units, layers, styles, blocks and
model entities). Kuubik layout and attachment state remains owned by Kuubik.
Paper-space entities, their recursively referenced blocks/styles/layers,
viewport layer overrides and colliding handles are retained and remapped in the
same operation. Dependency planning is bottom-up, so a same-id layer or
dimension style is duplicated whenever its linetype or text-style semantics
differ; colliding nested and cyclic block graphs are remapped as a whole. A
drawing-unit change is refused while any retained layout has entities,
viewports or an explicit page setup, including Model Window/scale state,
because silently reinterpreting those drawing-unit values would change output.
The replacement is one `DXFIN` operation in the same CadSession/IndexedDB
transaction as every other command. One Undo restores the complete former
drawing; one Redo restores the complete imported drawing. The imported objects
must remain editable through the ordinary command runtime.

Certification requires all of the following on the exact second-generation
DXF bytes:

- a 1920×1080 Chromium file-input workflow with import, real MOVE, Undo of the
  edit, atomic Undo/Redo of the import, IndexedDB reload and visible export;
- byte agreement between Chromium output and a fresh production
  export/import/export invocation;
- strict ezdxf audits of source and second generation with zero errors/fixes and
  identical per-handle semantic geometry, layers, units, styles and topology;
- installed AutoCAD 2024 Core Console and a separately owned visible AutoCAD
  2024 desktop process opening the second-generation file and reading all 40
  native objects, stable handles and regenerated extents;
- unit/golden, mutation-proven, transaction, browser-wiring and fail-closed
  partial-import tests;
- a final independent P0/P1 review and green public CI.

F-111 does not certify unsupported advanced DXF entities, native DWG/DWT/XREF,
PC3/CTB/STB, or the future full DXF-import command matrix outside this fixed
roundtrip row. LibreCAD and FreeCAD remain secondary developer oracles and are
never certification authorities.
