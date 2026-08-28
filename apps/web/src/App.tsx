import { useEffect, useMemo, useRef, useState } from "react";
import { allocateEntityHandles, CadCommandInputError, CadSession, createEmptyDocument, parseCartesianPoint, parseCopyDestinations, parseMoveDestination, parseReferenceAngleInput, parseRotationAngleInput, parseScaleFactorInput, parseScaleLengthInput, resolveCadCommand, type CadChange, type CopyRejectedTarget, type MirrorRejectedTarget, type MoveRejectedTarget, type RotateAngleSpec, type RotateRejectedTarget, type ScaleFactorSpec, type ScaleRejectedTarget } from "@kuubik/cad-core";
import { exportDxf } from "@kuubik/cad-dxf";
import { CadCanvasRenderer } from "@kuubik/cad-renderer";
import type { CadEntity, KDrawDocumentV1 } from "@kuubik/cad-schema";
import { KDrawIndexedDb, StorageRevisionConflictError } from "./indexed-db.js";
import "./style.css";

const LOCAL_DOCUMENT_ID = "local";

function nextInteractiveHandle(document: KDrawDocumentV1): string {
  const preferred = (document.revision + 16).toString(16).toUpperCase();
  return document.entities.some((entity) => entity.handle.toUpperCase() === preferred)
    ? allocateEntityHandles(document, 1)[0]!
    : preferred;
}

function rotateAngleSpec(
  mode: "relative" | "reference",
  basePoint: { x: number; y: number },
  angleInput: string,
  referenceInput: string,
  newAngleInput: string,
): RotateAngleSpec {
  if (mode === "relative") {
    return { mode, angleDeg: parseRotationAngleInput(angleInput, basePoint) };
  }
  return {
    mode,
    referenceAngleDeg: parseReferenceAngleInput(referenceInput, basePoint),
    newAngleDeg: parseRotationAngleInput(newAngleInput, basePoint),
  };
}

function scaleFactorSpec(
  mode: "factor" | "reference",
  basePoint: { x: number; y: number },
  factorInput: string,
  referenceInput: string,
  newLengthInput: string,
): ScaleFactorSpec {
  if (mode === "factor") {
    return { mode, factor: parseScaleFactorInput(factorInput, basePoint) };
  }
  return {
    mode,
    referenceLength: parseScaleLengthInput(referenceInput, basePoint),
    newLength: parseScaleLengthInput(newLengthInput, basePoint),
  };
}

