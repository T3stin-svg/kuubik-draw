import type { CSSProperties } from "react";

export interface PdfUnderlayViewPlacement {
  pageNumber: number;
  position: { x: number; y: number };
  widthMm: number;
  heightMm: number;
  rotationRad: number;
  opacity: number;
  visible: boolean;
  fadePercent?: number;
  clipBoundary?: Array<{ x: number; y: number }>;
}

export interface PdfUnderlayViewProps {
  sourceUrl: string;
  placement: PdfUnderlayViewPlacement;
  pixelsPerMm: number;
  layerVisible?: boolean;
}

export function PdfUnderlayView({ sourceUrl, placement, pixelsPerMm, layerVisible = true }: PdfUnderlayViewProps) {
  if (!placement.visible || !layerVisible) return null;
  const effectiveOpacity = placement.opacity * (1 - (placement.fadePercent ?? 0) / 100);
  const clipPath = placement.clipBoundary === undefined
    ? undefined
    : `polygon(${placement.clipBoundary.map((point) => `${point.x * 100}% ${(1 - point.y) * 100}%`).join(", ")})`;
  const style: CSSProperties = {
    position: "absolute",
    left: placement.position.x * pixelsPerMm,
    bottom: placement.position.y * pixelsPerMm,
    width: placement.widthMm * pixelsPerMm,
    height: placement.heightMm * pixelsPerMm,
    opacity: effectiveOpacity,
    transform: `rotate(${placement.rotationRad}rad)`,
    transformOrigin: "bottom left",
    pointerEvents: "none",
    border: 0,
    background: "white",
    ...(clipPath === undefined ? {} : { clipPath }),
  };
  return (
    <img
      aria-label={`PDF underlay page ${placement.pageNumber}`}
      alt={`PDF underlay page ${placement.pageNumber}`}
      data-page-number={placement.pageNumber}
      data-effective-opacity={effectiveOpacity}
      data-clipped={placement.clipBoundary === undefined ? "false" : "true"}
      src={sourceUrl}
      style={style}
    />
  );
}
