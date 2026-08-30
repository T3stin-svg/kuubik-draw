import { useEffect, useMemo, useRef, useState } from "react";
import { ISO_PAPER_MEDIA, MAX_PAGE_SETUP_TEMPLATE_BYTES, STANDARD_VIEWPORT_SCALE_DENOMINATORS, allocateEntityHandles, applyNamedPageSetup, buildLayoutPublishPlan, CadCommandInputError, CadSession, clearNamedPageSetupAssignment, createPageSetupTemplate, LayoutCommandError, LayoutPublishSettingsError, NoOpOperationError, PageSetupLibraryError, copyPaperLayout, createEmptyDocument, createPaperLayout, createPaperViewport, deleteNamedPageSetup, deletePaperLayout, deletePaperViewport, formatViewportScale, importPageSetupTemplate, metadataWithLayoutPublishSettings, movePaperLayout, panPaperViewportByPixels, paperDefinitionForPageSetup, parseCartesianPoint, parsePageSetupTemplate, renameNamedPageSetup, renamePaperLayout, replaceDrawingContentPreservingLayouts, resolveCadCommand, resolveLayoutPublishSettings, resolveModelPageSetup, resolvePageSetup, resolvePageSetupLibrary, resolvePaperDefinition, sanitizePdfFileStem, saveNamedPageSetup, serializeKDraw, serializePageSetupTemplate, setModelLayoutPageSetup, setPaperLayoutPageSetup, setPaperViewportDisplayLocked, setPaperViewportView, viewportScaleDenominator, zoomPaperViewportAtModelPoint, type CadChange, type ChamferRejectedTarget, type ChamferTrimMode, type CopyRejectedTarget, type ExtendRejectedTarget, type ExtendTargetAction, type FilletRejectedTarget, type FilletTrimMode, type LayoutPublishSettingsV1, type MirrorRejectedTarget, type MoveRejectedTarget, type OffsetLayerMode, type OffsetRejectedTarget, type RotateRejectedTarget, type ScaleRejectedTarget, type TrimEdgeMode, type TrimMode, type TrimProjectMode, type TrimRejectedTarget, type TrimTargetAction } from "@kuubik/cad-core";
import { DxfImportError, MAX_DXF_IMPORT_BYTES, exportDxf, importDxf } from "@kuubik/cad-dxf";
import { exportLayoutSvg, exportLayoutsVectorPdf, exportLayoutVectorPdf, exportModelSvg, exportModelVectorPdf, type LayoutPlotOptions, type ModelPlotOptions } from "@kuubik/cad-print";
import { CadCanvasRenderer, pickCadEntity, pannedViewportWorldCenter, selectCadEntityHitsByCrossingPolygon, selectCadEntityHitsByFence, viewportScreenToWorld, viewportScreenTransform, type Viewport2D } from "@kuubik/cad-renderer";
import type { CadEntity, CadLayout, CadPageSetup, CadPaperRect, CadPlotStyle, CadViewport, KDrawDocumentV1 } from "@kuubik/cad-schema";
import { KDrawIndexedDb, StorageRevisionConflictError } from "./indexed-db.js";
import { prepareChamfer, prepareCopy, prepareExtend, prepareFillet, prepareMirror, prepareMove, prepareOffset, prepareRotate, prepareScale, prepareTrim, putEntities } from "./workflows/modify-command.js";
import "./style.css";

const LOCAL_DOCUMENT_ID = "local";
const MODEL_SPACE_COMMANDS = new Set(["LINE", "RECTANGLE", "MOVE", "COPY", "ROTATE", "SCALE", "MIRROR", "OFFSET", "TRIM", "EXTEND", "FILLET", "CHAMFER", "ERASE"]);
const MODEL_VIEW_WORLD = Object.freeze({ minX: -500, minY: -500, maxX: 2500, maxY: 2500 });

function nextInteractiveHandle(document: KDrawDocumentV1): string {
  const preferred = (document.revision + 16).toString(16).toUpperCase();
  return document.entities.some((entity) => entity.handle.toUpperCase() === preferred)
    ? allocateEntityHandles(document, 1)[0]!
    : preferred;
}

function viewportClipPath(viewport: CadViewport): string | undefined {
  if (!viewport.clipBoundary) return undefined;
  const left = viewport.center.x - viewport.width / 2;
  const bottom = viewport.center.y - viewport.height / 2;
  return `polygon(${viewport.clipBoundary.map((point) => {
    const x = ((point.x - left) / viewport.width) * 100;
    const y = 100 - ((point.y - bottom) / viewport.height) * 100;
    return `${x}% ${y}%`;
  }).join(", ")})`;
}

function viewportRender2D(viewport: CadViewport, widthPx: number, heightPx: number, devicePixelRatio = 1): Viewport2D {
  const worldWidth = viewport.viewHeight * (viewport.width / viewport.height);
  return {
    world: {
      minX: viewport.viewCenter.x - worldWidth / 2,
      minY: viewport.viewCenter.y - viewport.viewHeight / 2,
      maxX: viewport.viewCenter.x + worldWidth / 2,
      maxY: viewport.viewCenter.y + viewport.viewHeight / 2,
    },
    widthPx,
    heightPx,
    devicePixelRatio,
    rotationRad: viewport.twistAngleRad,
  };
}

function PaperViewportCanvas({
  document,
  viewport,
  paper,
  active,
  modelContext,
  navigationEnabled,
  plotStyle,
  onSelect,
  onEnterModel,
  onZoom,
  onPan,
}: {
  document: KDrawDocumentV1;
  viewport: CadViewport;
  paper: NonNullable<CadLayout["paper"]>;
  active: boolean;
  modelContext: boolean;
  navigationEnabled: boolean;
  plotStyle: CadPlotStyle | undefined;
  onSelect: () => void;
  onEnterModel: () => void;
  onZoom: (anchorModel: { x: number; y: number }, scaleFactor: number) => void;
  onPan: (deltaPx: { x: number; y: number }, viewportPx: { width: number; height: number }) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const panStart = useRef<{
    pointerId: number;
    clientX: number;
    clientY: number;
    width: number;
    height: number;
  } | null>(null);
  const [draftCenter, setDraftCenter] = useState<{ x: number; y: number } | null>(null);
  const renderViewport = draftCenter === null ? viewport : { ...viewport, viewCenter: draftCenter };
  useEffect(() => {
    const element = canvas.current;
    const context = element?.getContext("2d");
    if (!element || !context) return;
    const renderer = new CadCanvasRenderer();
    renderer.setBlocks(document.blocks);
    renderer.setEntities(document.entities);
    const render = () => {
      const widthPx = element.clientWidth;
      const heightPx = element.clientHeight;
      if (widthPx <= 0 || heightPx <= 0) return;
      const devicePixelRatio = window.devicePixelRatio || 1;
      element.width = Math.max(1, Math.round(widthPx * devicePixelRatio));
      element.height = Math.max(1, Math.round(heightPx * devicePixelRatio));
      renderer.render(context, viewportRender2D(renderViewport, widthPx, heightPx, devicePixelRatio), document.layers, null, [], plotStyle ? {
        plotStyle,
        pixelsPerMillimeter: widthPx / viewport.width,
      } : {});
    };
    render();
    const observer = new ResizeObserver(render);
    observer.observe(element);
    return () => observer.disconnect();
  }, [document.blocks, document.entities, document.layers, plotStyle, renderViewport, viewport.width]);

  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const handleWheel = (event: WheelEvent) => {
      if (!navigationEnabled) return;
      event.stopPropagation();
      event.preventDefault();
      const canvasElement = canvas.current;
      if (!canvasElement) return;
      const rect = canvasElement.getBoundingClientRect();
      const pointPx = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      const anchorModel = viewportScreenToWorld(viewportRender2D(viewport, rect.width, rect.height), pointPx);
      onZoom(anchorModel, event.deltaY > 0 ? 1.1 : 1 / 1.1);
    };
    element.addEventListener("wheel", handleWheel, { passive: false });
    return () => element.removeEventListener("wheel", handleWheel);
  }, [navigationEnabled, onZoom, viewport]);

  return (
    <div
      ref={container}
      className={`paper-space-viewport${active ? " selected" : ""}${modelContext ? " model-context" : ""}`}
      data-testid="paper-space-viewport"
      data-viewport-id={viewport.id}
      data-viewport-kind={viewport.clipBoundary ? "polygon" : "rectangle"}
      data-space-context={modelContext ? "model" : "paper"}
      data-view-center={`${renderViewport.viewCenter.x},${renderViewport.viewCenter.y}`}
      data-view-height={renderViewport.viewHeight}
      data-frame-center={`${renderViewport.center.x},${renderViewport.center.y}`}
      data-frame-width={renderViewport.width}
      data-frame-height={renderViewport.height}
      data-scale-denominator={viewportScaleDenominator(renderViewport)}
      data-scale-label={formatViewportScale(renderViewport)}
      data-twist-angle-rad={renderViewport.twistAngleRad}
      data-twist-angle-deg={(renderViewport.twistAngleRad * 180) / Math.PI}
      data-display-locked={viewport.locked ? "true" : "false"}
      data-navigation-enabled={navigationEnabled ? "true" : "false"}
      style={{
        left: `${((viewport.center.x - viewport.width / 2) / paper.widthMm) * 100}%`,
        bottom: `${((viewport.center.y - viewport.height / 2) / paper.heightMm) * 100}%`,
        width: `${(viewport.width / paper.widthMm) * 100}%`,
        height: `${(viewport.height / paper.heightMm) * 100}%`,
        clipPath: viewportClipPath(viewport),
      }}
      onClick={(event) => { event.stopPropagation(); onSelect(); }}
      onDoubleClick={(event) => { event.stopPropagation(); onEnterModel(); }}
      onPointerDown={(event) => {
        event.stopPropagation();
        onSelect();
        if (!navigationEnabled) return;
        const rect = canvas.current?.getBoundingClientRect();
        if (!rect) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        panStart.current = {
          pointerId: event.pointerId,
          clientX: event.clientX,
          clientY: event.clientY,
          width: Math.max(1, rect.width),
          height: Math.max(1, rect.height),
        };
      }}
      onPointerMove={(event) => {
        const start = panStart.current;
        if (!start || start.pointerId !== event.pointerId) return;
        setDraftCenter(pannedViewportWorldCenter(viewportRender2D(viewport, start.width, start.height), {
          x: event.clientX - start.clientX,
          y: event.clientY - start.clientY,
        }));
      }}
      onPointerUp={(event) => {
        const start = panStart.current;
        if (!start || start.pointerId !== event.pointerId) return;
        const deltaPx = { x: event.clientX - start.clientX, y: event.clientY - start.clientY };
        event.currentTarget.releasePointerCapture(event.pointerId);
        panStart.current = null;
        setDraftCenter(null);
        if (deltaPx.x !== 0 || deltaPx.y !== 0) onPan(deltaPx, { width: start.width, height: start.height });
      }}
      onPointerCancel={() => { panStart.current = null; setDraftCenter(null); }}
    >
      <canvas ref={canvas} aria-label={`Viewport ${viewport.id}`} />
      <span className="paper-space-viewport-label">{viewport.locked ? "🔒 · " : ""}{viewport.id} · {formatViewportScale(renderViewport)}</span>
    </div>
  );
}

