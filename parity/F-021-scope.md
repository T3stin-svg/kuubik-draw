# F-021 OFFSET certification scope

The fixed AutoCAD 2024.1.2 Windows 2D row is `OFFSET – distants / Through`.

Required AutoCAD and Kuubik workflows:

- `O` and `OFFSET` resolve to one command implementation;
- preselection and command-first postselection;
- positive `Distance` with a picked side and exact `Through` geometry;
- repeated `Multiple` placements continue from the preceding result;
- `Erase No` preserves the source and `Erase Yes` replaces it with a fresh
  result handle while atomic Undo restores the exact original handle;
- `Layer Source` preserves the source layer and `Layer Current` writes to the
  current layer;
- command-local `Undo` removes the latest uncommitted placement and a fully
  locally undone command creates no global history entry;
- LINE, open/closed/bulged POLYLINE, CIRCLE, ARC and ELLIPSE are covered;
- ELLIPSE follows the live AutoCAD result: an ordinary parallel curve becomes
  a cubic SPLINE approximation, while a curvature-collapsing inward offset is
  trimmed at its crossings into two open cubic SPLINE entities; explicit source
  lineweight becomes ByLayer while layer, color and linetype remain aligned;
- locked, hidden, unsupported, source-coincident and invalid
  self-intersecting results are refused before document mutation;
- preview and commit invoke the same `executeOffset` predicate;
- a completed selection is one atomic Undo/Redo operation;
- production DXF and `.kdraw` outputs are read back independently.

The canonical exact probes are LINE `y=0 → y=200`, Through from source
`y=1000` to point `1500,1375`, progressive Multiple `y=2000 → 2100 → 2200`,
Erase `y=3000 → 3250`, and Layer Current `y=4000 → 4150`. The five-family
Distance matrix uses 20 drawing units and verifies AutoCAD object types,
bounds, layer/style behavior and locked-layer refusal. A second edge matrix
verifies an inward square, a bulged semicircle, concave self-intersection
refusal and AutoCAD's two-SPLINE inward ELLIPSE split.

AutoCAD's official OFFSET command documentation defines Distance, Through,
Erase, Layer, Multiple and command-local Undo:
https://help.autodesk.com/cloudhelp/2016/ENU/AutoCAD-Core/files/GUID-C0E4246D-C420-42BD-A6FC-8B1852EFD005.htm

The implementation is independent TypeScript geometry written for Kuubik Draw.
No LibreCAD or FreeCAD source module is copied into the runtime; those projects
remain optional non-authoritative developer/CI oracles. Full score depends on
the owned AutoCAD desktop matrix, real Chromium UI and independent output
read-back, never on documentation or an upstream oracle alone.
