import { describe, expect, it } from "vitest";
import { createEmptyDocument, deserializeKDraw, serializeKDraw } from "../src/index.js";

describe(".kdraw checksum container", () => {
  it("round-trips document and attachments with a complete manifest", async () => {
    const document = createEmptyDocument({ documentId: "container", now: "2026-08-28T00:00:00Z" });
    document.entities.push({ kind: "line", handle: "10", layerId: "0", start: { x: 0.25, y: 1.5 }, end: { x: 2.75, y: 4.5 } });
    const bytes = await serializeKDraw(
      document,
      [{ path: "attachments/note.txt", mediaType: "text/plain", bytes: new TextEncoder().encode("synthetic") }],
      "2026-08-28T00:01:00Z",
    );
    const restored = await deserializeKDraw(bytes);
    expect(restored.document).toEqual(document);
    expect(new TextDecoder().decode(restored.attachments.get("attachments/note.txt"))).toBe("synthetic");
    expect(restored.manifest.entries).toHaveLength(2);
    expect(restored.manifest.entries.every((entry) => /^[a-f0-9]{64}$/.test(entry.sha256))).toBe(true);
  });

  it("rejects a one-byte mutation before exposing document data", async () => {
    const bytes = await serializeKDraw(createEmptyDocument({ documentId: "corrupt" }));
    const text = new TextDecoder().decode(bytes);
    const envelope = JSON.parse(text.slice("KDRAW1\n".length));
    envelope.files["document.json"] = `${envelope.files["document.json"].slice(0, -2)}AA`;
    const corrupt = new TextEncoder().encode(`KDRAW1\n${JSON.stringify(envelope)}\n`);
    await expect(deserializeKDraw(corrupt)).rejects.toThrow(/mismatch/);
  });
});
