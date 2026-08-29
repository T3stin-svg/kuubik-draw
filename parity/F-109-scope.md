# F-109 — DXF export: core geometry, layers and styles

F-109 owns the deterministic R2004/AC1018 DXF export path used by the visible
`DXF eksport` action. The fixed certification fixture contains exactly 40
model-space entities: 12 LINE, 9 LWPOLYLINE, 10 TEXT, 7 HATCH, 1 CIRCLE and 1
aligned DIMENSION. Two polylines contain non-zero bulges. The file is in
millimetres and includes the four named production layers, two custom
linetypes, two text styles and the Standard dimension style.

The production writer must preserve stable collision-free 64-bit handles,
exact ACI indices (including TrueColor fallback indices), layer and entity
TrueColor properties, lineweights, linetypes, transparency, text and dimension
style references. It must emit a complete R2004 HEADER, CLASSES,
TABLES, BLOCKS, ENTITIES and OBJECTS structure. Unsupported entity kinds are
reported and the visible workflow refuses a partial download.

The exporter deliberately omits `$EXTMIN`/`$EXTMAX` instead of writing an
incomplete control-point approximation that ignores AutoCAD-generated text,
arrow and dimension graphics. Certification compares the extents recalculated
by two live AutoCAD readers. It also compares every HATCH loop flag and vertex,
not only the loop count.

Certification requires all of the following on the same exact DXF bytes:

- a 1920×1080 Chromium workflow seeded through IndexedDB and completed through
  the visible export button, with zero console or page errors;
- byte-for-byte agreement with a fresh direct production exporter invocation;
- strict ezdxf audit with zero errors and zero fixes;
- installed AutoCAD 2024 Core Console read-back of counts, units, bulges,
  layers and styles;
- a separately owned visible AutoCAD 2024 desktop process opening the file
  read-only and exposing all 40 native objects and stable handles through COM;
- safe close without saving and restoration of the prior AutoCAD process set;
- regression and mutation tests for the AutoCAD-rejected DIMENSION subclass
  ordering plus layer-style and hatch-topology sensitivity.

F-109 does not certify DXF import or roundtrip fidelity (F-110/F-111), native
DWG import/export (F-112/F-113), PDF output (F-114), unsupported advanced entity
kinds, or any visual AutoCAD workspace similarity.
