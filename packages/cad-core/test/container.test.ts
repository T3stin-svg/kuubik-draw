import { describe, expect, it } from "vitest";
import { CadSession, createEmptyDocument, createPaperLayout, createPaperViewport, deserializeKDraw, serializeKDraw } from "../src/index.js";

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

  it("rejects a checksummed container whose persisted viewport lock is not boolean", async () => {
    const source = createEmptyDocument({ documentId: "invalid-viewport-lock" });
    const paper = createPaperLayout(source, { name: "INVALID LOCK", viewports: [] });
    const created = createPaperViewport({ ...source, layouts: paper.layouts }, paper.layoutId, {
      center: { x: 210, y: 148.5 }, width: 200, height: 100,
      viewCenter: { x: 0, y: 0 }, viewHeight: 1000, twistAngleRad: 0, locked: false,
    });
    const valid = { ...source, layouts: created.layouts };
    const invalid = structuredClone(valid);
    (invalid.layouts[1]!.viewports[0] as unknown as { locked: unknown }).locked = "yes";
    await expect(serializeKDraw(invalid)).rejects.toThrow(/boolean/i);
    expect(() => new CadSession(invalid)).toThrow(/boolean/i);

    const bytes = await serializeKDraw(valid, [], "2026-08-28T00:00:00.000Z");
    const text = new TextDecoder().decode(bytes);
    const envelope = JSON.parse(text.slice("KDRAW1\n".length));
    const persisted = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(envelope.files["document.json"]), (character) => character.charCodeAt(0))));
    persisted.layouts[1].viewports[0].locked = "yes";
    const documentBytes = new TextEncoder().encode(`${JSON.stringify(persisted)}\n`);
    envelope.files["document.json"] = btoa(String.fromCharCode(...documentBytes));
    const entry = envelope.manifest.entries.find((candidate: { path: string }) => candidate.path === "document.json");
    entry.byteLength = documentBytes.byteLength;
    entry.sha256 = [...new Uint8Array(await crypto.subtle.digest("SHA-256", documentBytes))]
      .map((value) => value.toString(16).padStart(2, "0"))
      .join("");
    const corrupt = new TextEncoder().encode(`KDRAW1\n${JSON.stringify(envelope)}\n`);
    await expect(deserializeKDraw(corrupt)).rejects.toThrow(/boolean/i);
  });
});
