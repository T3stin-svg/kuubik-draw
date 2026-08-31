import { describe, expect, it } from "vitest";
import { exportDxf } from "../src/index.js";
import { createF110Document } from "./f110-fixture.js";

interface Pair {
  code: number;
  value: string;
}

interface RecordGroup {
  type: string;
  pairs: Pair[];
}

function records(source: string): RecordGroup[] {
  const lines = source.replaceAll("\r", "").split("\n");
  const pairs: Pair[] = [];
  for (let index = 0; index + 1 < lines.length; index += 2) {
    pairs.push({ code: Number.parseInt(lines[index]!.trim(), 10), value: lines[index + 1]!.trim() });
  }
  const result: RecordGroup[] = [];
  for (let index = 0; index < pairs.length;) {
    if (pairs[index]!.code !== 0) { index += 1; continue; }
    const type = pairs[index]!.value;
    const body: Pair[] = [];
    index += 1;
    while (index < pairs.length && pairs[index]!.code !== 0) body.push(pairs[index++]!);
    result.push({ type, pairs: body });
  }
  return result;
}

function value(record: RecordGroup, code: number): string | undefined {
  return record.pairs.find((pair) => pair.code === code)?.value;
}

describe("F-110 AutoCAD anonymous dimension-block audit contract", () => {
  it("marks the DIMENSION picture as single-owner anonymous and keeps record owners coherent", () => {
    const source = exportDxf(createF110Document()).text;
    const groups = records(source);
    const dimension = groups.find((record) => record.type === "DIMENSION");
    expect(dimension).toBeDefined();
    const blockName = value(dimension!, 2);
    expect(blockName).toMatch(/^\*D\d+$/u);
    expect(Number(value(dimension!, 70)) & 32).toBe(32);

    const blockRecord = groups.find((record) => record.type === "BLOCK_RECORD" && value(record, 2) === blockName);
    const block = groups.find((record) => record.type === "BLOCK" && value(record, 2) === blockName);
    expect(blockRecord).toBeDefined();
    expect(block).toBeDefined();
    expect(value(block!, 3)).toBe(blockName);
    expect(Number(value(block!, 70)) & 1).toBe(1);

    const recordHandle = value(blockRecord!, 5);
    expect(recordHandle).toMatch(/^[0-9A-F]+$/u);
    expect(value(block!, 330)).toBe(recordHandle);
    const blockIndex = groups.indexOf(block!);
    const endBlock = groups.slice(blockIndex + 1).find((record) => record.type === "ENDBLK");
    expect(endBlock).toBeDefined();
    expect(value(endBlock!, 330)).toBe(recordHandle);
  });
});
