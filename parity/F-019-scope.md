# F-019 SCALE certification scope

The fixed AutoCAD 2024.1.2 Windows 2D row is `SCALE – base point and Reference`.

Required Kuubik and AutoCAD live workflows:

- `SC` and `SCALE` resolve to one command implementation;
- preselection and postselection;
- a positive numeric scale factor;
- Reference old length supplied numerically, by a point from the base, or by two points;
- Reference new length supplied numerically, by a point from the base, or by two `Points`;
- zero/negative factors and coincident length points are rejected before mutation;
- factor one leaves geometry unchanged but creates one consumable Undo entry, matching the live AutoCAD sentinel workflow; `Copy` still creates scaled copies;
- `Copy` preserves the sources and gives each scaled result a fresh globally unique handle;
- LINE, POLYLINE, CIRCLE, ARC, ELLIPSE, SPLINE, TEXT, MTEXT, LEADER,
  DIMENSION, HATCH and BLOCK REFERENCE scale uniformly around one base while
  handles, layers, styles, angles, bulges, knots, weights and attributes survive;
- geometric widths, radii, text height and block-reference scale change with the factor;
- aligned-dimension extension points and measurement scale while the native style-controlled text gap remains constant, and Undo restores all semantic points;
- locked-layer and opaque proxy targets remain unchanged with explicit reasons;
- preview and commit invoke the same `executeScale` predicate;
- the entire pickset is one atomic Undo/Redo operation;
- production DXF and `.kdraw` output are read back independently.

The canonical full-matrix workflow uses base `100,200`, two-point Reference
`100,200 → 1100,200` (length `1000`) and new length `2000`, producing uniform
factor `2`.

AutoCAD's alternative factor workflow is graphical drag-and-click, not a
coordinate string interpreted as distance from the base. Autodesk documents it
as “Enter the scale factor or drag and click to specify a new scale.” Exact
pointer/dynamic-input behavior belongs to fixed row F-052 `Dynamic Input`; it is
not falsely counted inside F-019. A live `2,0` probe is retained in the AutoCAD
artifact as non-certifying evidence of this distinction.
