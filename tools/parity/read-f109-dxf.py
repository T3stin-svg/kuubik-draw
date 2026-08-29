#!/usr/bin/env python3
import hashlib
import json
import re
import sys
from collections import Counter
from pathlib import Path

import ezdxf
from ezdxf import bbox


source = Path(sys.argv[1]).resolve()
target = Path(sys.argv[2]).resolve()
raw_text = source.read_bytes().decode("cp1252")
raw_lines = raw_text.replace("\r", "").split("\n")
raw_pairs = [
    (int(raw_lines[index].strip()), raw_lines[index + 1])
    for index in range(0, len(raw_lines) - 1, 2)
    if raw_lines[index].strip().lstrip("-").isdigit()
]


def raw_records(record_type):
    records = []
    current = None
    for code, value in raw_pairs:
        if code == 0:
            if current is not None:
                records.append(current)
            current = [] if value == record_type else None
        elif current is not None:
            current.append((code, value))
    if current is not None:
        records.append(current)
    return records


def raw_named_record(record_type, name):
    for record in raw_records(record_type):
        if any(code == 2 and value == name for code, value in record):
            return record
    return []


def raw_value(record, code, default=None):
    return next((value for item_code, value in record if item_code == code), default)


def raw_xdata_value(record, app_id, code, default=None):
    active = False
    for item_code, value in record:
        if item_code == 1001:
            active = value == app_id
        elif active and item_code == code:
            return value
    return default


def raw_header_point(name):
    for index, (code, value) in enumerate(raw_pairs):
        if code != 9 or value != name:
            continue
        coordinates = {}
        for item_code, item_value in raw_pairs[index + 1:]:
            if item_code in (0, 9):
                break
            if item_code in (10, 20):
                coordinates[item_code] = float(item_value)
        return [number(coordinates[10]), number(coordinates[20])] if 10 in coordinates and 20 in coordinates else None
    return None


document = ezdxf.readfile(source, encoding="cp1252")
auditor = document.audit()
model = document.modelspace()
entities = list(model)


def number(value):
    return round(float(value), 12)


def point(value):
    return [number(value[0]), number(value[1])]


def decoded_text(value):
    return re.sub(r"\\U\+([0-9A-Fa-f]{4,8})", lambda match: chr(int(match.group(1), 16)), str(value))


def common(entity):
    return {
        "type": entity.dxftype(),
        "layer": str(entity.dxf.layer),
        "color": int(entity.dxf.get("color", 256)),
        "trueColor": entity.dxf.get("true_color", None),
        "linetype": str(entity.dxf.get("linetype", "BYLAYER")),
        "lineweight": int(entity.dxf.get("lineweight", -1)),
        "transparencyPercent": number(entity.transparency * 100),
    }


def semantic_entity(entity):
    record = common(entity)
    entity_type = entity.dxftype()
    if entity_type == "LINE":
        record.update({"start": point(entity.dxf.start), "end": point(entity.dxf.end)})
    elif entity_type == "LWPOLYLINE":
        record.update({
            "closed": bool(entity.closed),
            "vertices": [[number(value) for value in vertex] for vertex in entity.get_points("xyseb")],
        })
    elif entity_type == "TEXT":
        record.update({
            "insert": point(entity.dxf.insert), "text": decoded_text(entity.dxf.text),
            "height": number(entity.dxf.height), "style": str(entity.dxf.style),
            "rotation": number(entity.dxf.rotation),
        })
    elif entity_type == "HATCH":
        loops = []
        for path in entity.paths.paths:
            vertices = getattr(path, "vertices", None)
            if vertices is None:
                raise RuntimeError(f"F-109 HATCH {entity.dxf.handle} is not a polyline path")
            loops.append({
                "flags": int(getattr(path, "path_type_flags", 0)),
                "closed": bool(getattr(path, "is_closed", False)),
                "vertices": [[number(vertex[0]), number(vertex[1]), number(vertex[2])] for vertex in vertices],
            })
        record.update({
            "pattern": str(entity.dxf.pattern_name), "solid": bool(entity.dxf.solid_fill),
            "associative": bool(entity.dxf.associative), "loops": loops,
        })
    elif entity_type == "CIRCLE":
        record.update({"center": point(entity.dxf.center), "radius": number(entity.dxf.radius)})
    elif entity_type == "DIMENSION":
        record.update({
            "style": str(entity.dxf.dimstyle), "definition": point(entity.dxf.defpoint),
            "first": point(entity.dxf.defpoint2), "second": point(entity.dxf.defpoint3),
            "textPosition": point(entity.dxf.text_midpoint), "text": str(entity.dxf.text),
            "measurement": number(entity.get_measurement()),
        })
    else:
        raise RuntimeError(f"F-109 unexpected entity type: {entity_type}")
    return record


