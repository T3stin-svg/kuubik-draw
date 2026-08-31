import { expect, type Locator } from "@playwright/test";

export interface WorldPoint {
  x: number;
  y: number;
}

interface ModelTransform {
  centerX: number;
  centerY: number;
  worldUnitsPerPixel: number;
}

async function readModelTransform(canvas: Locator): Promise<ModelTransform> {
  await expect(canvas).toHaveAttribute("data-world-units-per-pixel", /.+/u);
  const transform = await canvas.evaluate((element) => ({
    centerX: Number((element as HTMLElement).dataset.worldCenterX),
    centerY: Number((element as HTMLElement).dataset.worldCenterY),
    worldUnitsPerPixel: Number((element as HTMLElement).dataset.worldUnitsPerPixel),
  }));
  expect(Object.values(transform).every(Number.isFinite)).toBe(true);
  expect(transform.worldUnitsPerPixel).toBeGreaterThan(0);
  return transform;
}

/** Converts through the same persistent model-space transform used by paint and pointer input. */
export async function modelWorldToScreen(canvas: Locator, point: WorldPoint): Promise<WorldPoint> {
  const [box, transform] = await Promise.all([canvas.boundingBox(), readModelTransform(canvas)]);
  expect(box).not.toBeNull();
  return {
    x: box!.x + box!.width / 2 + (point.x - transform.centerX) / transform.worldUnitsPerPixel,
    y: box!.y + box!.height / 2 - (point.y - transform.centerY) / transform.worldUnitsPerPixel,
  };
}

export async function modelVisibleWorldRect(canvas: Locator): Promise<{ x: number; y: number; width: number; height: number }> {
  const [box, transform] = await Promise.all([canvas.boundingBox(), readModelTransform(canvas)]);
  expect(box).not.toBeNull();
  const width = box!.width * transform.worldUnitsPerPixel;
  const height = box!.height * transform.worldUnitsPerPixel;
  const round = (value: number) => Number(value.toFixed(6));
  return {
    x: round(transform.centerX - width / 2),
    y: round(transform.centerY - height / 2),
    width: round(width),
    height: round(height),
  };
}
