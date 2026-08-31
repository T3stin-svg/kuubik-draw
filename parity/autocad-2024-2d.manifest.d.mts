export interface ParityManifestRow {
  id: `F-${string}`;
  category: string;
  feature: string;
  baselineScore: number;
  currentScore: number;
  weight: 1 | 3 | 5;
  priority: "P0" | "P1" | "P2";
  effort: "S" | "M" | "L";
}

export const parityManifest: {
  schemaVersion: 1;
  benchmark: "AutoCAD 2024.1.2 / Windows / 2D Drafting & Annotation";
  denominator: 133;
  rows: readonly ParityManifestRow[];
};
