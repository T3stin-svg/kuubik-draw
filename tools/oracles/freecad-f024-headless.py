"""Synthetic F-024 circular-arc oracle. Never import customer FCStd files."""

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
if payload.get("operation") != "circular-arc-readback":
    print(json.dumps({"status": "FAIL", "certificationAuthority": False, "error": "Unsupported synthetic operation"}))
    raise SystemExit(3)

result = []
for item in payload.get("arcs", []):
    edge = Part.Arc(point(item["start"]), point(item["mid"]), point(item["end"])).toShape()
    curve = edge.Curve
    first = edge.valueAt(edge.FirstParameter)
    last = edge.valueAt(edge.LastParameter)
    start_tangent = edge.tangentAt(edge.FirstParameter)
    end_tangent = edge.tangentAt(edge.LastParameter)
    result.append({
        "id": item["id"],
        "center": {"x": curve.Center.x, "y": curve.Center.y},
        "radius": curve.Radius,
        "length": edge.Length,
        "start": {"x": first.x, "y": first.y},
        "end": {"x": last.x, "y": last.y},
        "startTangent": {"x": start_tangent.x, "y": start_tangent.y},
        "endTangent": {"x": end_tangent.x, "y": end_tangent.y},
    })

print(json.dumps({
    "status": "PASS",
    "certificationAuthority": False,
    "freecadVersion": FreeCAD.Version(),
    "result": result,
}, sort_keys=True))
