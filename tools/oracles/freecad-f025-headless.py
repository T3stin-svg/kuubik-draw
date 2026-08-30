"""Synthetic F-025 line-network oracle. Never imports customer FCStd files."""

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
if payload.get("operation") != "line-network-readback":
    print(json.dumps({"status": "FAIL", "certificationAuthority": False, "error": "Unsupported synthetic operation"}))
    raise SystemExit(3)

result = []
for segment in payload.get("segments", []):
    shape = Part.makeLine(point(segment["start"]), point(segment["end"]))
    first = shape.Vertexes[0].Point
    second = shape.Vertexes[-1].Point
    result.append({
        "id": segment["id"],
        "start": {"x": first.x, "y": first.y},
        "end": {"x": second.x, "y": second.y},
        "length": shape.Length,
        "bounds": {
            "xmin": shape.BoundBox.XMin,
            "xmax": shape.BoundBox.XMax,
            "ymin": shape.BoundBox.YMin,
            "ymax": shape.BoundBox.YMax,
        },
    })

print(json.dumps({
    "status": "PASS",
    "certificationAuthority": False,
    "freecadVersion": FreeCAD.Version(),
    "result": result,
}, sort_keys=True))
