# Implementation status — 2026-08-29

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
- F-003 RECTANGLE mirrored through command registry, atomic browser commit, IndexedDB reload,
  production DXF, independent parser and a fresh AutoCAD 2024 Core Console live workflow.
- F-015 ERASE mirrored through selectable browser objects, locked-layer refusal, one atomic
  delete/UNDO, empty production DXF and a fresh AutoCAD 2024 Core Console live workflow.
- F-016…F-021 MOVE/COPY/ROTATE/SCALE/MIRROR/OFFSET mirrored through owned AutoCAD
  desktop workflows, Chromium, atomic operation logs and independent DXF/KDRAW1 read-back.
- F-097 Layout tabs mirrored with create/rename/copy-before-source/reorder/delete,
  independent viewport and paper-entity identifiers, atomic Undo/Redo, IndexedDB reload,
  production KDRAW1 read-back and an owned AutoCAD native-DWG reopen workflow.
- F-098 Visible paper sheet mirrored with validated paper dimensions, deterministic A4
  fallback, exact paper-world rendering, a measured 1920x1080 browser sheet/desk/canvas,
  IndexedDB/KDRAW1 read-back and owned AutoCAD native-DWG/pixel verification.
- F-099…F-101 mirrored multiple clipped viewports, custom/preset camera transforms,
  cursor-anchor zoom, rotated pan/twist and the native display-lock lifecycle.
- F-102 Page setup mirrored ISO paper/orientation, Layout/Window/Extents/Display,
  Fit/custom scale, center/offset, atomic persistence and physical SVG/PDF output.
  Native AutoCAD measurement established that media changes preserve existing
  viewport paper coordinates; the older proportional-refit assumption was removed.
  Chromium and native AutoCAD Display now consume the same measured paper-view
  source; PC3 printable-origin parity remains explicitly scoped to F-108.
  Display now requires the current paper view, arbitrary Window coordinates are
  accepted and native PDF line endpoints prove the 1:2 physical scale.
- F-103 Plot profiles mirrored Color/Monochrome/Grayscale, ACI/TrueColor,
  ByLayer/explicit lineweights, transparency and persisted plot-style preview.
- F-104 Layout vector output mirrored deterministic SVG/PDF for two independent
  clipped viewports, paper-space geometry and physical paper dimensions.
- F-105 Batch publish mirrored ordered include/exclude settings, one multi-page
  or separate PDF workflow, per-layout Display sources and Windows-safe names.
- F-106 Model-space print mirrored persisted Extents/Window/Display areas,
  Fit/custom scale, center/offset, A4/A3 output, atomic Undo/Redo and exact
  vector SVG/PDF read-back. Native AutoCAD reopens the synthetic DWG and
  independent readers measure the known LINE/CIRCLE geometry on paper.

## Explicitly not certified yet

- the new application has **18/133** locally certified parity rows (**13.5% raw / 16.4% weighted**);
- 4 of the 22 legacy-certified rows still need mirror workflows and evidence here;
- F-022 TRIM is not implemented in the new kernel;
- spline/NURBS rendering is rejected rather than drawn as a misleading control polygon;
- Unicode PDF text is rejected until a font-embedding path exists;
- LibreCAD/FreeCAD geometry fixtures, sandboxing and read-back are not implemented;
- crash-recovery operation replay and cloud storage are not complete;
- 50,000-entity R-tree query passes, but 30 FPS browser pan/zoom is not yet proved;
- native DWG/DWT/XREF and PC3/CTB/STB remain deferred;
- no preview or production deployment has been made.

The next release gate remains parity mirror; F-107 named page setups/templates
is the next directly testable legacy-certified row. F-108 native PC3/CTB/STB
remains blocked on a licensed adapter. F-022 work starts only after the mirror
baseline and oracle-labor execution paths are real.
