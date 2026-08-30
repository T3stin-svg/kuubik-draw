# F-030 MATCHPROP certification scope

Status: **broad candidate implemented; full row remains dependency-blocked at 0.75**.

Benchmark: AutoCAD 2024.1.2 on Windows, 2D Drafting & Annotation.

## Implemented and locally evidenced

- `MA`, `MATCHPROP` and `MATCHPROPERTIES` resolve through the production registry, persistent settings UI, one preview predicate and one atomic commit.
- Basic color, layer, linetype, linetype scale, lineweight, transparency, thickness, plot-style ID and material ID semantics are typed. Unsupported basic properties stay target-owned where AutoCAD excludes them.
- Represented special properties cover uniform polyline width, text height/rotation/style, dimension style, hatch pattern and the represented viewport property set.
- Source identity/content/geometry, target geometry/handles/extension data, locked targets, source-as-target, missing targets and semantic no-op behavior are explicitly protected.
- Cross-document resource import remaps layer, linetype, text-style and dimension-style collisions deterministically in the same atomic operation.
- Browser evidence covers persistent settings, physical source/multiple-target selection, viewport selection, Undo/Redo and independent DXF/KDRAW1 output read-back.
- LibreCAD 2.2.1.5 and FreeCAD 1.1.3 independently verify that the MATCHPROP output remains valid vector geometry. They are not certification authorities.

## Explicit dependency boundary

F-030 cannot reach `1.00` until the fixed audit's owning rows provide and expose the missing object families/workflows:

- F-060 Multileader;
- F-069 Table;
- F-071 Center object;
- F-108 native named plot-style definitions;
- F-128 visible multi-document tab switching for the cross-drawing workflow.

The owned AutoCAD runner currently covers the supported native subset (basic multiple/locked/no-op, polyline, text and atomic Undo/Redo) and deliberately reports the remaining native special-property cases. Its successful subset result must never be interpreted as full F-030 certification.

## Open evidence gates

- Run the supported-subset owned AutoCAD 2024.1.2 matrix in the shared F-028/F-029/F-030 batch and fix every measured difference.
- Extend the native matrix with dimension, hatch-origin, viewport, cross-drawing, Multileader, Table, Center object and named plot-style scenarios as their owning rows land.
- Close every dependency, regenerate current-byte cross-evidence, obtain independent `0 P0 / 0 P1` review, then enter F-030 into the score ratchet and require green exact-commit public CI.

No production deployment is authorized by this candidate.
