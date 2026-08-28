# F-018 ROTATE certification scope

The fixed AutoCAD 2024.1.2 Windows 2D row is `ROTATE – base point and Reference`.

Required Kuubik and AutoCAD live workflows:

- `RO` and `ROTATE` resolve to one command implementation;
- preselection and postselection;
- positive counterclockwise and negative clockwise standard angles;
- standard angle supplied numerically or by a point relative to the base;
- Reference supplied numerically, by a point from the base, or by two points;
- new absolute Reference angle supplied numerically or by a point from the base;
- coincident Reference points are rejected before mutation;
- equal Reference/new angle and complete turns are revision-free no-ops;
- LINE, POLYLINE, CIRCLE, ARC, ELLIPSE, SPLINE, TEXT, MTEXT, LEADER,
  DIMENSION, HATCH and BLOCK REFERENCE rotate around one base while handles,
  layers, styles, widths, bulges, knots, weights, scales and attributes survive;
- locked-layer and opaque proxy targets remain unchanged with explicit reasons;
- preview and commit invoke the same `executeRotate` predicate;
- the entire pickset is one atomic Undo/Redo operation;
- production DXF and `.kdraw` output are read back independently.

The canonical full-matrix workflow uses base `100,200`, two-point Reference
`100,200 → 1100,1200` (`45°`) and new absolute angle `135°`, producing one
counterclockwise `90°` rotation.
