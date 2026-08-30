# F-028 LENGTHEN certification scope

Status: **candidate implemented; certification evidence incomplete; score remains 0.75**.

Benchmark: AutoCAD 2024.1.2 on Windows, 2D Drafting & Annotation.

## Implemented and locally evidenced

- `LEN` and `LENGTHEN` resolve through the production registry, typed geometry kernel, visible workflow, preview and one atomic commit.
- Delta, Percent, Total and Dynamic modes are implemented. Delta/Total support both length and ARC angle input.
- LINE, ARC and open POLYLINE support the numeric matrix. Open ELLIPSE supports Dynamic endpoint placement.
- The audited rational control-point SPLINE now fails closed: AutoCAD 2024.1.2 left that exact DXF entity unchanged in both the numeric matrix and Dynamic probe. Fit-point SPLINE remains an explicit F-012/F-028 schema dependency and is not claimed complete.
- Multiple targets, command-local Undo, mixed locked targets, typed refusals and global atomic Undo/Redo are covered.
- Physical canvas endpoint and Dynamic destination picks are covered without mutating the document during preview.
- Production source/output DXF and output KDRAW1 are independently decoded. Exact handles, changed geometry, supported appearance, widths/bulges and unchanged rational spline degree/control points/knots/weights are checked.
- The owned AutoCAD 2024.1.2 Desktop matrix opens the exact synthetic Kuubik source DXF and covers Delta over LINE/ARC/open POLYLINE, Dynamic over open ELLIPSE, the rational control-point SPLINE refusal, Percent, Total, line Dynamic, ARC angle, command Undo, global Undo/Redo and locked/off/frozen layer behavior.
- AutoCAD's tapered terminal-segment width is reproduced: shortening interpolates and extension extrapolates the moving endpoint width by the exact old/new terminal-length ratio for straight and bulged segments.
- LibreCAD 2.2.1.5 renders the exact production output DXF to vector PDF. FreeCAD 1.1.3/OCCT independently rebuilds the lengthened line and unchanged rational control-point spline. Both remain `certificationAuthority: false`.
- Current-byte cross-evidence now matches the complete native and independently parsed AutoCAD output to the Kuubik fixture for every represented family and mode.

## Open evidence gates

- Add fit-point SPLINE data to the public schema/import/export path and repeat a manual AutoCAD live workflow before any spline capability can be added to F-028.
- Complete an independent `0 P0 / 0 P1` review.
- Refresh affected global receipts, enter F-028 into the score ratchet and require green exact-commit public CI.

F-028 must not receive score `1.00` before every open gate is closed. No production deployment is authorized by this candidate.
