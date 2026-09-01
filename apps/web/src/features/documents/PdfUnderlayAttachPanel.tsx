import { useMemo, useState, type CSSProperties } from "react";
import {
  createPdfUnderlayPlacement,
  preparePdfUnderlay,
  type PdfUnderlayPlacementCandidate,
  type PreparedPdfUnderlay,
} from "@kuubik/cad-print";

export interface PdfUnderlayAttachPanelProps {
  attachmentId: string;
  placementId: string;
  currentLayerId: string;
  onAttach(prepared: PreparedPdfUnderlay, placement: PdfUnderlayPlacementCandidate): Promise<void>;
}

const fieldStyle: CSSProperties = { display: "grid", gap: 4, color: "#dbe7f3", fontSize: 13 };
const inputStyle: CSSProperties = { background: "#182532", color: "#f7fbff", border: "1px solid #52708b", borderRadius: 4, padding: "6px 8px" };

export function PdfUnderlayAttachPanel({ attachmentId, placementId, currentLayerId, onAttach }: PdfUnderlayAttachPanelProps) {
  const [file, setFile] = useState<File | null>(null);
  const [prepared, setPrepared] = useState<PreparedPdfUnderlay | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [x, setX] = useState(0);
  const [y, setY] = useState(0);
  const [scale, setScale] = useState(1);
  const [rotationDeg, setRotationDeg] = useState(0);
  const [opacityPercent, setOpacityPercent] = useState(100);
  const [fadePercent, setFadePercent] = useState(0);
  const [clip, setClip] = useState(false);
  const [status, setStatus] = useState("Vali PDF-fail.");
  const [busy, setBusy] = useState(false);

  const selectedPage = useMemo(() => prepared?.inspection.pages.find((page) => page.pageNumber === pageNumber) ?? null, [prepared, pageNumber]);

  async function selectFile(next: File | null): Promise<void> {
    setFile(next);
    setPrepared(null);
    if (!next) { setStatus("Vali PDF-fail."); return; }
    try {
      const inspected = await preparePdfUnderlay(new Uint8Array(await next.arrayBuffer()), { attachmentId, fileName: next.name });
      setPrepared(inspected);
      setPageNumber(1);
      setStatus(`Kontrollitud: ${inspected.inspection.pages.length} lk, ${inspected.bytes.byteLength} baiti.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  async function submit(): Promise<void> {
    if (!file || !prepared) return;
    setBusy(true);
    try {
      const placement = createPdfUnderlayPlacement(prepared, {
        id: placementId,
        pageNumber,
        position: { x, y },
        scale,
        rotationRad: rotationDeg * Math.PI / 180,
        opacity: opacityPercent / 100,
        fadePercent,
        layerId: currentLayerId,
        referencePath: file.name,
        referenceMode: "linked-copy",
        ...(clip ? { clipBoundary: [{ x: 0.1, y: 0.1 }, { x: 0.9, y: 0.1 }, { x: 0.9, y: 0.9 }, { x: 0.1, y: 0.9 }] } : {}),
      });
      await onAttach(prepared, placement);
      setStatus(`Lisatud leht ${pageNumber}; SHA-256 ${prepared.attachment.sha256.slice(0, 12)}…`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form aria-label="PDF underlay attach" onSubmit={(event) => event.preventDefault()} style={{ display: "grid", gap: 12, padding: 16, background: "#101a24", border: "1px solid #355169", borderRadius: 8, width: 520 }}>
      <strong style={{ color: "#f7fbff" }}>PDF alusjoonise lisamine</strong>
      <label style={fieldStyle}>PDF-fail
        <input aria-label="PDF file" type="file" accept="application/pdf,.pdf" disabled={busy} onChange={(event) => void selectFile(event.currentTarget.files?.[0] ?? null)} style={inputStyle} />
      </label>
      {prepared && <label style={fieldStyle}>Lehekülg
        <select aria-label="PDF page" value={pageNumber} onChange={(event) => setPageNumber(Number(event.target.value))} style={inputStyle}>
          {prepared.inspection.pages.map((page) => <option key={page.pageNumber} value={page.pageNumber}>{page.pageNumber} — {page.widthMm.toFixed(1)} × {page.heightMm.toFixed(1)} mm</option>)}
        </select>
      </label>}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
        <label style={fieldStyle}>X mm<input aria-label="Insertion X" type="number" value={x} onChange={(event) => setX(Number(event.target.value))} style={inputStyle} /></label>
        <label style={fieldStyle}>Y mm<input aria-label="Insertion Y" type="number" value={y} onChange={(event) => setY(Number(event.target.value))} style={inputStyle} /></label>
        <label style={fieldStyle}>Mõõtkava<input aria-label="PDF scale" type="number" min="0.000001" step="0.1" value={scale} onChange={(event) => setScale(Number(event.target.value))} style={inputStyle} /></label>
        <label style={fieldStyle}>Pööre °<input aria-label="PDF rotation" type="number" value={rotationDeg} onChange={(event) => setRotationDeg(Number(event.target.value))} style={inputStyle} /></label>
        <label style={fieldStyle}>Läbipaistmatus %<input aria-label="PDF opacity" type="number" min="0" max="100" value={opacityPercent} onChange={(event) => setOpacityPercent(Number(event.target.value))} style={inputStyle} /></label>
        <label style={fieldStyle}>Fade %<input aria-label="PDF fade" type="number" min="0" max="100" value={fadePercent} onChange={(event) => setFadePercent(Number(event.target.value))} style={inputStyle} /></label>
      </div>
      <label style={{ ...fieldStyle, display: "flex", alignItems: "center", gap: 8 }}><input aria-label="Clip PDF" type="checkbox" checked={clip} onChange={(event) => setClip(event.target.checked)} /> Kärbi 10% servadest</label>
      <button type="button" onClick={() => void submit()} disabled={!prepared || !selectedPage || busy} style={{ ...inputStyle, background: "#1666a8", cursor: "pointer" }}>{busy ? "Lisan…" : "Lisa PDF alusjoonis"}</button>
      <output aria-live="polite" data-testid="pdf-status" style={{ color: status.includes("Lisatud") || status.includes("Kontrollitud") ? "#80e0a7" : "#ffd58a", fontSize: 13 }}>{status}</output>
    </form>
  );
}
