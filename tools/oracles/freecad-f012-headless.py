"""Synthetic F-012 SPLINE output oracle. Never import customer FCStd files."""

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
if payload.get("operation") != "spline-output-readback":
    print(json.dumps({"status": "FAIL", "certificationAuthority": False, "error": "Unsupported synthetic operation"}))
    raise SystemExit(3)

result = []
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
    first = curve.value(curve.FirstParameter)
    last = curve.value(curve.LastParameter)
    result.append({
        "id": item["id"],
        "degree": curve.Degree,
        "poles": [{"x": value.x, "y": value.y} for value in curve.getPoles()],
        "weights": list(curve.getWeights()),
        "knots": list(curve.getKnots()),
        "multiplicities": list(curve.getMultiplicities()),
        "rational": bool(curve.isRational()),
        "length": edge.Length,
        "start": {"x": first.x, "y": first.y},
        "end": {"x": last.x, "y": last.y},
    })

print(json.dumps({
    "status": "PASS",
    "certificationAuthority": False,
    "freecadVersion": FreeCAD.Version(),
    "result": result,
}, sort_keys=True))
