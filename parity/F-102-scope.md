# F-102 page setup certification scope

The fixed AutoCAD 2024.1.2 Windows 2D row is `Page setup – paper/orientation/area/scale`.

Required AutoCAD and Kuubik workflows:

- a paper layout persists ISO media, portrait/landscape orientation, Layout,
  Window, Extents and Display plot areas, Fit or positive custom scale,
  center state and an explicit plot offset;
- Layout normalizes to 1:1, origin 0,0 and non-centered because native AutoCAD
  rejects `CenterPlot` while `PlotType=acLayout`;
- Window coordinates are finite with positive width/height, but may be negative
  or outside the selected sheet because they address arbitrary layout space;
- Display consumes the current paper-space display window at plot time; a
  missing display window is rejected instead of silently becoming Layout;
- the AutoCAD scratch window is resized to the Chromium paper-view aspect,
  then `ZoomCenter` receives the same center and height. Native `VIEWCTR`,
  `VIEWSIZE` and `SCREENSIZE` reconstruct the same source rectangle within
  0.01 drawing units before either Display PDF is accepted;
- changing media/orientation leaves existing viewport paper-space center, width,
  height and clip coordinates unchanged. This is a measured AutoCAD 2024 result;
  the older proportional-refit prototype was rejected by the new live evidence;
- one PAGESETUP commit updates paper and plot state atomically, and one Undo/Redo
  restores/reapplies the complete state;
- IndexedDB reload and production KDRAW1 preserve the setup and exact viewport;
- physical SVG and vector PDF export use the same resolved source/destination
  placement; a separate reader checks A4 dimensions, Window 10,20–190,270,
  destination rectangle 10,10,90,125, PDF page count/xref and KDRAW1 payload hashes;
- a 1920x1080 Chromium workflow covers A3 Layout 1:1, A4 portrait Window 1:2,
  downloads, undo/redo, Extents Fit Center, an out-of-sheet Window, Display
  from the visible paper view, separate Display SVG/PDF read-back, A3
  restoration and zero errors;
- an owned AutoCAD 24.3 scratch process configures the same native Layout,
  parses the synthetic PDF vector endpoints, saves/reopens a temporary DWG,
  runs Extents Fit Center, arbitrary Window and current-view Display plots,
  restores A3 Layout and deletes/terminates all temporary native state.

Public CI verifies that the committed live evidence hashes match the current
AutoCAD/browser/read-back sources. A separately gated self-hosted Windows job
reruns AutoCAD when `REQUIRE_AUTOCAD_CERTIFICATION=true` and a licensed
`autocad-2024` runner is available.

F-102 owns per-layout paper/orientation/area/scale and single-layout physical
plot placement. Multiple layouts/publish, viewport layer overrides, PC3/CTB/STB
management and full plot-dialog parity remain separate audit rows. The native
and Kuubik Display readers prove the same source view, vector direction and
each engine's resolved Fit scale. They do not claim equal absolute printable
origin or device margin: `DWG To PDF.pc3` printable-area parity belongs to
F-108.

AutoCAD 2024.1.2 is the behavioral authority. LibreCAD and FreeCAD do not
certify page setup or native plot configuration semantics.
