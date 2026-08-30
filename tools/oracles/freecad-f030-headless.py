"""Synthetic F-030 MATCHPROP output oracle. Never import customer FCStd files."""
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
payload=json.load(sys.stdin)
if payload.get("operation")!="matchprop-output-readback":
    print(json.dumps({"status":"FAIL","certificationAuthority":False,"error":"Unsupported synthetic operation"}));raise SystemExit(3)
result={"lines":[],"circles":[]}
for item in payload.get("lines",[]):
    edge=Part.makeLine(point(item["start"]),point(item["end"]))
    result["lines"].append({"id":item["id"],"start":{"x":edge.Vertexes[0].Point.x,"y":edge.Vertexes[0].Point.y},"end":{"x":edge.Vertexes[-1].Point.x,"y":edge.Vertexes[-1].Point.y},"length":edge.Length})
for item in payload.get("circles",[]):
    edge=Part.makeCircle(float(item["radius"]),point(item["center"]))
    result["circles"].append({"id":item["id"],"center":item["center"],"radius":float(item["radius"]),"length":edge.Length})
print(json.dumps({"status":"PASS","certificationAuthority":False,"freecadVersion":FreeCAD.Version(),"result":result},sort_keys=True))
