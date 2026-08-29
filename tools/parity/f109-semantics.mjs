export const roundF109Number = (value) => Number(Number(value).toFixed(9));

export function normalizeF109HatchTopology(record) {
  return {
    loopCount: record?.loops?.length ?? 0,
    loops: (record?.loops ?? []).map((loop) => ({
      flags: loop.flags,
      closed: loop.closed,
      hasBulge: loop.vertices.some((vertex) => Math.abs(vertex[2] ?? 0) > 1e-9),
      vertexCount: loop.vertices.length,
      vertices: loop.vertices.map((vertex) => [roundF109Number(vertex[0]), roundF109Number(vertex[1]), roundF109Number(vertex[2] ?? 0)]),
    })),
  };
}
