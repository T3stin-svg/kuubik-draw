# F-023 — EXTEND

F-023 owns the AutoCAD 2024.1.2 two-dimensional EXTEND workflow: Standard and
Quick modes, explicit boundary selection, Quick all-object boundaries, endpoint
pick-side, Fence and Crossing target selection, Edge Extend/No extend, Project
None/UCS/View in the fixed planar document, command-local Undo, physical
Shift-select Trim, locked/hidden target refusal and one atomic global Undo/Redo
operation. Preview and commit execute the same pure `executeExtend` predicate;
preview may never mutate the document.

The audited target families are LINE, open LWPOLYLINE, ARC, elliptical ARC and
open cubic SPLINE. CIRCLE and closed LWPOLYLINE are audited as boundaries; they
are not themselves extendable targets because they have no endpoint. Entity
handles, layers, color, linetype, lineweight, polyline widths, rational weights
and all untouched semantic fields are preserved.

The fixed rational SPLINE fixture is the exact production-browser DXF opened by
AutoCAD. The native matrix measures six extension distances, three distinct
control-point/weight configurations and both endpoints. For the standard cubic
SPLINE produced by AutoCAD's SPLINE command, Kuubik reproduces the observed C2
endpoint continuation in homogeneous coordinates: endpoint value, first and
second derivative are preserved, the new span ends at the selected boundary,
and control points, knots and weights match the native output within `1e-9`.
This row does not claim arbitrary imported non-cubic NURBS extension; such an
entity fails closed as `unsupported-target` rather than being corrupted.

The fixed browser matrix proves:

- Standard mode, Fence and Crossing selection, command-local Undo, two-target
  atomic commit and global Undo;
- Quick all-object boundaries;
- Edge Extend/No extend, Project None/UCS/View and locked/hidden target refusal
  through the visible controls, with exact operation arguments and no-mutation
  checks;
- a real Playwright Shift-key-down plus canvas pointer click that selects Trim,
  followed by the same preview and atomic commit path;
- exact rational cubic SPLINE output through IndexedDB, production DXF and
  KDRAW1 downloads, with zero browser/page console errors.

The fixed native matrix runs in a newly owned blank AutoCAD 2024.1.2 desktop
process. It covers Standard/Quick, Edge, Project, Fence, Crossing, command Undo,
physical Shift-Trim, all audited geometry families and layer refusals. The owned
process is terminated and the exact pre-existing AutoCAD process set is
restored; a user's running AutoCAD process and documents are never automated.

Output proof uses the production command registry, immutable CadSession,
production DXF and KDRAW1 writers, strict Kuubik DXF import, independent
`dxf-parser`, independent KDRAW1 checksum decoding and atomic Undo. LibreCAD
2.2.1.5 renders the exact generated DXF and FreeCAD 1.1.3/OCCT independently
rebuilds and evaluates the rational spline. Both are secondary developer
oracles; neither is a certification authority, and missing signed network
isolation remains explicitly reported as not proven.

F-023 does not certify 3D projection, arbitrary UCS/view planes, native DWG,
dynamic blocks, associative topology or unsupported proxy targets. Project
None/UCS/View are equivalent here only because every audited entity and the
document are strictly planar.

Certification requires current source hashes in all three authoritative
artifacts, the machine-readable cross-evidence checker, unit/golden, mutation,
browser, DXF/KDRAW1, AutoCAD and repository gates, independent P0/P1 review,
green public CI and an unchanged 133-row denominator and weights.
