# F-099 multiple layout viewports certification scope

The fixed AutoCAD 2024.1.2 Windows 2D row is `Multiple layout viewports`.

Required AutoCAD and Kuubik workflows:

- a paper layout can own two or more stable, independently addressable viewport objects;
- the fixed A3 case creates two non-overlapping paper-space frames with different model-space view centers;
- rectangular and valid non-rectangular polygon-clipped viewport boundaries are supported;
- clipped polygons are finite, simple, non-collinear, contain no zero-length edge and remain inside their viewport frame;
- malformed, self-intersecting and out-of-frame boundaries are rejected before mutation;
- each viewport renders only its own camera world while paper entities remain separate;
- selecting and double-clicking a viewport exposes PAPER and MODEL context explicitly;
- deleting the active MODEL-context viewport returns safely to PAPER and leaves the adjacent viewport unchanged;
- create and delete are atomic operations with exact undo/redo;
- globally unique viewport IDs, frames, clip points, view centers and view heights survive IndexedDB reload and production KDRAW1 serialization;
- a 1920×1080 Chromium workflow proves two painted, non-overlapping canvases, real CSS polygon clipping, context switching, delete/undo/redo/reload and zero console errors;
- an owned isolated AutoCAD 24.3 process performs the same native two-MVIEW and VPCLIP workflow, saves/reopens a temporary DWG, activates the clipped viewport in MODEL, returns to PAPER, deletes it, saves/reopens again and verifies the first native viewport is bit-for-bit equivalent in the measured properties;
- the AutoCAD process, DWG, backup and PID sidecar are removed after every pass or failure.

F-099 owns viewport multiplicity, frame identity, non-rectangular clipping and safe
context deletion. Interactive viewport pan, scale and twist belong to F-100;
display locking belongs to F-101; viewport layer overrides belong to F-105. Those
functions are deliberately not double-counted here.

The implementation is independent TypeScript. AutoCAD 2024.1.2 is the behavioral
authority; LibreCAD and FreeCAD do not certify paper-space viewport semantics.
