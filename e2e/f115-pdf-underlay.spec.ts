import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { createEmptyDocument } from "@kuubik/cad-core";
import { exportLayoutsVectorPdf } from "@kuubik/cad-print";

function syntheticPdf(): Buffer {
  const document = createEmptyDocument({ documentId: "f115-e2e-source", now: "2026-09-01T08:00:00.000Z" });
  const pageSetup = (mediaName: string, orientation: "portrait" | "landscape") => ({
    mediaName, orientation, plotArea: { kind: "layout" as const }, plotScale: { mode: "fit" as const },
    centerPlot: false, plotOriginMm: { x: 0, y: 0 },
  });
  document.layouts.push(
    { id: "a4", name: "F-115 PAGE 1", kind: "paper", paper: { widthMm: 210, heightMm: 297, marginsMm: { top: 0, right: 0, bottom: 0, left: 0 } }, pageSetup: pageSetup("ISO_A4", "portrait"), viewports: [], entities: [
      { kind: "line", handle: "P1-A", layerId: "0", start: { x: 10, y: 10 }, end: { x: 200, y: 287 }, appearance: { color: "#1266a8" } },
      { kind: "text", handle: "P1-T", layerId: "0", position: { x: 20, y: 270 }, height: 10, text: "F-115 PAGE 1", rotationRad: 0 },
    ] },
    { id: "a3", name: "F-115 PAGE 2", kind: "paper", paper: { widthMm: 420, heightMm: 297, marginsMm: { top: 0, right: 0, bottom: 0, left: 0 } }, pageSetup: pageSetup("ISO_A3", "landscape"), viewports: [], entities: [
      { kind: "line", handle: "P2-A", layerId: "0", start: { x: 10, y: 10 }, end: { x: 410, y: 287 }, appearance: { color: "#1266a8" } },
      { kind: "line", handle: "P2-B", layerId: "0", start: { x: 10, y: 287 }, end: { x: 410, y: 10 }, appearance: { color: "#1266a8" } },
      { kind: "text", handle: "P2-T", layerId: "0", position: { x: 25, y: 270 }, height: 12, text: "F-115 PAGE 2", rotationRad: 0 },
    ] },
  );
  return Buffer.from(exportLayoutsVectorPdf(document, ["a4", "a3"]).bytes);
}