semantic_entities = {
    str(entity.dxf.handle).upper(): semantic_entity(entity)
    for entity in sorted(entities, key=lambda item: int(item.dxf.handle, 16))
}

counts = Counter(entity.dxftype() for entity in entities)
bulged = sum(
    1
    for entity in model.query("LWPOLYLINE")
    if any(abs(vertex[4]) > 1e-9 for vertex in entity.get_points("xyseb"))
)

layers = {}
for layer in document.layers:
    raw_layer = raw_named_record("LAYER", layer.dxf.name)
    layers[layer.dxf.name] = {
        "color": abs(int(layer.dxf.color)),
        "lineweight": int(layer.dxf.lineweight),
        "linetype": str(layer.dxf.linetype),
        "on": layer.is_on(),
        "frozen": layer.is_frozen(),
        "locked": layer.is_locked(),
        "plottable": bool(layer.dxf.plot),
        "trueColor": layer.dxf.get("true_color", None),
        "transparencyRaw": int(raw_xdata_value(raw_layer, "AcCmTransparency", 1071)) if raw_xdata_value(raw_layer, "AcCmTransparency", 1071) is not None else None,
        "transparencyPercent": number(layer.transparency * 100),
    }

cache = bbox.Cache()
box = bbox.extents(entities, cache=cache)
extents = None if not box.has_data else {
    "min": [number(box.extmin.x), number(box.extmin.y)],
    "max": [number(box.extmax.x), number(box.extmax.y)],
}

report = {
    "reader": "ezdxf",
    "ezdxfVersion": ezdxf.__version__,
    "source": source.name,
    "bytes": source.stat().st_size,
    "sha256": hashlib.sha256(source.read_bytes()).hexdigest(),
    "dxfVersion": document.dxfversion,
    "encoding": document.encoding,
    "units": int(document.header.get("$INSUNITS", 0)),
    "entities": dict(sorted(counts.items())),
    "totalEntities": len(entities),
    "semanticEntities": semantic_entities,
    "bulgedPolylines": bulged,
    "layers": layers,
    "linetypes": sorted(entry.dxf.name for entry in document.linetypes),
    "styles": sorted(entry.dxf.name for entry in document.styles),
    "dimensionStyles": sorted(entry.dxf.name for entry in document.dimstyles),
    "dimensionStyleRecords": {
        entry.dxf.name: {
            "handle": str(entry.dxf.handle).upper(),
            "textStyle": entry.dxf.get("dimtxsty", None),
            "textStyleHandle": raw_value(raw_named_record("DIMSTYLE", entry.dxf.name), 340),
            "textHeight": number(entry.dxf.dimtxt),
            "arrowSize": number(entry.dxf.dimasz),
            "extensionOffset": number(entry.dxf.dimexo),
            "scale": number(entry.dxf.dimscale),
        }
        for entry in document.dimstyles
    },
    "headerExtents": None if raw_header_point("$EXTMIN") is None and raw_header_point("$EXTMAX") is None else {
        "min": raw_header_point("$EXTMIN"),
        "max": raw_header_point("$EXTMAX"),
    },
    "handseed": str(document.header["$HANDSEED"]).upper(),
    "extents": extents,
    "auditErrors": len(auditor.errors),
    "auditFixes": len(auditor.fixes),
    "passed": len(auditor.errors) == 0 and len(auditor.fixes) == 0,
}
target.write_text(json.dumps(report, indent=2, sort_keys=True), encoding="utf-8")
print(json.dumps(report, indent=2, sort_keys=True))
if not report["passed"]:
    raise SystemExit(1)
