# Implementation status — 2026-08-28

## Shipped foundation

- separate public GPL application and MIT schema dependency;
- immutable 133-row legacy audit snapshot plus separate local-certification file;
- typed double-precision document model and stable handles;
- atomic entity transaction, monotonic revisions, idempotent opIds and one-step undo/redo;
- atomic IndexedDB document + snapshot + append-only operation commit;
- checksum-verifying `.kdraw` document/attachment envelope;
- read-only legacy Draw-blob migration that ignores Plan walls, rooms and 3D data;
- Canvas2D renderer with uniform world scale, R-tree culling and bulged polyline arcs;
- initial DXF writer with deterministic valid handles and independent `dxf-parser` read-back;
- initial SVG/vector-PDF writer with plottable-layer filtering and xref verification;
- developer-only LibreCAD/FreeCAD executable probes that return `NOT_RUN`, never a fake PASS;
- dependency-license, public-tree, Gitleaks, build, unit, mutation and Chromium gates.

## Explicitly not certified yet

- the new application has **0/133** locally certified parity rows;
- the 22 legacy-certified rows still need mirror workflows and evidence here;
- F-022 TRIM is not implemented in the new kernel;
- spline/NURBS rendering is rejected rather than drawn as a misleading control polygon;
- Unicode PDF text is rejected until a font-embedding path exists;
- LibreCAD/FreeCAD geometry fixtures, sandboxing and read-back are not implemented;
- crash-recovery operation replay and cloud storage are not complete;
- 50,000-entity R-tree query passes, but 30 FPS browser pan/zoom is not yet proved;
- native DWG/DWT/XREF and PC3/CTB/STB remain deferred;
- no preview or production deployment has been made.

The next release gate is parity mirror, beginning with the simplest already
certified legacy rows. F-022 work starts only after the mirror baseline and
oracle-labor execution paths are real.