export function App() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const paperDesk = useRef<HTMLDivElement>(null);
  const paperSheet = useRef<HTMLDivElement>(null);
  const database = useMemo(() => new KDrawIndexedDb(), []);
  const session = useRef(new CadSession(createEmptyDocument({ documentId: LOCAL_DOCUMENT_ID })));
  const committing = useRef(false);
  const [document, setDocument] = useState<KDrawDocumentV1>(session.current.document);
  const [status, setStatus] = useState("Uus kohalik dokument");
  const [activeLayoutId, setActiveLayoutId] = useState("model");
  const [selectedViewportId, setSelectedViewportId] = useState<string | null>(null);
  const [modelViewportId, setModelViewportId] = useState<string | null>(null);
  const [viewportScaleInput, setViewportScaleInput] = useState("20");
  const [viewportCenterXInput, setViewportCenterXInput] = useState("0");
  const [viewportCenterYInput, setViewportCenterYInput] = useState("0");
  const [viewportTwistInput, setViewportTwistInput] = useState("0");
  const [pageMediaInput, setPageMediaInput] = useState("ISO_A4");
  const [pageOrientationInput, setPageOrientationInput] = useState<"portrait" | "landscape">("landscape");
  const [plotAreaInput, setPlotAreaInput] = useState<CadPageSetup["plotArea"]["kind"]>("layout");
  const [plotScaleModeInput, setPlotScaleModeInput] = useState<CadPageSetup["plotScale"]["mode"]>("custom");
  const [plotScaleDenominatorInput, setPlotScaleDenominatorInput] = useState("1");
  const [centerPlotInput, setCenterPlotInput] = useState(false);
  const [plotOriginXInput, setPlotOriginXInput] = useState("0");
  const [plotOriginYInput, setPlotOriginYInput] = useState("0");
  const [plotWindowXInput, setPlotWindowXInput] = useState("10");
  const [plotWindowYInput, setPlotWindowYInput] = useState("20");
  const [plotWindowWidthInput, setPlotWindowWidthInput] = useState("180");
  const [plotWindowHeightInput, setPlotWindowHeightInput] = useState("250");
  const [plotProfileInput, setPlotProfileInput] = useState<CadPlotStyle["profile"]>("monochrome");
  const [plotLineweightsInput, setPlotLineweightsInput] = useState(true);
  const [plotTransparencyInput, setPlotTransparencyInput] = useState(true);
  const [displayPlotStylesInput, setDisplayPlotStylesInput] = useState(false);
  const [selectedNamedPageSetupId, setSelectedNamedPageSetupId] = useState("");
  const [newPageSetupNameInput, setNewPageSetupNameInput] = useState("");
  const [renamePageSetupInput, setRenamePageSetupInput] = useState("");
  const [pageSetupTemplateNameInput, setPageSetupTemplateNameInput] = useState("Kuubik office template");
  const [layoutRenameInput, setLayoutRenameInput] = useState("");
  const [publishBaseNameInput, setPublishBaseNameInput] = useState("local");
  const [publishCommitting, setPublishCommitting] = useState(false);
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
  const [offsetMode, setOffsetMode] = useState<"distance" | "through">("distance");
  const [offsetDistanceInput, setOffsetDistanceInput] = useState("200");
  const [offsetPlacementInput, setOffsetPlacementInput] = useState("500,200");
  const [offsetMultiple, setOffsetMultiple] = useState(false);
  const [offsetEraseSource, setOffsetEraseSource] = useState(false);
  const [offsetLayerMode, setOffsetLayerMode] = useState<OffsetLayerMode>("source");
  const [offsetAwaitingSelection, setOffsetAwaitingSelection] = useState(false);
  const [lastOffsetRejected, setLastOffsetRejected] = useState<OffsetRejectedTarget[]>([]);
  const [trimMode, setTrimMode] = useState<TrimMode>("standard");
  const [trimCuttingHandlesInput, setTrimCuttingHandlesInput] = useState("20,21");
  const [trimTargetsInput, setTrimTargetsInput] = useState("10@500,0");
  const [trimEdgeMode, setTrimEdgeMode] = useState<TrimEdgeMode>("no-extend");
  const [trimProjectMode, setTrimProjectMode] = useState<TrimProjectMode>("none");
  const [trimTargetAction, setTrimTargetAction] = useState<TrimTargetAction>("trim");
  const [trimPathMode, setTrimPathMode] = useState<"fence" | "crossing">("fence");
  const [trimPathInput, setTrimPathInput] = useState("500,-500; 500,500");
  const [lastTrimRejected, setLastTrimRejected] = useState<TrimRejectedTarget[]>([]);
  const [extendMode, setExtendMode] = useState<TrimMode>("quick");
  const [extendBoundaryHandlesInput, setExtendBoundaryHandlesInput] = useState("20");
  const [extendTargetsInput, setExtendTargetsInput] = useState("10@80,0");
  const [extendEdgeMode, setExtendEdgeMode] = useState<TrimEdgeMode>("no-extend");
  const [extendProjectMode, setExtendProjectMode] = useState<TrimProjectMode>("none");
  const [extendTargetAction, setExtendTargetAction] = useState<ExtendTargetAction>("extend");
  const [extendPathMode, setExtendPathMode] = useState<"fence" | "crossing">("fence");
  const [extendPathInput, setExtendPathInput] = useState("80,-50; 80,50");
  const [lastExtendRejected, setLastExtendRejected] = useState<ExtendRejectedTarget[]>([]);
  const [filletMode, setFilletMode] = useState<"pairs" | "polyline">("pairs");
  const [filletRadiusInput, setFilletRadiusInput] = useState("100");
  const [filletTrimMode, setFilletTrimMode] = useState<FilletTrimMode>("trim");
  const [filletPolylineArc, setFilletPolylineArc] = useState<0 | 1>(1);
  const [filletPairsInput, setFilletPairsInput] = useState("10@400,0>20@500,100");
  const [filletPolylineHandlesInput, setFilletPolylineHandlesInput] = useState("10");
  const [filletFirstCanvasPick, setFilletFirstCanvasPick] = useState<{ handle: string; segment?: number; point: { x: number; y: number } } | null>(null);
  const [filletCanvasSessionActive, setFilletCanvasSessionActive] = useState(false);
  const [lastFilletRejected, setLastFilletRejected] = useState<FilletRejectedTarget[]>([]);
  const [chamferMode, setChamferMode] = useState<"pairs" | "polyline">("pairs");
  const [chamferMethod, setChamferMethod] = useState<"distance" | "angle">("distance");
  const [chamferFirstDistanceInput, setChamferFirstDistanceInput] = useState("100");
  const [chamferSecondDistanceInput, setChamferSecondDistanceInput] = useState("100");
  const [chamferAngleInput, setChamferAngleInput] = useState("45");
  const [chamferTrimMode, setChamferTrimMode] = useState<ChamferTrimMode>("trim");
  const [chamferPairsInput, setChamferPairsInput] = useState("10@400,0>20@500,100");
  const [chamferPolylineHandlesInput, setChamferPolylineHandlesInput] = useState("10");
  const [chamferFirstCanvasPick, setChamferFirstCanvasPick] = useState<{ handle: string; segment?: number; point: { x: number; y: number } } | null>(null);
  const [chamferCanvasSessionActive, setChamferCanvasSessionActive] = useState(false);
  const [lastChamferRejected, setLastChamferRejected] = useState<ChamferRejectedTarget[]>([]);
  const [previewCommand, setPreviewCommand] = useState<"MOVE" | "COPY" | "ROTATE" | "SCALE" | "MIRROR" | "OFFSET" | "TRIM" | "EXTEND" | "FILLET" | "CHAMFER">("MOVE");
  const activeLayer = document.layers.find((layer) => layer.id === document.currentLayerId)!;
  const activeLayout = document.layouts.find((layout) => layout.id === activeLayoutId) ?? document.layouts[0]!;
  const selectedViewport = activeLayout.kind === "paper"
    ? activeLayout.viewports.find((viewport) => viewport.id === selectedViewportId) ?? null
    : null;
  const modelSpaceEditing = activeLayout.kind === "model" || modelViewportId !== null;
  const activePaper = useMemo(() => resolvePaperDefinition(activeLayout), [activeLayout]);
  const activePageSetup = useMemo(() => activeLayout.kind === "model" ? resolveModelPageSetup(activeLayout) : resolvePageSetup(activeLayout), [activeLayout]);
  const activePlotPaper = useMemo(() => activePageSetup ? (activePaper ?? paperDefinitionForPageSetup(activePageSetup)) : null, [activePageSetup, activePaper]);
  const activeSpace = modelSpaceEditing ? "MODEL" : "PAPER";
  const pendingViewportScale = Number(viewportScaleInput.trim().replace(",", "."));
  const selectedViewportPreset = String(STANDARD_VIEWPORT_SCALE_DENOMINATORS.find((candidate) => Math.abs(candidate - pendingViewportScale) <= Math.max(1, candidate) * 1e-9) ?? "custom");
  const canUndoInActiveLayout = session.current.canUndo && (modelSpaceEditing || /^(LAYOUT|VIEWPORT|PAGESETUP|PUBLISH)/u.test(session.current.nextUndoCommandId ?? ""));
  const canRedoInActiveLayout = session.current.canRedo && (modelSpaceEditing || /^(LAYOUT|VIEWPORT|PAGESETUP|PUBLISH)/u.test(session.current.nextRedoCommandId ?? ""));
  const paperLayouts = document.layouts.filter((layout) => layout.kind === "paper");
  const publishSettings = useMemo(() => resolveLayoutPublishSettings(document), [document]);
  const pageSetupLibrary = useMemo(() => resolvePageSetupLibrary(document), [document]);
  const activePaperIndex = paperLayouts.findIndex((layout) => layout.id === activeLayout.id);
  const movePreview = useMemo((): { entities: CadEntity[]; delta: { x: number; y: number } } | null => {
    if (previewCommand !== "MOVE" || selectedHandles.length === 0) return null;
    try {
      const { result } = prepareMove(document, { targetHandles: selectedHandles, baseInput: moveBaseInput, destinationInput: moveDestinationInput });
      return {
        entities: putEntities(result.changes),
        delta: result.delta,
      };
    } catch {
      return null;
    }
  }, [document, moveBaseInput, moveDestinationInput, previewCommand, selectedHandles]);
  const copyPreview = useMemo((): { entities: CadEntity[]; deltas: { x: number; y: number }[] } | null => {
    if (previewCommand !== "COPY" || selectedHandles.length === 0) return null;
    try {
      const { result } = prepareCopy(document, { targetHandles: selectedHandles, baseInput: copyBaseInput, destinationsInput: copyDestinationsInput });
      return {
        entities: putEntities(result.changes),
        deltas: result.deltas,
      };
    } catch {
      return null;
    }
  }, [copyBaseInput, copyDestinationsInput, document, previewCommand, selectedHandles]);
  const rotatePreview = useMemo((): { entities: CadEntity[]; deltaAngleDeg: number } | null => {
    if (previewCommand !== "ROTATE" || selectedHandles.length === 0) return null;
    try {
      const { result } = prepareRotate(document, {
        targetHandles: selectedHandles,
        baseInput: rotateBaseInput,
        mode: rotateMode,
        angleInput: rotateAngleInput,
        referenceInput: rotateReferenceInput,
        newAngleInput: rotateNewAngleInput,
      });
      return {
        entities: putEntities(result.changes),
        deltaAngleDeg: result.deltaAngleDeg,
      };
    } catch {
      return null;
    }
  }, [document, previewCommand, rotateAngleInput, rotateBaseInput, rotateMode, rotateNewAngleInput, rotateReferenceInput, selectedHandles]);
  const scalePreview = useMemo((): { entities: CadEntity[]; factor: number; copy: boolean } | null => {
    if (previewCommand !== "SCALE" || selectedHandles.length === 0) return null;
    try {
      const { result } = prepareScale(document, {
        targetHandles: selectedHandles,
        baseInput: scaleBaseInput,
        mode: scaleMode,
        factorInput: scaleFactorInput,
        referenceInput: scaleReferenceInput,
        newLengthInput: scaleNewLengthInput,
        copy: scaleCopy,
      });
      return {
        entities: putEntities(result.changes),
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
      const { result } = prepareMirror(document, {
        targetHandles: selectedHandles,
        firstPointInput: mirrorFirstPointInput,
        secondPointInput: mirrorSecondPointInput,
        eraseSource: mirrorEraseSource,
      });
      return {
        entities: putEntities(result.changes),
        eraseSource: result.eraseSource,
        sourceHandles: result.sourceHandles,
      };
    } catch {
      return null;
    }
  }, [document, mirrorEraseSource, mirrorFirstPointInput, mirrorSecondPointInput, previewCommand, selectedHandles]);
  const offsetPreview = useMemo((): { entities: CadEntity[]; eraseSource: boolean; sourceHandles: string[]; steps: number } | null => {
    if (previewCommand !== "OFFSET" || selectedHandles.length === 0) return null;
    try {
      const { result } = prepareOffset(document, {
        targetHandles: selectedHandles,
        mode: offsetMode,
        distanceInput: offsetDistanceInput,
        placementInput: offsetPlacementInput,
        multiple: offsetMultiple,
        eraseSource: offsetEraseSource,
        layerMode: offsetLayerMode,
      });
      return {
        entities: putEntities(result.changes),
        eraseSource: result.eraseSource,
        sourceHandles: result.sourceHandles,
        steps: result.steps.length,
      };
    } catch {
      return null;
    }
  }, [document, offsetDistanceInput, offsetEraseSource, offsetLayerMode, offsetMode, offsetMultiple, offsetPlacementInput, previewCommand, selectedHandles]);
  const trimPreview = useMemo((): { entities: CadEntity[]; sourceHandles: string[]; steps: number } | null => {
    if (previewCommand !== "TRIM") return null;
    try {
      const { result } = prepareTrim(document, {
        mode: trimMode,
        cuttingHandlesInput: trimCuttingHandlesInput,
        targetsInput: trimTargetsInput,
        targetAction: trimTargetAction,
        edgeMode: trimEdgeMode,
        projectMode: trimProjectMode,
      });
      return {
        entities: putEntities(result.changes),
        sourceHandles: result.steps.map((step) => step.sourceHandle),
        steps: result.steps.length,
      };
    } catch {
      return null;
    }
  }, [document, previewCommand, trimCuttingHandlesInput, trimEdgeMode, trimMode, trimProjectMode, trimTargetAction, trimTargetsInput]);
  const extendPreview = useMemo((): { entities: CadEntity[]; sourceHandles: string[]; steps: number } | null => {
    if (previewCommand !== "EXTEND") return null;
    try {
      const { result } = prepareExtend(document, {
        mode: extendMode,
        boundaryHandlesInput: extendBoundaryHandlesInput,
        targetsInput: extendTargetsInput,
        targetAction: extendTargetAction,
        edgeMode: extendEdgeMode,
        projectMode: extendProjectMode,
      });
      return {
        entities: putEntities(result.changes),
        sourceHandles: result.steps.map((step) => step.sourceHandle),
        steps: result.steps.length,
      };
    } catch {
      return null;
    }
  }, [document, extendBoundaryHandlesInput, extendEdgeMode, extendMode, extendProjectMode, extendTargetAction, extendTargetsInput, previewCommand]);
  const filletPreview = useMemo((): { entities: CadEntity[]; sourceHandles: string[]; steps: number; trimMode: FilletTrimMode } | null => {
    if (previewCommand !== "FILLET") return null;
    try {
      const { result } = prepareFillet(document, {
        mode: filletMode,
        radiusInput: filletRadiusInput,
        pairsInput: filletPairsInput,
        polylineHandlesInput: filletPolylineHandlesInput,
        trimMode: filletTrimMode,
        filletPolylineArc,
      });
      const successfulSourceHandles = new Set(result.sourceHandles);
      return {
        entities: putEntities(result.changes),
        sourceHandles: result.changes.flatMap((change) => {
          const handle = change.type === "put" ? change.entity.handle : change.handle;
          return successfulSourceHandles.has(handle) ? [handle] : [];
        }),
        steps: result.steps.length,
        trimMode: result.trimMode,
      };
    } catch {
      return null;
    }
  }, [document, filletMode, filletPairsInput, filletPolylineArc, filletPolylineHandlesInput, filletRadiusInput, filletTrimMode, previewCommand]);
  const chamferPreview = useMemo((): { entities: CadEntity[]; sourceHandles: string[]; steps: number; trimMode: ChamferTrimMode } | null => {
    if (previewCommand !== "CHAMFER") return null;
    try {
      const { result } = prepareChamfer(document, {
        mode: chamferMode,
        method: chamferMethod,
        firstDistanceInput: chamferFirstDistanceInput,
        secondDistanceInput: chamferSecondDistanceInput,
        angleInput: chamferAngleInput,
        pairsInput: chamferPairsInput,
        polylineHandlesInput: chamferPolylineHandlesInput,
        trimMode: chamferTrimMode,
      });
      const successfulSourceHandles = new Set(result.sourceHandles);
      return {
        entities: putEntities(result.changes),
        sourceHandles: result.changes.flatMap((change) => {
          const handle = change.type === "put" ? change.entity.handle : change.handle;
          return successfulSourceHandles.has(handle) ? [handle] : [];
        }),
        steps: result.steps.length,
        trimMode: result.trimMode,
      };
    } catch {
      return null;
    }
  }, [chamferAngleInput, chamferFirstDistanceInput, chamferMethod, chamferMode, chamferPairsInput, chamferPolylineHandlesInput, chamferSecondDistanceInput, chamferTrimMode, document, previewCommand]);

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
    setPublishBaseNameInput(publishSettings.baseFileName);
  }, [publishSettings.baseFileName]);

  useEffect(() => {
    const assigned = pageSetupLibrary.assignments[activeLayout.id] ?? "";
    setSelectedNamedPageSetupId(assigned);
  }, [activeLayout.id, pageSetupLibrary]);

  useEffect(() => {
    const setup = pageSetupLibrary.setups.find((candidate) => candidate.id === selectedNamedPageSetupId);
    setRenamePageSetupInput(setup?.name ?? "");
  }, [pageSetupLibrary.setups, selectedNamedPageSetupId]);

  useEffect(() => {
    if (document.layouts.some((layout) => layout.id === activeLayoutId)) return;
    setActiveLayoutId(document.layouts[0]!.id);
  }, [activeLayoutId, document.layouts]);

  useEffect(() => {
    if (activeLayout.kind !== "paper") {
      setSelectedViewportId(null);
      setModelViewportId(null);
      return;
    }
    const viewportIds = new Set(activeLayout.viewports.map((viewport) => viewport.id));
    if (selectedViewportId !== null && !viewportIds.has(selectedViewportId)) setSelectedViewportId(null);
    if (modelViewportId !== null && !viewportIds.has(modelViewportId)) setModelViewportId(null);
  }, [activeLayout, modelViewportId, selectedViewportId]);

  useEffect(() => {
    if (!selectedViewport) return;
    setViewportScaleInput(String(viewportScaleDenominator(selectedViewport)));
    setViewportCenterXInput(String(selectedViewport.viewCenter.x));
    setViewportCenterYInput(String(selectedViewport.viewCenter.y));
    setViewportTwistInput(String((selectedViewport.twistAngleRad * 180) / Math.PI));
  }, [selectedViewport]);

  useEffect(() => {
    if (!activePageSetup || !activePlotPaper) return;
    setPageMediaInput(activePageSetup.mediaName);
    setPageOrientationInput(activePageSetup.orientation);
    setPlotAreaInput(activePageSetup.plotArea.kind);
    setPlotScaleModeInput(activePageSetup.plotScale.mode);
    setPlotScaleDenominatorInput(activePageSetup.plotScale.mode === "custom"
      ? String(activePageSetup.plotScale.drawingUnits / activePageSetup.plotScale.paperUnits)
      : "1");
    setCenterPlotInput(activePageSetup.centerPlot);
    setPlotOriginXInput(String(activePageSetup.plotOriginMm.x));
    setPlotOriginYInput(String(activePageSetup.plotOriginMm.y));
    setPlotProfileInput(activePageSetup.plotStyle?.profile ?? "monochrome");
    setPlotLineweightsInput(activePageSetup.plotStyle?.plotLineweights ?? true);
    setPlotTransparencyInput(activePageSetup.plotStyle?.plotTransparency ?? true);
    setDisplayPlotStylesInput(activePageSetup.displayPlotStyles === true);
    const window = activePageSetup.plotArea.kind === "window" ? activePageSetup.plotArea.window : activeLayout.kind === "model" ? {
      x: MODEL_VIEW_WORLD.minX,
      y: MODEL_VIEW_WORLD.minY,
      width: MODEL_VIEW_WORLD.maxX - MODEL_VIEW_WORLD.minX,
      height: MODEL_VIEW_WORLD.maxY - MODEL_VIEW_WORLD.minY,
    } : {
      x: activePlotPaper.marginsMm.left,
      y: activePlotPaper.marginsMm.bottom,
      width: activePlotPaper.widthMm - activePlotPaper.marginsMm.left - activePlotPaper.marginsMm.right,
      height: activePlotPaper.heightMm - activePlotPaper.marginsMm.top - activePlotPaper.marginsMm.bottom,
    };
    setPlotWindowXInput(String(window.x));
    setPlotWindowYInput(String(window.y));
    setPlotWindowWidthInput(String(window.width));
    setPlotWindowHeightInput(String(window.height));
  }, [activeLayout.kind, activePageSetup, activePlotPaper]);

  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const context = element.getContext("2d");
    if (!context) return;
    const renderer = new CadCanvasRenderer();
    renderer.setBlocks(document.blocks);
    renderer.setEntities(activeLayout.kind === "model" ? document.entities : (activeLayout.entities ?? []));
    const render = () => {
      const ratio = window.devicePixelRatio || 1;
      const widthPx = element.clientWidth;
      const heightPx = element.clientHeight;
      if (widthPx <= 0 || heightPx <= 0) return;
      element.width = Math.round(widthPx * ratio);
      element.height = Math.round(heightPx * ratio);
      renderer.render(context, {
        world: activePaper
          ? { minX: 0, minY: 0, maxX: activePaper.widthMm, maxY: activePaper.heightMm }
          : MODEL_VIEW_WORLD,
        widthPx,
        heightPx,
        devicePixelRatio: ratio,
      }, document.layers, activeLayout.kind === "model" ? [...(movePreview?.entities ?? []), ...(copyPreview?.entities ?? []), ...(rotatePreview?.entities ?? []), ...(scalePreview?.entities ?? []), ...(mirrorPreview?.entities ?? []), ...(offsetPreview?.entities ?? []), ...(trimPreview?.entities ?? []), ...(extendPreview?.entities ?? []), ...(filletPreview?.entities ?? []), ...(chamferPreview?.entities ?? [])] : [], [
        ...(mirrorPreview?.eraseSource ? mirrorPreview.sourceHandles : []),
        ...(offsetPreview?.eraseSource ? offsetPreview.sourceHandles : []),
        ...(trimPreview?.sourceHandles ?? []),
        ...(extendPreview?.sourceHandles ?? []),
        ...(filletPreview?.trimMode === "trim" ? filletPreview.sourceHandles : []),
        ...(chamferPreview?.trimMode === "trim" ? chamferPreview.sourceHandles : []),
      ], activePaper && activePageSetup?.displayPlotStyles ? {
        plotStyle: activePageSetup.plotStyle ?? { profile: "monochrome", plotLineweights: true, plotTransparency: true },
        pixelsPerMillimeter: widthPx / activePaper.widthMm,
      } : {});
    };
    render();
    const observer = new ResizeObserver(render);
    observer.observe(element);
    return () => observer.disconnect();
  }, [activeLayout, activePageSetup, activePaper, chamferPreview, copyPreview, document, extendPreview, filletPreview, mirrorPreview, movePreview, offsetPreview, rotatePreview, scalePreview, trimPreview]);

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
    if (activeLayout.kind !== "model" && modelViewportId === null && MODEL_SPACE_COMMANDS.has(commandId)) {
      throw new CadCommandInputError(`${commandId} cannot mutate hidden Model geometry while a paper layout is active.`);
    }
    const operation = {
      opId: crypto.randomUUID(),
      baseRevision: document.revision,
      commandId,
      args,
      targetHandles,
      resultHandles,
    };
    const candidate = session.current.fork();
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
    if (!modelSpaceEditing) {
      setSelectedHandles([]);
      setStatus("PAPER: geomeetria muutmine avaneb viewport/paper-space etappides; Model-objekte ei muudeta");
      return;
    }
    const handles = document.entities.map((entity) => entity.handle);
    setSelectedHandles(handles);
    if (offsetAwaitingSelection) setStatus(`${handles.length} objekti valitud; OFFSET: määra režiim, külje-/Through-punkt ja valikud`);
    else if (mirrorAwaitingSelection) setStatus(`${handles.length} objekti valitud; MIRROR: määra peegeldusjoon ja lähteobjektide valik`);
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
      const prepared = prepareMove(document, { targetHandles: selectedHandles, baseInput: moveBaseInput, destinationInput: moveDestinationInput });
      const { result } = prepared;
      setLastMoveRejected(result.rejected);
      setMoveAwaitingSelection(false);
      if (result.changes.length === 0) {
        const suffix = result.rejected.length ? `; ${result.rejected.length} lukus, puudu või toetamata` : "";
        setStatus(`MOVE ei muutnud geomeetriat${suffix}`);
        return;
      }
      await commitChanges(prepared.commandId, prepared.operationArgs, result.changes, result.movedHandles, result.movedHandles);
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
      const prepared = prepareCopy(document, { targetHandles: selectedHandles, baseInput: copyBaseInput, destinationsInput: copyDestinationsInput });
      const { result } = prepared;
      setLastCopyRejected(result.rejected);
      setCopyAwaitingSelection(false);
      if (result.changes.length === 0) {
        const suffix = result.rejected.length ? `; ${result.rejected.length} lukus, puudu või toetamata` : "";
        setStatus(`COPY ei loonud geomeetriat${suffix}`);
        return;
      }
      await commitChanges(
        prepared.commandId,
        prepared.operationArgs,
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
      const prepared = prepareRotate(document, {
        targetHandles: selectedHandles,
        baseInput: rotateBaseInput,
        mode: rotateMode,
        angleInput: rotateAngleInput,
        referenceInput: rotateReferenceInput,
        newAngleInput: rotateNewAngleInput,
      });
      const { result } = prepared;
      setLastRotateRejected(result.rejected);
      setRotateAwaitingSelection(false);
      if (result.changes.length === 0) {
        const suffix = result.rejected.length ? `; ${result.rejected.length} lukus, puudu või toetamata` : "";
        setStatus(`ROTATE ei muutnud geomeetriat${suffix}`);
        return;
      }
      await commitChanges(
        prepared.commandId,
        prepared.operationArgs,
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
      const prepared = prepareScale(document, {
        targetHandles: selectedHandles,
        baseInput: scaleBaseInput,
        mode: scaleMode,
        factorInput: scaleFactorInput,
        referenceInput: scaleReferenceInput,
        newLengthInput: scaleNewLengthInput,
        copy: scaleCopy,
      });
      const { result } = prepared;
      setLastScaleRejected(result.rejected);
      setScaleAwaitingSelection(false);
      if (result.changes.length === 0) {
        if (result.factor === 1 && !result.copy && result.sourceHandles.length > 0) {
          await commitChanges(
            prepared.commandId,
            { ...prepared.operationArgs, geometryNoOp: true },
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
        prepared.commandId,
        prepared.operationArgs,
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
      const prepared = prepareMirror(document, {
        targetHandles: selectedHandles,
        firstPointInput: mirrorFirstPointInput,
        secondPointInput: mirrorSecondPointInput,
        eraseSource: mirrorEraseSource,
      });
      const { result } = prepared;
      setLastMirrorRejected(result.rejected);
      setMirrorAwaitingSelection(false);
      if (result.changes.length === 0) {
        const suffix = result.rejected.length ? `; ${result.rejected.length} lukus, puudu või toetamata` : "";
        setStatus(`MIRROR ei loonud geomeetriat${suffix}`);
        return;
      }
      await commitChanges(
        prepared.commandId,
        prepared.operationArgs,
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

  function undoOffsetPlacement(): void {
    const tokens = offsetPlacementInput.split(/[;\r\n]+/).map((token) => token.trim()).filter(Boolean);
    if (tokens.length === 0) {
      setStatus("OFFSET Undo: käsk on täielikult tagasi võetud; globaalset UNDO sammu ei loodud");
      return;
    }
    tokens.pop();
    setOffsetPlacementInput(tokens.join("; "));
    setPreviewCommand("OFFSET");
    setStatus(tokens.length
      ? `OFFSET Undo: viimane paigutus eemaldatud; ${tokens.length} paigutust jääb`
      : "OFFSET Undo: kõik paigutused eemaldatud; globaalset UNDO sammu ei loodud");
  }

  async function offsetSelected(): Promise<void> {
    if (committing.current) return;
    setPreviewCommand("OFFSET");
    if (selectedHandles.length === 0) {
      setMoveAwaitingSelection(false);
      setCopyAwaitingSelection(false);
      setRotateAwaitingSelection(false);
      setScaleAwaitingSelection(false);
      setMirrorAwaitingSelection(false);
      setOffsetAwaitingSelection(true);
      setStatus("OFFSET: vali objektid, seejärel kinnita valik, režiim ja külje-/Through-punkt");
      return;
    }
    committing.current = true;
    try {
      const prepared = prepareOffset(document, {
        targetHandles: selectedHandles,
        mode: offsetMode,
        distanceInput: offsetDistanceInput,
        placementInput: offsetPlacementInput,
        multiple: offsetMultiple,
        eraseSource: offsetEraseSource,
        layerMode: offsetLayerMode,
      });
      const { result } = prepared;
      setLastOffsetRejected(result.rejected);
      setOffsetAwaitingSelection(false);
      if (result.changes.length === 0) {
        const suffix = result.rejected.length ? `; ${result.rejected.length} lukus, peidetud, puudu või sobimatu` : "";
        setStatus(`OFFSET ei loonud geomeetriat${suffix}`);
        return;
      }
      await commitChanges(
        prepared.commandId,
        prepared.operationArgs,
        result.changes,
        result.createdHandles,
        result.sourceHandles,
      );
      setSelectedHandles([]);
      const suffix = result.rejected.length ? `; ${result.rejected.length} jäi muutmata` : "";
      setStatus(`${result.createdHandles.length} OFFSET tulemust loodud${result.multiple ? " (Multiple)" : ""}; lähteobjektid ${result.eraseSource ? "kustutatud" : "säilitatud"}${suffix}`);
    } catch (error) {
      if (error instanceof StorageRevisionConflictError) await recoverFromStorageConflict(error);
      else if (error instanceof CadCommandInputError) {
        setOffsetAwaitingSelection(false);
        setStatus(`OFFSET viga: ${error.message}`);
      } else throw error;
    } finally {
      committing.current = false;
    }
  }

  function undoTrimTarget(): void {
    const tokens = trimTargetsInput.split(/[;\r\n]+/).map((token) => token.trim()).filter(Boolean);
    if (tokens.length === 0) {
      setStatus("TRIM Undo: käsk on täielikult tagasi võetud; globaalset UNDO sammu ei loodud");
      return;
    }
    tokens.pop();
    setTrimTargetsInput(tokens.join("; "));
    setPreviewCommand("TRIM");
    setStatus(tokens.length
      ? `TRIM Undo: viimane siht eemaldatud; ${tokens.length} sihtmärki jääb`
      : "TRIM Undo: kõik sihid eemaldatud; globaalset UNDO sammu ei loodud");
  }

  function selectTrimTargetsFromPath(): void {
    try {
      const points = trimPathInput.split(/[;\r\n]+/).map((token) => token.trim()).filter(Boolean).map(parseCartesianPoint);
      const hiddenLayers = new Set(document.layers.filter((layer) => !layer.visible || layer.frozen).map((layer) => layer.id));
      const candidates = document.entities.filter((entity) => !hiddenLayers.has(entity.layerId));
      const hits = trimPathMode === "fence"
        ? selectCadEntityHitsByFence(candidates, points)
        : selectCadEntityHitsByCrossingPolygon(candidates, points);
      setTrimTargetsInput(hits.map((hit) => `${hit.handle}@${hit.pickPoint.x},${hit.pickPoint.y}`).join("; "));
      setPreviewCommand("TRIM");
      setStatus(hits.length
        ? `TRIM ${trimPathMode === "fence" ? "Fence" : "Crossing"}: ${hits.length} sihtmärki valitud`
        : `TRIM ${trimPathMode === "fence" ? "Fence" : "Crossing"}: geomeetriat ei tabatud`);
    } catch (error) {
      setStatus(`TRIM valikuviga: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  function selectModifyTargetFromCanvas(event: React.PointerEvent<HTMLCanvasElement>): void {
    if (!modelSpaceEditing || (previewCommand !== "TRIM" && previewCommand !== "EXTEND" && previewCommand !== "FILLET" && previewCommand !== "CHAMFER") || event.button !== 0) return;
    const element = event.currentTarget;
    const rect = element.getBoundingClientRect();
    if (!(rect.width > 0 && rect.height > 0)) return;
    const viewport: Viewport2D = {
      world: MODEL_VIEW_WORLD,
      widthPx: rect.width,
      heightPx: rect.height,
      devicePixelRatio: window.devicePixelRatio || 1,
    };
    const point = viewportScreenToWorld(viewport, { x: event.clientX - rect.left, y: event.clientY - rect.top });
    const tolerance = viewportScreenTransform(viewport).worldUnitsPerPixel * 8;
    const hiddenLayers = new Set(document.layers.filter((layer) => !layer.visible || layer.frozen).map((layer) => layer.id));
    const hits = document.entities.flatMap((entity, index) => {
      if (hiddenLayers.has(entity.layerId)) return [];
      const hit = pickCadEntity(entity, point, tolerance);
      return hit ? [{ ...hit, drawIndex: index }] : [];
    }).sort((first, second) => first.distance - second.distance || second.drawIndex - first.drawIndex);
    const hit = hits[0];
    if (!hit) {
      setStatus(`${previewCommand} valik: objekti ei leitud ${tolerance.toFixed(3)} ühiku raadiuses`);
      return;
    }
    const cleanCoordinate = (value: number): number => Number(value.toFixed(6));
    const pickPoint = { x: cleanCoordinate(hit.point.x), y: cleanCoordinate(hit.point.y) };
    if (previewCommand === "CHAMFER") {
      setChamferMode("pairs");
      if (!chamferFirstCanvasPick) {
        if (!chamferCanvasSessionActive) setChamferPairsInput("");
        setChamferCanvasSessionActive(true);
        const entity = document.entities.find((candidate) => candidate.handle === hit.handle);
        const segment = entity?.kind === "polyline" ? hit.segment : undefined;
        setChamferFirstCanvasPick({ handle: hit.handle, ...(segment === undefined ? {} : { segment }), point: pickPoint });
        setStatus(`CHAMFER esimene objekt: ${hit.handle}${segment === undefined ? "" : ` segment ${segment}`}; vali teine objekt`);
        return;
      }
      const secondEntity = document.entities.find((candidate) => candidate.handle === hit.handle);
      const secondSegment = secondEntity?.kind === "polyline" ? hit.segment : undefined;
      const firstToken = `${chamferFirstCanvasPick.handle}${chamferFirstCanvasPick.segment === undefined ? "" : `#${chamferFirstCanvasPick.segment}`}`;
      const secondToken = `${hit.handle}${secondSegment === undefined ? "" : `#${secondSegment}`}`;
      const pair = `${firstToken}@${chamferFirstCanvasPick.point.x},${chamferFirstCanvasPick.point.y}>${secondToken}@${pickPoint.x},${pickPoint.y}${event.shiftKey ? "~0" : ""}`;
      setChamferPairsInput((current) => current.trim() ? `${current.trim()}; ${pair}` : pair);
      setChamferFirstCanvasPick(null);
      setStatus(event.shiftKey
        ? `CHAMFER Shift-teine objekt: ${hit.handle}; see paar kasutab nullkaugusega teravat nurka`
        : `CHAMFER paar lisatud: ${chamferFirstCanvasPick.handle}+${hit.handle}; vali järgmine esimene objekt või käivita CHAMFER`);
      return;
    }
    if (previewCommand === "FILLET") {
      setFilletMode("pairs");
      if (!filletFirstCanvasPick) {
        if (!filletCanvasSessionActive) setFilletPairsInput("");
        setFilletCanvasSessionActive(true);
        const entity = document.entities.find((candidate) => candidate.handle === hit.handle);
        const segment = entity?.kind === "polyline" ? hit.segment : undefined;
        setFilletFirstCanvasPick({ handle: hit.handle, ...(segment === undefined ? {} : { segment }), point: pickPoint });
        setStatus(`FILLET esimene objekt: ${hit.handle}${segment === undefined ? "" : ` segment ${segment}`}; vali teine objekt${event.shiftKey ? " (Shift rakendub teisele valikule)" : ""}`);
        return;
      }
      const secondEntity = document.entities.find((candidate) => candidate.handle === hit.handle);
      const secondSegment = secondEntity?.kind === "polyline" ? hit.segment : undefined;
      const firstToken = `${filletFirstCanvasPick.handle}${filletFirstCanvasPick.segment === undefined ? "" : `#${filletFirstCanvasPick.segment}`}`;
      const secondToken = `${hit.handle}${secondSegment === undefined ? "" : `#${secondSegment}`}`;
      const pair = `${firstToken}@${filletFirstCanvasPick.point.x},${filletFirstCanvasPick.point.y}>${secondToken}@${pickPoint.x},${pickPoint.y}${event.shiftKey ? "~0" : ""}`;
      setFilletPairsInput((current) => current.trim() ? `${current.trim()}; ${pair}` : pair);
      setFilletFirstCanvasPick(null);
      setStatus(event.shiftKey
        ? `FILLET Shift-teine objekt: ${hit.handle}; see paar kasutab raadiust 0, salvestatud Radius ei muutunud`
        : `FILLET paar lisatud: ${filletFirstCanvasPick.handle}+${hit.handle}; vali järgmine esimene objekt või käivita FILLET`);
      return;
    }
    if (previewCommand === "TRIM") {
      const action: TrimTargetAction = event.shiftKey ? "extend" : trimTargetAction === "extend" ? "trim" : trimTargetAction;
      setTrimTargetAction(action);
      setTrimTargetsInput(`${hit.handle}@${pickPoint.x},${pickPoint.y}`);
      setStatus(event.shiftKey
        ? `TRIM Shift-valik: ${hit.handle} pikendatakse`
        : `TRIM valik: ${hit.handle} · ${action}`);
      return;
    }
    const action: ExtendTargetAction = event.shiftKey ? "trim" : "extend";
    setExtendTargetAction(action);
    setExtendTargetsInput(`${hit.handle}@${pickPoint.x},${pickPoint.y}`);
    setStatus(event.shiftKey
      ? `EXTEND Shift-valik: ${hit.handle} kärbitakse`
      : `EXTEND valik: ${hit.handle} · extend`);
  }

  async function trimTargets(): Promise<void> {
    if (committing.current) return;
    setPreviewCommand("TRIM");
    committing.current = true;
    try {
      const prepared = prepareTrim(document, {
        mode: trimMode,
        cuttingHandlesInput: trimCuttingHandlesInput,
        targetsInput: trimTargetsInput,
        targetAction: trimTargetAction,
        edgeMode: trimEdgeMode,
        projectMode: trimProjectMode,
      });
      const { result } = prepared;
      setLastTrimRejected(result.rejected);
      if (result.changes.length === 0) {
        const suffix = result.rejected.length ? `; ${result.rejected.length} lukus, peidetud, puudu või sobimatu` : "";
        setStatus(`TRIM ei muutnud geomeetriat${suffix}`);
        return;
      }
      await commitChanges(
        prepared.commandId,
        prepared.operationArgs,
        result.changes,
        result.resultHandles,
        result.targetHandles,
      );
      setSelectedHandles([]);
      const suffix = result.rejected.length ? `; ${result.rejected.length} jäi muutmata` : "";
      setStatus(`${result.steps.length} TRIM sammu salvestatud ühe Undo-operatsioonina${suffix}`);
    } catch (error) {
      if (error instanceof StorageRevisionConflictError) await recoverFromStorageConflict(error);
      else if (error instanceof CadCommandInputError) setStatus(`TRIM viga: ${error.message}`);
      else throw error;
    } finally {
      committing.current = false;
    }
  }

  function undoExtendTarget(): void {
    const tokens = extendTargetsInput.split(/[;\r\n]+/).map((token) => token.trim()).filter(Boolean);
    if (tokens.length === 0) {
      setStatus("EXTEND Undo: käsk on täielikult tagasi võetud; globaalset UNDO sammu ei loodud");
      return;
    }
    tokens.pop();
    setExtendTargetsInput(tokens.join("; "));
    setPreviewCommand("EXTEND");
    setStatus(tokens.length
      ? `EXTEND Undo: viimane siht eemaldatud; ${tokens.length} sihtmärki jääb`
      : "EXTEND Undo: kõik sihid eemaldatud; globaalset UNDO sammu ei loodud");
  }

  function selectExtendTargetsFromPath(): void {
    try {
      const points = extendPathInput.split(/[;\r\n]+/).map((token) => token.trim()).filter(Boolean).map(parseCartesianPoint);
      const hiddenLayers = new Set(document.layers.filter((layer) => !layer.visible || layer.frozen).map((layer) => layer.id));
      const candidates = document.entities.filter((entity) => !hiddenLayers.has(entity.layerId));
      const hits = extendPathMode === "fence"
        ? selectCadEntityHitsByFence(candidates, points)
        : selectCadEntityHitsByCrossingPolygon(candidates, points);
      setExtendTargetsInput(hits.map((hit) => `${hit.handle}@${hit.pickPoint.x},${hit.pickPoint.y}`).join("; "));
      setPreviewCommand("EXTEND");
      setStatus(hits.length
        ? `EXTEND ${extendPathMode === "fence" ? "Fence" : "Crossing"}: ${hits.length} sihtmärki valitud`
        : `EXTEND ${extendPathMode === "fence" ? "Fence" : "Crossing"}: geomeetriat ei tabatud`);
    } catch (error) {
      setStatus(`EXTEND valikuviga: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async function extendTargets(): Promise<void> {
    if (committing.current) return;
    setPreviewCommand("EXTEND");
    committing.current = true;
    try {
      const prepared = prepareExtend(document, {
        mode: extendMode,
        boundaryHandlesInput: extendBoundaryHandlesInput,
        targetsInput: extendTargetsInput,
        targetAction: extendTargetAction,
        edgeMode: extendEdgeMode,
        projectMode: extendProjectMode,
      });
      const { result } = prepared;
      setLastExtendRejected(result.rejected);
      if (result.changes.length === 0) {
        const suffix = result.rejected.length ? `; ${result.rejected.length} lukus, peidetud, puudu või sobimatu` : "";
        setStatus(`EXTEND ei muutnud geomeetriat${suffix}`);
        return;
      }
      await commitChanges(prepared.commandId, prepared.operationArgs, result.changes, result.resultHandles, result.targetHandles);
      setSelectedHandles([]);
      const suffix = result.rejected.length ? `; ${result.rejected.length} jäi muutmata` : "";
      setStatus(`${result.steps.length} EXTEND sammu salvestatud ühe Undo-operatsioonina${suffix}`);
    } catch (error) {
      if (error instanceof StorageRevisionConflictError) await recoverFromStorageConflict(error);
      else if (error instanceof CadCommandInputError) setStatus(`EXTEND viga: ${error.message}`);
      else throw error;
    } finally {
      committing.current = false;
    }
  }

  function undoFilletSource(): void {
    if (filletFirstCanvasPick) {
      setFilletFirstCanvasPick(null);
      setStatus("FILLET Undo: pooleliolev esimese objekti valik tühistatud");
      return;
    }
    if (filletMode === "pairs") {
      const tokens = filletPairsInput.split(/[;\r\n]+/).map((token) => token.trim()).filter(Boolean);
      if (tokens.length === 0) {
        setStatus("FILLET Undo: käsk on täielikult tagasi võetud; globaalset UNDO sammu ei loodud");
        return;
      }
      tokens.pop();
      setFilletPairsInput(tokens.join("; "));
      setPreviewCommand("FILLET");
      setStatus(tokens.length ? `FILLET Undo: viimane paar eemaldatud; ${tokens.length} paari jääb` : "FILLET Undo: kõik paarid eemaldatud; globaalset UNDO sammu ei loodud");
      return;
    }
    const handles = filletPolylineHandlesInput.split(/[,;\s]+/u).map((token) => token.trim()).filter(Boolean);
    if (handles.length === 0) {
      setStatus("FILLET Polyline Undo: käsk on täielikult tagasi võetud; globaalset UNDO sammu ei loodud");
      return;
    }
    handles.pop();
    setFilletPolylineHandlesInput(handles.join(","));
    setPreviewCommand("FILLET");
    setStatus(handles.length ? `FILLET Polyline Undo: viimane objekt eemaldatud; ${handles.length} jääb` : "FILLET Polyline Undo: kõik objektid eemaldatud; globaalset UNDO sammu ei loodud");
  }

  async function filletTargets(): Promise<void> {
    if (committing.current) return;
    setPreviewCommand("FILLET");
    committing.current = true;
    try {
      const prepared = prepareFillet(document, {
        mode: filletMode,
        radiusInput: filletRadiusInput,
        pairsInput: filletPairsInput,
        polylineHandlesInput: filletPolylineHandlesInput,
        trimMode: filletTrimMode,
        filletPolylineArc,
      });
      const { result } = prepared;
      setLastFilletRejected(result.rejected);
      if (result.changes.length === 0) {
        const suffix = result.rejected.length ? `; ${result.rejected.length} lukus, peidetud, puudu või sobimatu` : "";
        setStatus(`FILLET ei muutnud geomeetriat${suffix}`);
        return;
      }
      await commitChanges(prepared.commandId, prepared.operationArgs, result.changes, result.resultHandles, result.sourceHandles);
      setFilletFirstCanvasPick(null);
      setFilletCanvasSessionActive(false);
      setSelectedHandles([]);
      const suffix = result.rejected.length ? `; ${result.rejected.length} jäi muutmata` : "";
      setStatus(`${result.steps.length} FILLET sammu salvestatud ühe Undo-operatsioonina${suffix}`);
    } catch (error) {
      if (error instanceof StorageRevisionConflictError) await recoverFromStorageConflict(error);
      else if (error instanceof CadCommandInputError) setStatus(`FILLET viga: ${error.message}`);
      else throw error;
    } finally {
      committing.current = false;
    }
  }

  function undoChamferSource(): void {
    if (chamferFirstCanvasPick) {
      setChamferFirstCanvasPick(null);
      setStatus("CHAMFER Undo: pooleliolev esimese objekti valik tühistatud");
      return;
    }
    if (chamferMode === "pairs") {
      const tokens = chamferPairsInput.split(/[;\r\n]+/).map((token) => token.trim()).filter(Boolean);
      if (tokens.length === 0) {
        setStatus("CHAMFER Undo: käsk on täielikult tagasi võetud; globaalset UNDO sammu ei loodud");
        return;
      }
      tokens.pop();
      setChamferPairsInput(tokens.join("; "));
      setPreviewCommand("CHAMFER");
      setStatus(tokens.length ? `CHAMFER Undo: viimane paar eemaldatud; ${tokens.length} paari jääb` : "CHAMFER Undo: kõik paarid eemaldatud; globaalset UNDO sammu ei loodud");
      return;
    }
    const handles = chamferPolylineHandlesInput.split(/[,;\s]+/u).map((token) => token.trim()).filter(Boolean);
    if (handles.length === 0) {
      setStatus("CHAMFER Polyline Undo: käsk on täielikult tagasi võetud; globaalset UNDO sammu ei loodud");
      return;
    }
    handles.pop();
    setChamferPolylineHandlesInput(handles.join(","));
    setPreviewCommand("CHAMFER");
    setStatus(handles.length ? `CHAMFER Polyline Undo: viimane objekt eemaldatud; ${handles.length} jääb` : "CHAMFER Polyline Undo: kõik objektid eemaldatud; globaalset UNDO sammu ei loodud");
  }

  async function chamferTargets(): Promise<void> {
    if (committing.current) return;
    setPreviewCommand("CHAMFER");
    committing.current = true;
    try {
      const prepared = prepareChamfer(document, {
        mode: chamferMode,
        method: chamferMethod,
        firstDistanceInput: chamferFirstDistanceInput,
        secondDistanceInput: chamferSecondDistanceInput,
        angleInput: chamferAngleInput,
        pairsInput: chamferPairsInput,
        polylineHandlesInput: chamferPolylineHandlesInput,
        trimMode: chamferTrimMode,
      });
      const { result } = prepared;
      setLastChamferRejected(result.rejected);
      if (result.changes.length === 0) {
        const suffix = result.rejected.length ? `; ${result.rejected.length} lukus, peidetud, puudu või sobimatu` : "";
        setStatus(`CHAMFER ei muutnud geomeetriat${suffix}`);
        return;
      }
      await commitChanges(prepared.commandId, prepared.operationArgs, result.changes, result.resultHandles, result.sourceHandles);
      setChamferFirstCanvasPick(null);
      setChamferCanvasSessionActive(false);
      setSelectedHandles([]);
      const suffix = result.rejected.length ? `; ${result.rejected.length} jäi muutmata` : "";
      setStatus(`${result.steps.length} CHAMFER sammu salvestatud ühe Undo-operatsioonina${suffix}`);
    } catch (error) {
      if (error instanceof StorageRevisionConflictError) await recoverFromStorageConflict(error);
      else if (error instanceof CadCommandInputError) setStatus(`CHAMFER viga: ${error.message}`);
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
    if (committing.current || !canUndoInActiveLayout) return;
    committing.current = true;
    try {
      const committed = session.current.undo();
      if (!committed) return;
      const next = session.current.document;
      await database.commitRevision(next, committed.operation);
      setDocument(next);
      setActiveLayoutId((current) => next.layouts.some((layout) => layout.id === current) ? current : next.layouts[0]!.id);
      setSelectedHandles([]);
      setStatus(`UNDO taastatud, revision ${next.revision}`);
    } catch (error) {
      await recoverFromStorageConflict(error);
    } finally {
      committing.current = false;
    }
  }

  async function redoLast(): Promise<void> {
    if (committing.current || !canRedoInActiveLayout) return;
    committing.current = true;
    try {
      const committed = session.current.redo();
      if (!committed) return;
      const next = session.current.document;
      await database.commitRevision(next, committed.operation);
      setDocument(next);
      setActiveLayoutId((current) => next.layouts.some((layout) => layout.id === current) ? current : next.layouts[0]!.id);
      setSelectedHandles([]);
      setStatus(`REDO taastatud, revision ${next.revision}`);
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

  async function createLayout(): Promise<void> {
    if (committing.current) return;
    committing.current = true;
    try {
      const result = createPaperLayout(document);
      await commitChanges("LAYOUT_CREATE", { name: result.layouts.find((layout) => layout.id === result.layoutId)!.name }, result.changes, []);
      setActiveLayoutId(result.layoutId);
      setLayoutRenameInput(result.layouts.find((layout) => layout.id === result.layoutId)!.name);
    } catch (error) {
      if (error instanceof StorageRevisionConflictError) await recoverFromStorageConflict(error);
      else if (error instanceof LayoutCommandError) setStatus(`LAYOUT viga: ${error.message}`);
      else throw error;
    } finally {
      committing.current = false;
    }
  }

  async function copyLayout(): Promise<void> {
    if (committing.current || activeLayout.kind !== "paper") return;
    committing.current = true;
    try {
      const result = copyPaperLayout(document, activeLayout.id);
      const copied = result.layouts.find((layout) => layout.id === result.layoutId)!;
      await commitChanges(
        "LAYOUT_COPY",
        { sourceLayoutId: activeLayout.id, resultLayoutId: copied.id },
        result.changes,
        (copied.entities ?? []).map((entity) => entity.handle),
        (activeLayout.entities ?? []).map((entity) => entity.handle),
      );
      setActiveLayoutId(copied.id);
      setLayoutRenameInput(copied.name);
    } catch (error) {
      if (error instanceof StorageRevisionConflictError) await recoverFromStorageConflict(error);
      else if (error instanceof LayoutCommandError) setStatus(`LAYOUT viga: ${error.message}`);
      else throw error;
    } finally {
      committing.current = false;
    }
  }

  async function reorderLayout(delta: -1 | 1): Promise<void> {
    if (committing.current || activeLayout.kind !== "paper") return;
    committing.current = true;
    try {
      const result = movePaperLayout(document, activeLayout.id, delta);
      await commitChanges("LAYOUT_REORDER", { layoutId: activeLayout.id, delta }, result.changes, []);
    } catch (error) {
      if (error instanceof StorageRevisionConflictError) await recoverFromStorageConflict(error);
      else if (error instanceof LayoutCommandError) setStatus(`LAYOUT viga: ${error.message}`);
      else throw error;
    } finally {
      committing.current = false;
    }
  }

  async function renameLayout(): Promise<void> {
    if (committing.current || activeLayout.kind !== "paper") return;
    committing.current = true;
    try {
      const result = renamePaperLayout(document, activeLayout.id, layoutRenameInput);
      const renamed = result.layouts.find((layout) => layout.id === activeLayout.id)!;
      await commitChanges("LAYOUT_RENAME", { layoutId: activeLayout.id, name: renamed.name }, result.changes, []);
      setLayoutRenameInput(renamed.name);
    } catch (error) {
      if (error instanceof StorageRevisionConflictError) await recoverFromStorageConflict(error);
      else if (error instanceof LayoutCommandError) setStatus(`LAYOUT viga: ${error.message}`);
      else throw error;
    } finally {
      committing.current = false;
    }
  }

  async function deleteLayout(): Promise<void> {
    if (committing.current || activeLayout.kind !== "paper") return;
    if (!window.confirm(`Kustuta paigutus “${activeLayout.name}”?`)) return;
    committing.current = true;
    try {
      const deletedHandles = (activeLayout.entities ?? []).map((entity) => entity.handle);
      const result = deletePaperLayout(document, activeLayout.id);
      await commitChanges("LAYOUT_DELETE", { layoutId: activeLayout.id }, result.changes, [], deletedHandles);
      setActiveLayoutId(result.layoutId);
      setLayoutRenameInput(result.layouts.find((layout) => layout.id === result.layoutId)?.name ?? "");
    } catch (error) {
      if (error instanceof StorageRevisionConflictError) await recoverFromStorageConflict(error);
      else if (error instanceof LayoutCommandError) setStatus(`LAYOUT viga: ${error.message}`);
      else throw error;
    } finally {
      committing.current = false;
    }
  }

  function viewportPlacement(index: number): { center: { x: number; y: number }; width: number; height: number } {
    if (!activePaper) throw new LayoutCommandError("INVALID_PAPER", "Paper definition is missing.");
    const margins = activePaper.marginsMm;
    const printableWidth = activePaper.widthMm - margins.left - margins.right;
    const printableHeight = activePaper.heightMm - margins.top - margins.bottom;
    const gap = Math.min(5, printableWidth / 20);
    const width = (printableWidth - gap) / 2;
    const column = index % 2;
    return {
      center: {
        x: margins.left + width / 2 + column * (width + gap),
        y: margins.bottom + printableHeight / 2,
      },
      width,
      height: printableHeight,
    };
  }

  async function addViewport(kind: "rectangle" | "polygon"): Promise<void> {
    if (committing.current || activeLayout.kind !== "paper" || !activePaper) return;
    committing.current = true;
    try {
      const placement = viewportPlacement(activeLayout.viewports.length);
      const viewCenter = activeLayout.viewports.length % 2 === 0 ? { x: 0, y: 0 } : { x: 2000, y: 0 };
      const clipBoundary = kind === "polygon" ? [
        { x: placement.center.x - placement.width / 2, y: placement.center.y - placement.height * 0.28 },
        { x: placement.center.x - placement.width * 0.28, y: placement.center.y - placement.height / 2 },
        { x: placement.center.x + placement.width * 0.28, y: placement.center.y - placement.height / 2 },
        { x: placement.center.x + placement.width / 2, y: placement.center.y - placement.height * 0.12 },
        { x: placement.center.x + placement.width * 0.38, y: placement.center.y + placement.height / 2 },
        { x: placement.center.x - placement.width * 0.38, y: placement.center.y + placement.height / 2 },
      ] : undefined;
      const result = createPaperViewport(document, activeLayout.id, {
        ...placement,
        viewCenter,
        viewHeight: 1200,
        twistAngleRad: 0,
        locked: false,
        ...(clipBoundary ? { clipBoundary } : {}),
      });
      await commitChanges("VIEWPORT_CREATE", { layoutId: activeLayout.id, kind, viewportId: result.viewportId }, result.changes, []);
      setSelectedViewportId(result.viewportId);
      setModelViewportId(null);
      setStatus(`${kind === "polygon" ? "Polügoon" : "Ristkülik"}viewport ${result.viewportId} loodud`);
    } catch (error) {
      if (error instanceof StorageRevisionConflictError) await recoverFromStorageConflict(error);
      else if (error instanceof LayoutCommandError) setStatus(`VIEWPORT viga: ${error.message}`);
      else throw error;
    } finally {
      committing.current = false;
    }
  }

  async function deleteSelectedViewport(): Promise<void> {
    if (committing.current || activeLayout.kind !== "paper" || selectedViewportId === null) return;
    committing.current = true;
    try {
      const deletedViewportId = selectedViewportId;
      const result = deletePaperViewport(document, activeLayout.id, deletedViewportId);
      await commitChanges("VIEWPORT_DELETE", { layoutId: activeLayout.id, viewportId: deletedViewportId }, result.changes, []);
      setSelectedViewportId(result.viewportId);
      setModelViewportId(null);
      setStatus(`Viewport ${deletedViewportId} kustutatud; PAPER aktiivne`);
    } catch (error) {
      if (error instanceof StorageRevisionConflictError) await recoverFromStorageConflict(error);
      else if (error instanceof LayoutCommandError) setStatus(`VIEWPORT viga: ${error.message}`);
      else throw error;
    } finally {
      committing.current = false;
    }
  }

  function viewportNumber(value: string, label: string): number {
    const parsed = Number(value.trim().replace(",", "."));
    if (!Number.isFinite(parsed)) throw new LayoutCommandError("INVALID_VIEWPORT", `${label} peab olema lõplik arv.`);
    return parsed;
  }

  async function applySelectedViewportView(): Promise<void> {
    if (committing.current || activeLayout.kind !== "paper" || selectedViewport === null) return;
    if (modelViewportId !== selectedViewport.id) {
      setStatus("Ava valitud viewport topeltklõpsuga MODEL-kontekstis.");
      return;
    }
    committing.current = true;
    try {
      const scaleDenominator = viewportNumber(viewportScaleInput, "Mõõtkava");
      const viewCenter = {
        x: viewportNumber(viewportCenterXInput, "Keskme X"),
        y: viewportNumber(viewportCenterYInput, "Keskme Y"),
      };
      const twistAngleRad = (viewportNumber(viewportTwistInput, "Pöördenurk") * Math.PI) / 180;
      const result = setPaperViewportView(document, activeLayout.id, selectedViewport.id, { viewCenter, scaleDenominator, twistAngleRad });
      await commitChanges("VIEWPORT_VIEW", { layoutId: activeLayout.id, viewportId: selectedViewport.id, scaleDenominator, viewCenter, twistAngleRad }, result.changes, []);
      const changed = result.layouts.find((layout) => layout.id === activeLayout.id)!.viewports.find((viewport) => viewport.id === selectedViewport.id)!;
      setStatus(`${selectedViewport.id}: ${formatViewportScale(changed)} · keskus ${changed.viewCenter.x},${changed.viewCenter.y} · twist ${Number(((changed.twistAngleRad * 180) / Math.PI).toFixed(6))}°`);
    } catch (error) {
      if (error instanceof StorageRevisionConflictError) await recoverFromStorageConflict(error);
      else if (error instanceof LayoutCommandError) setStatus(`VIEWPORT viga: ${error.message}`);
      else throw error;
    } finally {
      committing.current = false;
    }
  }

  async function setSelectedViewportLock(locked: boolean): Promise<void> {
    if (committing.current || activeLayout.kind !== "paper" || selectedViewport === null || selectedViewport.locked === locked) return;
    committing.current = true;
    try {
      const result = setPaperViewportDisplayLocked(document, activeLayout.id, selectedViewport.id, locked);
      if (result.changes.length === 0) return;
      await commitChanges("VIEWPORT_LOCK", { layoutId: activeLayout.id, viewportId: selectedViewport.id, locked }, result.changes, []);
      setStatus(`${selectedViewport.id}: viewport ${locked ? "lukustatud" : "avatud"}; MODEL ${modelViewportId === selectedViewport.id ? "aktiivne" : "ei ole aktiivne"}`);
    } catch (error) {
      if (error instanceof StorageRevisionConflictError) await recoverFromStorageConflict(error);
      else if (error instanceof LayoutCommandError) setStatus(`VIEWPORT viga: ${error.message}`);
      else throw error;
    } finally {
      committing.current = false;
    }
  }

  async function zoomViewport(viewportId: string, anchorModel: { x: number; y: number }, scaleFactor: number): Promise<void> {
    if (committing.current || activeLayout.kind !== "paper" || modelViewportId !== viewportId) return;
    committing.current = true;
    try {
      const result = zoomPaperViewportAtModelPoint(document, activeLayout.id, viewportId, anchorModel, scaleFactor);
      const changed = result.layouts.find((layout) => layout.id === activeLayout.id)!.viewports.find((viewport) => viewport.id === viewportId)!;
      await commitChanges("VIEWPORT_ZOOM", { layoutId: activeLayout.id, viewportId, anchorModel, scaleFactor, scaleDenominator: viewportScaleDenominator(changed) }, result.changes, []);
      setStatus(`${viewportId}: kursoriankruga ${formatViewportScale(changed)}`);
    } catch (error) {
      if (error instanceof StorageRevisionConflictError) await recoverFromStorageConflict(error);
      else if (error instanceof LayoutCommandError) setStatus(`VIEWPORT viga: ${error.message}`);
      else throw error;
    } finally {
      committing.current = false;
    }
  }

  async function panViewport(viewportId: string, deltaPx: { x: number; y: number }, viewportPx: { width: number; height: number }): Promise<void> {
    if (committing.current || activeLayout.kind !== "paper" || modelViewportId !== viewportId) return;
    committing.current = true;
    try {
      const result = panPaperViewportByPixels(document, activeLayout.id, viewportId, deltaPx, viewportPx);
      const changed = result.layouts.find((layout) => layout.id === activeLayout.id)!.viewports.find((viewport) => viewport.id === viewportId)!;
      await commitChanges("VIEWPORT_PAN", { layoutId: activeLayout.id, viewportId, deltaPx, viewportPx, viewCenter: changed.viewCenter }, result.changes, []);
      setStatus(`${viewportId}: keskus ${Number(changed.viewCenter.x.toFixed(6))},${Number(changed.viewCenter.y.toFixed(6))}`);
    } catch (error) {
      if (error instanceof StorageRevisionConflictError) await recoverFromStorageConflict(error);
      else if (error instanceof LayoutCommandError) setStatus(`VIEWPORT viga: ${error.message}`);
      else throw error;
    } finally {
      committing.current = false;
    }
  }

  function activateLayout(layoutId: string): void {
    const layout = document.layouts.find((candidate) => candidate.id === layoutId);
    if (!layout) return;
    setActiveLayoutId(layoutId);
    setLayoutRenameInput(layout.name);
    setSelectedHandles([]);
    setSelectedViewportId(null);
    setModelViewportId(null);
    setStatus(`${layout.name}: ${layout.kind === "model" ? "MODEL" : "PAPER"}`);
  }

  function pageNumber(value: string, label: string, positive = false): number {
    const parsed = Number(value.trim().replace(",", "."));
    if (!Number.isFinite(parsed) || (positive && parsed <= 0)) throw new LayoutCommandError("INVALID_PAPER", `${label} peab olema ${positive ? "positiivne " : ""}arv.`);
    return parsed;
  }

  async function applyPageSetup(): Promise<void> {
    if (committing.current) return;
    committing.current = true;
    try {
      const plotArea: CadPageSetup["plotArea"] = plotAreaInput === "window"
        ? { kind: "window", window: {
            x: pageNumber(plotWindowXInput, "Window X"),
            y: pageNumber(plotWindowYInput, "Window Y"),
            width: pageNumber(plotWindowWidthInput, "Window laius", true),
            height: pageNumber(plotWindowHeightInput, "Window kõrgus", true),
          } }
        : { kind: plotAreaInput };
      const denominator = plotScaleModeInput === "custom"
        ? pageNumber(plotScaleDenominatorInput, "Plot mõõtkava", true)
        : null;
      const setup: CadPageSetup = {
        mediaName: pageMediaInput,
        orientation: pageOrientationInput,
        plotArea,
        plotScale: plotScaleModeInput === "fit" ? { mode: "fit" } : { mode: "custom", paperUnits: 1, drawingUnits: denominator! },
        centerPlot: centerPlotInput,
        plotOriginMm: { x: pageNumber(plotOriginXInput, "Plot offset X"), y: pageNumber(plotOriginYInput, "Plot offset Y") },
        plotStyle: { profile: plotProfileInput, plotLineweights: plotLineweightsInput, plotTransparency: plotTransparencyInput },
        displayPlotStyles: displayPlotStylesInput,
      };
      const result = activeLayout.kind === "model"
        ? setModelLayoutPageSetup(document, activeLayout.id, setup)
        : setPaperLayoutPageSetup(document, activeLayout.id, setup);
      const detached = clearNamedPageSetupAssignment(document, activeLayout.id);
      await commitChanges(activeLayout.kind === "model" ? "PAGESETUP_MODEL" : "PAGESETUP", { layoutId: activeLayout.id, setup }, [...result.changes, ...detached], []);
      setModelViewportId(null);
      setStatus(`${activeLayout.name}: ${pageMediaInput} ${pageOrientationInput}, ${plotAreaInput}, ${plotScaleModeInput === "fit" ? "Fit" : `1:${denominator}`}, ${plotProfileInput}, LW ${plotLineweightsInput ? "ON" : "OFF"}, transparency ${plotTransparencyInput ? "ON" : "OFF"}, preview ${displayPlotStylesInput ? "ON" : "OFF"}`);
    } catch (error) {
      if (error instanceof StorageRevisionConflictError) await recoverFromStorageConflict(error);
      else if (error instanceof LayoutCommandError || error instanceof PageSetupLibraryError) setStatus(`PAGESETUP viga: ${error.message}`);
      else throw error;
    } finally {
      committing.current = false;
    }
  }

  async function saveCurrentNamedPageSetup(): Promise<void> {
    if (committing.current) return;
    committing.current = true;
    try {
      const result = saveNamedPageSetup(document, activeLayout.id, newPageSetupNameInput);
      const named = result.library.setups.find((setup) => setup.id === result.setupId)!;
      await commitChanges("PAGESETUP_SAVE", { layoutId: activeLayout.id, setupId: result.setupId, name: named.name }, result.changes, []);
      setSelectedNamedPageSetupId(result.setupId);
      setRenamePageSetupInput(named.name);
      setNewPageSetupNameInput("");
      setStatus(`Page setup “${named.name}” salvestatud.`);
    } catch (error) {
      if (error instanceof StorageRevisionConflictError) await recoverFromStorageConflict(error);
      else if (error instanceof PageSetupLibraryError || error instanceof LayoutCommandError) setStatus(`PAGESETUP viga: ${error.message}`);
      else throw error;
    } finally {
      committing.current = false;
    }
  }

  async function applySelectedNamedPageSetup(): Promise<void> {
    if (committing.current || !selectedNamedPageSetupId) return;
    committing.current = true;
    try {
      const result = applyNamedPageSetup(document, activeLayout.id, selectedNamedPageSetupId);
      const named = result.library.setups.find((setup) => setup.id === result.setupId)!;
      await commitChanges("PAGESETUP_APPLY", { layoutId: activeLayout.id, setupId: result.setupId }, result.changes, []);
      setModelViewportId(null);
      setStatus(`Page setup “${named.name}” rakendatud paigutusele ${activeLayout.name}.`);
    } catch (error) {
      if (error instanceof StorageRevisionConflictError) await recoverFromStorageConflict(error);
      else if (error instanceof PageSetupLibraryError || error instanceof LayoutCommandError) setStatus(`PAGESETUP viga: ${error.message}`);
      else throw error;
    } finally {
      committing.current = false;
    }
  }

  async function renameSelectedNamedPageSetup(): Promise<void> {
    if (committing.current || !selectedNamedPageSetupId) return;
    committing.current = true;
    try {
      const result = renameNamedPageSetup(document, selectedNamedPageSetupId, renamePageSetupInput);
      const named = result.library.setups.find((setup) => setup.id === result.setupId)!;
      await commitChanges("PAGESETUP_RENAME", { setupId: result.setupId, name: named.name }, result.changes, []);
      setRenamePageSetupInput(named.name);
      setStatus(`Page setup nimetatud: “${named.name}”.`);
    } catch (error) {
      if (error instanceof StorageRevisionConflictError) await recoverFromStorageConflict(error);
      else if (error instanceof PageSetupLibraryError) setStatus(`PAGESETUP viga: ${error.message}`);
      else throw error;
    } finally {
      committing.current = false;
    }
  }

  async function deleteSelectedNamedPageSetup(): Promise<void> {
    if (committing.current || !selectedNamedPageSetupId) return;
    const named = pageSetupLibrary.setups.find((setup) => setup.id === selectedNamedPageSetupId);
    if (!named || !window.confirm(`Kustuta page setup “${named.name}”?`)) return;
    committing.current = true;
    try {
      const result = deleteNamedPageSetup(document, selectedNamedPageSetupId);
      await commitChanges("PAGESETUP_DELETE", { setupId: selectedNamedPageSetupId }, result.changes, []);
      setSelectedNamedPageSetupId("");
      setRenamePageSetupInput("");
      setStatus(`Page setup “${named.name}” kustutatud; layout'ide praegused plotiseaded säilisid.`);
    } catch (error) {
      if (error instanceof StorageRevisionConflictError) await recoverFromStorageConflict(error);
      else if (error instanceof PageSetupLibraryError) setStatus(`PAGESETUP viga: ${error.message}`);
      else throw error;
    } finally {
      committing.current = false;
    }
  }

  function exportPageSetupTemplate(): void {
    try {
      const template = createPageSetupTemplate(document, pageSetupTemplateNameInput);
      const text = serializePageSetupTemplate(template);
      const fileName = `${sanitizePdfFileStem(template.name)}.kdraw-template.json`;
      downloadBlob(new Blob([text], { type: "application/json" }), fileName);
      setStatus(`Page setup template “${template.name}” eksporditud ilma geomeetriata.`);
    } catch (error) {
      if (error instanceof PageSetupLibraryError || error instanceof LayoutCommandError) setStatus(`TEMPLATE viga: ${error.message}`);
      else throw error;
    }
  }

  async function importPageSetupTemplateFile(file: File): Promise<void> {
    if (committing.current) return;
    committing.current = true;
    try {
      if (file.size > MAX_PAGE_SETUP_TEMPLATE_BYTES) {
        throw new PageSetupLibraryError("TEMPLATE_TOO_LARGE", `Page setup template exceeds ${MAX_PAGE_SETUP_TEMPLATE_BYTES} bytes.`);
      }
      const template = parsePageSetupTemplate(await file.text());
      const result = importPageSetupTemplate(document, template);
      await commitChanges("PAGESETUP_TEMPLATE_IMPORT", { templateName: template.name, importedLayoutIds: result.importedLayoutIds, importedSetupIds: result.importedSetupIds }, result.changes, []);
      if (result.importedLayoutIds[0]) setActiveLayoutId(result.importedLayoutIds[0]);
      setSelectedNamedPageSetupId(result.importedLayoutIds[0] ? (result.library.assignments[result.importedLayoutIds[0]] ?? "") : "");
      setStatus(`Template “${template.name}” rakendatud ühe undo-sammuna: ${result.importedSetupIds.length} setup'i, ${result.importedLayoutIds.length} layout'i.`);
    } catch (error) {
      if (error instanceof StorageRevisionConflictError) await recoverFromStorageConflict(error);
      else if (error instanceof PageSetupLibraryError || error instanceof LayoutCommandError) setStatus(`TEMPLATE viga: ${error.message}`);
      else throw error;
    } finally {
      committing.current = false;
    }
  }

  function downloadBlob(blob: Blob, fileName: string): void {
    const url = URL.createObjectURL(blob);
    const anchor = window.document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function currentPaperDisplayWindow(): CadPaperRect {
    if (!activePaper || !paperDesk.current || !paperSheet.current) throw new LayoutCommandError("INVALID_PAPER", "Aktiivne paberivaade puudub.");
    const deskRect = paperDesk.current.getBoundingClientRect(); const sheetRect = paperSheet.current.getBoundingClientRect();
    const deskLeft = deskRect.left + paperDesk.current.clientLeft; const deskTop = deskRect.top + paperDesk.current.clientTop;
    const sheetLeft = sheetRect.left + paperSheet.current.clientLeft; const sheetTop = sheetRect.top + paperSheet.current.clientTop;
    const sheetBottom = sheetTop + paperSheet.current.clientHeight;
    const scaleX = paperSheet.current.clientWidth / activePaper.widthMm; const scaleY = paperSheet.current.clientHeight / activePaper.heightMm;
    if (![scaleX, scaleY].every((value) => Number.isFinite(value) && value > 0) || Math.abs(scaleX - scaleY) > Math.max(scaleX, scaleY) * 0.01) {
      throw new LayoutCommandError("INVALID_PAPER", "Paberivaate piksliskaala ei ole ühtlane.");
    }
    const scale = (scaleX + scaleY) / 2; const round = (value: number) => Number(value.toFixed(6));
    return {
      x: round((deskLeft - sheetLeft) / scale),
      y: round((sheetBottom - (deskTop + paperDesk.current.clientHeight)) / scale),
      width: round(paperDesk.current.clientWidth / scale),
      height: round(paperDesk.current.clientHeight / scale),
    };
  }

  function currentModelDisplayWindow(): CadPaperRect {
    const element = canvas.current;
    if (activeLayout.kind !== "model" || !element || element.clientWidth <= 0 || element.clientHeight <= 0) {
      throw new LayoutCommandError("INVALID_PAPER", "Aktiivne mudelivaade puudub.");
    }
    const viewport: Viewport2D = {
      world: MODEL_VIEW_WORLD,
      widthPx: element.clientWidth,
      heightPx: element.clientHeight,
      devicePixelRatio: window.devicePixelRatio || 1,
    };
    const bottomLeft = viewportScreenToWorld(viewport, { x: 0, y: element.clientHeight });
    const topRight = viewportScreenToWorld(viewport, { x: element.clientWidth, y: 0 });
    const round = (value: number) => Number(value.toFixed(6));
    return {
      x: round(Math.min(bottomLeft.x, topRight.x)),
      y: round(Math.min(bottomLeft.y, topRight.y)),
      width: round(Math.abs(topRight.x - bottomLeft.x)),
      height: round(Math.abs(topRight.y - bottomLeft.y)),
    };
  }

  function modelPlotOptions(): ModelPlotOptions {
    return activePageSetup?.plotArea.kind === "display" ? { displayWindow: currentModelDisplayWindow() } : {};
  }

  function downloadModelSvg(): void {
    if (activeLayout.kind !== "model") return;
    try {
      const output = exportModelSvg(document, modelPlotOptions());
      if (output.skippedHandles.length) {
        setStatus(`Model SVG peatatud: ${output.skippedHandles.length} toetamata objekti`);
        return;
      }
      downloadBlob(new Blob([output.text], { type: "image/svg+xml" }), `${document.documentId}-Model.svg`);
      setStatus(`Model SVG: ${output.placement.setup.plotArea.kind}, ${output.placement.paper.widthMm}×${output.placement.paper.heightMm} mm`);
    } catch (error) {
      setStatus(`Model SVG viga: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  function downloadModelPdf(): void {
    if (activeLayout.kind !== "model") return;
    try {
      const output = exportModelVectorPdf(document, modelPlotOptions());
      if (output.skippedHandles.length) {
        setStatus(`Model PDF peatatud: ${output.skippedHandles.length} toetamata objekti`);
        return;
      }
      downloadBlob(new Blob([output.bytes as Uint8Array<ArrayBuffer>], { type: "application/pdf" }), `${document.documentId}-Model.pdf`);
      setStatus(`Model PDF: ${output.placement.setup.plotArea.kind}, ${output.placement.paper.widthMm}×${output.placement.paper.heightMm} mm`);
    } catch (error) {
      setStatus(`Model PDF viga: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  function downloadActiveLayoutSvg(): void {
    if (activeLayout.kind !== "paper") return;
    const output = exportLayoutSvg(document, activeLayout.id, activePageSetup?.plotArea.kind === "display" && activePaper
      ? { displayWindow: currentPaperDisplayWindow() }
      : {});
    if (output.skippedHandles.length) {
      setStatus(`SVG peatatud: ${output.skippedHandles.length} toetamata objekti`);
      return;
    }
    downloadBlob(new Blob([output.text], { type: "image/svg+xml" }), `${document.documentId}-${activeLayout.name}.svg`);
    setStatus(`SVG: ${output.placement.setup.plotArea.kind}, ${output.placement.paper.widthMm}×${output.placement.paper.heightMm} mm`);
  }

  function downloadActiveLayoutPdf(): void {
    if (activeLayout.kind !== "paper") return;
    const output = exportLayoutVectorPdf(document, activeLayout.id, activePageSetup?.plotArea.kind === "display" && activePaper
      ? { displayWindow: currentPaperDisplayWindow() }
      : {});
    if (output.skippedHandles.length) {
      setStatus(`PDF peatatud: ${output.skippedHandles.length} toetamata objekti`);
      return;
    }
    downloadBlob(new Blob([output.bytes as Uint8Array<ArrayBuffer>], { type: "application/pdf" }), `${document.documentId}-${activeLayout.name}.pdf`);
    setStatus(`PDF: ${output.placement.setup.plotArea.kind}, ${output.placement.paper.widthMm}×${output.placement.paper.heightMm} mm`);
  }

  async function commitPublishSettings(next: LayoutPublishSettingsV1, message: string): Promise<void> {
    if (committing.current) return;
    committing.current = true;
    setPublishCommitting(true);
    try {
      const change = metadataWithLayoutPublishSettings(document, next);
      const normalized = resolveLayoutPublishSettings({ ...document, metadata: change.metadata });
      if (JSON.stringify(normalized) === JSON.stringify(publishSettings)) {
        setPublishBaseNameInput(normalized.baseFileName);
        setStatus(message);
        return;
      }
      await commitChanges("PUBLISH_SET", normalized, [change], []);
      setPublishBaseNameInput(normalized.baseFileName);
      setStatus(message);
    } catch (error) {
      if (error instanceof StorageRevisionConflictError) await recoverFromStorageConflict(error);
      else if (error instanceof LayoutPublishSettingsError) setStatus(`PUBLISH viga: ${error.message}`);
      else throw error;
    } finally {
      setPublishCommitting(false);
      committing.current = false;
    }
  }

  async function setPublishIncluded(layoutId: string, included: boolean): Promise<void> {
    const next = structuredClone(publishSettings);
    const sheet = next.sheets.find((candidate) => candidate.layoutId === layoutId);
    if (!sheet) return;
    sheet.included = included;
    await commitPublishSettings(next, `${included ? "Lisatud" : "Välistatud"}: ${document.layouts.find((layout) => layout.id === layoutId)?.name ?? layoutId}`);
  }

  async function movePublishSheet(index: number, delta: -1 | 1): Promise<void> {
    const destination = index + delta;
    if (destination < 0 || destination >= publishSettings.sheets.length) return;
    const next = structuredClone(publishSettings);
    const [sheet] = next.sheets.splice(index, 1);
    next.sheets.splice(destination, 0, sheet!);
    await commitPublishSettings(next, `Publish järjestus: ${next.sheets.map((entry) => document.layouts.find((layout) => layout.id === entry.layoutId)?.name).join(" → ")}`);
  }

  async function setPublishOutput(output: LayoutPublishSettingsV1["output"]): Promise<void> {
    await commitPublishSettings({ ...structuredClone(publishSettings), output }, `Publish väljund: ${output}`);
  }

  async function savePublishBaseName(): Promise<void> {
    await commitPublishSettings({ ...structuredClone(publishSettings), baseFileName: publishBaseNameInput }, `Publish failinimi: ${publishBaseNameInput}`);
  }

  async function capturePublishDisplayWindow(layoutId: string): Promise<void> {
    if (layoutId !== activeLayout.id || resolvePageSetup(activeLayout)?.plotArea.kind !== "display") {
      setStatus("PUBLISH viga: kuvaala saab salvestada ainult aktiivselt Display-layout'ilt.");
      return;
    }
    const next = structuredClone(publishSettings);
    const sheet = next.sheets.find((candidate) => candidate.layoutId === layoutId);
    if (!sheet) return;
    sheet.displayWindow = currentPaperDisplayWindow();
    await commitPublishSettings(next, `Publish kuvaala salvestatud: ${activeLayout.name}`);
  }

  function publishLayoutOptions(plan: ReturnType<typeof buildLayoutPublishPlan>): Readonly<Record<string, LayoutPlotOptions>> {
    const options: Record<string, LayoutPlotOptions> = {};
    for (const layoutId of plan.layoutIds) {
      const layout = document.layouts.find((candidate) => candidate.id === layoutId);
      if (!layout || resolvePageSetup(layout)?.plotArea.kind !== "display") continue;
      const captured = plan.settings.sheets.find((sheet) => sheet.layoutId === layoutId)?.displayWindow;
      const displayWindow = layoutId === activeLayout.id && activePaper ? currentPaperDisplayWindow() : captured;
      if (!displayWindow) throw new LayoutCommandError("INVALID_PAPER", `Display-layout ${layout.name} vajab enne publish'i salvestatud kuvaala.`);
      options[layoutId] = { displayWindow };
    }
    return options;
  }

  function publishLayouts(): void {
    try {
      const plan = buildLayoutPublishPlan(document, publishSettings);
      const options = publishLayoutOptions(plan);
      if (plan.settings.output === "multi-page") {
        const output = exportLayoutsVectorPdf(document, plan.layoutIds, options);
        if (output.skippedHandles.length) {
          setStatus(`PUBLISH peatatud: ${output.skippedHandles.length} toetamata objekti`);
          return;
        }
        downloadBlob(new Blob([output.bytes as Uint8Array<ArrayBuffer>], { type: "application/pdf" }), plan.multiPageFileName);
        setStatus(`PUBLISH: ${output.pages.length} layout'i ühes järjestatud vektor-PDF-is.`);
        return;
      }
      const outputs = plan.separateFiles.map((file) => ({ file, output: exportLayoutVectorPdf(document, file.layoutId, options[file.layoutId] ?? {}) }));
      const skipped = [...new Set(outputs.flatMap(({ output }) => output.skippedHandles))];
      if (skipped.length) {
        setStatus(`PUBLISH peatatud: ${skipped.length} toetamata objekti`);
        return;
      }
      for (const { file, output } of outputs) {
        downloadBlob(new Blob([output.bytes as Uint8Array<ArrayBuffer>], { type: "application/pdf" }), file.fileName);
      }
      setStatus(`PUBLISH: ${outputs.length} eraldi vektor-PDF faili.`);
    } catch (error) {
      if (error instanceof LayoutPublishSettingsError || error instanceof LayoutCommandError || error instanceof RangeError || error instanceof TypeError) {
        setStatus(`PUBLISH viga: ${error.message}`);
      } else throw error;
    }
  }

  function downloadDxf(): void {
    try {
      const exported = exportDxf(document);
      if (exported.report.skipped.length) {
        setStatus(`DXF peatatud: ${exported.report.skipped.length} toetamata objekti`);
        return;
      }
      const url = URL.createObjectURL(new Blob([exported.bytes as Uint8Array<ArrayBuffer>], { type: "application/dxf" }));
      try {
        const anchor = window.document.createElement("a");
        anchor.href = url;
        anchor.download = `${sanitizePdfFileStem(document.documentId)}-r${document.revision}.dxf`;
        anchor.click();
      } finally {
        URL.revokeObjectURL(url);
      }
      setStatus(`DXF eksporditud: ${exported.report.emittedHandles.length} objekti`);
    } catch (error) {
      if (error instanceof LayoutPublishSettingsError || error instanceof RangeError || error instanceof TypeError) {
        setStatus(`DXF viga: ${error.message}`);
      } else throw error;
    }
  }

  async function importDxfFile(file: File | undefined, input: HTMLInputElement): Promise<void> {
    if (!file || committing.current) {
      input.value = "";
      return;
    }
    committing.current = true;
    try {
      if (file.size > MAX_DXF_IMPORT_BYTES) throw new DxfImportError(`Fail ületab ${MAX_DXF_IMPORT_BYTES} baidi impordipiiri.`);
      const bytes = new Uint8Array(await file.arrayBuffer());
      const imported = importDxf(bytes, { documentId: document.documentId });
      if (imported.report.skipped.length) {
        const first = imported.report.skipped[0]!;
        setStatus(`DXF import peatatud: ${imported.report.skipped.length} toetamata objekti; esimene ${first.type}${first.handle ? ` ${first.handle}` : ""}.`);
        return;
      }
      const previousHandles = document.entities.map((entity) => entity.handle);
      await commitChanges(
        "DXFIN",
        { fileName: file.name, byteLength: file.size, acadVersion: imported.report.acadVersion, codePage: imported.report.codePage },
        replaceDrawingContentPreservingLayouts(document, imported.document),
        imported.report.importedHandles,
        previousHandles,
      );
      setSelectedHandles([]);
      setActiveLayoutId("model");
      setSelectedViewportId(null);
      setModelViewportId(null);
      setStatus(`DXF imporditud: ${imported.report.importedHandles.length} objekti · ${imported.document.layers.length} kihti · ${imported.document.units.linear}`);
    } catch (error) {
      if (error instanceof StorageRevisionConflictError) await recoverFromStorageConflict(error);
      else if (error instanceof NoOpOperationError) setStatus("DXF import muutusteta: sama joonis on juba avatud");
      else if (error instanceof DxfImportError || error instanceof RangeError || error instanceof TypeError) setStatus(`DXF impordi viga: ${error.message}`);
      else throw error;
    } finally {
      committing.current = false;
      input.value = "";
    }
  }

  async function downloadKDraw(): Promise<void> {
    const bytes = await serializeKDraw(document);
    const url = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "application/vnd.kuubik.kdraw+json" }));
    const anchor = window.document.createElement("a");
    anchor.href = url;
    anchor.download = `${document.documentId}-r${document.revision}.kdraw`;
    anchor.click();
    URL.revokeObjectURL(url);
    setStatus(`KDraw eksporditud: revision ${document.revision}`);
  }

  return (
    <main className="app-shell">
      <header className="titlebar">
        <strong>Kuubik Draw</strong>
        <span>GPL 2D CAD · eksperimentaalne</span>
      </header>
      <section className="ribbon" aria-label="Joonestustööriistad">
        <button type="button" onClick={() => void addSyntheticLine()} disabled={!modelSpaceEditing || activeLayer.locked}>LINE test</button>
        <label className="coordinate-input">
          <span>Esimene nurk</span>
          <input aria-label="Esimene nurk" value={firstCornerInput} onChange={(event) => setFirstCornerInput(event.target.value)} placeholder="x,y" />
        </label>
        <label className="coordinate-input">
          <span>Teine nurk</span>
          <input aria-label="Teine nurk" value={otherCornerInput} onChange={(event) => setOtherCornerInput(event.target.value)} placeholder="x,y" />
        </label>
        <button type="button" onClick={() => void addRectangle()} disabled={!modelSpaceEditing || activeLayer.locked}>RECTANGLE</button>
        <button type="button" onClick={() => void createLayer()}>Uus kiht</button>
        <button type="button" onClick={() => void toggleActiveLayerLock()}>{activeLayer.locked ? "Ava aktiivne" : "Lukusta aktiivne"}</button>
        <button type="button" onClick={selectAll} disabled={!modelSpaceEditing || document.entities.length === 0}>Vali kõik</button>
        <label className="coordinate-input">
          <span>MOVE baaspunkt</span>
          <input aria-label="MOVE baaspunkt" value={moveBaseInput} onFocus={() => setPreviewCommand("MOVE")} onChange={(event) => { setPreviewCommand("MOVE"); setMoveBaseInput(event.target.value); }} placeholder="x,y" />
        </label>
        <label className="coordinate-input">
          <span>MOVE sihtpunkt</span>
          <input aria-label="MOVE sihtpunkt" value={moveDestinationInput} onFocus={() => setPreviewCommand("MOVE")} onChange={(event) => { setPreviewCommand("MOVE"); setMoveDestinationInput(event.target.value); }} placeholder="x,y või @dx,dy" />
        </label>
        <button type="button" onClick={() => void moveSelected()} disabled={!modelSpaceEditing}>MOVE</button>
        <label className="coordinate-input">
          <span>COPY baaspunkt</span>
          <input aria-label="COPY baaspunkt" value={copyBaseInput} onFocus={() => setPreviewCommand("COPY")} onChange={(event) => { setPreviewCommand("COPY"); setCopyBaseInput(event.target.value); }} placeholder="x,y" />
        </label>
        <label className="coordinate-input">
          <span>COPY sihtpunkt(id)</span>
          <input aria-label="COPY sihtpunktid" value={copyDestinationsInput} onFocus={() => setPreviewCommand("COPY")} onChange={(event) => { setPreviewCommand("COPY"); setCopyDestinationsInput(event.target.value); }} placeholder="x,y; @dx,dy" />
        </label>
        <button type="button" onClick={() => void copySelected()} disabled={!modelSpaceEditing}>COPY</button>
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
        <button type="button" onClick={() => void rotateSelected()} disabled={!modelSpaceEditing}>ROTATE</button>
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
        <button type="button" onClick={() => void scaleSelected()} disabled={!modelSpaceEditing}>SCALE</button>
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
        <button type="button" onClick={() => void mirrorSelected()} disabled={!modelSpaceEditing}>MIRROR</button>
        <label className="coordinate-input">
          <span>OFFSET režiim</span>
          <select aria-label="OFFSET režiim" value={offsetMode} onFocus={() => setPreviewCommand("OFFSET")} onChange={(event) => { setPreviewCommand("OFFSET"); setOffsetMode(event.target.value as "distance" | "through"); }}>
            <option value="distance">Distance</option>
            <option value="through">Through</option>
          </select>
        </label>
        {offsetMode === "distance" && (
          <label className="coordinate-input">
            <span>OFFSET distants</span>
            <input aria-label="OFFSET distants" value={offsetDistanceInput} onFocus={() => setPreviewCommand("OFFSET")} onChange={(event) => { setPreviewCommand("OFFSET"); setOffsetDistanceInput(event.target.value); }} placeholder="positiivne distants" />
          </label>
        )}
        <label className="coordinate-input">
          <span>OFFSET külje-/Through-punkt(id)</span>
          <input aria-label="OFFSET punktid" value={offsetPlacementInput} onFocus={() => setPreviewCommand("OFFSET")} onChange={(event) => { setPreviewCommand("OFFSET"); setOffsetPlacementInput(event.target.value); }} placeholder="x,y; x,y" />
        </label>
        <label className="coordinate-input">
          <span>OFFSET Multiple</span>
          <input aria-label="OFFSET Multiple" type="checkbox" checked={offsetMultiple} onFocus={() => setPreviewCommand("OFFSET")} onChange={(event) => { setPreviewCommand("OFFSET"); setOffsetMultiple(event.target.checked); }} />
        </label>
        <label className="coordinate-input">
          <span>OFFSET Erase source</span>
          <input aria-label="OFFSET kustuta lähteobjektid" type="checkbox" checked={offsetEraseSource} onFocus={() => setPreviewCommand("OFFSET")} onChange={(event) => { setPreviewCommand("OFFSET"); setOffsetEraseSource(event.target.checked); }} />
        </label>
        <label className="coordinate-input">
          <span>OFFSET Layer</span>
          <select aria-label="OFFSET kiht" value={offsetLayerMode} onFocus={() => setPreviewCommand("OFFSET")} onChange={(event) => { setPreviewCommand("OFFSET"); setOffsetLayerMode(event.target.value as OffsetLayerMode); }}>
            <option value="source">Source</option>
            <option value="current">Current</option>
          </select>
        </label>
        <button type="button" onClick={() => void offsetSelected()} disabled={!modelSpaceEditing}>OFFSET</button>
        <button type="button" onClick={undoOffsetPlacement} disabled={!modelSpaceEditing}>OFFSET Undo</button>
        <label className="coordinate-input">
          <span>TRIM režiim</span>
          <select aria-label="TRIM režiim" value={trimMode} onFocus={() => setPreviewCommand("TRIM")} onChange={(event) => { setPreviewCommand("TRIM"); setTrimMode(event.target.value as TrimMode); }}>
            <option value="quick">Quick</option>
            <option value="standard">Standard</option>
          </select>
        </label>
        <label className="coordinate-input">
          <span>TRIM cutting edges</span>
          <input aria-label="TRIM cutting edges" value={trimCuttingHandlesInput} disabled={trimMode === "quick"} onFocus={() => setPreviewCommand("TRIM")} onChange={(event) => { setPreviewCommand("TRIM"); setTrimCuttingHandlesInput(event.target.value); }} placeholder="20,21" />
        </label>
        <label className="coordinate-input">
          <span>TRIM sihid</span>
          <input aria-label="TRIM sihid" value={trimTargetsInput} onFocus={() => setPreviewCommand("TRIM")} onChange={(event) => { setPreviewCommand("TRIM"); setTrimTargetsInput(event.target.value); }} placeholder="10@500,0; 11@500,200" />
        </label>
        <label className="coordinate-input">
          <span>TRIM valik</span>
          <select aria-label="TRIM valik" value={trimPathMode} onFocus={() => setPreviewCommand("TRIM")} onChange={(event) => { setPreviewCommand("TRIM"); setTrimPathMode(event.target.value as "fence" | "crossing"); }}>
            <option value="fence">Fence</option>
            <option value="crossing">Crossing</option>
          </select>
        </label>
        <label className="coordinate-input">
          <span>TRIM valikutee</span>
          <input aria-label="TRIM valikutee" value={trimPathInput} onFocus={() => setPreviewCommand("TRIM")} onChange={(event) => { setPreviewCommand("TRIM"); setTrimPathInput(event.target.value); }} placeholder="x,y; x,y; ..." />
        </label>
        <button type="button" onClick={selectTrimTargetsFromPath} disabled={!modelSpaceEditing}>TRIM Fence/Crossing vali</button>
        <label className="coordinate-input">
          <span>TRIM Edge</span>
          <select aria-label="TRIM Edge" value={trimEdgeMode} onFocus={() => setPreviewCommand("TRIM")} onChange={(event) => { setPreviewCommand("TRIM"); setTrimEdgeMode(event.target.value as TrimEdgeMode); }}>
            <option value="no-extend">No extend</option>
            <option value="extend">Extend</option>
          </select>
        </label>
        <label className="coordinate-input">
          <span>TRIM Project</span>
          <select aria-label="TRIM Project" value={trimProjectMode} onFocus={() => setPreviewCommand("TRIM")} onChange={(event) => { setPreviewCommand("TRIM"); setTrimProjectMode(event.target.value as TrimProjectMode); }}>
            <option value="none">None</option>
            <option value="ucs">UCS</option>
            <option value="view">View</option>
          </select>
        </label>
        <label className="coordinate-input">
          <span>TRIM tegevus</span>
          <select aria-label="TRIM tegevus" value={trimTargetAction} onFocus={() => setPreviewCommand("TRIM")} onChange={(event) => { setPreviewCommand("TRIM"); setTrimTargetAction(event.target.value as TrimTargetAction); }}>
            <option value="trim">Trim</option>
            <option value="extend">Shift-Extend</option>
            <option value="erase">Erase</option>
          </select>
        </label>
        <button type="button" onClick={() => void trimTargets()} disabled={!modelSpaceEditing}>TRIM</button>
        <button type="button" onClick={undoTrimTarget} disabled={!modelSpaceEditing}>TRIM Undo</button>
        <label className="coordinate-input">
          <span>EXTEND režiim</span>
          <select aria-label="EXTEND režiim" value={extendMode} onFocus={() => setPreviewCommand("EXTEND")} onChange={(event) => { setPreviewCommand("EXTEND"); setExtendMode(event.target.value as TrimMode); }}>
            <option value="quick">Quick</option>
            <option value="standard">Standard</option>
          </select>
        </label>
        <label className="coordinate-input">
          <span>EXTEND boundary edges</span>
          <input aria-label="EXTEND boundary edges" value={extendBoundaryHandlesInput} disabled={extendMode === "quick"} onFocus={() => setPreviewCommand("EXTEND")} onChange={(event) => { setPreviewCommand("EXTEND"); setExtendBoundaryHandlesInput(event.target.value); }} placeholder="20,21" />
        </label>
        <label className="coordinate-input">
          <span>EXTEND sihid</span>
          <input aria-label="EXTEND sihid" value={extendTargetsInput} onFocus={() => setPreviewCommand("EXTEND")} onChange={(event) => { setPreviewCommand("EXTEND"); setExtendTargetsInput(event.target.value); }} placeholder="10@80,0; 11@80,20" />
        </label>
        <label className="coordinate-input">
          <span>EXTEND valik</span>
          <select aria-label="EXTEND valik" value={extendPathMode} onFocus={() => setPreviewCommand("EXTEND")} onChange={(event) => { setPreviewCommand("EXTEND"); setExtendPathMode(event.target.value as "fence" | "crossing"); }}>
            <option value="fence">Fence</option>
            <option value="crossing">Crossing</option>
          </select>
        </label>
        <label className="coordinate-input">
          <span>EXTEND valikutee</span>
          <input aria-label="EXTEND valikutee" value={extendPathInput} onFocus={() => setPreviewCommand("EXTEND")} onChange={(event) => { setPreviewCommand("EXTEND"); setExtendPathInput(event.target.value); }} placeholder="x,y; x,y; ..." />
        </label>
        <button type="button" onClick={selectExtendTargetsFromPath} disabled={!modelSpaceEditing}>EXTEND Fence/Crossing vali</button>
        <label className="coordinate-input">
          <span>EXTEND Edge</span>
          <select aria-label="EXTEND Edge" value={extendEdgeMode} onFocus={() => setPreviewCommand("EXTEND")} onChange={(event) => { setPreviewCommand("EXTEND"); setExtendEdgeMode(event.target.value as TrimEdgeMode); }}>
            <option value="no-extend">No extend</option>
            <option value="extend">Extend</option>
          </select>
        </label>
        <label className="coordinate-input">
          <span>EXTEND Project</span>
          <select aria-label="EXTEND Project" value={extendProjectMode} onFocus={() => setPreviewCommand("EXTEND")} onChange={(event) => { setPreviewCommand("EXTEND"); setExtendProjectMode(event.target.value as TrimProjectMode); }}>
            <option value="none">None</option>
            <option value="ucs">UCS</option>
            <option value="view">View</option>
          </select>
        </label>
        <label className="coordinate-input">
          <span>EXTEND tegevus</span>
          <select aria-label="EXTEND tegevus" value={extendTargetAction} onFocus={() => setPreviewCommand("EXTEND")} onChange={(event) => { setPreviewCommand("EXTEND"); setExtendTargetAction(event.target.value as ExtendTargetAction); }}>
            <option value="extend">Extend</option>
            <option value="trim">Shift-Trim</option>
          </select>
        </label>
        <button type="button" onClick={() => void extendTargets()} disabled={!modelSpaceEditing}>EXTEND</button>
        <button type="button" onClick={undoExtendTarget} disabled={!modelSpaceEditing}>EXTEND Undo</button>
        <label className="coordinate-input">
          <span>FILLET režiim</span>
          <select aria-label="FILLET režiim" value={filletMode} onFocus={() => setPreviewCommand("FILLET")} onChange={(event) => { setPreviewCommand("FILLET"); setFilletMode(event.target.value as "pairs" | "polyline"); setFilletFirstCanvasPick(null); setFilletCanvasSessionActive(false); }}>
            <option value="pairs">Object pairs / Multiple</option>
            <option value="polyline">Polyline</option>
          </select>
        </label>
        <label className="coordinate-input">
          <span>FILLET Radius</span>
          <input aria-label="FILLET radius" value={filletRadiusInput} onFocus={() => setPreviewCommand("FILLET")} onChange={(event) => { setPreviewCommand("FILLET"); setFilletRadiusInput(event.target.value); }} placeholder="0 või suurem" />
        </label>
        {filletMode === "pairs" ? (
          <label className="coordinate-input">
            <span>FILLET objektipaarid</span>
            <input aria-label="FILLET paarid" value={filletPairsInput} onFocus={() => setPreviewCommand("FILLET")} onChange={(event) => { setPreviewCommand("FILLET"); setFilletPairsInput(event.target.value); setFilletFirstCanvasPick(null); setFilletCanvasSessionActive(false); }} placeholder="10#0@x,y&gt;10#1@x,y; ..." />
          </label>
        ) : (
          <>
            <label className="coordinate-input">
              <span>FILLET Polyline handle’id</span>
              <input aria-label="FILLET Polyline handle'id" value={filletPolylineHandlesInput} onFocus={() => setPreviewCommand("FILLET")} onChange={(event) => { setPreviewCommand("FILLET"); setFilletPolylineHandlesInput(event.target.value); }} placeholder="10,20" />
            </label>
            <label className="coordinate-input">
              <span>FILLETPOLYARC</span>
              <select aria-label="FILLETPOLYARC" value={filletPolylineArc} onFocus={() => setPreviewCommand("FILLET")} onChange={(event) => { setPreviewCommand("FILLET"); setFilletPolylineArc(Number(event.target.value) as 0 | 1); }}>
                <option value={1}>1 · kaaresegmendid</option>
                <option value={0}>0 · legacy sirgsegmendid</option>
              </select>
            </label>
          </>
        )}
        <label className="coordinate-input">
          <span>FILLET Trim</span>
          <select aria-label="FILLET Trim" value={filletTrimMode} onFocus={() => setPreviewCommand("FILLET")} onChange={(event) => { setPreviewCommand("FILLET"); setFilletTrimMode(event.target.value as FilletTrimMode); }}>
            <option value="trim">Trim</option>
            <option value="no-trim">No Trim</option>
          </select>
        </label>
        <button type="button" onClick={() => void filletTargets()} disabled={!modelSpaceEditing}>FILLET</button>
        <button type="button" onClick={undoFilletSource} disabled={!modelSpaceEditing}>FILLET Undo</button>
        <label className="coordinate-input">
          <span>CHAMFER režiim</span>
          <select aria-label="CHAMFER režiim" value={chamferMode} onFocus={() => setPreviewCommand("CHAMFER")} onChange={(event) => { setPreviewCommand("CHAMFER"); setChamferMode(event.target.value as "pairs" | "polyline"); setChamferFirstCanvasPick(null); setChamferCanvasSessionActive(false); }}>
            <option value="pairs">Object pairs / Multiple</option>
            <option value="polyline">Polyline</option>
          </select>
        </label>
        <label className="coordinate-input">
          <span>CHAMFER Method</span>
          <select aria-label="CHAMFER Method" value={chamferMethod} onFocus={() => setPreviewCommand("CHAMFER")} onChange={(event) => { setPreviewCommand("CHAMFER"); setChamferMethod(event.target.value as "distance" | "angle"); }}>
            <option value="distance">Distance</option>
            <option value="angle">Angle</option>
          </select>
        </label>
        <label className="coordinate-input">
          <span>CHAMFER esimene kaugus</span>
          <input aria-label="CHAMFER esimene kaugus" value={chamferFirstDistanceInput} onFocus={() => setPreviewCommand("CHAMFER")} onChange={(event) => { setPreviewCommand("CHAMFER"); setChamferFirstDistanceInput(event.target.value); }} placeholder="0 või suurem" />
        </label>
        {chamferMethod === "distance" ? (
          <label className="coordinate-input">
            <span>CHAMFER teine kaugus</span>
            <input aria-label="CHAMFER teine kaugus" value={chamferSecondDistanceInput} onFocus={() => setPreviewCommand("CHAMFER")} onChange={(event) => { setPreviewCommand("CHAMFER"); setChamferSecondDistanceInput(event.target.value); }} placeholder="0 või suurem" />
          </label>
        ) : (
          <label className="coordinate-input">
            <span>CHAMFER nurk</span>
            <input aria-label="CHAMFER nurk" value={chamferAngleInput} onFocus={() => setPreviewCommand("CHAMFER")} onChange={(event) => { setPreviewCommand("CHAMFER"); setChamferAngleInput(event.target.value); }} placeholder="0…&lt;180°" />
          </label>
        )}
        {chamferMode === "pairs" ? (
          <label className="coordinate-input">
            <span>CHAMFER objektipaarid</span>
            <input aria-label="CHAMFER paarid" value={chamferPairsInput} onFocus={() => setPreviewCommand("CHAMFER")} onChange={(event) => { setPreviewCommand("CHAMFER"); setChamferPairsInput(event.target.value); setChamferFirstCanvasPick(null); setChamferCanvasSessionActive(false); }} placeholder="10#0@x,y&gt;10#1@x,y; ..." />
          </label>
        ) : (
          <label className="coordinate-input">
            <span>CHAMFER Polyline handle’id</span>
            <input aria-label="CHAMFER Polyline handle'id" value={chamferPolylineHandlesInput} onFocus={() => setPreviewCommand("CHAMFER")} onChange={(event) => { setPreviewCommand("CHAMFER"); setChamferPolylineHandlesInput(event.target.value); }} placeholder="10,20" />
          </label>
        )}
        <label className="coordinate-input">
          <span>CHAMFER Trim</span>
          <select aria-label="CHAMFER Trim" value={chamferTrimMode} onFocus={() => setPreviewCommand("CHAMFER")} onChange={(event) => { setPreviewCommand("CHAMFER"); setChamferTrimMode(event.target.value as ChamferTrimMode); }}>
            <option value="trim">Trim</option>
            <option value="no-trim">No Trim</option>
          </select>
        </label>
        <button type="button" onClick={() => void chamferTargets()} disabled={!modelSpaceEditing}>CHAMFER</button>
        <button type="button" onClick={undoChamferSource} disabled={!modelSpaceEditing}>CHAMFER Undo</button>
        <button type="button" onClick={() => void eraseSelected()} disabled={!modelSpaceEditing || selectedHandles.length === 0}>ERASE</button>
        <button type="button" onClick={() => void undoLast()} disabled={!canUndoInActiveLayout}>UNDO</button>
        <button type="button" onClick={() => void redoLast()} disabled={!canRedoInActiveLayout}>REDO</button>
        <label className="coordinate-input">
          <span>DXF import</span>
          <input
            aria-label="DXF import"
            type="file"
            accept=".dxf,application/dxf,text/plain"
            onChange={(event) => void importDxfFile(event.target.files?.[0], event.currentTarget)}
          />
        </label>
        <button type="button" onClick={downloadDxf}>DXF eksport</button>
        <button type="button" onClick={() => void downloadKDraw()}>KDraw eksport</button>
        <span>{document.entities.length} objekti · {selectedHandles.length} valitud · {activeLayer.name}{activeLayer.locked ? " 🔒" : ""}</span>
        {movePreview && <span data-testid="move-preview">MOVE eelvaade: {movePreview.entities.length} · Δ{movePreview.delta.x},{movePreview.delta.y}</span>}
        {copyPreview && <span data-testid="copy-preview">COPY eelvaade: {copyPreview.entities.length} · {copyPreview.deltas.length} paigutust</span>}
        {rotatePreview && <span data-testid="rotate-preview">ROTATE eelvaade: {rotatePreview.entities.length} · {rotatePreview.deltaAngleDeg}°</span>}
        {scalePreview && <span data-testid="scale-preview">SCALE eelvaade: {scalePreview.entities.length} · ×{scalePreview.factor}{scalePreview.copy ? " · Copy" : ""}</span>}
        {mirrorPreview && <span data-testid="mirror-preview" data-hidden-source-count={mirrorPreview.eraseSource ? mirrorPreview.sourceHandles.length : 0}>MIRROR eelvaade: {mirrorPreview.entities.length} · lähteobjektid {mirrorPreview.eraseSource ? "kustutatakse" : "säilivad"}</span>}
        {offsetPreview && <span data-testid="offset-preview" data-hidden-source-count={offsetPreview.eraseSource ? offsetPreview.sourceHandles.length : 0}>OFFSET eelvaade: {offsetPreview.entities.length} · {offsetPreview.steps} sammu · lähteobjektid {offsetPreview.eraseSource ? "kustutatakse" : "säilivad"}</span>}
        {trimPreview && <span data-testid="trim-preview" data-hidden-source-count={trimPreview.sourceHandles.length}>TRIM eelvaade: {trimPreview.entities.length} tulemust · {trimPreview.steps} sammu</span>}
        {extendPreview && <span data-testid="extend-preview" data-hidden-source-count={extendPreview.sourceHandles.length}>EXTEND eelvaade: {extendPreview.entities.length} tulemust · {extendPreview.steps} sammu</span>}
        {filletPreview && <span data-testid="fillet-preview" data-hidden-source-count={filletPreview.trimMode === "trim" ? filletPreview.sourceHandles.length : 0}>FILLET eelvaade: {filletPreview.entities.length} tulemust · {filletPreview.steps} sammu</span>}
        {chamferPreview && <span data-testid="chamfer-preview" data-hidden-source-count={chamferPreview.trimMode === "trim" ? chamferPreview.sourceHandles.length : 0}>CHAMFER eelvaade: {chamferPreview.entities.length} tulemust · {chamferPreview.steps} sammu</span>}
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
        {lastOffsetRejected.length > 0 && (
          <span data-testid="offset-rejected" data-rejected={JSON.stringify(lastOffsetRejected)}>
            OFFSET muutmata: {lastOffsetRejected.map(({ handle, placementIndex, reason }) => `${handle}${placementIndex === null ? "" : `#${placementIndex + 1}`} (${reason})`).join(", ")}
          </span>
        )}
        {lastTrimRejected.length > 0 && (
          <span data-testid="trim-rejected" data-rejected={JSON.stringify(lastTrimRejected)}>
            TRIM muutmata: {lastTrimRejected.map(({ handle, targetIndex, reason }) => `${handle}#${targetIndex + 1} (${reason})`).join(", ")}
          </span>
        )}
        {lastExtendRejected.length > 0 && (
          <span data-testid="extend-rejected" data-rejected={JSON.stringify(lastExtendRejected)}>
            EXTEND muutmata: {lastExtendRejected.map(({ handle, targetIndex, reason }) => `${handle}#${targetIndex + 1} (${reason})`).join(", ")}
          </span>
        )}
        {lastFilletRejected.length > 0 && (
          <span data-testid="fillet-rejected" data-rejected={JSON.stringify(lastFilletRejected)}>
            FILLET muutmata: {lastFilletRejected.map(({ handles, sourceIndex, reason }) => `${handles.join("+")}#${sourceIndex + 1} (${reason})`).join(", ")}
          </span>
        )}
        {lastChamferRejected.length > 0 && (
          <span data-testid="chamfer-rejected" data-rejected={JSON.stringify(lastChamferRejected)}>
            CHAMFER muutmata: {lastChamferRejected.map(({ handles, sourceIndex, reason }) => `${handles.join("+")}#${sourceIndex + 1} (${reason})`).join(", ")}
          </span>
        )}
      </section>
      <section className={`drawing-area ${activePaper ? "paper-mode" : "model-mode"}`} data-mode={activePaper ? "paper" : "model"}>
        {activePaper ? (
          <div className="paper-space-desk" data-testid="paper-space-desk" ref={paperDesk}>
            <div
              className="paper-space-sheet"
              data-testid="paper-space-sheet"
              ref={paperSheet}
              data-paper-width-mm={activePaper.widthMm}
              data-paper-height-mm={activePaper.heightMm}
              data-page-media={activePageSetup?.mediaName}
              data-page-orientation={activePageSetup?.orientation}
              data-plot-area={activePageSetup?.plotArea.kind}
              data-plot-scale={activePageSetup?.plotScale.mode === "fit" ? "fit" : activePageSetup ? String(activePageSetup.plotScale.drawingUnits / activePageSetup.plotScale.paperUnits) : ""}
              data-plot-profile={activePageSetup?.plotStyle?.profile ?? "monochrome"}
              data-plot-lineweights={(activePageSetup?.plotStyle?.plotLineweights ?? true) ? "true" : "false"}
              data-plot-transparency={(activePageSetup?.plotStyle?.plotTransparency ?? true) ? "true" : "false"}
              data-display-plot-styles={activePageSetup?.displayPlotStyles ? "true" : "false"}
              style={{ aspectRatio: `${activePaper.widthMm} / ${activePaper.heightMm}` }}
              onClick={() => {
                if (modelViewportId !== null) setStatus("PAPER aktiivne");
                setModelViewportId(null);
              }}
            >
              <canvas className="paper-space-entities" ref={canvas} aria-label={`${activeLayout.name} paberiruum`} />
              {activeLayout.viewports.map((viewport) => (
                <PaperViewportCanvas
                  key={viewport.id}
                  document={document}
                  viewport={viewport}
                  paper={activePaper}
                  active={viewport.id === selectedViewportId}
                  modelContext={viewport.id === modelViewportId}
                  navigationEnabled={viewport.id === modelViewportId && !viewport.locked}
                  plotStyle={activePageSetup?.displayPlotStyles ? (activePageSetup.plotStyle ?? { profile: "monochrome", plotLineweights: true, plotTransparency: true }) : undefined}
                  onSelect={() => {
                    setSelectedViewportId(viewport.id);
                    if (modelViewportId !== viewport.id) setModelViewportId(null);
                    setStatus(`Viewport ${viewport.id} valitud; PAPER aktiivne`);
                  }}
                  onEnterModel={() => {
                    setSelectedViewportId(viewport.id);
                    setModelViewportId(viewport.id);
                    setStatus(`Viewport ${viewport.id}: MODEL aktiivne`);
                  }}
                  onZoom={(anchorModel, scaleFactor) => { void zoomViewport(viewport.id, anchorModel, scaleFactor); }}
                  onPan={(deltaPx, viewportPx) => { void panViewport(viewport.id, deltaPx, viewportPx); }}
                />
              ))}
            </div>
          </div>
        ) : (
          <canvas ref={canvas} aria-label="Kuubik Draw joonestusala" onPointerDown={selectModifyTargetFromCanvas} />
        )}
      </section>
      <section className="layoutbar" aria-label="Model ja Layout vahelehed">
        {document.layouts.map((layout) => (
          <button
            key={layout.id}
            type="button"
            className={layout.id === activeLayout.id ? "layout-tab active" : "layout-tab"}
            aria-pressed={layout.id === activeLayout.id}
            onClick={() => activateLayout(layout.id)}
          >
            {layout.name}
          </button>
        ))}
        <button type="button" className="layout-action" aria-label="Lisa paigutus" onClick={() => void createLayout()}>+</button>
        {activeLayout.kind === "model" && activePageSetup && activePlotPaper && (
          <span
            className="page-setup-controls model-page-setup-controls"
            data-testid="model-page-setup-controls"
            data-media={activePageSetup.mediaName}
            data-orientation={activePageSetup.orientation}
            data-plot-area={activePageSetup.plotArea.kind}
            data-plot-scale={activePageSetup.plotScale.mode === "fit" ? "fit" : String(activePageSetup.plotScale.drawingUnits / activePageSetup.plotScale.paperUnits)}
            data-center-plot={activePageSetup.centerPlot ? "true" : "false"}
            data-plot-origin={`${activePageSetup.plotOriginMm.x},${activePageSetup.plotOriginMm.y}`}
            data-paper={`${activePlotPaper.widthMm},${activePlotPaper.heightMm}`}
          >
            <select aria-label="Model paper media" value={pageMediaInput} onChange={(event) => setPageMediaInput(event.target.value)}>
              {ISO_PAPER_MEDIA.map((paper) => <option key={paper.mediaName} value={paper.mediaName}>{paper.mediaName.replace("ISO_", "")}</option>)}
            </select>
            <select aria-label="Model paper orientation" value={pageOrientationInput} onChange={(event) => setPageOrientationInput(event.target.value as "portrait" | "landscape")}>
              <option value="portrait">Portrait</option><option value="landscape">Landscape</option>
            </select>
            <select aria-label="Model plot area" value={plotAreaInput} onChange={(event) => setPlotAreaInput(event.target.value as CadPageSetup["plotArea"]["kind"])}>
              <option value="window">Window</option><option value="extents">Extents</option><option value="display">Display</option>
            </select>
            <select aria-label="Model plot scale mode" value={plotScaleModeInput} onChange={(event) => setPlotScaleModeInput(event.target.value as CadPageSetup["plotScale"]["mode"])}>
              <option value="custom">Fixed</option><option value="fit">Fit</option>
            </select>
            <input aria-label="Model plot scale denominator" inputMode="decimal" disabled={plotScaleModeInput === "fit"} value={plotScaleDenominatorInput} onChange={(event) => setPlotScaleDenominatorInput(event.target.value)} />
            <label><input aria-label="Model center plot" type="checkbox" checked={centerPlotInput} onChange={(event) => setCenterPlotInput(event.target.checked)} />Center</label>
            <input aria-label="Model plot offset X" inputMode="decimal" disabled={centerPlotInput} value={plotOriginXInput} onChange={(event) => setPlotOriginXInput(event.target.value)} />
            <input aria-label="Model plot offset Y" inputMode="decimal" disabled={centerPlotInput} value={plotOriginYInput} onChange={(event) => setPlotOriginYInput(event.target.value)} />
            <select aria-label="Model plot profile" value={plotProfileInput} onChange={(event) => setPlotProfileInput(event.target.value as CadPlotStyle["profile"])}>
              <option value="color">Color</option><option value="monochrome">Monochrome</option><option value="grayscale">Grayscale</option>
            </select>
            <label><input aria-label="Model lineweights" type="checkbox" checked={plotLineweightsInput} onChange={(event) => setPlotLineweightsInput(event.target.checked)} />LW</label>
            <label><input aria-label="Model transparency" type="checkbox" checked={plotTransparencyInput} onChange={(event) => setPlotTransparencyInput(event.target.checked)} />Alpha</label>
            {plotAreaInput === "window" && <>
              <input aria-label="Model plot window X" inputMode="decimal" value={plotWindowXInput} onChange={(event) => setPlotWindowXInput(event.target.value)} />
              <input aria-label="Model plot window Y" inputMode="decimal" value={plotWindowYInput} onChange={(event) => setPlotWindowYInput(event.target.value)} />
              <input aria-label="Model plot window width" inputMode="decimal" value={plotWindowWidthInput} onChange={(event) => setPlotWindowWidthInput(event.target.value)} />
              <input aria-label="Model plot window height" inputMode="decimal" value={plotWindowHeightInput} onChange={(event) => setPlotWindowHeightInput(event.target.value)} />
            </>}
            <button type="button" className="layout-action" aria-label="Rakenda model page setup" onClick={() => void applyPageSetup()}>PAGESETUP</button>
            <button type="button" className="layout-action" aria-label="Ekspordi model SVG" onClick={downloadModelSvg}>SVG</button>
            <button type="button" className="layout-action" aria-label="Ekspordi model PDF" onClick={downloadModelPdf}>PDF</button>
          </span>
        )}
        {activeLayout.kind === "paper" && (
          <span className="layout-actions" aria-label="Layout tegevused">
            <button type="button" className="layout-action" aria-label="Kopeeri paigutus" onClick={() => void copyLayout()}>Kopeeri</button>
            <span
              className="page-setup-controls"
              data-testid="page-setup-controls"
              data-media={activePageSetup?.mediaName}
              data-orientation={activePageSetup?.orientation}
              data-plot-area={activePageSetup?.plotArea.kind}
              data-plot-scale={activePageSetup?.plotScale.mode === "fit" ? "fit" : activePageSetup ? String(activePageSetup.plotScale.drawingUnits / activePageSetup.plotScale.paperUnits) : ""}
              data-center-plot={activePageSetup?.centerPlot ? "true" : "false"}
              data-plot-origin={activePageSetup ? `${activePageSetup.plotOriginMm.x},${activePageSetup.plotOriginMm.y}` : ""}
              data-plot-profile={activePageSetup?.plotStyle?.profile ?? "monochrome"}
              data-plot-lineweights={(activePageSetup?.plotStyle?.plotLineweights ?? true) ? "true" : "false"}
              data-plot-transparency={(activePageSetup?.plotStyle?.plotTransparency ?? true) ? "true" : "false"}
              data-display-plot-styles={activePageSetup?.displayPlotStyles ? "true" : "false"}
            >
              <select aria-label="Paper media" value={pageMediaInput} onChange={(event) => setPageMediaInput(event.target.value)}>
                {ISO_PAPER_MEDIA.map((paper) => <option key={paper.mediaName} value={paper.mediaName}>{paper.mediaName.replace("ISO_", "")}</option>)}
              </select>
              <select aria-label="Paper orientation" value={pageOrientationInput} onChange={(event) => setPageOrientationInput(event.target.value as "portrait" | "landscape")}>
                <option value="portrait">Portrait</option><option value="landscape">Landscape</option>
              </select>
              <select aria-label="Plot area" value={plotAreaInput} onChange={(event) => {
                const kind = event.target.value as CadPageSetup["plotArea"]["kind"];
                setPlotAreaInput(kind);
                if (kind === "layout") {
                  setCenterPlotInput(false); setPlotScaleModeInput("custom"); setPlotScaleDenominatorInput("1"); setPlotOriginXInput("0"); setPlotOriginYInput("0");
                }
              }}>
                <option value="layout">Layout</option><option value="window">Window</option><option value="extents">Extents</option><option value="display">Display</option>
              </select>
              <select aria-label="Plot scale mode" value={plotScaleModeInput} disabled={plotAreaInput === "layout"} onChange={(event) => setPlotScaleModeInput(event.target.value as CadPageSetup["plotScale"]["mode"])}>
                <option value="custom">Fixed</option><option value="fit">Fit</option>
              </select>
              <input aria-label="Plot scale denominator" inputMode="decimal" disabled={plotAreaInput === "layout" || plotScaleModeInput === "fit"} value={plotScaleDenominatorInput} onChange={(event) => setPlotScaleDenominatorInput(event.target.value)} />
              <label><input aria-label="Center plot" type="checkbox" disabled={plotAreaInput === "layout"} checked={centerPlotInput} onChange={(event) => setCenterPlotInput(event.target.checked)} />Center</label>
              <input aria-label="Plot offset X" inputMode="decimal" disabled={plotAreaInput === "layout" || centerPlotInput} value={plotOriginXInput} onChange={(event) => setPlotOriginXInput(event.target.value)} />
              <input aria-label="Plot offset Y" inputMode="decimal" disabled={plotAreaInput === "layout" || centerPlotInput} value={plotOriginYInput} onChange={(event) => setPlotOriginYInput(event.target.value)} />
              <select aria-label="Plot profile" value={plotProfileInput} onChange={(event) => setPlotProfileInput(event.target.value as CadPlotStyle["profile"])}>
                <option value="color">Color</option><option value="monochrome">Monochrome</option><option value="grayscale">Grayscale</option>
              </select>
              <label><input aria-label="Lineweights" type="checkbox" checked={plotLineweightsInput} onChange={(event) => setPlotLineweightsInput(event.target.checked)} />LW</label>
              <label><input aria-label="Transparency" type="checkbox" checked={plotTransparencyInput} onChange={(event) => setPlotTransparencyInput(event.target.checked)} />Alpha</label>
              <label><input aria-label="Display plot styles" type="checkbox" checked={displayPlotStylesInput} onChange={(event) => setDisplayPlotStylesInput(event.target.checked)} />View</label>
              {plotAreaInput === "window" && <>
                <input aria-label="Plot window X" inputMode="decimal" value={plotWindowXInput} onChange={(event) => setPlotWindowXInput(event.target.value)} />
                <input aria-label="Plot window Y" inputMode="decimal" value={plotWindowYInput} onChange={(event) => setPlotWindowYInput(event.target.value)} />
                <input aria-label="Plot window width" inputMode="decimal" value={plotWindowWidthInput} onChange={(event) => setPlotWindowWidthInput(event.target.value)} />
                <input aria-label="Plot window height" inputMode="decimal" value={plotWindowHeightInput} onChange={(event) => setPlotWindowHeightInput(event.target.value)} />
              </>}
              <button type="button" className="layout-action" aria-label="Rakenda page setup" onClick={() => void applyPageSetup()}>PAGESETUP</button>
              <button type="button" className="layout-action" aria-label="Ekspordi layout SVG" onClick={downloadActiveLayoutSvg}>SVG</button>
              <button type="button" className="layout-action" aria-label="Ekspordi layout PDF" onClick={downloadActiveLayoutPdf}>PDF</button>
            </span>
            <details
              className="publish-options"
              data-testid="publish-options"
              data-output={publishSettings.output}
              data-busy={publishCommitting}
              data-order={publishSettings.sheets.map((sheet) => sheet.layoutId).join("|")}
              data-included={publishSettings.sheets.filter((sheet) => sheet.included).map((sheet) => sheet.layoutId).join("|")}
            >
              <summary>PUBLISH</summary>
              <div className="publish-options-grid">
                {publishSettings.sheets.map((sheet, index) => {
                  const layout = document.layouts.find((candidate) => candidate.id === sheet.layoutId);
                  const isDisplay = layout ? resolvePageSetup(layout)?.plotArea.kind === "display" : false;
                  return <div className="publish-sheet" key={sheet.layoutId}>
                    <label>
                      <input
                        type="checkbox"
                        aria-label={`Avalda ${layout?.name ?? sheet.layoutId}`}
                        checked={sheet.included}
                        disabled={publishCommitting}
                        onChange={(event) => void setPublishIncluded(sheet.layoutId, event.target.checked)}
                      />
                      {layout?.name ?? sheet.layoutId}
                    </label>
                    <button type="button" aria-label={`Liiguta publish leht ${layout?.name ?? sheet.layoutId} üles`} disabled={publishCommitting || index === 0} onClick={() => void movePublishSheet(index, -1)}>↑</button>
                    <button type="button" aria-label={`Liiguta publish leht ${layout?.name ?? sheet.layoutId} alla`} disabled={publishCommitting || index === publishSettings.sheets.length - 1} onClick={() => void movePublishSheet(index, 1)}>↓</button>
                    {isDisplay && <button
                      type="button"
                      aria-label={`Salvesta publish kuvaala ${layout?.name ?? sheet.layoutId}`}
                      disabled={publishCommitting || layout?.id !== activeLayout.id}
                      onClick={() => void capturePublishDisplayWindow(sheet.layoutId)}
                    >{sheet.displayWindow ? "Kuvaala ✓" : "Salvesta kuvaala"}</button>}
                  </div>;
                })}
                <label>Väljund
                  <select aria-label="Publish output" value={publishSettings.output} disabled={publishCommitting} onChange={(event) => void setPublishOutput(event.target.value as LayoutPublishSettingsV1["output"])}>
                    <option value="multi-page">Üks mitmeleheküljeline PDF</option>
                    <option value="separate">Eraldi PDF failid</option>
                  </select>
                </label>
                <label>Failinimi
                  <input aria-label="Publish failinimi" value={publishBaseNameInput} disabled={publishCommitting} onChange={(event) => setPublishBaseNameInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void savePublishBaseName(); }} />
                </label>
                <button type="button" aria-label="Salvesta publish failinimi" disabled={publishCommitting} onClick={() => void savePublishBaseName()}>Salvesta nimi</button>
                <button type="button" aria-label="Publish layouts" disabled={publishCommitting || !publishSettings.sheets.some((sheet) => sheet.included)} onClick={publishLayouts}>Publish layouts</button>
              </div>
            </details>
            <button type="button" className="layout-action" aria-label="Lisa ristkülikviewport" onClick={() => void addViewport("rectangle")}>+ View</button>
            <button type="button" className="layout-action" aria-label="Lisa polügoonviewport" onClick={() => void addViewport("polygon")}>+ Clip</button>
            <button type="button" className="layout-action danger" aria-label="Kustuta viewport" disabled={selectedViewportId === null} onClick={() => void deleteSelectedViewport()}>− View</button>
            {selectedViewport && (
              <span className="viewport-view-controls" aria-label="Viewport vaate seaded">
                <button
                  type="button"
                  className="layout-action"
                  aria-label={selectedViewport.locked ? "Ava viewport" : "Lukusta viewport"}
                  aria-pressed={selectedViewport.locked}
                  data-testid="viewport-lock-toggle"
                  onClick={() => void setSelectedViewportLock(!selectedViewport.locked)}
                >{selectedViewport.locked ? "🔒 Lukus" : "🔓 Avatud"}</button>
                <select
                  aria-label="Viewport standardmõõtkava"
                  value={selectedViewportPreset}
                  onChange={(event) => { if (event.target.value !== "custom") setViewportScaleInput(event.target.value); }}
                >
                  <option value="custom">Custom</option>
                  {STANDARD_VIEWPORT_SCALE_DENOMINATORS.map((denominator) => <option key={denominator} value={denominator}>1:{denominator}</option>)}
                </select>
                <input aria-label="Viewport mõõtkava nimetaja" inputMode="decimal" value={viewportScaleInput} onChange={(event) => setViewportScaleInput(event.target.value)} />
                <input aria-label="Viewport keskme X" inputMode="decimal" value={viewportCenterXInput} onChange={(event) => setViewportCenterXInput(event.target.value)} />
                <input aria-label="Viewport keskme Y" inputMode="decimal" value={viewportCenterYInput} onChange={(event) => setViewportCenterYInput(event.target.value)} />
                <input aria-label="Viewport pöördenurk" inputMode="decimal" value={viewportTwistInput} onChange={(event) => setViewportTwistInput(event.target.value)} />
                <button
                  type="button"
                  className="layout-action"
                  aria-label="Rakenda viewport vaade"
                  disabled={modelViewportId !== selectedViewport.id || selectedViewport.locked}
                  onClick={() => void applySelectedViewportView()}
                >Rakenda</button>
                <span data-testid="viewport-scale-readout">{formatViewportScale(selectedViewport)}</span>
              </span>
            )}
            {modelViewportId !== null && <button type="button" className="layout-action" aria-label="Tagasi PAPER" onClick={() => { setModelViewportId(null); setStatus("PAPER aktiivne"); }}>PAPER</button>}
            <button type="button" className="layout-action" aria-label="Liiguta vasakule" disabled={activePaperIndex <= 0} onClick={() => void reorderLayout(-1)}>←</button>
            <button type="button" className="layout-action" aria-label="Liiguta paremale" disabled={activePaperIndex < 0 || activePaperIndex >= paperLayouts.length - 1} onClick={() => void reorderLayout(1)}>→</button>
            <input aria-label="Paigutuse nimi" value={layoutRenameInput} maxLength={255} onChange={(event) => setLayoutRenameInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void renameLayout(); }} />
            <button type="button" className="layout-action" aria-label="Nimeta paigutus" onClick={() => void renameLayout()}>Nimeta</button>
            <button type="button" className="layout-action danger" aria-label="Kustuta paigutus" disabled={paperLayouts.length <= 1} onClick={() => void deleteLayout()}>Kustuta</button>
          </span>
        )}
        <details className="page-setup-library" data-testid="page-setup-library" data-count={pageSetupLibrary.setups.length} data-assigned={pageSetupLibrary.assignments[activeLayout.id] ?? ""}>
          <summary>PAGE SETUPS</summary>
          <div className="page-setup-library-grid">
            <select aria-label="Named page setup" value={selectedNamedPageSetupId} onChange={(event) => setSelectedNamedPageSetupId(event.target.value)}>
              <option value="">Current layout settings</option>
              {pageSetupLibrary.setups.map((setup) => <option key={setup.id} value={setup.id}>{setup.name}</option>)}
            </select>
            <button type="button" aria-label="Apply named page setup" disabled={!selectedNamedPageSetupId} onClick={() => void applySelectedNamedPageSetup()}>Apply</button>
            <input aria-label="New page setup name" maxLength={255} value={newPageSetupNameInput} onChange={(event) => setNewPageSetupNameInput(event.target.value)} />
            <button type="button" aria-label="Save named page setup" disabled={!newPageSetupNameInput.trim()} onClick={() => void saveCurrentNamedPageSetup()}>Save as</button>
            <input aria-label="Rename page setup" maxLength={255} disabled={!selectedNamedPageSetupId} value={renamePageSetupInput} onChange={(event) => setRenamePageSetupInput(event.target.value)} />
            <button type="button" aria-label="Rename named page setup" disabled={!selectedNamedPageSetupId || !renamePageSetupInput.trim()} onClick={() => void renameSelectedNamedPageSetup()}>Rename</button>
            <button type="button" aria-label="Delete named page setup" disabled={!selectedNamedPageSetupId} onClick={() => void deleteSelectedNamedPageSetup()}>Delete</button>
            <input aria-label="Page setup template name" maxLength={255} value={pageSetupTemplateNameInput} onChange={(event) => setPageSetupTemplateNameInput(event.target.value)} />
            <button type="button" aria-label="Export page setup template" onClick={exportPageSetupTemplate}>Export template</button>
            <label className="template-import">Import template
              <input
                type="file"
                accept=".json,.kdraw-template.json,application/json"
                aria-label="Import page setup template"
                onChange={(event) => {
                  const input = event.currentTarget;
                  const file = input.files?.[0];
                  if (file) void importPageSetupTemplateFile(file).finally(() => { input.value = ""; });
                }}
              />
            </label>
          </div>
        </details>
        <span className="layout-space">{activeSpace}</span>
      </section>
      <footer className="statusbar">
        <span>{status}</span>
        <span>{activeSpace} · mm · SNAP</span>
      </footer>
    </main>
  );
}
