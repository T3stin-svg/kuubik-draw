export function roundF109Number(value: unknown): number;
export function normalizeF109HatchTopology(record: {
  loops?: Array<{ flags?: number; closed?: boolean; vertices: Array<readonly [number, number, number?]> }>;
} | null | undefined): {
  loopCount: number;
  loops: Array<{ flags?: number; closed?: boolean; hasBulge: boolean; vertexCount: number; vertices: number[][] }>;
};
