import {
  assertKDrawDocumentV1,
  type KDrawContainerManifestV1,
  type KDrawDocumentV1,
} from "@kuubik/cad-schema";

const MAGIC = "KDRAW1\n";

export interface KDrawAttachmentBytes {
  path: `attachments/${string}`;
  mediaType: string;
  bytes: Uint8Array;
}

interface KDrawEnvelopeV1 {
  format: "application/vnd.kuubik.kdraw+json";
  manifest: KDrawContainerManifestV1;
  files: Record<string, string>;
}

function base64Encode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64Decode(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

export async function serializeKDraw(
  document: KDrawDocumentV1,
  attachments: readonly KDrawAttachmentBytes[] = [],
  createdAt = new Date().toISOString(),
): Promise<Uint8Array> {
  assertKDrawDocumentV1(document);
  const encoder = new TextEncoder();
  const documentBytes = encoder.encode(`${JSON.stringify(document)}\n`);
  const paths = new Set<string>(["document.json"]);
  const entries = [
    {
      path: "document.json",
      mediaType: "application/json",
      byteLength: documentBytes.byteLength,
      sha256: await sha256(documentBytes),
    },
  ];
  const files: Record<string, string> = { "document.json": base64Encode(documentBytes) };
  for (const attachment of attachments) {
    if (!attachment.path.startsWith("attachments/") || attachment.path.includes("..") || paths.has(attachment.path)) {
      throw new TypeError(`Invalid or duplicate attachment path: ${attachment.path}`);
    }
    paths.add(attachment.path);
    const bytes = Uint8Array.from(attachment.bytes);
    entries.push({
      path: attachment.path,
      mediaType: attachment.mediaType,
      byteLength: bytes.byteLength,
      sha256: await sha256(bytes),
    });
    files[attachment.path] = base64Encode(bytes);
  }
  const envelope: KDrawEnvelopeV1 = {
    format: "application/vnd.kuubik.kdraw+json",
    manifest: { containerVersion: 1, documentPath: "document.json", createdAt, entries },
    files,
  };
  return encoder.encode(`${MAGIC}${JSON.stringify(envelope)}\n`);
}

export async function deserializeKDraw(bytes: Uint8Array): Promise<{
  document: KDrawDocumentV1;
  manifest: KDrawContainerManifestV1;
  attachments: Map<string, Uint8Array>;
}> {
  const text = new TextDecoder().decode(bytes);
  if (!text.startsWith(MAGIC)) throw new TypeError("Not a KDraw v1 container.");
  const envelope = JSON.parse(text.slice(MAGIC.length)) as KDrawEnvelopeV1;
  if (envelope.format !== "application/vnd.kuubik.kdraw+json" || envelope.manifest?.containerVersion !== 1) {
    throw new TypeError("Unsupported KDraw container version.");
  }
  const decoded = new Map<string, Uint8Array>();
  for (const entry of envelope.manifest.entries) {
    const encoded = envelope.files?.[entry.path];
    if (typeof encoded !== "string") throw new TypeError(`Missing KDraw entry: ${entry.path}`);
    const fileBytes = base64Decode(encoded);
    if (fileBytes.byteLength !== entry.byteLength) throw new TypeError(`KDraw size mismatch: ${entry.path}`);
    if ((await sha256(fileBytes)) !== entry.sha256) throw new TypeError(`KDraw checksum mismatch: ${entry.path}`);
    decoded.set(entry.path, fileBytes);
  }
  if (Object.keys(envelope.files).some((path) => !decoded.has(path))) {
    throw new TypeError("KDraw container has unmanifested files.");
  }
  const documentBytes = decoded.get(envelope.manifest.documentPath);
  if (!documentBytes) throw new TypeError("KDraw document.json is missing.");
  const document = JSON.parse(new TextDecoder().decode(documentBytes)) as unknown;
  assertKDrawDocumentV1(document);
  decoded.delete(envelope.manifest.documentPath);
  return { document, manifest: envelope.manifest, attachments: decoded };
}
