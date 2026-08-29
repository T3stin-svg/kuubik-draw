"""Synthetic-fixture FreeCAD oracle entrypoint. Never import customer FCStd files."""

import json
import sys

try:
    import FreeCAD  # type: ignore
    import Part  # type: ignore
except Exception as exc:
    print(json.dumps({"status": "FAIL", "certificationAuthority": False, "error": str(exc)}))
    raise SystemExit(2)


def point(value):
    return FreeCAD.Vector(float(value["x"]), float(value["y"]), 0.0)


payload = json.load(sys.stdin)
operation = payload.get("operation")
if operation == "intersections":
    first = Part.makeLine(point(payload["a"][0]), point(payload["a"][1]))
    second = Part.makeLine(point(payload["b"][0]), point(payload["b"][1]))
    section = first.section(second)
    result = [{"x": vertex.Point.x, "y": vertex.Point.y} for vertex in section.Vertexes]
elif operation == "spline-intersections":
    spline = Part.BezierCurve()
    poles = [point(value) for value in payload["controlPoints"]]
    spline.setPoles(poles)
    spline_shape = spline.toShape()
    intersections = []
    for boundary in payload["boundaries"]:
        boundary_shape = Part.makeLine(point(boundary[0]), point(boundary[1]))
        section = spline_shape.section(boundary_shape)
        intersections.extend({"x": vertex.Point.x, "y": vertex.Point.y} for vertex in section.Vertexes)
    intersections.sort(key=lambda value: (value["x"], value["y"]))
    result = {
        "degree": spline.Degree,
        "poleCount": len(spline.getPoles()),
        "intersections": intersections,
        "bounds": {
            "xmin": spline_shape.BoundBox.XMin,
            "xmax": spline_shape.BoundBox.XMax,
            "ymin": spline_shape.BoundBox.YMin,
            "ymax": spline_shape.BoundBox.YMax,
        },
    }
else:
    print(json.dumps({"status": "FAIL", "certificationAuthority": False, "error": "Unsupported synthetic operation"}))
    raise SystemExit(3)

print(json.dumps({
    "status": "PASS",
    "certificationAuthority": False,
    "freecadVersion": FreeCAD.Version(),
    "result": result,
}, sort_keys=True))
