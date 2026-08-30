# F-026 — BREAK / BREAKATPOINT

F-026 owns the AutoCAD 2024.1.2 two-dimensional BREAK workflow: the object
selection point as the default first point, explicit `First point` override,
the second point, repeated targets, command-local Undo, zero-gap splitting and
one atomic global Undo/Redo operation. `BR`, `BREAK` and `BREAKATPOINT` resolve
through the production command registry. Preview and commit execute the same
pure `executeBreak` predicate; preview may never mutate the document.

The official AutoCAD contract projects points that are off the selected object
onto that object. For an open object, the undirected interval between the two
projected points is removed. For a circle or full ellipse, the directed interval
from the first point to the second is removed counterclockwise. Reversing those
points therefore keeps a different complementary arc. The selected source
handle is retained by the first surviving output and any additional piece gets
a deterministic new handle without losing layer, appearance or extension data.

The audited two-point targets are LINE, ARC, CIRCLE, ELLIPSE, open/closed
LWPOLYLINE and rational SPLINE. The zero-gap path covers open LINE, ARC,
LWPOLYLINE and the AutoCAD-live-confirmed open ELLIPSE. AutoCAD 2024.1.2 leaves
an open SPLINE unchanged in both the `BREAK` + `@` and `BREAKATPOINT`
workflows, so Kuubik rejects that single-point target while retaining two-point
SPLINE BREAK. Closed objects such as CIRCLE, full ELLIPSE and closed
LWPOLYLINE are rejected at a single point rather than being silently converted
to a full-cycle open object.
Blocks, dimensions, multilines, regions and other unsupported objects fail
closed without partial writes.

The native matrix uses separate fresh ELLIPSE and SPLINE fixtures for
`BREAK` + `@` and `BREAKATPOINT`. It compares complete geometry, handles,
layer/colour/lineweight/linetype, polyline widths and bulges, rational spline
control points/knots/weights, and exact committed/Undo/Redo snapshots.

The browser matrix must prove visible two-point/at-point controls, an actual
canvas object pick, a free second click projected back to the chosen object,
ordered repeated targets, command-local Undo, one atomic commit, global
Undo/Redo, locked-layer refusal, IndexedDB persistence, production DXF and
KDRAW1 downloads, and zero console/page errors.

The AutoCAD matrix runs only in a newly owned blank 2024.1.2 process. It must
measure open-curve projection, explicit first-point override, reversed CIRCLE
direction, ARC and ELLIPSE results, open/closed polyline behavior, rational
SPLINE behavior, BREAKATPOINT validity, locked/off/frozen layer behavior,
unsupported objects and Undo. Its PID, binary identity and start-time token are
authenticated; cleanup terminates only that process and restores the exact
pre-existing process set. A user's AutoCAD process and document are never
driven.

The isolated AutoCAD Core Console reference additionally proves the native
layer distinction: an explicit handle on an OFF or FROZEN layer is broken,
while a LOCKED-layer target is refused. The browser cannot pick invisible
geometry from the canvas, but the typed handle workflow preserves this AutoCAD
behavior.

LibreCAD 2.2.1.5 independently renders the generated DXF. FreeCAD 1.1.3 and
OCCT independently read or reconstruct the resulting curve pieces. Both are
developer/CI oracles with `certificationAuthority: false`; disagreement is
recorded and AutoCAD remains the behavioral authority. Missing signed network
isolation remains explicit rather than becoming a false PASS.

Primary behavior references:

- <https://help.autodesk.com/cloudhelp/2024/ENU/AutoCAD-Core/files/GUID-E0439DE0-B2C3-4233-BB4D-5A574A00694B.htm>
- <https://help.autodesk.com/cloudhelp/2024/ENU/AutoCAD-DidYouKnow/files/GUID-73B7DEA8-309E-4823-9F65-DB0A2E1FBC75.htm>

F-026 does not certify 3D curves, arbitrary UCS/view projection, native DWG,
associative proxy objects or the later PEDIT/JOIN workflow. Certification
requires current source hashes, exact cross-evidence, unit, golden, mutation,
browser, DXF/KDRAW1, AutoCAD and repository gates, independent 0 P0 / 0 P1
review, green public CI and the unchanged 133-row denominator and weights.
