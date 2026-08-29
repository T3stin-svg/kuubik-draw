import { Buffer } from "node:buffer";

function rebuildPdf(objects, rootObject = 1) {
  const sorted = [...objects].sort((left, right) => left.number - right.number);
  const maximum = sorted.at(-1)?.number ?? 0;
  const chunks = [Buffer.from("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n", "latin1")];
  const offsets = new Map();
  let length = chunks[0].length;
  for (const object of sorted) {
    offsets.set(object.number, length);
    const chunk = Buffer.from(`${object.number} 0 obj\n${object.body}\nendobj\n`, "latin1");
    chunks.push(chunk);
    length += chunk.length;
  }
  const xrefOffset = length;
  const xref = [`xref\n0 ${maximum + 1}\n`, "0000000000 65535 f \n"];
  for (let number = 1; number <= maximum; number += 1) {
    const offset = offsets.get(number);
    xref.push(offset === undefined ? "0000000000 00000 f \n" : `${String(offset).padStart(10, "0")} 00000 n \n`);
  }
  xref.push(`trailer\n<< /Size ${maximum + 1} /Root ${rootObject} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);
  chunks.push(Buffer.from(xref.join(""), "latin1"));
  return new Uint8Array(Buffer.concat(chunks));
}

export function injectReferencedImageXObject(pdfBytes) {
  const text = Buffer.from(pdfBytes).toString("latin1");
  const objects = [];
  const objectPattern = /(?:^|\n)(\d+) 0 obj\n([\s\S]*?)\nendobj(?=\n|$)/gu;
  for (const match of text.matchAll(objectPattern)) objects.push({ number: Number(match[1]), body: match[2] });
  if (objects.length === 0) throw new Error("F-114 image mutant could not parse source objects.");
  const imageObject = Math.max(...objects.map((object) => object.number)) + 1;
  const page = objects.find((object) => /\/Type \/Page(?:\s|\/)/u.test(object.body));
  if (!page) throw new Error("F-114 image mutant could not locate the first page.");
  const resources = /\/ExtGState <<([^>]*)>> >> \/Contents/u;
  if (!resources.test(page.body)) throw new Error("F-114 image mutant could not locate page resources.");
  page.body = page.body.replace(resources, `/ExtGState <<$1>> /XObject << /ImMutation ${imageObject} 0 R >> >> /Contents`);
  const pixel = Buffer.from([0, 0, 0]).toString("latin1");
  objects.push({
    number: imageObject,
    body: `<< /Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Length 3 >>\nstream\n${pixel}\nendstream`,
  });
  return rebuildPdf(objects);
}
