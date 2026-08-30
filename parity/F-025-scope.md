# F-025 — CHAMFER

F-025 owns the AutoCAD 2024.1.2 two-dimensional CHAMFER workflow: ordered
Distance and Angle methods, Method switching, Trim/No Trim, Polyline, Multiple,
command-local Undo, physical Shift sharp-corner override and one atomic global
Undo/Redo operation. Preview and commit execute the same pure
`executeChamfer` predicate; preview may never mutate the document.

The audited targets are LINE, open/closed straight-segment LWPOLYLINE, RAY and
XLINE. The polyline matrix covers adjacent middle segments, segments separated
by one intervening segment, open start/end closure, every eligible vertex,
No Trim standalone chamfer lines and too-short segments. Zero distances form a
sharp corner without creating a zero-length line. Parallel or unsupported
targets are rejected without partial writes.

The native matrix establishes the construction-line rule from exact DXF:
trimming the retained reverse side of a RAY produces a finite LINE, retaining
its forward side preserves a normalized RAY, and trimming an XLINE preserves
the chosen half as a normalized RAY. No Trim preserves the original RAY/XLINE.
Same-layer connector output uses that layer; cross-layer output uses the
current layer and ByLayer color. Locked targets are refused, while explicitly
addressed off/frozen targets follow the measured AutoCAD behavior.

The browser matrix proves visible controls, physical canvas picks, ordered
Multiple preview and one atomic commit, Angle No Trim, Polyline, physical Shift,
layer refusal, IndexedDB operation persistence, Undo/Redo and production DXF
and KDRAW1 downloads with zero console/page errors.

The AutoCAD matrix runs only in a newly owned blank 2024.1.2 process. Its PID,
binary identity and start-time token are authenticated; cleanup terminates only
that process and restores the exact pre-existing process set. A user's AutoCAD
process and document are never driven.

LibreCAD 2.2.1.5 independently renders the generated vector DXF. FreeCAD 1.1.3
and OCCT independently reconstruct the six output segments and read their exact
endpoints and lengths. Both are developer/CI oracles and never certification
authorities. Missing signed network isolation remains explicit rather than
becoming a false PASS.

F-025 does not certify 3D solid chamfers, arbitrary UCS/view projection,
curved polyline-segment chamfers, native DWG or associative proxy objects.
Certification requires current source hashes, exact cross-evidence, unit,
golden, mutation, browser, DXF/KDRAW1, AutoCAD and repository gates, independent
0 P0 / 0 P1 review, green public CI and the unchanged 133-row denominator and
weights.
