# F-098 visible paper sheet certification scope

The fixed AutoCAD 2024.1.2 Windows 2D row is `Visible paper sheet`.

Required AutoCAD and Kuubik workflows:

- selecting a paper layout leaves Model space and enters a distinct paper-space context;
- paper space shows a finite, positive white sheet against a visibly darker desk;
- the sheet aspect ratio follows its physical paper width and height, including landscape orientation;
- AutoCAD and Kuubik execute the same ISO A3 landscape `420 x 297 mm` case;
- paper-space world coordinates are exactly `0,0` through the paper width and height in drawing units;
- paper geometry is rendered on the sheet and never used to infer the sheet dimensions;
- missing paper metadata receives the deterministic A4 fallback;
- zero, negative, non-finite or fully collapsed printable dimensions are rejected;
- the same paper definition survives production `.kdraw` serialization and IndexedDB reload;
- the 1920×1080 browser measurement proves positive drawing-area, desk, sheet and canvas rectangles, exact paper aspect ratio, painted paper geometry and zero console errors;
- the owned AutoCAD workflow measures the light sheet in the actual application window without retaining the screenshot, saves a temporary native DWG, reopens it and verifies that the paper context, paper dimensions and geometry persist;
- no temporary AutoCAD DWG or screenshot is retained in the public repository.

F-098 owns only the visible paper workspace, validated paper dimensions and the
paper-coordinate render domain. Viewport creation and management belong to F-099,
viewport navigation to F-100, viewport locking to F-101 and page setup/plotting to
F-102 onward; those functions are not double-counted here.

The implementation is independent TypeScript. LibreCAD and FreeCAD are not
certification authorities for AutoCAD's paper-space UI or native layout state.
