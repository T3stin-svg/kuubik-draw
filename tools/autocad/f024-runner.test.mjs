import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { exactDirectFamilyGeometry } from "./f024-dxf-verifier.mjs";

const source = async (name) => readFile(new URL(name, import.meta.url), "utf8");

describe("F-024 AutoCAD FILLET runner ratchet", () => {
  it("preserves single-shot COM ownership and authenticated cleanup", async () => {
    const matrix = await source("f024-standard-matrix.ps1");
    const runner = await source("run-f024.mjs");
    const physicalHelper = await source("f022-shift-click.ps1");

    expect(matrix.match(/New-Object\s+-ComObject\s+AutoCAD\.Application\.24\.3/gu)).toHaveLength(1);
    expect(matrix).not.toMatch(/Invoke-ComRetry\s*\{\s*New-Object\s+-ComObject/gu);
    expect(matrix).toMatch(/if \(-not \$owned\) \{ throw 'F-024 refuses to use a pre-existing AutoCAD process\.'/u);
    expect(matrix).toMatch(/Write-OwnedPidSidecar \$automationProcessId/gu);
    expect(matrix).toMatch(/if \(\$owned -and \$acad\) \{ try \{ Invoke-ComRetry \{ \$acad\.Quit\(\) \}/u);

    expect(runner).toContain("timedOut = true");
    expect(runner).toContain('execFileSync("taskkill.exe"');
    expect(runner).toContain("async function ownedSidecar()");
    expect(runner).toContain("function identityMatches(sidecar, current)");
    expect(runner).toMatch(/async function terminate\(sidecar\)[\s\S]*processIdentity\(sidecar\.processId\)[\s\S]*identityMatches\(sidecar, current\)[\s\S]*process\.kill\(sidecar\.processId\)/u);
    expect(runner).toContain("function newAutomationSidecars()");
    expect(runner).toMatch(/finally\s*\{\s*const cleanupErrors = \[\];[\s\S]*await ownedSidecar\(\)[\s\S]*newAutomationSidecars\(\)[\s\S]*!await terminate\(sidecar\)[\s\S]*!await restoredProcessSet\(\)[\s\S]*await rm\(tempRoot, \{ recursive: true, force: true \}\)[\s\S]*AggregateError\(primaryError \? \[primaryError, \.\.\.cleanupErrors\]/u);
    expect(physicalHelper).toContain("for (int attempt = 0; attempt < 5; attempt++)");
    expect(physicalHelper).toContain("EnsureForeground(window, expectedProcessId)");
    expect(matrix).toContain("foreach ($delay in @(1000, 3000))");
    expect(matrix).toContain("function Wait-AcadCommandMarker");
    expect(matrix).toContain('(setvar `"USERS1`" `"$marker`")');
    expect(matrix).toContain("Wait-AcadCommandMarker $Document $marker");
    expect(matrix).toContain("Get-LayerStatesAtLeast $scratch 'F024_NO_TRIM' 3");
    expect(matrix).toContain("Get-LayerStatesAtLeast $parametricDocument '0' 6 10");
    expect(matrix).toContain("rejected-pair Escape watchdogs both failed");
    expect(matrix).toContain("foreach ($escapeHelper in $escapeHelpers) { try { Stop-InputHelper $escapeHelper 'F-024 rejected-pair Escape watchdog'");
    expect(matrix).toContain("function Stop-InputHelper");
    expect(matrix).toContain("$actualValues = if ($null -eq $Actual) { @() } else { @($Actual) }");
    expect(matrix).toContain("Stop-InputHelper $shiftHelper 'F-024 physical Shift-click helper'");
    expect(matrix).toContain("Stop-InputHelper $shiftEscape 'F-024 physical Shift cleanup helper'");
    expect(matrix).toContain("foreach ($helper in @($shiftEscape, $shiftHelper))");
    expect(runner).not.toContain("forceTimeout");
    expect(runner).toMatch(/timedOut = true;[\s\S]*execFileSync\("taskkill\.exe", \["\/PID", String\(child\.pid\), "\/T", "\/F"\][\s\S]*catch \{ child\.kill\(\); \}/u);
  });

  it("keeps the polyline matrix and command policy explicit", async () => {
    const matrix = await source("f024-standard-matrix.ps1");
    const runner = await source("run-f024.mjs");

    for (const layer of [
      "F024_PAIR",
      "F024_NO_TRIM",
      "F024_MIXED",
      "F024_ADJACENT",
      "F024_ARC_ZERO",
      "F024_OPEN_CLOSE",
      "F024_FPA0",
      "F024_FPA1",
      "F024_FPA0_NO_TRIM",
      "F024_POLY_NO_TRIM",
      "F024_MULTIPLE",
      "F024_COMMAND_UNDO",
      "F024_GLOBAL_UNDO_REDO",
      "F024_CURRENT_SRC",
      "F024_CURRENT_ARC",
      "F024_CROSS_A",
      "F024_CROSS_B",
      "F024_CROSS_ARC",
      "F024_SHIFT",
      "F024_LINE_CIRCLE",
      "F024_LINE_ARC",
      "F024_RAY_LINE",
      "F024_XLINE_LINE",
      "F024_RAY_LINE_NO_TRIM",
      "F024_XLINE_LINE_NO_TRIM",
      "F024_RAY_XLINE",
    ]) expect(matrix).toContain(layer);

    expect(matrix).toContain('(setvar `"FILLETRAD`" $Radius)');
    expect(matrix).toContain('(setvar `"TRIMMODE`" $trimMode)');
    expect(matrix).toContain('(setvar `"FILLETPOLYARC`" $FilletPolyArc)');
    expect(matrix).toContain('(command `"_.FILLET`" `"_Polyline`"');
    expect(matrix).toContain("separatedArcRadiusZero = $arcZeroPassed");
    expect(matrix).toContain("openPolylineClose = $openClosePassed");
    expect(matrix).toContain("polylineNoTrim = $polyNoTrimPassed");
    expect(matrix).toContain('(command `"_.FILLET`" `"_Multiple`"');
    expect(matrix).toContain("commandUndo = $commandUndoPassed");
    expect(matrix).toContain("globalUndoRedo = $globalUndoRedoPassed");
    expect(matrix).toContain("sameSourceLayerOutput = $sameSourceLayerPassed");
    expect(matrix).toContain("crossLayerCurrentOutput = $crossLayerCurrentPassed");
    expect(matrix).toContain("physicalShiftRadiusZero = $shiftPassed");
    expect(matrix).toContain("lineCircle = $lineCirclePassed");
    expect(matrix).toContain("lineArc = $lineArcPassed");
    expect(matrix).toContain("the saved DXF");
    expect(matrix).toContain("$parametricDocument.SaveAs($ParametricDxfOutputPath, 65)");
    expect(matrix).toContain("$acad.Documents.Open($ParametricDxfOutputPath, $true)");
    expect(matrix).toContain("parametricDxfOutputSha256 = Get-FileSha256 $ParametricDxfOutputPath");
    expect(matrix).toContain("$pair.Count -eq 2 -or $pair.Count -eq 3");
    expect(matrix).toContain("rayLineTrim = $rayLinePassed");
    expect(matrix).toContain("xlineLineTrim = $xlineLinePassed");
    expect(matrix).toContain("rayLineNoTrim = $rayLineNoTrimPassed");
    expect(matrix).toContain("xlineLineNoTrim = $xlineLineNoTrimPassed");
    expect(matrix).toContain("rayXlineTrim = $rayXlinePassed");
    expect(matrix).toContain("'-Action','ShiftClick'");
    expect(matrix).toContain("'-ExpectedProcessId',([string]$automationProcessId)");
    expect(matrix).toContain("' \"_Undo\" \"\"'");
    expect(matrix).not.toContain("`\"_Undo`\"");
    for (const stage of ["line-pairs", "polylines", "multiple-undo-redo", "physical-shift", "curved-entities", "construction-lines", "layer-states", "same-source-parametric", "validate-and-save", "complete"]) {
      expect(matrix).toContain(`Write-Stage '${stage}'`);
    }

    expect(runner).toContain("function dxfRawLayerRecords(bytes, selectedLayers)");
    expect(runner).toContain("progress=${JSON.stringify(childResult.output");
    expect(runner).toContain("selectedRawConstructionRecords: dxfRawLayerRecords");
    expect(runner).toContain("function exactConstructionGeometry(readback)");
    expect(runner).toContain("function exactPolylineGeometry(readback, observations)");
    expect(runner).toContain("function exactParametricGeometry(readback, sourceReadback)");
    expect(runner).toContain("exactDirectFamilyGeometry(matrix.dxfReadback");
    expect(runner).toContain('"-ParametricDxfOutputPath", parametricOutputPath');
    expect(runner).toContain("matrix.parametricDxfReadback.sha256 !== matrix.parametricDxfOutputSha256");
    expect(runner).toContain('twoLineArc("F024_PAIR", [0, 0], [90, 0]');
    expect(runner).toContain("!exactConstructionGeometry(matrix.dxfReadback)");
    expect(runner).toContain("!exactPolylineGeometry(matrix.dxfReadback, matrix.observations)");
    expect(runner).toContain("new Set(sourceSpline?.weights ?? []).size > 1");
    expect(matrix).toContain("Test-NormalizedNumbers -Actual $parametricSplines[0].details.weights");
    expect(runner).toContain('rawConstruction("F024_RAY_LINE_NO_TRIM", "RAY"');
    expect(runner).toContain('rawConstruction("F024_XLINE_LINE_NO_TRIM", "XLINE"');
    expect(runner).toContain('rawConstruction("F024_XLINE_LINE", "RAY", [90, 4800], [-1, 0])');
    expect(runner).toContain('rawConstruction("F024_RAY_XLINE", "RAY", [100, 5410], [0, 1])');
  });

  it("rejects saved-DXF direct-family geometry, handle and appearance mutations", async () => {
    const expected = JSON.parse(await source("../../parity/expected/F-024.json"));
    const objectName = { LINE: "AcDbLine", CIRCLE: "AcDbCircle", ARC: "AcDbArc", ELLIPSE: "AcDbEllipse", SPLINE: "AcDbSpline" };
    let nextHandle = 0xA0;
    const selectedLayerEntities = {}; const observations = {};
    for (const [layer, entities] of Object.entries(expected.autoCad.directFamilies)) {
      selectedLayerEntities[layer] = []; observations[layer] = [];
      for (const entity of entities) {
        const handle = (nextHandle++).toString(16).toUpperCase();
        selectedLayerEntities[layer].push({
          ...structuredClone(entity), handle, layer,
          vertices: entity.vertices?.map(([x, y]) => ({ x, y })),
          center: entity.center === undefined ? undefined : { x: entity.center[0], y: entity.center[1] },
          majorAxis: entity.majorAxis === undefined ? undefined : { x: entity.majorAxis[0], y: entity.majorAxis[1] },
          startAngle: entity.startAngle ?? entity.startParameter,
          endAngle: entity.endAngle ?? entity.endParameter,
          controlPoints: entity.controlPoints?.map(([x, y]) => ({ x, y })),
          fitPoints: (entity.savedFitPoints ?? entity.fitPoints)?.map(([x, y]) => ({ x, y })),
          weights: entity.type === "SPLINE" ? [] : undefined,
        });
        observations[layer].push({
          objectName: objectName[entity.type], handle, layer, color: entity.colorNumber, lineweight: entity.lineweight,
          details: {
            start: entity.vertices?.[0], end: entity.vertices?.[1], center: entity.center, radius: entity.radius,
            startAngle: entity.startAngle, endAngle: entity.endAngle, majorAxis: entity.majorAxis,
            radiusRatio: entity.ratio, startParameter: entity.startParameter, endParameter: entity.endParameter,
            degree: entity.degree, closed: entity.closed, controlPoints: entity.controlPoints,
            fitPoints: entity.fitPoints, knots: entity.knots,
            weights: entity.type === "SPLINE" ? null : undefined,
          },
        });
      }
    }
    const readback = { selectedLayerEntities };
    const verifies = (saved = readback, live = observations) => exactDirectFamilyGeometry(saved, live, expected.autoCad.directFamilies);

    expect(verifies()).toBe(true);
    const wrongEndpoint = structuredClone(readback);
    wrongEndpoint.selectedLayerEntities.F024_LINE_CIRCLE.find(({ type }) => type === "LINE").vertices[1].x += 1;
    expect(verifies(wrongEndpoint)).toBe(false);
    const wrongSweep = structuredClone(readback);
    wrongSweep.selectedLayerEntities.F024_LINE_ARC.find((entity) => entity.type === "ARC" && entity.center.y === 3610).endAngle += 0.1;
    expect(verifies(wrongSweep)).toBe(false);
    const wrongHandle = structuredClone(observations);
    wrongHandle.F024_LINE_ELLIPSE.find(({ objectName }) => objectName === "AcDbEllipse").handle = "FFFF";
    expect(verifies(readback, wrongHandle)).toBe(false);
    const wrongAppearance = structuredClone(readback);
    wrongAppearance.selectedLayerEntities.F024_LINE_SPLINE.find(({ type }) => type === "SPLINE").lineweight = 25;
    expect(verifies(wrongAppearance)).toBe(false);
    const wrongSavedWeights = structuredClone(readback);
    wrongSavedWeights.selectedLayerEntities.F024_LINE_SPLINE.find(({ type }) => type === "SPLINE").weights = [1, 9, 1, 1, 1];
    expect(verifies(wrongSavedWeights)).toBe(false);
    const wrongLiveWeights = structuredClone(observations);
    wrongLiveWeights.F024_LINE_SPLINE.find(({ objectName }) => objectName === "AcDbSpline").details.weights = [1, 9, 1, 1, 1];
    expect(verifies(readback, wrongLiveWeights)).toBe(false);
    const duplicateHandle = structuredClone(readback);
    duplicateHandle.selectedLayerEntities.F024_LINE_ARC[0].handle = duplicateHandle.selectedLayerEntities.F024_LINE_CIRCLE[0].handle;
    expect(verifies(duplicateHandle)).toBe(false);
  });
});
