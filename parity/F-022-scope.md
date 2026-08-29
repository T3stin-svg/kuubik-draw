# F-022 — TRIM

F-022 owns the AutoCAD 2024.1.2 two-dimensional TRIM workflow: Standard and
Quick selection modes, explicit cutting edges, Quick all-object boundaries,
pick-side removal, Fence and Crossing target selection, Edge Extend/No extend,
Project None/UCS/View in the fixed planar document, Erase, command-local Undo,
physical Shift-select Extend, locked/hidden target refusal and one atomic global
Undo/Redo operation.

The audited target families are LINE, ARC, CIRCLE, ELLIPSE, open and closed
LWPOLYLINE (including bulge and width preservation), and SPLINE. AutoCAD's
selected HATCH entity does not expose its display loops as cutting edges, while
recursively expanded block contents may act as cutting boundaries without the
container becoming a trim-capable target. Nested block cycles fail closed.
Preview and commit execute the same pure `executeTrim` predicate; preview may
never mutate the document.

The fixed browser matrix proves:

- Standard mode with explicit boundaries, Fence selection, command-local Undo,
  Crossing selection, split handles, property preservation, commit and global
  Undo;
- Quick no-intersection erase;
- a real Playwright Shift-key-down plus canvas pointer click, followed by the
  same preview and atomic commit path;
- Edge No extend refusal and Edge Extend success under Project None/UCS/View;
- explicit Erase plus locked and hidden layer target refusal;
- CIRCLE and full ELLIPSE conversion to open ARC/ELLIPSE results;
- rational cubic SPLINE exact knot insertion, an adversarial between-sample
  spline tangency and production DXF downloads.

The fixed AutoCAD matrix runs in a newly owned blank AutoCAD 2024 desktop
process. It covers the same command options and six geometry families, records
the locked-layer behavior, and performs physical Shift-key-down, model-window
mouse click and Enter input at a world-to-screen coordinate derived from native
`SCREENSIZE`, `VIEWCTR`, `VIEWSIZE` and the DXGI viewport rectangle. The owned
process is terminated and the exact pre-existing AutoCAD process set is
restored.

Output proof uses the production command registry, immutable CadSession,
production DXF and KDRAW1 writers, strict Kuubik DXF import, independent
`dxf-parser`, independent KDRAW1 envelope decoding and atomic Undo. LibreCAD
2.2.1.5 renders the exact generated DXF and FreeCAD 1.1.3/OCCT independently
checks the cubic spline intersections. Both are secondary developer oracles;
neither is a certification authority and lack of signed network isolation is
reported honestly rather than converted to PASS.

F-022 does not certify 3D projection, arbitrary UCS/view planes, native DWG,
dynamic blocks, associative topology, spline extension beyond its finite
definition, or unsupported proxy targets. Project None/UCS/View are equivalent
only because every audited entity and the document itself are strictly planar.

Certification requires current source hashes in all three authoritative
artifacts, the machine-readable cross-evidence checker, all unit/golden,
mutation, browser, DXF/KDRAW1, AutoCAD and repository gates, an independent
P0/P1 review, green public CI and an unchanged 133-row denominator and weights.