export function App() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const database = useMemo(() => new KDrawIndexedDb(), []);
  const session = useRef(new CadSession(createEmptyDocument({ documentId: LOCAL_DOCUMENT_ID })));
  const committing = useRef(false);
  const [document, setDocument] = useState<KDrawDocumentV1>(session.current.document);
  const [status, setStatus] = useState("Uus kohalik dokument");
  const [firstCornerInput, setFirstCornerInput] = useState("100,200");
  const [otherCornerInput, setOtherCornerInput] = useState("600,900");
  const [selectedHandles, setSelectedHandles] = useState<string[]>([]);
  const [moveBaseInput, setMoveBaseInput] = useState("100,200");
  const [moveDestinationInput, setMoveDestinationInput] = useState("600,950");
  const [moveAwaitingSelection, setMoveAwaitingSelection] = useState(false);
  const [lastMoveRejected, setLastMoveRejected] = useState<MoveRejectedTarget[]>([]);
  const [copyBaseInput, setCopyBaseInput] = useState("100,200");
  const [copyDestinationsInput, setCopyDestinationsInput] = useState("600,950; -200,300");
  const [copyAwaitingSelection, setCopyAwaitingSelection] = useState(false);
  const [lastCopyRejected, setLastCopyRejected] = useState<CopyRejectedTarget[]>([]);
  const [rotateBaseInput, setRotateBaseInput] = useState("100,200");
  const [rotateMode, setRotateMode] = useState<"relative" | "reference">("relative");
  const [rotateAngleInput, setRotateAngleInput] = useState("90");
  const [rotateReferenceInput, setRotateReferenceInput] = useState("100,200; 1100,1200");
  const [rotateNewAngleInput, setRotateNewAngleInput] = useState("135");
  const [rotateAwaitingSelection, setRotateAwaitingSelection] = useState(false);
  const [lastRotateRejected, setLastRotateRejected] = useState<RotateRejectedTarget[]>([]);
  const [scaleBaseInput, setScaleBaseInput] = useState("100,200");
  const [scaleMode, setScaleMode] = useState<"factor" | "reference">("factor");
  const [scaleFactorInput, setScaleFactorInput] = useState("2");
  const [scaleReferenceInput, setScaleReferenceInput] = useState("100,200; 1100,200");
  const [scaleNewLengthInput, setScaleNewLengthInput] = useState("2000");
  const [scaleCopy, setScaleCopy] = useState(false);
  const [scaleAwaitingSelection, setScaleAwaitingSelection] = useState(false);
  const [lastScaleRejected, setLastScaleRejected] = useState<ScaleRejectedTarget[]>([]);
  const [mirrorFirstPointInput, setMirrorFirstPointInput] = useState("1500,-500");
  const [mirrorSecondPointInput, setMirrorSecondPointInput] = useState("1500,1500");
  const [mirrorEraseSource, setMirrorEraseSource] = useState(false);
  const [mirrorAwaitingSelection, setMirrorAwaitingSelection] = useState(false);
  const [lastMirrorRejected, setLastMirrorRejected] = useState<MirrorRejectedTarget[]>([]);
  const [previewCommand, setPreviewCommand] = useState<"MOVE" | "COPY" | "ROTATE" | "SCALE" | "MIRROR">("MOVE");
  const activeLayer = document.layers.find((layer) => layer.id === document.currentLayerId)!;
  const movePreview = useMemo((): { entities: CadEntity[]; delta: { x: number; y: number } } | null => {
    if (previewCommand !== "MOVE" || selectedHandles.length === 0) return null;
    try {
      const command = resolveCadCommand("MOVE");
      if (!command || command.id !== "MOVE") return null;
      const basePoint = parseCartesianPoint(moveBaseInput);
      const destinationPoint = parseMoveDestination(moveDestinationInput, basePoint);
      const result = command.execute(document, { targetHandles: selectedHandles, basePoint, destinationPoint });
      return {
        entities: result.changes.flatMap((change) => change.type === "put" ? [change.entity] : []),
        delta: result.delta,
      };
    } catch {
      return null;
    }
  }, [document, moveBaseInput, moveDestinationInput, previewCommand, selectedHandles]);
  const copyPreview = useMemo((): { entities: CadEntity[]; deltas: { x: number; y: number }[] } | null => {
    if (previewCommand !== "COPY" || selectedHandles.length === 0) return null;
    try {
      const command = resolveCadCommand("COPY");
      if (!command || command.id !== "COPY") return null;
      const basePoint = parseCartesianPoint(copyBaseInput);
      const destinationPoints = parseCopyDestinations(copyDestinationsInput, basePoint);
      const result = command.execute(document, { targetHandles: selectedHandles, basePoint, destinationPoints });
      return {
        entities: result.changes.flatMap((change) => change.type === "put" ? [change.entity] : []),
        deltas: result.deltas,
      };
    } catch {
      return null;
    }
  }, [copyBaseInput, copyDestinationsInput, document, previewCommand, selectedHandles]);
  const rotatePreview = useMemo((): { entities: CadEntity[]; deltaAngleDeg: number } | null => {
    if (previewCommand !== "ROTATE" || selectedHandles.length === 0) return null;
    try {
      const command = resolveCadCommand("ROTATE");
      if (!command || command.id !== "ROTATE") return null;
      const basePoint = parseCartesianPoint(rotateBaseInput);
      const angle = rotateAngleSpec(rotateMode, basePoint, rotateAngleInput, rotateReferenceInput, rotateNewAngleInput);
      const result = command.execute(document, { targetHandles: selectedHandles, basePoint, angle });
      return {
        entities: result.changes.flatMap((change) => change.type === "put" ? [change.entity] : []),
        deltaAngleDeg: result.deltaAngleDeg,
      };
    } catch {
      return null;
    }
  }, [document, previewCommand, rotateAngleInput, rotateBaseInput, rotateMode, rotateNewAngleInput, rotateReferenceInput, selectedHandles]);
  const scalePreview = useMemo((): { entities: CadEntity[]; factor: number; copy: boolean } | null => {
    if (previewCommand !== "SCALE" || selectedHandles.length === 0) return null;
    try {
      const command = resolveCadCommand("SCALE");
      if (!command || command.id !== "SCALE") return null;
      const basePoint = parseCartesianPoint(scaleBaseInput);
      const scale = scaleFactorSpec(scaleMode, basePoint, scaleFactorInput, scaleReferenceInput, scaleNewLengthInput);
      const result = command.execute(document, { targetHandles: selectedHandles, basePoint, scale, copy: scaleCopy });
      return {
        entities: result.changes.flatMap((change) => change.type === "put" ? [change.entity] : []),
        factor: result.factor,
        copy: result.copy,
      };
    } catch {
      return null;
    }
  }, [document, previewCommand, scaleBaseInput, scaleCopy, scaleFactorInput, scaleMode, scaleNewLengthInput, scaleReferenceInput, selectedHandles]);
  const mirrorPreview = useMemo((): { entities: CadEntity[]; eraseSource: boolean; sourceHandles: string[] } | null => {
    if (previewCommand !== "MIRROR" || selectedHandles.length === 0) return null;
    try {
      const command = resolveCadCommand("MIRROR");
      if (!command || command.id !== "MIRROR") return null;
      const axisStart = parseCartesianPoint(mirrorFirstPointInput);
      const axisEnd = parseCartesianPoint(mirrorSecondPointInput);
      const result = command.execute(document, { targetHandles: selectedHandles, axisStart, axisEnd, eraseSource: mirrorEraseSource });
      return {
        entities: result.changes.flatMap((change) => change.type === "put" ? [change.entity] : []),
        eraseSource: result.eraseSource,
        sourceHandles: result.sourceHandles,
      };
    } catch {
      return null;
    }
  }, [document, mirrorEraseSource, mirrorFirstPointInput, mirrorSecondPointInput, previewCommand, selectedHandles]);

  useEffect(() => {
    let active = true;
    void (async () => {
      await database.open();
      const stored = await database.loadDocument(LOCAL_DOCUMENT_ID);
      if (!active || !stored) return;
      const operations = await database.operations(LOCAL_DOCUMENT_ID);
      if (!active) return;
      session.current = new CadSession(stored, operations.map((entry) => entry.opId));
      setDocument(session.current.document);
      setStatus(`Taastatud revision ${stored.revision}`);
    })();
    return () => {
      active = false;
      database.close();
    };
  }, [database]);

  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const context = element.getContext("2d");
    if (!context) return;
    const ratio = window.devicePixelRatio || 1;
    element.width = Math.round(element.clientWidth * ratio);
    element.height = Math.round(element.clientHeight * ratio);
    const renderer = new CadCanvasRenderer();
    renderer.setBlocks(document.blocks);
    renderer.setEntities(document.entities);
    renderer.render(context, {
      world: { minX: -500, minY: -500, maxX: 2500, maxY: 2500 },
      widthPx: element.clientWidth,
      heightPx: element.clientHeight,
      devicePixelRatio: ratio,
    }, document.layers, [...(movePreview?.entities ?? []), ...(copyPreview?.entities ?? []), ...(rotatePreview?.entities ?? []), ...(scalePreview?.entities ?? []), ...(mirrorPreview?.entities ?? [])], mirrorPreview?.eraseSource ? mirrorPreview.sourceHandles : []);
  }, [copyPreview, document, mirrorPreview, movePreview, rotatePreview, scalePreview]);

  async function recoverFromStorageConflict(error: unknown): Promise<void> {
    if (!(error instanceof StorageRevisionConflictError)) throw error;
    const stored = await database.loadDocument(document.documentId);
    if (!stored) return;
    const operations = await database.operations(stored.documentId);
    session.current = new CadSession(stored, operations.map((entry) => entry.opId));
    setDocument(stored);
    setStatus(`Teine vaheleht muutis dokumenti; taastatud revision ${stored.revision}`);
  }

  async function addSyntheticLine(): Promise<void> {
    if (committing.current) return;
    committing.current = true;
    try {
      const handle = nextInteractiveHandle(document);
      const args = { start: { x: 10, y: 10 + document.revision * 5 }, end: { x: 180, y: 90 } };
      await commitChanges("LINE", args, [{
        type: "put",
        entity: { kind: "line", handle, layerId: document.currentLayerId, start: args.start, end: args.end },
      }], [handle]);
    } catch (error) {
      await recoverFromStorageConflict(error);
    } finally {
      committing.current = false;
    }
  }

  async function commitChanges(
    commandId: string,
    args: unknown,
    changes: CadChange[],
    resultHandles: string[],
    targetHandles: string[] = [],
  ): Promise<void> {
    const operation = {
      opId: crypto.randomUUID(),
      baseRevision: document.revision,
      commandId,
      args,
      targetHandles,
      resultHandles,
    };
    const candidate = new CadSession(document, (await database.operations(document.documentId)).map((entry) => entry.opId));
    candidate.commit(operation, changes);
    const next = candidate.document;
    await database.commitRevision(next, operation);
    session.current = candidate;
    setDocument(next);
    setStatus(`${commandId} salvestatud, revision ${next.revision}`);
  }

  async function addRectangle(): Promise<void> {
    if (committing.current) return;
    committing.current = true;
    try {
      const command = resolveCadCommand("RECTANG");
      if (!command || command.id !== "RECTANGLE") throw new Error("RECTANGLE command is missing from the registry.");
      const handle = nextInteractiveHandle(document);
      const args = {
        handle,
        layerId: document.currentLayerId,
        firstCorner: parseCartesianPoint(firstCornerInput),
        otherCorner: parseCartesianPoint(otherCornerInput),
      };
      await commitChanges(command.id, args, command.execute(args), [handle]);
    } catch (error) {
      if (error instanceof StorageRevisionConflictError) {
        await recoverFromStorageConflict(error);
      } else if (error instanceof CadCommandInputError) {
        setStatus(`RECTANGLE viga: ${error.message}`);
      } else {
        throw error;
      }
    } finally {
      committing.current = false;
    }
  }

  function selectAll(): void {
    const handles = document.entities.map((entity) => entity.handle);
    setSelectedHandles(handles);
    if (mirrorAwaitingSelection) setStatus(`${handles.length} objekti valitud; MIRROR: määra peegeldusjoon ja lähteobjektide valik`);
    else if (scaleAwaitingSelection) setStatus(`${handles.length} objekti valitud; SCALE: määra baaspunkt ja mõõtkava`);
    else if (rotateAwaitingSelection) setStatus(`${handles.length} objekti valitud; ROTATE: määra baaspunkt ja nurk`);
    else if (copyAwaitingSelection) setStatus(`${handles.length} objekti valitud; COPY: määra baaspunkt ja sihtpunkt(id)`);
    else if (moveAwaitingSelection) setStatus(`${handles.length} objekti valitud; MOVE: määra baaspunkt ja sihtpunkt`);
    else setStatus(`${handles.length} objekti valitud`);
  }

  async function moveSelected(): Promise<void> {
    if (committing.current) return;
    setPreviewCommand("MOVE");
    if (selectedHandles.length === 0) {
      setCopyAwaitingSelection(false);
      setRotateAwaitingSelection(false);
      setScaleAwaitingSelection(false);
      setMirrorAwaitingSelection(false);
      setMoveAwaitingSelection(true);
      setStatus("MOVE: vali objektid, seejärel kinnita valik ja punktid");
      return;
    }
    committing.current = true;
    try {
      const command = resolveCadCommand("MOVE");
      if (!command || command.id !== "MOVE") throw new Error("MOVE command is missing from the registry.");
      const basePoint = parseCartesianPoint(moveBaseInput);
      const destinationPoint = parseMoveDestination(moveDestinationInput, basePoint);
      const result = command.execute(document, { targetHandles: selectedHandles, basePoint, destinationPoint });
      setLastMoveRejected(result.rejected);
      setMoveAwaitingSelection(false);
      if (result.changes.length === 0) {
        const suffix = result.rejected.length ? `; ${result.rejected.length} lukus, puudu või toetamata` : "";
        setStatus(`MOVE ei muutnud geomeetriat${suffix}`);
        return;
      }
      await commitChanges(command.id, { basePoint, destinationPoint }, result.changes, result.movedHandles, result.movedHandles);
      setSelectedHandles([]);
      const suffix = result.rejected.length ? `; ${result.rejected.length} jäi muutmata` : "";
      setStatus(`${result.movedHandles.length} objekti nihutatud Δ${result.delta.x},${result.delta.y}${suffix}`);
    } catch (error) {
      if (error instanceof StorageRevisionConflictError) await recoverFromStorageConflict(error);
      else if (error instanceof CadCommandInputError) setStatus(`MOVE viga: ${error.message}`);
      else throw error;
    } finally {
      committing.current = false;
    }
  }

  async function copySelected(): Promise<void> {
    if (committing.current) return;
    setPreviewCommand("COPY");
    if (selectedHandles.length === 0) {
      setMoveAwaitingSelection(false);
      setRotateAwaitingSelection(false);
      setScaleAwaitingSelection(false);
      setMirrorAwaitingSelection(false);
      setCopyAwaitingSelection(true);
      setStatus("COPY: vali objektid, seejärel kinnita valik ja punktid");
      return;
    }
    committing.current = true;
    try {
      const command = resolveCadCommand("COPY");
      if (!command || command.id !== "COPY") throw new Error("COPY command is missing from the registry.");
      const basePoint = parseCartesianPoint(copyBaseInput);
      const destinationPoints = parseCopyDestinations(copyDestinationsInput, basePoint);
      const result = command.execute(document, { targetHandles: selectedHandles, basePoint, destinationPoints });
      setLastCopyRejected(result.rejected);
      setCopyAwaitingSelection(false);
      if (result.changes.length === 0) {
        const suffix = result.rejected.length ? `; ${result.rejected.length} lukus, puudu või toetamata` : "";
        setStatus(`COPY ei loonud geomeetriat${suffix}`);
        return;
      }
      await commitChanges(
        command.id,
        { basePoint, destinationPoints },
        result.changes,
        result.copiedHandles,
        result.sourceHandles,
      );
      setSelectedHandles([]);
      const suffix = result.rejected.length ? `; ${result.rejected.length} jäi kopeerimata` : "";
      setStatus(`${result.copiedHandles.length} koopiat loodud · ${result.deltas.length} paigutust${suffix}`);
    } catch (error) {
      if (error instanceof StorageRevisionConflictError) await recoverFromStorageConflict(error);
      else if (error instanceof CadCommandInputError) setStatus(`COPY viga: ${error.message}`);
      else throw error;
    } finally {
      committing.current = false;
    }
  }

  async function rotateSelected(): Promise<void> {
    if (committing.current) return;
    setPreviewCommand("ROTATE");
    if (selectedHandles.length === 0) {
      setMoveAwaitingSelection(false);
      setCopyAwaitingSelection(false);
      setScaleAwaitingSelection(false);
      setMirrorAwaitingSelection(false);
      setRotateAwaitingSelection(true);
      setStatus("ROTATE: vali objektid, seejärel kinnita valik, baaspunkt ja nurk");
      return;
    }
    committing.current = true;
    try {
      const command = resolveCadCommand("ROTATE");
      if (!command || command.id !== "ROTATE") throw new Error("ROTATE command is missing from the registry.");
      const basePoint = parseCartesianPoint(rotateBaseInput);
      const angle = rotateAngleSpec(rotateMode, basePoint, rotateAngleInput, rotateReferenceInput, rotateNewAngleInput);
      const result = command.execute(document, { targetHandles: selectedHandles, basePoint, angle });
      setLastRotateRejected(result.rejected);
      setRotateAwaitingSelection(false);
      if (result.changes.length === 0) {
        const suffix = result.rejected.length ? `; ${result.rejected.length} lukus, puudu või toetamata` : "";
        setStatus(`ROTATE ei muutnud geomeetriat${suffix}`);
        return;
      }
      await commitChanges(
        command.id,
        { basePoint, angle, deltaAngleDeg: result.deltaAngleDeg },
        result.changes,
        result.rotatedHandles,
        result.rotatedHandles,
      );
      setSelectedHandles([]);
      const suffix = result.rejected.length ? `; ${result.rejected.length} jäi muutmata` : "";
      setStatus(`${result.rotatedHandles.length} objekti pööratud ${result.deltaAngleDeg}°${suffix}`);
    } catch (error) {
      if (error instanceof StorageRevisionConflictError) await recoverFromStorageConflict(error);
      else if (error instanceof CadCommandInputError) setStatus(`ROTATE viga: ${error.message}`);
      else throw error;
    } finally {
      committing.current = false;
    }
  }

  async function scaleSelected(): Promise<void> {
    if (committing.current) return;
    setPreviewCommand("SCALE");
    if (selectedHandles.length === 0) {
      setMoveAwaitingSelection(false);
      setCopyAwaitingSelection(false);
      setRotateAwaitingSelection(false);
      setMirrorAwaitingSelection(false);
      setScaleAwaitingSelection(true);
      setStatus("SCALE: vali objektid, seejärel kinnita valik, baaspunkt ja mõõtkava");
      return;
    }
    committing.current = true;
    try {
      const command = resolveCadCommand("SCALE");
      if (!command || command.id !== "SCALE") throw new Error("SCALE command is missing from the registry.");
      const basePoint = parseCartesianPoint(scaleBaseInput);
      const scale = scaleFactorSpec(scaleMode, basePoint, scaleFactorInput, scaleReferenceInput, scaleNewLengthInput);
      const result = command.execute(document, { targetHandles: selectedHandles, basePoint, scale, copy: scaleCopy });
      setLastScaleRejected(result.rejected);
      setScaleAwaitingSelection(false);
      if (result.changes.length === 0) {
        if (result.factor === 1 && !result.copy && result.sourceHandles.length > 0) {
          await commitChanges(
            command.id,
            { basePoint, scale, factor: result.factor, copy: false, geometryNoOp: true },
            [{ type: "undo-mark" }],
            [],
            result.sourceHandles,
          );
          setSelectedHandles([]);
          const suffix = result.rejected.length ? `; ${result.rejected.length} jäi muutmata` : "";
          setStatus(`SCALE ×1 kinnitatud; geomeetria muutumata${suffix}`);
          return;
        }
        const suffix = result.rejected.length ? `; ${result.rejected.length} lukus, puudu või toetamata` : "";
        setStatus(`SCALE ei muutnud geomeetriat${suffix}`);
        return;
      }
      const resultHandles = result.copy ? result.createdHandles : result.scaledHandles;
      await commitChanges(
        command.id,
        { basePoint, scale, factor: result.factor, copy: result.copy },
        result.changes,
        resultHandles,
        result.sourceHandles,
      );
      setSelectedHandles([]);
      const suffix = result.rejected.length ? `; ${result.rejected.length} jäi muutmata` : "";
      setStatus(`${resultHandles.length} objekti ${result.copy ? "kopeeritud ja " : ""}skaleeritud ×${result.factor}${suffix}`);
    } catch (error) {
      if (error instanceof StorageRevisionConflictError) await recoverFromStorageConflict(error);
      else if (error instanceof CadCommandInputError) setStatus(`SCALE viga: ${error.message}`);
      else throw error;
    } finally {
      committing.current = false;
    }
  }

  async function mirrorSelected(): Promise<void> {
    if (committing.current) return;
    setPreviewCommand("MIRROR");
    if (selectedHandles.length === 0) {
      setMoveAwaitingSelection(false);
      setCopyAwaitingSelection(false);
      setRotateAwaitingSelection(false);
      setScaleAwaitingSelection(false);
      setMirrorAwaitingSelection(true);
      setStatus("MIRROR: vali objektid, seejärel kinnita valik ja peegeldusjoon");
      return;
    }
    committing.current = true;
    try {
      const command = resolveCadCommand("MIRROR");
      if (!command || command.id !== "MIRROR") throw new Error("MIRROR command is missing from the registry.");
      const axisStart = parseCartesianPoint(mirrorFirstPointInput);
      const axisEnd = parseCartesianPoint(mirrorSecondPointInput);
      const result = command.execute(document, {
        targetHandles: selectedHandles,
        axisStart,
        axisEnd,
        eraseSource: mirrorEraseSource,
      });
      setLastMirrorRejected(result.rejected);
      setMirrorAwaitingSelection(false);
      if (result.changes.length === 0) {
        const suffix = result.rejected.length ? `; ${result.rejected.length} lukus, puudu või toetamata` : "";
        setStatus(`MIRROR ei loonud geomeetriat${suffix}`);
        return;
      }
      await commitChanges(
        command.id,
        { axisStart, axisEnd, eraseSource: result.eraseSource, mirrtext: 0 },
        result.changes,
        result.mirroredHandles,
        result.sourceHandles,
      );
      setSelectedHandles([]);
      const suffix = result.rejected.length ? `; ${result.rejected.length} jäi muutmata` : "";
      setStatus(`${result.mirroredHandles.length} objekti peegeldatud; lähteobjektid ${result.eraseSource ? "kustutatud" : "säilitatud"}${suffix}`);
    } catch (error) {
      if (error instanceof StorageRevisionConflictError) await recoverFromStorageConflict(error);
      else if (error instanceof CadCommandInputError) {
        setMirrorAwaitingSelection(false);
        setStatus(`MIRROR viga: ${error.message}`);
      }
      else throw error;
    } finally {
      committing.current = false;
    }
  }

  async function eraseSelected(): Promise<void> {
    if (committing.current || selectedHandles.length === 0) return;
    committing.current = true;
    try {
      const command = resolveCadCommand("ERASE");
      if (!command || command.id !== "ERASE") throw new Error("ERASE command is missing from the registry.");
      const result = command.execute(document, { targetHandles: selectedHandles });
      setSelectedHandles([]);
      if (result.changes.length === 0) {
        setStatus(`Midagi ei kustutatud (${result.rejected.length} lukus või puudu)`);
        return;
      }
      await commitChanges(command.id, { targetHandles: selectedHandles }, result.changes, [], result.erasedHandles);
      const suffix = result.rejected.length ? `; ${result.rejected.length} jäi muutmata` : "";
      setStatus(`${result.erasedHandles.length} objekti kustutatud${suffix}`);
    } catch (error) {
      if (error instanceof StorageRevisionConflictError) await recoverFromStorageConflict(error);
      else throw error;
    } finally {
      committing.current = false;
    }
  }

  async function undoLast(): Promise<void> {
    if (committing.current || !session.current.canUndo) return;
    committing.current = true;
    try {
      const committed = session.current.undo();
      if (!committed) return;
      const next = session.current.document;
      await database.commitRevision(next, committed.operation);
      setDocument(next);
      setSelectedHandles([]);
      setStatus(`UNDO taastatud, revision ${next.revision}`);
    } catch (error) {
      await recoverFromStorageConflict(error);
    } finally {
      committing.current = false;
    }
  }

  async function createLayer(): Promise<void> {
    if (committing.current) return;
    committing.current = true;
    try {
      let sequence = document.layers.length;
      while (document.layers.some((layer) => layer.id === `layer-${sequence}`)) sequence += 1;
      const layer = {
        id: `layer-${sequence}`,
        name: `Layer ${sequence}`,
        visible: true,
        frozen: false,
        locked: false,
        plottable: true,
      };
      await commitChanges("LAYER_NEW", { layerId: layer.id }, [
        { type: "put-layer", layer },
        { type: "set-current-layer", layerId: layer.id },
      ], []);
      setStatus(`${layer.name} loodud ja aktiivne`);
    } catch (error) {
      await recoverFromStorageConflict(error);
    } finally {
      committing.current = false;
    }
  }

  async function toggleActiveLayerLock(): Promise<void> {
    if (committing.current) return;
    committing.current = true;
    try {
      const next = { ...activeLayer, locked: !activeLayer.locked };
      await commitChanges("LAYER_LOCK", { layerId: next.id, locked: next.locked }, [{ type: "put-layer", layer: next }], []);
      setStatus(`${next.name} ${next.locked ? "lukustatud" : "avatud"}`);
    } catch (error) {
      await recoverFromStorageConflict(error);
    } finally {
      committing.current = false;
    }
  }

  function downloadDxf(): void {
    const exported = exportDxf(document);
    if (exported.report.skipped.length) {
      setStatus(`DXF peatatud: ${exported.report.skipped.length} toetamata objekti`);
      return;
    }
    const url = URL.createObjectURL(new Blob([exported.text], { type: "application/dxf" }));
    const anchor = window.document.createElement("a");
    anchor.href = url;
    anchor.download = `${document.documentId}-r${document.revision}.dxf`;
    anchor.click();
    URL.revokeObjectURL(url);
    setStatus(`DXF eksporditud: ${exported.report.emittedHandles.length} objekti`);
  }

  return (
    <main className="app-shell">
      <header className="titlebar">
        <strong>Kuubik Draw</strong>
        <span>GPL 2D CAD · eksperimentaalne</span>
      </header>
      <section className="ribbon" aria-label="Joonestustööriistad">
        <button type="button" onClick={() => void addSyntheticLine()} disabled={activeLayer.locked}>LINE test</button>
        <label className="coordinate-input">
          <span>Esimene nurk</span>
          <input aria-label="Esimene nurk" value={firstCornerInput} onChange={(event) => setFirstCornerInput(event.target.value)} placeholder="x,y" />
        </label>
        <label className="coordinate-input">
          <span>Teine nurk</span>
          <input aria-label="Teine nurk" value={otherCornerInput} onChange={(event) => setOtherCornerInput(event.target.value)} placeholder="x,y" />
        </label>
        <button type="button" onClick={() => void addRectangle()} disabled={activeLayer.locked}>RECTANGLE</button>
        <button type="button" onClick={() => void createLayer()}>Uus kiht</button>
        <button type="button" onClick={() => void toggleActiveLayerLock()}>{activeLayer.locked ? "Ava aktiivne" : "Lukusta aktiivne"}</button>
        <button type="button" onClick={selectAll} disabled={document.entities.length === 0}>Vali kõik</button>
        <label className="coordinate-input">
          <span>MOVE baaspunkt</span>
          <input aria-label="MOVE baaspunkt" value={moveBaseInput} onFocus={() => setPreviewCommand("MOVE")} onChange={(event) => { setPreviewCommand("MOVE"); setMoveBaseInput(event.target.value); }} placeholder="x,y" />
        </label>
        <label className="coordinate-input">
          <span>MOVE sihtpunkt</span>
          <input aria-label="MOVE sihtpunkt" value={moveDestinationInput} onFocus={() => setPreviewCommand("MOVE")} onChange={(event) => { setPreviewCommand("MOVE"); setMoveDestinationInput(event.target.value); }} placeholder="x,y või @dx,dy" />
        </label>
        <button type="button" onClick={() => void moveSelected()}>MOVE</button>
        <label className="coordinate-input">
          <span>COPY baaspunkt</span>
          <input aria-label="COPY baaspunkt" value={copyBaseInput} onFocus={() => setPreviewCommand("COPY")} onChange={(event) => { setPreviewCommand("COPY"); setCopyBaseInput(event.target.value); }} placeholder="x,y" />
        </label>
        <label className="coordinate-input">
          <span>COPY sihtpunkt(id)</span>
          <input aria-label="COPY sihtpunktid" value={copyDestinationsInput} onFocus={() => setPreviewCommand("COPY")} onChange={(event) => { setPreviewCommand("COPY"); setCopyDestinationsInput(event.target.value); }} placeholder="x,y; @dx,dy" />
        </label>
        <button type="button" onClick={() => void copySelected()}>COPY</button>
        <label className="coordinate-input">
          <span>ROTATE baaspunkt</span>
          <input aria-label="ROTATE baaspunkt" value={rotateBaseInput} onFocus={() => setPreviewCommand("ROTATE")} onChange={(event) => { setPreviewCommand("ROTATE"); setRotateBaseInput(event.target.value); }} placeholder="x,y" />
        </label>
        <label className="coordinate-input">
          <span>ROTATE režiim</span>
          <select aria-label="ROTATE režiim" value={rotateMode} onFocus={() => setPreviewCommand("ROTATE")} onChange={(event) => { setPreviewCommand("ROTATE"); setRotateMode(event.target.value as "relative" | "reference"); }}>
            <option value="relative">Nurk</option>
            <option value="reference">Reference</option>
          </select>
        </label>
        {rotateMode === "relative" ? (
          <label className="coordinate-input">
            <span>ROTATE nurk</span>
            <input aria-label="ROTATE nurk" value={rotateAngleInput} onFocus={() => setPreviewCommand("ROTATE")} onChange={(event) => { setPreviewCommand("ROTATE"); setRotateAngleInput(event.target.value); }} placeholder="kraadi või x,y" />
          </label>
        ) : (
          <>
            <label className="coordinate-input">
              <span>ROTATE Reference</span>
              <input aria-label="ROTATE Reference" value={rotateReferenceInput} onFocus={() => setPreviewCommand("ROTATE")} onChange={(event) => { setPreviewCommand("ROTATE"); setRotateReferenceInput(event.target.value); }} placeholder="kraadi või x,y; x,y" />
            </label>
            <label className="coordinate-input">
              <span>ROTATE uus nurk</span>
              <input aria-label="ROTATE uus nurk" value={rotateNewAngleInput} onFocus={() => setPreviewCommand("ROTATE")} onChange={(event) => { setPreviewCommand("ROTATE"); setRotateNewAngleInput(event.target.value); }} placeholder="kraadi või x,y" />
            </label>
          </>
        )}
        <button type="button" onClick={() => void rotateSelected()}>ROTATE</button>
        <label className="coordinate-input">
          <span>SCALE baaspunkt</span>
          <input aria-label="SCALE baaspunkt" value={scaleBaseInput} onFocus={() => setPreviewCommand("SCALE")} onChange={(event) => { setPreviewCommand("SCALE"); setScaleBaseInput(event.target.value); }} placeholder="x,y" />
        </label>
        <label className="coordinate-input">
          <span>SCALE režiim</span>
          <select aria-label="SCALE režiim" value={scaleMode} onFocus={() => setPreviewCommand("SCALE")} onChange={(event) => { setPreviewCommand("SCALE"); setScaleMode(event.target.value as "factor" | "reference"); }}>
            <option value="factor">Kordaja</option>
            <option value="reference">Reference</option>
          </select>
        </label>
        {scaleMode === "factor" ? (
          <label className="coordinate-input">
            <span>SCALE kordaja</span>
            <input aria-label="SCALE kordaja" value={scaleFactorInput} onFocus={() => setPreviewCommand("SCALE")} onChange={(event) => { setPreviewCommand("SCALE"); setScaleFactorInput(event.target.value); }} placeholder="positiivne kordaja" />
          </label>
        ) : (
          <>
            <label className="coordinate-input">
              <span>SCALE Reference</span>
              <input aria-label="SCALE Reference" value={scaleReferenceInput} onFocus={() => setPreviewCommand("SCALE")} onChange={(event) => { setPreviewCommand("SCALE"); setScaleReferenceInput(event.target.value); }} placeholder="pikkus või x,y; x,y" />
            </label>
            <label className="coordinate-input">
              <span>SCALE uus pikkus</span>
              <input aria-label="SCALE uus pikkus" value={scaleNewLengthInput} onFocus={() => setPreviewCommand("SCALE")} onChange={(event) => { setPreviewCommand("SCALE"); setScaleNewLengthInput(event.target.value); }} placeholder="pikkus või x,y; x,y" />
            </label>
          </>
        )}
        <label className="coordinate-input">
          <span>SCALE Copy</span>
          <input aria-label="SCALE Copy" type="checkbox" checked={scaleCopy} onFocus={() => setPreviewCommand("SCALE")} onChange={(event) => { setPreviewCommand("SCALE"); setScaleCopy(event.target.checked); }} />
        </label>
        <button type="button" onClick={() => void scaleSelected()}>SCALE</button>
        <label className="coordinate-input">
          <span>MIRROR esimene punkt</span>
          <input aria-label="MIRROR esimene punkt" value={mirrorFirstPointInput} onFocus={() => setPreviewCommand("MIRROR")} onChange={(event) => { setPreviewCommand("MIRROR"); setMirrorFirstPointInput(event.target.value); }} placeholder="x,y" />
        </label>
        <label className="coordinate-input">
          <span>MIRROR teine punkt</span>
          <input aria-label="MIRROR teine punkt" value={mirrorSecondPointInput} onFocus={() => setPreviewCommand("MIRROR")} onChange={(event) => { setPreviewCommand("MIRROR"); setMirrorSecondPointInput(event.target.value); }} placeholder="x,y" />
        </label>
        <label className="coordinate-input">
          <span>MIRROR kustuta lähteobjektid</span>
          <input aria-label="MIRROR kustuta lähteobjektid" type="checkbox" checked={mirrorEraseSource} onFocus={() => setPreviewCommand("MIRROR")} onChange={(event) => { setPreviewCommand("MIRROR"); setMirrorEraseSource(event.target.checked); }} />
        </label>
        <button type="button" onClick={() => void mirrorSelected()}>MIRROR</button>
        <button type="button" onClick={() => void eraseSelected()} disabled={selectedHandles.length === 0}>ERASE</button>
        <button type="button" onClick={() => void undoLast()} disabled={!session.current.canUndo}>UNDO</button>
        <button type="button" onClick={downloadDxf}>DXF eksport</button>
        <button type="button" disabled>TRIM järgmine</button>
        <span>{document.entities.length} objekti · {selectedHandles.length} valitud · {activeLayer.name}{activeLayer.locked ? " 🔒" : ""}</span>
        {movePreview && <span data-testid="move-preview">MOVE eelvaade: {movePreview.entities.length} · Δ{movePreview.delta.x},{movePreview.delta.y}</span>}
        {copyPreview && <span data-testid="copy-preview">COPY eelvaade: {copyPreview.entities.length} · {copyPreview.deltas.length} paigutust</span>}
        {rotatePreview && <span data-testid="rotate-preview">ROTATE eelvaade: {rotatePreview.entities.length} · {rotatePreview.deltaAngleDeg}°</span>}
        {scalePreview && <span data-testid="scale-preview">SCALE eelvaade: {scalePreview.entities.length} · ×{scalePreview.factor}{scalePreview.copy ? " · Copy" : ""}</span>}
        {mirrorPreview && <span data-testid="mirror-preview" data-hidden-source-count={mirrorPreview.eraseSource ? mirrorPreview.sourceHandles.length : 0}>MIRROR eelvaade: {mirrorPreview.entities.length} · lähteobjektid {mirrorPreview.eraseSource ? "kustutatakse" : "säilivad"}</span>}
        {lastMoveRejected.length > 0 && (
          <span data-testid="move-rejected" data-rejected={JSON.stringify(lastMoveRejected)}>
            MOVE muutmata: {lastMoveRejected.map(({ handle, reason }) => `${handle} (${reason})`).join(", ")}
          </span>
        )}
        {lastCopyRejected.length > 0 && (
          <span data-testid="copy-rejected" data-rejected={JSON.stringify(lastCopyRejected)}>
            COPY kopeerimata: {lastCopyRejected.map(({ handle, reason }) => `${handle} (${reason})`).join(", ")}
          </span>
        )}
        {lastRotateRejected.length > 0 && (
          <span data-testid="rotate-rejected" data-rejected={JSON.stringify(lastRotateRejected)}>
            ROTATE muutmata: {lastRotateRejected.map(({ handle, reason }) => `${handle} (${reason})`).join(", ")}
          </span>
        )}
        {lastScaleRejected.length > 0 && (
          <span data-testid="scale-rejected" data-rejected={JSON.stringify(lastScaleRejected)}>
            SCALE muutmata: {lastScaleRejected.map(({ handle, reason }) => `${handle} (${reason})`).join(", ")}
          </span>
        )}
        {lastMirrorRejected.length > 0 && (
          <span data-testid="mirror-rejected" data-rejected={JSON.stringify(lastMirrorRejected)}>
            MIRROR muutmata: {lastMirrorRejected.map(({ handle, reason }) => `${handle} (${reason})`).join(", ")}
          </span>
        )}
      </section>
      <section className="drawing-area">
        <canvas ref={canvas} aria-label="Kuubik Draw joonestusala" />
      </section>
      <footer className="statusbar">
        <span>{status}</span>
        <span>MODEL · mm · SNAP</span>
      </footer>
    </main>
  );
}
