# F-024 — FILLET

F-024 owns the AutoCAD 2024.1.2 two-dimensional FILLET workflow: pair and
Polyline modes, Radius, Trim/No Trim, Multiple, command-local Undo, physical
Shift radius-zero override, `FILLETPOLYARC=0/1`, same- and cross-layer output,
locked/off/frozen layer behavior and one atomic global Undo/Redo operation.
Preview and commit execute the same pure `executeFillet` predicate; preview may
never mutate the document.

The audited pair families are LINE, open/closed LWPOLYLINE segments, ARC,
CIRCLE, ELLIPSE, rational cubic SPLINE, RAY and XLINE. The Polyline workflow
covers open and closed line/arc segments, radius zero, closing an open polyline,
No Trim standalone arcs, width/bulge preservation and `FILLETPOLYARC` policy.
Handles, layers, ACI color, lineweight, widths, rational weights and untouched
semantic fields are preserved.

AutoCAD live DXF establishes the construction-line rule that cannot be inferred
from its transient COM wrappers: trimmed RAY becomes a finite LINE, while the
retained half of a trimmed XLINE becomes a normalized RAY. Therefore RAY+XLINE
Trim produces LINE + RAY + ARC, not LINE + ARC. No Trim preserves the original
RAY/XLINE and creates only the fillet ARC. The native and browser fixtures use
the same exact coordinates, appearance and pick sides.

The browser matrix proves physical canvas picks, visible controls, preview,
atomic commit and Undo; exact IndexedDB operations; production DXF and KDRAW1
downloads; line/circle/arc/ellipse/rational-spline families; polyline segment
identity; construction-line conversion; and zero console/page errors.

The native matrix runs in a newly owned blank AutoCAD 2024.1.2 process. It
covers every audited option and family, saves a DXF and validates both COM state
and exact raw DXF records. The owned process is authenticated, terminated and
the exact pre-existing process set restored; a user's AutoCAD is never driven.

Output proof uses the production registry, immutable CadSession, production DXF
and KDRAW1 writers, strict Kuubik import, independent `dxf-parser`, raw DXF
records and atomic Undo/Redo. LibreCAD 2.2.1.5 renders the generated vector DXF
and FreeCAD 1.1.3/OCCT reconstructs its circular arcs. Both are secondary
developer oracles, never certification authorities. Missing signed network
isolation remains explicit and does not become a false PASS.

F-024 does not certify 3D projection, arbitrary UCS/view planes, native DWG,
associative topology or proxy targets. Certification requires current hashes in
all authoritative artifacts, cross-evidence PASS, unit/golden, mutation,
browser, DXF/KDRAW1, AutoCAD and repository gates, independent 0 P0 / 0 P1
review, green public CI and the unchanged 133-row denominator and weights.
