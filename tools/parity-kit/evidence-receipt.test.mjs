import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const timestampedStages = [
  "tools/parity/run-f015-readback.mjs",
  "tools/parity/run-f097-readback.mjs",
  "tools/parity/run-f098-readback.mjs",
  "tools/parity/run-f099-readback.mjs",
  "tools/parity/run-f100-readback.mjs",
  "tools/parity/run-f101-readback.mjs",
  "tools/parity/build-f098-browser-readback.mjs",
];

describe("fresh evidence receipts", () => {
  it.each(timestampedStages)("records a new observedAt value in %s", async (path) => {
    const source = await readFile(resolve(root, path), "utf8");
    expect(source).toContain("observedAt: new Date().toISOString(),");
  });
});
