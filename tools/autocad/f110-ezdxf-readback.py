from __future__ import annotations

import hashlib
import json
import re
import sys
from pathlib import Path
from typing import Any

import ezdxf


if len(sys.argv) != 4:
    raise SystemExit("Usage: f110-ezdxf-readback.py <source.dxf> <desktop-saved.dxf> <output.json>")

source_path, saved_path, output_path = map(Path, sys.argv[1:])


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def rounded(value: float) -> float:
    return round(float(value), 12)


def vec(value: Any) -> list[float]:
    values = list(value)
    return [rounded(values[0]), rounded(values[1]), rounded(values[2] if len(values) > 2 else 0)]


def raw_text_entity(path: Path, handle: str) -> str:
    raw = path.read_bytes()
    probe = raw.decode("cp1252")
    version_match = re.search(r"\$ACADVER\s*\r?\n\s*1\s*\r?\n(AC\d+)", probe)
    version = int(version_match.group(1)[2:]) if version_match else 0
    text = raw.decode("utf-8" if version >= 1021 else "cp1252")
    lines = text.splitlines()
    pairs = [(int(lines[index].strip()), lines[index + 1]) for index in range(0, len(lines) - 1, 2)]
    for index, pair in enumerate(pairs):
        if pair != (0, "TEXT"):
            continue
        record: list[tuple[int, str]] = []
        for candidate in pairs[index + 1 :]:
            if candidate[0] == 0:
                break
            record.append(candidate)
        if next((value for code, value in record if code == 5), None) == handle:
            value = next(value for code, value in record if code == 1)
            return re.sub(r"\\U\+([0-9A-Fa-f]{4})", lambda match: chr(int(match.group(1), 16)), value)
    raise AssertionError(f"TEXT {handle} not found in {path}")


def manifest(path: Path) -> tuple[dict[str, Any], Any]:
    document = ezdxf.readfile(path)
    audit = document.audit()
    model = document.modelspace()
    by_handle = {entity.dxf.handle: entity for entity in model}
    line = by_handle["10"]
    polyline = by_handle["20"]
    circle = by_handle["30"]
    arc = by_handle["40"]
    ellipse = by_handle["50"]
    spline = by_handle["60"]
    text = by_handle["70"]
    mtext = by_handle["80"]
    hatch = by_handle["90"]
    dimension = by_handle["A0"]
    insert = by_handle["B0"]
    anonymous = next(block for block in document.blocks if block.name.upper().startswith("*D"))
    symbol = document.blocks.get("SYMBOL")
    semantic = {
        "dxfVersion": document.dxfversion,
        "insunits": int(document.header["$INSUNITS"]),
        "entityCount": len(model),
        "entities": [{"type": entity.dxftype(), "handle": entity.dxf.handle, "layer": entity.dxf.layer} for entity in model],
        "line": {"start": vec(line.dxf.start), "end": vec(line.dxf.end), "color": line.dxf.color, "trueColor": line.dxf.true_color, "linetype": line.dxf.linetype, "linetypeScale": rounded(line.dxf.ltscale)},
        "polyline": {"closed": polyline.closed, "points": [[rounded(item) for item in point] for point in polyline.get_points("xyseb")]},
        "circle": {"center": vec(circle.dxf.center), "radius": rounded(circle.dxf.radius)},
        "arc": {"center": vec(arc.dxf.center), "radius": rounded(arc.dxf.radius), "startAngle": rounded(arc.dxf.start_angle), "endAngle": rounded(arc.dxf.end_angle)},
        "ellipse": {"center": vec(ellipse.dxf.center), "majorAxis": vec(ellipse.dxf.major_axis), "ratio": rounded(ellipse.dxf.ratio), "startParam": rounded(ellipse.dxf.start_param), "endParam": rounded(ellipse.dxf.end_param)},
        "spline": {"degree": spline.dxf.degree, "flags": spline.dxf.flags, "knots": [rounded(value) for value in spline.knots], "controlPoints": [vec(value) for value in spline.control_points], "weights": [rounded(value) for value in spline.weights]},
        "text": {"value": raw_text_entity(path, "70"), "insert": vec(text.dxf.insert), "height": rounded(text.dxf.height), "rotation": rounded(text.dxf.rotation), "style": text.dxf.style},
        "mtext": {"value": mtext.plain_text(), "insert": vec(mtext.dxf.insert), "height": rounded(mtext.dxf.char_height), "width": rounded(mtext.dxf.width), "attachment": mtext.dxf.attachment_point, "rotation": rounded(mtext.get_rotation()), "style": mtext.dxf.style},
        "hatch": {"pattern": hatch.dxf.pattern_name, "solid": hatch.dxf.solid_fill, "associative": hatch.dxf.associative, "loops": [[[rounded(vertex[0]), rounded(vertex[1])] for vertex in path.vertices] for path in hatch.paths]},
        "dimension": {"type": dimension.dxf.dimtype, "anonymousBlockHandle": anonymous.block.dxf.handle, "text": dimension.dxf.text, "style": dimension.dxf.dimstyle, "actualMeasurement": rounded(dimension.dxf.actual_measurement), "measured": rounded(dimension.get_measurement()), "defpoint": vec(dimension.dxf.defpoint), "defpoint2": vec(dimension.dxf.defpoint2), "defpoint3": vec(dimension.dxf.defpoint3), "textMidpoint": vec(dimension.dxf.text_midpoint)},
        "insert": {"name": insert.dxf.name, "point": vec(insert.dxf.insert), "scale": [rounded(insert.dxf.xscale), rounded(insert.dxf.yscale), rounded(insert.dxf.zscale)], "rotation": rounded(insert.dxf.rotation)},
        "blocks": {"anonymous": {"handle": anonymous.block.dxf.handle, "entityTypes": [entity.dxftype() for entity in anonymous]}, "SYMBOL": {"handle": symbol.block.dxf.handle, "entities": [{"type": entity.dxftype(), "handle": entity.dxf.handle} for entity in symbol]}},
        "tables": {"layers": [item.dxf.name for item in document.layers], "linetypes": [item.dxf.name for item in document.linetypes], "textStyles": [item.dxf.name for item in document.styles], "dimensionStyles": [item.dxf.name for item in document.dimstyles]},
        "audit": {"errors": len(audit.errors), "fixes": len(audit.fixes)},
    }
    return semantic, document


