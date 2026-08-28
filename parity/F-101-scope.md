# F-101 viewport display-lock certification scope

The fixed AutoCAD 2024.1.2 Windows 2D row is `Viewport lock`.

Required AutoCAD and Kuubik workflows:

- a selected paper-layout viewport exposes an explicit unlocked/locked state;
- locking, unlocking and relocking are atomic document operations with exact
  undo and redo;
- a locked viewport can still enter MODEL context and model entities remain
  editable because this is a display lock, not an entity lock;
- wheel zoom, pointer pan and direct scale/center/twist application cannot alter
  the camera while the viewport is locked;
- refused navigation creates no document revision, operation or draft camera;
- unlocking immediately restores the same navigation paths; relocking preserves
  the resulting center, scale and twist;
- viewport ID, camera and lock state survive IndexedDB reload and production
  KDRAW1 serialization;
- a 1920x1080 Chromium workflow proves lock, refused wheel/pan, model editing,
  unlock, successful wheel/pan, relock, refused navigation again, undo/redo,
  download/reload and zero console errors;
- an independent reader validates KDRAW1 magic, payload length and SHA-256 before
  reading the persisted lock and camera without production deserialization;
- an owned isolated AutoCAD 24.3 process creates an equivalent native PViewport,
  reads `DisplayLocked`, `VIEWCTR`, `VIEWSIZE`, target and scale, proves native
  `ZOOM` and `-PAN` are suppressed while locked, proves native `MOVE` still edits
  a model entity, unlocks and proves both view commands change the view, relocks,
  saves/reopens a temporary DWG and reads the same state back;
- the AutoCAD process, DWG, backup and PID sidecar are removed after every pass
  or failure.

F-101 owns only paper-viewport display locking. Viewport creation and clip
boundaries belong to F-099; camera scale/pan/twist belong to F-100; layer
overrides and plotting are separate rows. A locked-camera refusal alone is not
enough: the complete lock lifecycle and display-only boundary must be proven.

The implementation is independent TypeScript. AutoCAD 2024.1.2 is the behavioral
authority; LibreCAD and FreeCAD do not certify paper-space viewport semantics.
