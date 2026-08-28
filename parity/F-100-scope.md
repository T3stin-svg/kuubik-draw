# F-100 viewport scale, pan and twist certification scope

The fixed AutoCAD 2024.1.2 Windows 2D row is `Viewport scale, pan and twist`.

Required AutoCAD and Kuubik workflows:

- an active, unlocked MODEL-context paper viewport accepts a named 1:20 scale,
  a finite model-space view center and a 30 degree counter-clockwise view twist;
- the paper-frame height and model view height produce the exact scale
  denominator, while a non-preset denominator is labelled as custom;
- the same finite model-to-normalized and normalized-to-model transform drives
  rendering, zoom anchoring and hit-coordinate conversion;
- wheel zoom preserves the model point below the cursor and changes only the
  scale plus the center required by that invariant;
- pointer pan accounts for view twist and preserves scale and twist;
- the canvas paints the twisted model geometry rather than only reporting
  twist metadata;
- scale, center and twist inputs reject zero, non-finite and overflowing values
  before mutation;
- apply, wheel zoom and completed pointer pan are separate atomic operations
  with exact undo and redo;
- viewport ID, frame, center, scale-derived view height and twist survive
  IndexedDB reload and production KDRAW1 serialization;
- a 1920x1080 Chromium workflow proves the preset, actual canvas slope,
  cursor-anchor invariant, rotated drag pan, undo/redo, download/reload and zero
  console errors;
- an independent reader validates KDRAW1 magic, payload length and SHA-256 before
  reading the persisted viewport without production deserialization;
- an owned isolated AutoCAD 24.3 process creates the equivalent native paper
  viewport, resolves the native StandardScale value for 1:20 by measuring
  CustomScale, measures WCS against native DisplayDCS to prove the visible twist
  direction, derives the cursor zoom and rotated pan targets from that native
  transform, changes to custom 1:18.1818, saves/reopens a temporary DWG and
  measures the same native state;
- the AutoCAD process, DWG, backup and PID sidecar are removed after every pass
  or failure.

F-100 owns viewport camera scale, center/pan and twist. Viewport multiplicity and
clip boundaries belong to F-099; display-lock behavior belongs to F-101; viewport
layer overrides belong to F-105. The locked-viewport refusal used here is a
safety boundary and does not certify F-101.

The implementation is independent TypeScript. AutoCAD 2024.1.2 is the behavioral
authority; LibreCAD and FreeCAD do not certify paper-space viewport semantics.
