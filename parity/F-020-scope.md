# F-020 MIRROR certification scope

The fixed AutoCAD 2024.1.2 Windows 2D row is `MIRROR – peegeldusjoon`.

Required AutoCAD and Kuubik workflows:

- `MI` and `MIRROR` resolve to one command implementation;
- preselection and command-first postselection;
- any finite, non-coincident two-point mirror axis;
- Enter/default `No` preserves every source and creates fresh globally unique handles;
- `Yes` replaces editable source geometry under stable handles, as observed by the owned AutoCAD process;
- `MIRRTEXT=0` preserves readable TEXT and MTEXT strings;
- LINE, POLYLINE, CIRCLE, ARC, ELLIPSE, SPLINE, TEXT, MTEXT, LEADER,
  DIMENSION, HATCH and BLOCK REFERENCE reflect geometrically while layers,
  styles and semantic properties survive;
- polyline bulge and arc direction reverse handedness;
- locked-layer and opaque proxy targets remain unchanged with explicit reasons;
- a coincident axis is refused before mutation and the command returns to idle;
- preview and commit invoke the same `executeMirror` predicate;
- the entire pickset is one atomic Undo/Redo operation;
- production DXF and `.kdraw` outputs are read back independently.

The canonical twelve-family matrix uses the vertical axis
`1500,-500 → 1500,1500`. A second `0,0 → 100,100` 45-degree matrix verifies
exact LINE endpoints, readable TEXT rotation/bounds, and BLOCK insertion,
rotation, negative X scale, Y scale and bounds.
AutoCAD's official MIRROR documentation defines the two points as the mirror
line, defaults Enter to retaining the sources, and documents `MIRRTEXT=0` as
the non-reversed text behavior. Full score still depends on the owned desktop
live matrix, not documentation alone.
