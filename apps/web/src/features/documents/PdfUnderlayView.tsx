import type { CSSProperties } from "react";

export interface PdfUnderlayViewPlacement {
  pageNumber: number;
  position: { x: number; y: number };
  widthMm: number;
  heightMm: number;
  rotationRad: number;
  opacity: number;
  visible: boolean;
}

export interface PdfUnderlayViewProps {
  sourceUrl: string;
  placement: PdfUnderlayViewPlacement;
  pixelsPerMm: number;
}

export function PdfUnderlayView({ sourceUrl, placement, pixelsPerMm }: PdfUnderlayViewProps) {
  if (!placement.visible) return null;
  const style: CSSProperties = {
    position: "absolute",
    left: placement.position.x * pixelsPerMm,
    bottom: placement.position.y * pixelsPerMm,
    width: placement.widthMm * pixelsPerMm,
    height: placement.heightMm * pixelsPerMm,
    opacity: placement.opacity,
    transform: `rotate(${placement.rotationRad}rad)`,
    transformOrigin: "bottom left",
    pointerEvents: "none",
    border: 0,
    background: "white",
  };
  const separator = sourceUrl.includes("#") ? "&" : "#";
  return (
    <object
      aria-label={`PDF underlay page ${placement.pageNumber}`}
      data={`${sourceUrl}${separator}page=${placement.pageNumber}&toolbar=0&navpanes=0&scrollbar=0`}
      type="application/pdf"
      style={style}
    >
      <span>PDF underlay preview is unavailable.</span>
    </object>
  );
}