test("F-115 visibly attaches page 2, persists transforms, recovers, and enforces layer rules", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", (error) => errors.push(error.message));
  const path = "/src/features/documents/pdf-underlay-visible-harness.html?db=f115-e2e&reset=1";
  const fixtureBytes = process.env.F115_PDF_FIXTURE
    ? await readFile(resolve(process.env.F115_PDF_FIXTURE))
    : syntheticPdf();
  const fixturePageCount = (fixtureBytes.toString("latin1").match(/\/Type \/Page\b/gu) ?? []).length;
  const fixtureSha256 = createHash("sha256").update(fixtureBytes).digest("hex");
  await page.goto(path);
  await expect(page.getByText("PDF alusjoonise lisamine")).toBeVisible();
  await page.getByLabel("PDF file").setInputFiles({ name: "f115-synthetic-underlay.pdf", mimeType: "application/pdf", buffer: fixtureBytes });
  await expect(page.getByTestId("pdf-status")).toContainText(`Kontrollitud: ${fixturePageCount} lk`);
  await page.getByLabel("PDF page").selectOption("2");
  await page.getByLabel("Insertion X").fill("25");
  await page.getByLabel("Insertion Y").fill("40");
  await page.getByLabel("PDF scale").fill("0.5");
  await page.getByLabel("PDF rotation").fill("30");
  await page.getByLabel("PDF opacity").fill("80");
  await page.getByLabel("PDF fade").fill("25");
  await page.getByLabel("Clip PDF").check();
  await page.getByRole("button", { name: "Lisa PDF alusjoonis" }).click();

  const underlay = page.getByLabel("PDF underlay page 2");
  await expect(underlay).toBeVisible();
  await expect(underlay).toHaveAttribute("data-effective-opacity", "0.6000000000000001");
  await expect(underlay).toHaveAttribute("data-clipped", "true");
  await expect(underlay).toHaveAttribute("data-page-number", "2");
  await expect(page.getByTestId("pdf-readback")).toContainText('"referencePath": "f115-synthetic-underlay.pdf"');
  await expect(page.getByTestId("pdf-readback")).toContainText('"revision": 1');

  await page.goto("/src/features/documents/pdf-underlay-visible-harness.html?db=f115-e2e");
  await expect(page.getByLabel("PDF underlay page 2")).toBeVisible();
  await expect(page.getByTestId("pdf-readback")).toContainText('"revision": 1');
  await expect(page.getByTestId("pdf-readback")).toContainText(`"pageCount": ${fixturePageCount}`);

  await page.getByRole("button", { name: "Fade 40%" }).click();
  await expect(page.getByLabel("PDF underlay page 2")).toHaveAttribute("data-effective-opacity", "0.48");
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByLabel("PDF underlay page 2")).toHaveAttribute("data-effective-opacity", "0.6000000000000001");
  await page.getByRole("button", { name: "Redo" }).click();
  await expect(page.getByLabel("PDF underlay page 2")).toHaveAttribute("data-effective-opacity", "0.48");

  await page.getByRole("button", { name: "Lukusta kiht" }).click();
  await expect(page.getByTestId("pdf-readback")).toContainText('"reason": "layer-locked"');
  await page.getByRole("button", { name: "Muuda lukus" }).click();
  await expect(page.getByTestId("harness-status")).toContainText("layer-locked");
  await expect(page.getByTestId("pdf-readback")).toContainText('"revision": 5');
  await page.getByRole("button", { name: "Ava kiht" }).click();

  await page.getByRole("button", { name: "Kiht off" }).click();
  await expect(page.getByTestId("pdf-canvas")).toHaveAttribute("data-layer-rendered", "false");
  await expect(page.getByLabel("PDF underlay page 2")).toHaveCount(0);
  await page.getByRole("button", { name: "Kiht on" }).click();
  await expect(page.getByLabel("PDF underlay page 2")).toBeVisible();
  await page.getByRole("button", { name: "Freeze" }).click();
  await expect(page.getByTestId("pdf-canvas")).toHaveAttribute("data-layer-rendered", "false");
  await page.getByRole("button", { name: "Thaw" }).click();
  await expect(page.getByLabel("PDF underlay page 2")).toBeVisible();
  expect(errors).toEqual([]);

  if (process.env.PARITY_CAPTURE_DIR) {
    const captureDir = resolve(process.env.PARITY_CAPTURE_DIR);
    await mkdir(captureDir, { recursive: true });
    const readback = JSON.parse(await page.getByTestId("pdf-readback").innerText()) as Record<string, unknown>;
    await Promise.all([
      page.getByTestId("pdf-canvas").screenshot({ path: resolve(captureDir, "F-115-browser-underlay.png") }),
      writeFile(resolve(captureDir, "F-115-browser-readback.json"), `${JSON.stringify({
        schemaVersion: 1,
        rowId: "F-115",
        engine: "production Chromium",
        action: "visible file upload -> page 2 -> insertion/scale/rotation -> clip/fade -> reload -> Undo/Redo -> locked/off/frozen layer checks",
        source: { fileName: "f115-synthetic-underlay.pdf", byteLength: fixtureBytes.byteLength, sha256: fixtureSha256, pageCount: fixturePageCount },
        readback,
        assertions: { visibleAttach: true, reload: true, undoRedo: true, lockedRejected: true, offHidden: true, frozenHidden: true },
        consoleErrors: errors,
      }, null, 2)}\n`, "utf8"),
    ]);
  }
});
