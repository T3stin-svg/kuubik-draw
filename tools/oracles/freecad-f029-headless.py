"""Synthetic F-029 ALIGN output oracle. Never import customer FCStd files."""

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
if payload.get("operation") != "align-output-readback":
    print(json.dumps({"status": "FAIL", "certificationAuthority": False, "error": "Unsupported synthetic operation"}))
    raise SystemExit(3)

result = {"lines": [], "splines": []}
for item in payload.get("lines", []):
    edge = Part.makeLine(point(item["start"]), point(item["end"]))
    result["lines"].append({
        "id": item["id"],
        "start": {"x": edge.Vertexes[0].Point.x, "y": edge.Vertexes[0].Point.y},
        "end": {"x": edge.Vertexes[-1].Point.x, "y": edge.Vertexes[-1].Point.y},
        "length": edge.Length,
    })

for item in payload.get("splines", []):
    curve = Part.BSplineCurve()
    curve.buildFromPolesMultsKnots(
        [point(value) for value in item["controlPoints"]],
        [int(value) for value in item["multiplicities"]],
        [float(value) for value in item["knots"]],
        False,
        int(item["degree"]),
        [float(value) for value in item["weights"]],
    )
    edge = curve.toShape()
    result["splines"].append({
        "id": item["id"],
        "degree": curve.Degree,
        "poles": [{"x": value.x, "y": value.y} for value in curve.getPoles()],
        "weights": list(curve.getWeights()),
        "knots": list(curve.getKnots()),
        "multiplicities": list(curve.getMultiplicities()),
        "rational": bool(curve.isRational()),
        "length": edge.Length,
    })

print(json.dumps({
    "status": "PASS",
    "certificationAuthority": False,
    "freecadVersion": FreeCAD.Version(),
    "result": result,
}, sort_keys=True))