source_semantic, _ = manifest(source_path)
saved_semantic, _ = manifest(saved_path)
if source_semantic["audit"] != {"errors": 0, "fixes": 0} or saved_semantic["audit"] != {"errors": 0, "fixes": 0}:
    raise AssertionError("ezdxf audit did not pass cleanly")
if source_semantic["insunits"] != 4 or saved_semantic["insunits"] != 4:
    raise AssertionError("millimetre units were not preserved")
if source_semantic["text"]["value"] != "TÕEND ŠŽ€" or saved_semantic["text"]["value"] != "TÕEND ŠŽ€":
    raise AssertionError("UTF-8 TEXT content was not preserved")

# AutoCAD legitimately upgrades the file version and renames the anonymous
# dimension block from *D1 to *D0. The name is not used as semantic identity;
# its stable block handle is compared above.
source_comparison = json.loads(json.dumps(source_semantic))
saved_comparison = json.loads(json.dumps(saved_semantic))
source_comparison["dxfVersion"] = "normalized"
saved_comparison["dxfVersion"] = "normalized"
if source_comparison != saved_comparison:
    raise AssertionError("independent semantic manifests differ after allowed DXF-version normalization")

result = {
    "schemaVersion": 1,
    "rowId": "F-110",
    "authority": "ezdxf-1.4.3",
    "status": "PASS",
    "source": {"path": str(source_path), "bytes": source_path.stat().st_size, "sha256": sha256(source_path), "semantic": source_semantic},
    "desktopSaved": {"path": str(saved_path), "bytes": saved_path.stat().st_size, "sha256": sha256(saved_path), "semantic": saved_semantic},
    "allowedNormalization": {"dxfVersion": "AC1018 -> AC1032", "anonymousDimensionBlock": "*D1 -> *D0", "anonymousBlockHandlePreserved": "700"},
}
with output_path.open("w", encoding="utf-8", newline="\n") as output:
    output.write(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
print("F-110 independent ezdxf Desktop read-back PASS.")
