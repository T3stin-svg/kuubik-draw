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
else:
    print(json.dumps({"status": "FAIL", "certificationAuthority": False, "error": "Unsupported synthetic operation"}))
    raise SystemExit(3)

print(json.dumps({
    "status": "PASS",
    "certificationAuthority": False,
    "freecadVersion": FreeCAD.Version(),
    "result": result,
}, sort_keys=True))
