"""Create the public synthetic multi-page F-115 PDF underlay fixture."""

from __future__ import annotations

import argparse
from pathlib import Path

from reportlab.lib.colors import HexColor
from reportlab.lib.pagesizes import A3, A4, landscape
from reportlab.pdfgen.canvas import Canvas


def draw_page(canvas: Canvas, label: str, width: float, height: float) -> None:
    canvas.setStrokeColor(HexColor("#1266A8"))
    canvas.setLineWidth(2)
    canvas.rect(24, 24, width - 48, height - 48)
    canvas.line(24, 24, width - 24, height - 24)
    canvas.line(24, height - 24, width - 24, 24)
    canvas.setFillColor(HexColor("#102A43"))
    compact = width < 400
    canvas.setFont("Helvetica-Bold", 12 if compact else 24)
    canvas.drawString(48, height - 72, label)
    canvas.setFont("Helvetica", 6 if compact else 11)
    canvas.drawString(48, height - 92, "SYNTHETIC FIXTURE — NO CLIENT DATA" if compact else "SYNTHETIC PUBLIC FIXTURE — NO CLIENT DATA")
    canvas.drawString(48, 48, f"PAGE BOX {width:.3f} × {height:.3f} PT")


def create_pdf(output: Path) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    canvas = Canvas(str(output), pagesize=A4, pageCompression=0, invariant=1)
    draw_page(canvas, "F-115 PAGE 1 — A4 PORTRAIT", *A4)
    canvas.showPage()

    a3_landscape = landscape(A3)
    canvas.setPageSize(a3_landscape)
    draw_page(canvas, "F-115 PAGE 2 — A3 LANDSCAPE", *a3_landscape)
    canvas.showPage()

    custom_portrait = (216.0, 360.0)
    canvas.setPageSize(custom_portrait)
    draw_page(canvas, "F-115 PAGE 3", *custom_portrait)
    canvas.showPage()
    canvas.save()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("output", nargs="?", type=Path, default=Path("tmp/f115/f115-synthetic-underlay.pdf"))
    args = parser.parse_args()
    create_pdf(args.output.resolve())
    print(args.output.resolve())


if __name__ == "__main__":
    main()
