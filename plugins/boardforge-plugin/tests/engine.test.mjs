import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pointInPolygon, rectanglePoints, round } from '../lib/geometry.mjs'
import { getManufacturerProfile } from '../lib/manufacturers.mjs'
import { assignNetsToClasses } from '../lib/net-classes.mjs'
import { validateBoardOutline, validatePlacement } from '../lib/validation.mjs'
import { generateRoutingPlan } from '../lib/routing.mjs'
import { applyTraceBranchRoutingSelection, buildNetSpecificConnectivityGraph, classifyDrcParserMismatch, classifyDrcRegression, classifyEscBlocker, classifyEscDrcFamilies, classifyEscErcErrors, classifyRouteDrcFailure, classifySameFootprintRouteNeed, compareDrcStdoutVsJson, compareEscRoutingBranches, createEscRoutingBranch, createInternalRepairTask, detectExternalAutorouterAvailability, detectNoOpBranch, detectSameFootprintPadPair, discardFailedEscRoutingBranch, enqueueInternalRepairTask, executeInternalRepairTask, executeJob, generateDrcAwareRouteAlternatives, generateLocalPadBridgeCandidates, legalizeTraceRoutingPlan, normalizeKicadDrcCounts, promoteBestEscRoutingBranch, recordTransactionSourceTarget, rejectNoOpBranch, rejectSameFootprintFloatingIsland, repairBoardEdgeDrc, repairEscErcErrors, repairEscErcErrorsLocally, repairGeneratedCopperDrc, repairVinDrcRegression, requireBranchExecutionEvidence, requireSourceTargetInBlockerReport, restoreEscRoutingBranch, resumeEscSupervisorAfterTask, resolveScannedKiCadPadBindings, routeSameFootprintPadPair, routeWithoutViaWhenViaBlocked, runFocusedTestsForRepair, runMultiBranchEscRouting, saveInternalRepairTaskLog, scoreEscRoutingBranch, scoreEscRoutingBranchDelta, selectNextConnectionForNet, validateEscFinalState, validateSameFootprintRoute, verifyGeneratedCopperBelongsToNetIsland, verifyInternalRepairTask, verifySameFootprintPadContact, writeEscDrcCleanupReport, writeEscErcRepairReport } from '../lib/jobs.mjs'
import { buildDrcArgs, detectKiCadCli } from '../lib/kicad-cli.mjs'
import { detectKiCadLibraryRoots, normalize3dModelPath } from '../lib/library-adapter.mjs'
import { parseFootprintCourtyardFromText, parseFootprintPadsFromText, parseSymbolPinsFromText } from '../lib/component-compatibility.mjs'
import { scorePlacement } from '../lib/placement.mjs'
import { validateRoutingGeometry, verifyPadToPadConnectivity } from '../lib/routing-validation.mjs'
import { scoreRoutingPlan } from '../lib/routing-quality.mjs'
import { kicadPcbFile, scanKiCadProject } from '../lib/kicad.mjs'
import { runAutotracerPlanning } from '../lib/autotracer-engine.mjs'
import { autorouteBoard, buildPadEscapeSegment, extractPadCopperGeometry, findLegalPadEscapePoint, findNearestLegalThroughViaSite, generatePadEdgeContactPoints, generatePadEscapeCandidates, snapEndpointToPadCopper } from '../lib/autorouter.mjs'
import { planDrcRepairs } from '../lib/drc-repair.mjs'
import { applyErcIntentPolicy, classifyErcPowerIntent } from '../lib/erc-repair.mjs'
import { buildDrcClusterReport, compactSilkscreenForDenseBoard, validateEscViaPolicy } from '../lib/esc-drc-clusters.mjs'
import { buildEscRouteBundle, buildNetConnectivityGraph, evaluateRouteletSuccess, selectEscHighCurrentEndpointPairs } from '../lib/esc-routelet-success.mjs'
import { analyzeEscRoutingCorridors, generateHighCurrentRouteCandidates, generateViaArrayCandidate, recommendEscPlacementCorridorFix, validateHighCurrentCandidate } from '../lib/esc-high-current-router.mjs'
import { analyzeVbatCorridor, applyCorridorMovesToPcb, buildPowerCorridorMap, classifyFootprintMobility, generateFullInternalEscRelayoutCandidates, generatePowerCorridorRegenerationCandidates, generateVbatCorridorRepairCandidates, scoreFullInternalRelayoutCandidate, scorePowerCorridorRegenerationCandidate, scoreVbatCorridorCandidate } from '../lib/esc-corridor-regeneration.mjs'
import { applyDryRunMoves, buildEscRouteStrategySet, createWorkingCandidateStack, evaluateCorridorGain, evaluatePlacementAcceptanceGate, evaluateRoutingAcceptanceGate, extractFootprintGeometry, extractPlacementBlockersFromPrecheck, filterTargetedMoveCandidatesForPriority, generateMoveMutationsForNet, generateTargetedMoveCandidates, normalizeDrcBaseline, optimizePriorityEscCorridors, precheckPlacementGeometry, runEscAutonomousRoutingConvergence, selectPriorityTargetedMoveCandidate, shouldRollbackTargetedPlacement, simulateTargetedMove, scoreGeometryAwareCandidate, verifyConnectivityProgress } from '../lib/kicad-footprint-geometry.mjs'
import {
  copyLibrariesToProject,
  diagnoseMissingKiCadLibraries,
  searchLocalKiCadLibraries,
  selectBestFootprintLibraryCandidate,
  updateFpLibTable,
  updateSymLibTable,
  validateLibraryResolution,
} from '../lib/kicad-library-resolver.mjs'
import { diagnoseFixture, planEndpointAwareReroutes } from '../lib/endpoint-router.mjs'
import { validateJlcpcbPackage } from '../lib/jlcpcb-package-validator.mjs'
import { normalizeCanonicalPinMap } from '../lib/component-database.mjs'
import { generateSchematicModel, kicadSchematicFromModel } from '../lib/schematic-generator.mjs'
import { analyzeErcReport, analyzeEscRoutingFeasibility, applyEscNetClasses, classifyEscNets, migrateEscPcbStackup } from '../lib/esc-workflow.mjs'
import { buildLayerObstacleMap, buildM2ObstructionReport, buildRoutingGrid, continueEscRouteToFinishWithSourcingGate, createMultilayerRoutePlan, extractPadConnectionRegions, findMultilayerPath, generateM2PlacementMutations, generateM2ReplacementCandidates, identifyExactM2FootprintBlockers, placeHighCurrentViaArray, reclassifyVbatStatus, runEscMultilayerAutorouteConvergence, runEscRouteToCompletion, runEscUnattendedRouteToFinish, runEscUnattendedRouteToFinishWithStandingApproval, runM2PlacementAutorouteMutationLoop, selectEscSafeRuleProfiles, validateEscSafeRuleProfile, validatePathTouchesPads } from '../lib/multilayer-autorouter.mjs'
import { checkPartAvailability, compareElectricalRatings, digikeyKeywordSearch, digikeyPricing, digikeyProductDetails, evaluateReplacementCandidate, generateReplacementSourcingReport, getDigikeyAccessToken, queryDigikeyStock, querySupplierStock, scoreReplacementAvailability, verifyFootprintCompatibility, verifyPinoutCompatibility } from '../lib/part-availability.mjs'
import { classifyReplacementBlockers, evaluateManualVerifiedReplacements, extractCurrentMpnRecords, loadManualStockVerification, validateManualStockEntries, writeReplacementShoppingList } from '../lib/sourcing-gate.mjs'
import { auditOriginalEscSpec, writeOriginalSpecAuditReport } from '../lib/original-spec-audit.mjs'
import { applyRoutingPlanToPcb, assertRouteBundleRetained, compareExpectedVsActualCopper, scanKicadCopperAfterWrite, scanKicadCopperText } from '../lib/copper-writer.mjs'
import {
  buildHighDensityRoutePolicy,
  classifyEscRouteNet,
  classifyGanPowerStageRegion,
  classifyNoiseSensitiveNets,
  createPgndGndZoneStrategy,
  highDensityEscRouter,
  identifyGeneratedRouteBlockingFutureNets,
  mutateRouteAfterDrcFailure as mutateHighDensityRouteAfterDrcFailure,
  placeThroughViaArray,
  protectCurrentSenseCorridor,
  protectGateDriveLoops,
  rejectSenseRouteThroughSwitchingNoise,
  rerouteWithHigherPriorityOrder,
  ripupGeneratedRoute,
  routeKelvinSensePair,
  routeSensitiveNetWithReference,
  scoreEscPowerStageRouting,
  scoreViaSite,
} from '../lib/high-density-esc-router.mjs'

test('validates a simple rectangular board outline', () => {
  const board = { outline: rectanglePoints(40, 30), mountingHoles: [{ id: 'MH1', x: 5, y: 5, diameterMm: 3 }] }
  const issues = validateBoardOutline(board, getManufacturerProfile())
  assert.equal(issues.length, 0)
})

test('rejects a self-intersecting custom board outline', () => {
  const board = { outline: [{ x: 0, y: 0 }, { x: 20, y: 20 }, { x: 0, y: 20 }, { x: 20, y: 0 }], mountingHoles: [] }
  const issues = validateBoardOutline(board, getManufacturerProfile())
  assert.equal(issues.some((issue) => issue.code === 'OUTLINE_SELF_INTERSECTION'), true)
})

test('plugin generates custom prompt outlines with notches and mounting holes', async () => {
  const result = await executeJob({
    id: 'custom_outline_prompt',
    type: 'generate_custom_outline',
    input: {
      projectName: 'Wearable USB Outline',
      outlinePrompt: 'custom notched wearable board 44 x 28 mm with USB-C notch on the left edge and four mounting holes',
      manufacturerProfile: 'JLCPCB_STANDARD',
    },
  }, process.cwd())
  assert.ok(['CUSTOM_OUTLINE_READY', 'CUSTOM_OUTLINE_READY_NEEDS_REVIEW'].includes(result.status))
  assert.equal(result.board.mountingHoles.length, 4)
  assert.ok(result.board.outline.length >= 8)
  assert.equal(validateBoardOutline(result.board, getManufacturerProfile('JLCPCB_STANDARD')).some((issue) => issue.severity === 'BLOCKER'), false)
  assert.equal(result.outlinePlan.board.generatedOutline.operations.includes('usb_c_edge_cutout'), true)
})

test('outline-only plugin commands write and transform KiCad Edge.Cuts safely', async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'boardforge-custom-outline-'))
  try {
    const created = await executeJob({
      id: 'custom_outline_project',
      type: 'create_outline_board',
      allowOverwrite: true,
      input: {
        projectName: 'Custom Shape Board',
        outlinePrompt: 'custom board 48 x 30 mm with RJ45 clearance on the right edge and two mounting holes',
      },
    }, workspace)
    assert.equal(created.status, 'OUTLINE_GENERATED_NEEDS_REVIEW')
    assert.ok(created.generatedFiles.some((file) => file.endsWith('boardforge-outline-plan.json')))
    const rounded = await executeJob({
      id: 'round_custom_outline',
      type: 'round_board_corners',
      input: { projectPath: 'custom-shape-board', radiusMm: 4 },
    }, workspace)
    assert.ok(['OUTLINE_TRANSFORM_READY_NEEDS_REVIEW', 'OUTLINE_TRANSFORM_NEEDS_FIX'].includes(rounded.status))
    assert.ok(rounded.generatedFiles.some((file) => file.endsWith('custom-shape-board.kicad_pcb')))
    const pcb = await readFile(path.join(workspace, 'custom-shape-board', 'custom-shape-board.kicad_pcb'), 'utf8')
    assert.match(pcb, /Edge\.Cuts/)
    assert.match(pcb, /BoardForge outline-only/)
    const state = JSON.parse(await readFile(path.join(workspace, 'custom-shape-board', 'boardforge-project.json'), 'utf8'))
    assert.equal(state.board.outline.length, rounded.board.outline.length)
    const detected = await detectKiCadCli()
    if (detected.available) {
      const drc = await executeJob({ id: 'custom_outline_drc', type: 'run_kicad_drc', input: { projectPath: 'custom-shape-board' } }, workspace)
      assert.ok(['DRC_PASSED', 'DRC_PASSED_WITH_WARNINGS'].includes(drc.status))
      assert.equal(drc.report.issueCounts.errors, 0)
    }
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})

test('KiCad scanner transforms rotated footprint pads into board coordinates', async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'boardforge-rotated-pad-'))
  try {
    const projectDir = path.join(workspace, 'rotated-usb')
    await mkdir(projectDir, { recursive: true })
    await writeFile(path.join(projectDir, 'rotated-usb.kicad_pcb'), `(kicad_pcb (version 20240108)
  (paper "A4")
  (layers (0 "F.Cu" signal) (31 "B.Cu" signal) (44 "Edge.Cuts" user))
  (footprint "BoardForge_USB_C_Receptacle_USB2_Routeable"
    (layer "F.Cu")
    (at 9 32 90)
    (property "Reference" "J1" (at 0 0 90) (layer "F.SilkS"))
    (property "Value" "USB-C" (at 0 0 90) (layer "F.Fab"))
    (pad "A5" smd roundrect (at -1.5 -2.9) (size 0.22 0.72) (layers "F.Cu" "F.Mask") (net "CC1"))
  )
)`, 'utf8')
    const scan = await scanKiCadProject(projectDir)
    const pad = scan.pads.find((item) => item.ref === 'J1' && item.pad === 'A5')
    assert.ok(pad)
    assert.equal(pad.x, 6.1)
    assert.equal(pad.y, 33.5)
    assert.equal(pad.netName, 'CC1')
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})

test('assigns USB and battery nets to strict classes', () => {
  const nets = assignNetsToClasses([{ name: 'USB_DP' }, { name: 'USB_DN' }, { name: 'VBAT' }, { name: 'SCL' }])
  assert.equal(nets.find((net) => net.name === 'USB_DP').className, 'USB_DIFF')
  assert.equal(nets.find((net) => net.name === 'VBAT').className, 'BATTERY')
  assert.equal(nets.find((net) => net.name === 'SCL').className, 'I2C')
})

test('classifies advanced high-speed, field-bus, switching, and debug nets', () => {
  const nets = assignNetsToClasses([
    { name: 'RS485_A' },
    { name: 'MIPI_D0_P' },
    { name: 'PCIE_TX_N' },
    { name: 'SWCLK' },
    { name: 'NRST' },
    { name: 'BOOT0' },
    { name: 'PHASE_A' },
    { name: 'SW' },
    { name: 'ANTENNA_FEED' },
    { name: 'POE_VDD' },
  ])
  assert.equal(nets.find((net) => net.name === 'RS485_A').className, 'RS485_DIFF')
  assert.equal(nets.find((net) => net.name === 'MIPI_D0_P').className, 'MIPI_DIFF')
  assert.equal(nets.find((net) => net.name === 'PCIE_TX_N').className, 'PCIe_DIFF')
  assert.equal(nets.find((net) => net.name === 'SWCLK').className, 'DEBUG')
  assert.equal(nets.find((net) => net.name === 'NRST').className, 'RESET')
  assert.equal(nets.find((net) => net.name === 'BOOT0').className, 'BOOT')
  assert.equal(nets.find((net) => net.name === 'PHASE_A').className, 'MOTOR_PHASE')
  assert.equal(nets.find((net) => net.name === 'SW').className, 'SWITCHING_NODE')
  assert.equal(nets.find((net) => net.name === 'ANTENNA_FEED').className, 'ANTENNA')
  assert.equal(nets.find((net) => net.name === 'POE_VDD').className, 'HIGH_VOLTAGE')
})

test('esc-net-classification maps real ESC power, gate-drive, switching, and current-sense names', () => {
  const nets = assignNetsToClasses([
    { name: 'VBAT_RAW' },
    { name: '/VBAT_RAW' },
    { name: 'VBAT_HK' },
    { name: 'PGND' },
    { name: '/PGND' },
    { name: 'M1_A_SW' },
    { name: 'M4_C_SW' },
    { name: '/M4_C_SW' },
    { name: 'M1_A_HG' },
    { name: '/M1_A_HG' },
    { name: 'M1_A_LG' },
    { name: 'M3_B_HI' },
    { name: 'M3_B_LO' },
    { name: 'M1_SHUNT_P' },
    { name: 'M1_SHUNT_N' },
    { name: 'ISENSE_M4' },
    { name: 'VREG3V3' },
    { name: '/SW_12' },
    { name: '/M1_A_VDD' },
    { name: 'DSHOT_M1_IN' },
  ])
  const classFor = (name) => nets.find((net) => net.name === name).className
  assert.equal(classFor('VBAT_RAW'), 'BATTERY')
  assert.equal(classFor('/VBAT_RAW'), 'BATTERY')
  assert.equal(classFor('VBAT_HK'), 'BATTERY')
  assert.equal(classFor('PGND'), 'GROUND')
  assert.equal(classFor('/PGND'), 'GROUND')
  assert.equal(classFor('M1_A_SW'), 'SWITCHING_NODE')
  assert.equal(classFor('M4_C_SW'), 'SWITCHING_NODE')
  assert.equal(classFor('/M4_C_SW'), 'SWITCHING_NODE')
  assert.equal(classFor('M1_A_HG'), 'GATE_DRIVE')
  assert.equal(classFor('/M1_A_HG'), 'GATE_DRIVE')
  assert.equal(classFor('M1_A_LG'), 'GATE_DRIVE')
  assert.equal(classFor('M3_B_HI'), 'GATE_DRIVE')
  assert.equal(classFor('M3_B_LO'), 'GATE_DRIVE')
  assert.equal(classFor('M1_SHUNT_P'), 'CURRENT_SENSE')
  assert.equal(classFor('M1_SHUNT_N'), 'CURRENT_SENSE')
  assert.equal(classFor('ISENSE_M4'), 'CURRENT_SENSE')
  assert.equal(classFor('VREG3V3'), 'POWER_LOW_CURRENT')
  assert.equal(classFor('/SW_12'), 'SWITCHING_NODE')
  assert.equal(classFor('/M1_A_VDD'), 'POWER_LOW_CURRENT')
  assert.equal(classFor('DSHOT_M1_IN'), 'GATE_DRIVE')
})

test('ESC ERC analysis clusters KiCad text reports into blockers and review groups', async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'boardforge-esc-erc-'))
  try {
    const reportFile = path.join(workspace, 'erc.rpt')
    await writeFile(reportFile, `ERC report
[lib_symbol_mismatch]: Symbol 'LMG1210RVRT' doesn't match copy in library 'ESC'
    ; warning
    @(73.66 mm, 508.00 mm): Symbol U14 [LMG1210RVRT]
[pin_to_pin]: Pins of type Unspecified and Power input are connected
    ; warning
    @(91.44 mm, 530.86 mm): Symbol U14 Pin 20 [LS_DAP, Unspecified, Line]
[unconnected_pin]: Input pin is not connected
    ; error
    @(10.00 mm, 20.00 mm): Symbol U1 Pin 1 [IN, Input, Line]
`, 'utf8')
    const analysis = await analyzeErcReport({ reportFile })
    assert.equal(analysis.totalErcViolations, 3)
    assert.equal(analysis.clusters.some((cluster) => cluster.type === 'schematic_symbol_issue' && cluster.blocking === false), true)
    assert.equal(analysis.clusters.some((cluster) => cluster.type === 'pin_type_conflict'), true)
    assert.equal(analysis.blockers.some((cluster) => cluster.type === 'unconnected_required_pin'), true)
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})

test('ESC feasibility rejects dense two-layer motor controllers and counts ESC classes', async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'boardforge-esc-feasibility-'))
  try {
    const projectDir = path.join(workspace, 'esc-dense')
    await mkdir(projectDir, { recursive: true })
    const footprints = Array.from({ length: 90 }, (_, index) => `
  (footprint "BoardForge:Part${index}"
    (layer "F.Cu")
    (at ${5 + (index % 15) * 2} ${5 + Math.floor(index / 15) * 2})
    (property "Reference" "${index < 12 ? `Q${index + 1}` : index < 16 ? `R_SHUNT${index - 11}` : `U${index + 1}`}" (at 0 0 0) (layer "F.SilkS"))
    (pad "1" smd rect (at 0 0) (size 0.5 0.5) (layers "F.Cu") (net "${index < 10 ? `M1_A_SW` : index < 20 ? `M1_A_HG` : index < 30 ? `M1_SHUNT_P` : index < 40 ? `VBAT_RAW` : `NET_${index}`}"))
  )`).join('\n')
    await writeFile(path.join(projectDir, 'esc-dense.kicad_pcb'), `(kicad_pcb (version 20240108)
  (paper "A4")
  (layers (0 "F.Cu" signal) (2 "B.Cu" signal) (25 "Edge.Cuts" user))
  (gr_line (start 0 0) (end 41.5 0) (stroke (width 0.1) (type solid)) (layer "Edge.Cuts"))
  (gr_line (start 41.5 0) (end 41.5 40.85) (stroke (width 0.1) (type solid)) (layer "Edge.Cuts"))
  (gr_line (start 41.5 40.85) (end 0 40.85) (stroke (width 0.1) (type solid)) (layer "Edge.Cuts"))
  (gr_line (start 0 40.85) (end 0 0) (stroke (width 0.1) (type solid)) (layer "Edge.Cuts"))
${footprints}
)`, 'utf8')
    const feasibility = await analyzeEscRoutingFeasibility({ projectPath: projectDir, drcSummary: { unconnectedItems: 240 } })
    assert.equal(feasibility.twoLayerFeasible, false)
    assert.equal(feasibility.recommendedMvpLayerCount, 6)
    assert.ok(feasibility.gateDriveNetCount >= 1)
    assert.ok(feasibility.currentSenseNetCount >= 1)
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})

test('ESC layer stack migration and ESC netclass application write KiCad derivative metadata', async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'boardforge-esc-stackup-'))
  try {
    const projectDir = path.join(workspace, 'esc-stackup')
    await mkdir(projectDir, { recursive: true })
    const pcbFile = path.join(projectDir, 'esc-stackup.kicad_pcb')
    const projectFile = path.join(projectDir, 'esc-stackup.kicad_pro')
    await writeFile(projectFile, JSON.stringify({ meta: { version: 1 }, board: { design_settings: {} }, net_settings: {} }, null, 2), 'utf8')
    await writeFile(pcbFile, `(kicad_pcb
  (version 20260206)
  (generator "pcbnew")
  (layers
    (0 "F.Cu" signal)
    (2 "B.Cu" signal)
    (25 "Edge.Cuts" user)
  )
  (setup
    (stackup
      (layer "F.Cu" (type "copper") (thickness 0.035))
      (layer "dielectric 1" (type "core") (thickness 1.51))
      (layer "B.Cu" (type "copper") (thickness 0.035))
    )
  )
  (net 1 "VBAT_RAW")
  (net 2 "PGND")
)
`, 'utf8')
    const migrated = await migrateEscPcbStackup({ pcbFile, layerCount: 6 })
    assert.equal(migrated.status, 'ESC_STACKUP_MIGRATED_NEEDS_DRC')
    const classed = await applyEscNetClasses({ projectDir, projectFile, pcbFile, nets: classifyEscNets([{ name: 'VBAT_RAW' }, { name: 'PGND' }, { name: 'M1_SHUNT_P' }]) })
    assert.equal(classed.status, 'ESC_NET_CLASSES_APPLIED_NEEDS_DRC')
    const pcb = await readFile(pcbFile, 'utf8')
    assert.match(pcb, /"In4\.Cu"/)
    assert.doesNotMatch(pcb, /\(net_class "BATTERY"/)
    const pro = JSON.parse(await readFile(projectFile, 'utf8'))
    assert.ok(pro.net_settings.classes.some((item) => item.name === 'BATTERY'))
    assert.ok(pro.net_settings.classes.some((item) => item.name === 'PGND'))
    assert.ok(pro.net_settings.classes.some((item) => item.name === 'KELVIN_SENSE'))
    assert.equal(pro.net_settings.netclass_assignments.VBAT_RAW, 'BATTERY')
    assert.equal(pro.net_settings.netclass_assignments.PGND, 'PGND')
    assert.equal(pro.net_settings.netclass_assignments.M1_SHUNT_P, 'KELVIN_SENSE')
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})

test('ESC 8-layer stackup uses through-via-only power-control layer roles', async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'boardforge-esc-8-layer-'))
  try {
    const pcbFile = path.join(workspace, 'esc.kicad_pcb')
    await writeFile(pcbFile, `(kicad_pcb
  (version 20240108)
  (generator "BoardForge")
  (layers
    (0 "F.Cu" signal)
    (31 "B.Cu" signal)
    (32 "B.Adhes" user "B.Adhesive")
  )
  (setup
    (stackup)
  )
)`, 'utf8')
    const migrated = await migrateEscPcbStackup({ pcbFile, layerCount: 8 })
    assert.equal(migrated.layerCount, 8)
    assert.equal(migrated.stackup.find((layer) => layer.name === 'In4.Cu').role, 'regulated rails / 5V / 3V3 / VREG')
    assert.equal(migrated.stackup.find((layer) => layer.name === 'In5.Cu').role, 'control/sense routing, current-sense protected routes')
    assert.equal(migrated.stackup.find((layer) => layer.name === 'In6.Cu').role, 'solid GND / return / shielding')
    const text = await readFile(pcbFile, 'utf8')
    assert.match(text, /\(14 "In6\.Cu" signal\)/)
    assert.match(text, /\(layer "In6\.Cu"\s+\(type "copper"\)/)
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})

test('ESC via policy rejects advanced vias and allows through-via arrays', () => {
  const allowed = validateEscViaPolicy([
    { net: 'VBAT', viaType: 'through', layers: ['F.Cu', 'B.Cu'], array: true },
    { net: 'PGND', layers: ['F.Cu', 'B.Cu'] },
  ])
  assert.equal(allowed.status, 'ESC_VIA_POLICY_READY')
  const blocked = validateEscViaPolicy([
    { net: 'VBAT', viaType: 'blind', layers: ['F.Cu', 'In1.Cu'] },
    { net: 'MCU', viaType: 'buried', layers: ['In2.Cu', 'In3.Cu'] },
    { net: 'IMU', viaType: 'microvia', layers: ['F.Cu', 'In1.Cu'] },
    { net: 'DRV', viaType: 'through', layers: ['F.Cu', 'B.Cu'], viaInPad: true },
  ])
  assert.equal(blocked.status, 'ESC_VIA_POLICY_REJECTED')
  assert.deepEqual(blocked.errors.map((item) => item.code), ['BLIND_VIA_FORBIDDEN', 'NON_THROUGH_LAYER_SPAN_FORBIDDEN', 'BURIED_VIA_FORBIDDEN', 'NON_THROUGH_LAYER_SPAN_FORBIDDEN', 'MICROVIA_FORBIDDEN', 'NON_THROUGH_LAYER_SPAN_FORBIDDEN', 'VIA_IN_PAD_FORBIDDEN'])
})

test('dense silkscreen repair hides values and compacts references', async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'boardforge-dense-silk-'))
  try {
    const pcbFile = path.join(workspace, 'dense.kicad_pcb')
    await writeFile(pcbFile, `(kicad_pcb
  (footprint "Device:R_0603"
    (layer "F.Cu")
    (fp_text reference "R1" (at 0 0) (layer "F.SilkS")
      (effects (font (size 1 1) (thickness 0.15)))
    )
    (fp_text value "10k" (at 0 1) (layer "F.SilkS")
      (effects (font (size 1 1) (thickness 0.15)))
    )
  )
)`, 'utf8')
    const repaired = await compactSilkscreenForDenseBoard({ pcbFile })
    const text = await readFile(pcbFile, 'utf8')
    assert.equal(repaired.status, 'DENSE_SILKSCREEN_COMPACTED_NEEDS_DRC')
    assert.match(text, /\(fp_text value "10k"[\s\S]*\(hide yes\)/)
    assert.match(text, /\(fp_text reference "R1"[\s\S]*\(size 0\.6 0\.6\)/)
    assert.match(text, /\(thickness 0\.1\)/)
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})

test('copper edge clearance repair classifies generated and imported edge clusters', async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'boardforge-edge-cluster-'))
  try {
    const reportFile = path.join(workspace, 'drc.json')
    await writeFile(reportFile, JSON.stringify({
      violations: [
        { severity: 'error', type: 'copper_edge_clearance', description: 'BoardForge generated zone too close to edge', items: [{ description: 'Zone [/PGND] on In1.Cu', pos: { x: 5, y: 5 } }] },
        { severity: 'error', type: 'copper_edge_clearance', description: 'Footprint copper too close to Edge.Cuts', items: [{ description: 'Pad 1 [VBAT] of J1 on F.Cu', pos: { x: 8, y: 5 } }] },
      ],
      unconnected_items: [],
    }), 'utf8')
    const clusters = await buildDrcClusterReport({ reportFile })
    const edge = clusters.clusters.find((cluster) => cluster.type === 'copper_edge_clearance')
    assert.equal(edge.count, 2)
    assert.equal(edge.blocksRouting, true)
    assert.equal(edge.blocksExport, true)
    assert.equal(edge.safeToAutoFix, true)
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})

test('drill out-of-range repair classifies imported holes as review unless generated', async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'boardforge-drill-cluster-'))
  try {
    const reportFile = path.join(workspace, 'drc.json')
    await writeFile(reportFile, JSON.stringify({
      violations: [{ severity: 'error', type: 'drill_out_of_range', description: 'Drill out of range', items: [{ description: 'Pad 1 of J2 on F.Cu', pos: { x: 1, y: 2 } }] }],
      unconnected_items: [],
    }), 'utf8')
    const clusters = await buildDrcClusterReport({ reportFile })
    const drill = clusters.clusters.find((cluster) => cluster.type === 'drill_out_of_range')
    assert.equal(drill.safeToAutoFix, false)
    assert.match(drill.safeRepairStrategy, /generated drills only/)
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})

test('solder mask bridge classification avoids blanket footprint edits', async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'boardforge-mask-cluster-'))
  try {
    const reportFile = path.join(workspace, 'drc.json')
    await writeFile(reportFile, JSON.stringify({
      violations: [{ severity: 'error', type: 'solder_mask_bridge', description: 'Solder mask bridge below minimum', items: [{ description: 'Pad 2 [M1_A] of Q3 on B.Cu', pos: { x: 2, y: 3 } }] }],
      unconnected_items: [],
    }), 'utf8')
    const clusters = await buildDrcClusterReport({ reportFile })
    const mask = clusters.clusters.find((cluster) => cluster.type === 'solder_mask_bridge')
    assert.equal(mask.blocksExport, true)
    assert.equal(mask.safeToAutoFix, false)
    assert.match(mask.safeRepairStrategy, /do not globally edit footprints/)
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})

test('clustered clearance repair separates generated repair from imported review', async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'boardforge-clearance-cluster-'))
  try {
    const reportFile = path.join(workspace, 'drc.json')
    await writeFile(reportFile, JSON.stringify({
      violations: [
        { severity: 'error', type: 'clearance', description: 'Clearance violation between BoardForge generated copper and pad', items: [{ description: 'Track [/PGND] on In1.Cu', pos: { x: 3, y: 4 } }] },
        { severity: 'error', type: 'clearance', description: 'Clearance violation between imported footprint pads', items: [{ description: 'Pad 1 [VBAT] of U1 on F.Cu', pos: { x: 4, y: 4 } }] },
      ],
      unconnected_items: [],
    }), 'utf8')
    const clusters = await buildDrcClusterReport({ reportFile })
    const clearance = clusters.clusters.find((cluster) => cluster.type === 'clearance')
    assert.equal(clearance.count, 2)
    assert.equal(clearance.blocksRouting, true)
    assert.equal(clearance.safeToAutoFix, true)
    assert.match(clearance.safeRepairStrategy, /rollback or repair generated copper/)
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})

test('KiCad library resolver copies libraries and writes project-relative tables', async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'boardforge-lib-resolver-'))
  try {
    const source = path.join(workspace, 'source')
    const projectDir = path.join(workspace, 'project')
    const pretty = path.join(source, 'AstraRMM.pretty')
    await mkdir(pretty, { recursive: true })
    await mkdir(projectDir, { recursive: true })
    await writeFile(path.join(pretty, 'EPC2367.kicad_mod'), '(footprint "EPC2367")\n', 'utf8')
    await writeFile(path.join(source, 'ESC.kicad_sym'), '(kicad_symbol_lib (symbol "ESC_Test"))\n', 'utf8')
    const copied = await copyLibrariesToProject({
      projectDir,
      nickname: 'AstraRMM',
      footprintCandidate: { path: pretty },
      symbolCandidate: { path: path.join(source, 'ESC.kicad_sym') },
    })
    await updateFpLibTable({ projectDir, nickname: 'AstraRMM', relativePrettyPath: 'boardforge-local-libs/footprints/AstraRMM.pretty' })
    await updateSymLibTable({ projectDir, nickname: 'AstraRMM', relativeSymbolPath: 'boardforge-local-libs/symbols/AstraRMM.kicad_sym' })
    const fpTable = await readFile(path.join(projectDir, 'fp-lib-table'), 'utf8')
    const symTable = await readFile(path.join(projectDir, 'sym-lib-table'), 'utf8')
    assert.match(fpTable, /\$\{KIPRJMOD\}\/boardforge-local-libs\/footprints\/AstraRMM\.pretty/)
    assert.match(symTable, /\$\{KIPRJMOD\}\/boardforge-local-libs\/symbols\/AstraRMM\.kicad_sym/)
    assert.match(copied.footprints, /boardforge-local-libs/)
    const validation = await validateLibraryResolution({ projectDir, nickname: 'AstraRMM', requiredFootprints: ['EPC2367'] })
    assert.equal(validation.status, 'KICAD_LIBRARY_RESOLUTION_READY')
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})

test('missing AstraRMM library resolution selects candidate by footprint matches', async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'boardforge-astrarmm-resolver-'))
  try {
    const source = path.join(workspace, 'Documents', 'KiCad', '9.0', 'footprints', 'AstraRMM.pretty')
    const weak = path.join(workspace, 'Downloads', 'AstraRMM.pretty')
    await mkdir(source, { recursive: true })
    await mkdir(weak, { recursive: true })
    await writeFile(path.join(source, 'EPC2367.kicad_mod'), '(footprint "EPC2367")\n', 'utf8')
    await writeFile(path.join(source, 'RVR0019A.kicad_mod'), '(footprint "RVR0019A")\n', 'utf8')
    await writeFile(path.join(weak, 'Other.kicad_mod'), '(footprint "Other")\n', 'utf8')
    const pcbText = '(footprint "AstraRMM:EPC2367" (property "Reference" "Q1"))\n(footprint "AstraRMM:RVR0019A" (property "Reference" "U1"))'
    const diagnosis = diagnoseMissingKiCadLibraries({
      pcbText,
      drcReport: { violations: [{ description: "The current configuration does not include the footprint library 'AstraRMM'" }] },
    })
    assert.equal(diagnosis[0].library, 'AstraRMM')
    assert.equal(diagnosis[0].affectedFootprints, 2)
    const candidates = await searchLocalKiCadLibraries({
      roots: [workspace],
      missingLibraries: ['AstraRMM'],
      requiredFootprints: ['EPC2367', 'RVR0019A'],
    })
    const selected = selectBestFootprintLibraryCandidate(candidates, ['EPC2367', 'RVR0019A'])
    assert.equal(selected.path, source)
    assert.deepEqual(selected.matchedFootprints.sort(), ['EPC2367', 'RVR0019A'])
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})

test('KiCad library resolver classifies footprint version mismatch as review not routing block', async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'boardforge-footprint-version-review-'))
  try {
    const reportFile = path.join(workspace, 'drc.json')
    await writeFile(reportFile, JSON.stringify({
      violations: [
        { severity: 'warning', type: 'lib_footprint_issues', description: "Footprint 'RES_L300x_BRN' does not match copy in library 'AstraRMM'", items: [{ description: 'Footprint R_SHUNT1' }] },
      ],
      unconnected_items: [],
    }), 'utf8')
    const clusters = await buildDrcClusterReport({ reportFile })
    const library = clusters.clusters.find((cluster) => cluster.type === 'lib_footprint_issues')
    assert.equal(library.severity, 'footprint version review')
    assert.equal(library.blocksRouting, false)
    assert.equal(library.blocksExport, true)
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})

test('ESC DRC cluster policy allows routing past imported export-review issues', async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'boardforge-esc-drc-policy-'))
  try {
    const reportFile = path.join(workspace, 'drc.json')
    await writeFile(reportFile, JSON.stringify({
      violations: [
        { severity: 'error', type: 'clearance', description: 'Clearance violation in imported footprint pads', items: [{ description: 'Pad 1 [VBAT] of J1 on F.Cu' }] },
        { severity: 'error', type: 'drill_out_of_range', description: 'Hole size out of range', items: [{ description: 'PTH pad V [<no net>] of U1' }] },
        { severity: 'error', type: 'solder_mask_bridge', description: 'Rear solder mask aperture bridges items', items: [{ description: 'Pad 20 [/PGND] of U1 on B.Cu' }] },
        { severity: 'warning', type: 'lib_footprint_issues', description: "Footprint 'RES_L300x_BRN' does not match copy in library 'AstraRMM'", items: [{ description: 'Footprint R_SHUNT1' }] },
      ],
      unconnected_items: [{ severity: 'error', type: 'unconnected_items', description: 'Missing connection between items', items: [{ description: 'Pad 1 [/VBAT_RAW] of J1 on F.Cu' }] }],
    }), 'utf8')
    const clusters = await buildDrcClusterReport({ reportFile })
    const byType = Object.fromEntries(clusters.clusters.map((cluster) => [cluster.type, cluster]))
    assert.equal(byType.clearance.status, 'NEEDS_REVIEW_EXPORT')
    assert.equal(byType.clearance.continueRouting, true)
    assert.equal(byType.drill_out_of_range.status, 'NEEDS_REVIEW_EXPORT')
    assert.equal(byType.solder_mask_bridge.status, 'NEEDS_REVIEW_EXPORT')
    assert.equal(byType.lib_footprint_issues.status, 'NEEDS_REVIEW_EXPORT')
    assert.equal(byType.unconnected_items.status, 'ROUTING_WORK')
    assert.equal(byType.unconnected_items.continueRouting, true)
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})

test('ESC VBAT routing policy accepts only through-via generated stage geometry', () => {
  const stagePlan = {
    vias: [
      { net: '/VBAT_RAW', viaType: 'through', layers: ['F.Cu', 'B.Cu'], diameterMm: 0.9, drillMm: 0.45 },
      { net: '/PGND', viaType: 'through', layers: ['F.Cu', 'B.Cu'], diameterMm: 0.7, drillMm: 0.35 },
    ],
  }
  const valid = validateEscViaPolicy(stagePlan)
  assert.equal(valid.status, 'ESC_VIA_POLICY_READY')
  const invalid = validateEscViaPolicy({ vias: [{ net: '/VBAT_RAW', viaType: 'blind', layers: ['F.Cu', 'In2.Cu'] }] })
  assert.equal(invalid.status, 'ESC_VIA_POLICY_REJECTED')
})

test('ESC routelet connectivity gate rejects decorative copper with no DRC or unconnected progress', () => {
  const decision = evaluateRouteletSuccess({
    before: { issueCounts: { errors: 886, warnings: 430 }, unconnected_items: Array.from({ length: 499 }, () => ({ severity: 'error' })) },
    after: { issueCounts: { errors: 886, warnings: 430 }, unconnected_items: Array.from({ length: 499 }, () => ({ severity: 'error' })) },
    route: { net: '/VBAT_RAW', segmentsWritten: 1 },
    connectionCompleted: false,
  })
  assert.equal(decision.decision, 'rollback_or_retry')
  assert.match(decision.reason, /did not reduce/)
})

test('ESC routelet connectivity gate rejects DRC-only improvement for routing stages', () => {
  const decision = evaluateRouteletSuccess({
    before: { issueCounts: { errors: 886, warnings: 430 }, unconnected_items: Array.from({ length: 499 }, () => ({ severity: 'error' })) },
    after: { issueCounts: { errors: 884, warnings: 430 }, unconnected_items: Array.from({ length: 499 }, () => ({ severity: 'error' })) },
    route: { net: '/M2_C_SW', segmentsWritten: 2 },
    operationKind: 'routing_stage',
  })
  assert.equal(decision.decision, 'rollback_or_retry')
  assert.match(decision.reason, /did not reduce/)
})

test('ESC net connectivity graph counts disconnected same-net islands', () => {
  const graph = buildNetConnectivityGraph({
    pads: [
      { id: 'J5:3', ref: 'J5', pad: '3', netName: '/M2_C_SW', x: 10, y: 10 },
      { id: 'Q14:13', ref: 'Q14', pad: '13', netName: '/M2_C_SW', x: 14, y: 10 },
      { id: 'Q14:15', ref: 'Q14', pad: '15', netName: '/M2_C_SW', x: 14.2, y: 10 },
    ],
    tracks: [{ netName: '/M2_C_SW', start: { x: 14, y: 10 }, end: { x: 14.2, y: 10 }, widthMm: 0.3 }],
    drcReport: {
      unconnected_items: [{
        severity: 'error',
        items: [
          { description: 'Pad 3 [/M2_C_SW] of J5 on F.Cu' },
          { description: 'Pad 13 [/M2_C_SW] of Q14 on F.Cu' },
        ],
      }],
    },
  })
  const net = graph.nets.find((item) => item.net === '/M2_C_SW')
  assert.equal(net.connectedIslands, 2)
  assert.equal(net.unconnectedItems, 1)
  assert.equal(net.requiredConnections.length, 1)
  assert.equal(net.requiredConnections[0].from.ref, 'J5')
  assert.equal(net.requiredConnections[0].to.ref, 'Q14')
})

test('ESC endpoint pairing prefers cross-component motor phase endpoints over same-footprint stitches', () => {
  const pairs = selectEscHighCurrentEndpointPairs({
    drcReport: {
      unconnected_items: [
        {
          type: 'unconnected_items',
          items: [
            { description: 'Pad 5 [/M1_B_SW] of Q24 on F.Cu', pos: { x: 118.288, y: 95.205 } },
            { description: 'Pad 15 [/M1_B_SW] of Q24 on F.Cu', pos: { x: 118.085, y: 95.205 } },
          ],
        },
        {
          type: 'unconnected_items',
          items: [
            { description: 'Pad 2 [/M1_B_SW] of J4 on F.Cu', pos: { x: 115.18, y: 92.65 } },
            { description: 'Pad 11 [/M1_B_SW] of Q24 on F.Cu', pos: { x: 117.91, y: 94.23 } },
          ],
        },
      ],
    },
    target: 'motor_phase',
  })
  assert.equal(pairs.length, 1)
  assert.equal(pairs[0].start.ref, 'J4')
  assert.equal(pairs[0].end.ref, 'Q24')
  const bundle = buildEscRouteBundle({ pair: pairs[0] })
  assert.equal(bundle.routes[0].className, 'MOTOR_PHASE')
  assert.equal(bundle.routes[0].widthMm, 1.2)
})

test('ESC high-current candidates include zones and mixed through-via arrays', () => {
  const pair = {
    net: '/VBAT_RAW',
    start: { ref: 'C1', pad: '1', x: 10, y: 10, layer: 'B.Cu' },
    end: { ref: 'J1', pad: '1', x: 14, y: 10, layer: 'F.Cu' },
  }
  const board = { outline: rectanglePoints(30, 30) }
  const candidates = generateHighCurrentRouteCandidates({ pair, board, target: 'battery' })
  assert.ok(candidates.length >= 5)
  assert.ok(candidates.some((candidate) => candidate.kind === 'zone'))
  assert.ok(candidates.some((candidate) => candidate.kind === 'mixed_via_array'))
  assert.equal(candidates.every((candidate) => validateHighCurrentCandidate(candidate).forbiddenViasUsed === 0), true)
})

test('ESC through-via array uses only standard through vias', () => {
  const vias = generateViaArrayCandidate({ net: '/VBAT_RAW', center: { x: 10, y: 10 }, targetLayer: 'In2.Cu', count: 6 })
  assert.equal(vias.length, 6)
  assert.equal(vias.every((via) => via.viaType === 'through'), true)
  assert.equal(validateEscViaPolicy({ vias }).status, 'ESC_VIA_POLICY_READY')
})

test('ESC high-current zone routing creates clipped copper pour candidates', () => {
  const pair = {
    net: '/M2_C_SW',
    start: { ref: 'Q14', pad: '13', x: 10, y: 10, layer: 'F.Cu' },
    end: { ref: 'J5', pad: '3', x: 14, y: 11, layer: 'F.Cu' },
  }
  const board = { outline: rectanglePoints(30, 30) }
  const zone = generateHighCurrentRouteCandidates({ pair, board, target: 'motor_phase' }).find((candidate) => candidate.kind === 'zone')
  assert.ok(zone.layers.includes('In2.Cu'))
  assert.equal(zone.routePlan.designIntent.copperPours[0].layer, 'In2.Cu')
  assert.ok(zone.routePlan.designIntent.copperPours[0].polygon.length >= 4)
  assert.equal(validateHighCurrentCandidate(zone).status, 'HIGH_CURRENT_CANDIDATE_READY')
})

test('ESC routing corridor analysis recommends placement repair when all candidates fail', () => {
  const pair = {
    net: '/M2_C_SW',
    start: { ref: 'Q14', pad: '13', x: 10, y: 10 },
    end: { ref: 'J5', pad: '3', x: 14, y: 11 },
  }
  const corridor = analyzeEscRoutingCorridors({ pair, board: { outline: rectanglePoints(30, 30) }, candidateResults: [{ committed: false }, { committed: false }] })
  assert.equal(corridor.status, 'ESC_CORRIDOR_REGENERATION_RECOMMENDED')
  assert.equal(recommendEscPlacementCorridorFix(corridor).status, 'ESC_PLACEMENT_CORRIDOR_FIX_READY_NEEDS_REVIEW')
})

test('ESC routing corridor analysis clears obstruction when any candidate works', () => {
  const pair = {
    net: '/M2_C_SW',
    start: { ref: 'Q14', pad: '13', x: 10, y: 10 },
    end: { ref: 'J5', pad: '3', x: 14, y: 11 },
  }
  const corridor = analyzeEscRoutingCorridors({
    pair,
    board: { outline: rectanglePoints(30, 30) },
    candidateResults: [{ committed: false }, { committed: true }],
  })
  assert.equal(corridor.status, 'ESC_CORRIDOR_HAS_WORKABLE_CANDIDATE')
  assert.equal(corridor.obstruction, null)
})

test('ESC VBAT corridor analysis preserves fixed battery connector and selects C1 repair candidates', () => {
  const source = { ref: 'C1', pad: '1', x: 128.7, y: 106.045 }
  const target = { ref: 'J1', pad: '1', x: 128.59, y: 107.66 }
  const footprints = [
    { ref: 'J1', lib: 'AstraRMM:ESC_Battery_1Pad_BottomEdge_OpenESC_Tab', x: 128.59, y: 107.66 },
    { ref: 'C1', lib: 'Capacitor_SMD:C_1210_3225Metric', x: 130.175, y: 106.045 },
    { ref: 'C34', lib: 'Capacitor_SMD:C_0402_1005Metric', x: 127.13, y: 105.09 },
  ]
  const analysis = analyzeVbatCorridor({ footprints, source, target })
  assert.ok(analysis.fixedObjects.includes('J1'))
  assert.equal(classifyFootprintMobility(footprints[0]).classification, 'fixed')
  assert.equal(classifyFootprintMobility(footprints[1]).classification, 'semi_fixed')
  const candidates = generateVbatCorridorRepairCandidates({ analysis })
  assert.ok(candidates.some((candidate) => candidate.id === 'vbat-corridor-c1-left-0p8'))
  assert.equal(candidates.every((candidate) => candidate.moves.every((move) => move.ref !== 'J1')), true)
})

test('ESC corridor regeneration scores target-net improvement over larger movement', () => {
  const candidate = generateVbatCorridorRepairCandidates({ analysis: { requiredWidthMm: 1.4 } })[0]
  const score = scoreVbatCorridorCandidate(candidate, {
    errorsBefore: 884,
    errorsAfter: 883,
    warningsBefore: 430,
    warningsAfter: 430,
    vbatRawBefore: 71,
    vbatRawAfter: 70,
  })
  assert.ok(score > 90)
})

test('ESC power-corridor map covers VBAT and motor phase internal-layer strategies', () => {
  const footprints = [
    { ref: 'J1', lib: 'AstraRMM:ESC_Battery_1Pad_BottomEdge_OpenESC_Tab', x: 128.59, y: 107.66 },
    { ref: 'C1', lib: 'Capacitor_SMD:C_1210_3225Metric', x: 129.375, y: 106.045 },
    { ref: 'C34', lib: 'Capacitor_SMD:C_0402_1005Metric', x: 127.13, y: 105.09 },
    { ref: 'J6', lib: 'AstraRMM:Untitled2', x: 140, y: 88 },
    { ref: 'Q13', lib: 'AstraRMM:EPC2367', x: 137, y: 88 },
  ]
  const map = buildPowerCorridorMap({
    footprints,
    corridors: [
      { net: '/VBAT_RAW', source: { ref: 'C1', pad: '1', x: 128.7, y: 106.045 }, target: { ref: 'J1', pad: '1', x: 128.59, y: 107.66 } },
      { net: '/M3_A_SW', source: { ref: 'Q13', pad: '8', x: 137, y: 88 }, target: { ref: 'J6', pad: '1', x: 140, y: 88 } },
    ],
  })
  assert.equal(map.corridors.length, 2)
  assert.ok(map.corridors.find((item) => item.net === '/VBAT_RAW').preferredLayers.some((layer) => layer.includes('In2.Cu')))
  assert.ok(map.corridors.find((item) => item.net === '/M3_A_SW').routeStyles.some((style) => style.includes('inner-layer')))
})

test('ESC power-corridor regeneration creates five internal-layer-aware candidates without fixed moves', () => {
  const footprints = [
    { ref: 'J1', lib: 'AstraRMM:ESC_Battery_1Pad_BottomEdge_OpenESC_Tab', x: 128.59, y: 107.66 },
    { ref: 'C1', lib: 'Capacitor_SMD:C_1210_3225Metric', x: 129.375, y: 106.045 },
    { ref: 'C34', lib: 'Capacitor_SMD:C_0402_1005Metric', x: 127.13, y: 105.09 },
    { ref: 'C5', lib: 'Capacitor_SMD:C_0603_1608Metric', x: 130, y: 103.64 },
    { ref: 'C20', lib: 'Capacitor_SMD:C_0402_1005Metric', x: 125.71, y: 105.6 },
    { ref: 'R7', lib: 'Resistor_SMD:R_0402_1005Metric', x: 133.4, y: 106.9 },
  ]
  const map = buildPowerCorridorMap({
    footprints,
    corridors: [{ net: '/VBAT_RAW', source: { ref: 'C1', pad: '1', x: 128.7, y: 106.045 }, target: { ref: 'J1', pad: '1', x: 128.59, y: 107.66 } }],
  })
  const candidates = generatePowerCorridorRegenerationCandidates({ corridorMap: map, footprints })
  assert.ok(candidates.length >= 5)
  assert.ok(candidates.some((candidate) => candidate.strategy === 'inner_layer_power_corridor'))
  assert.equal(candidates.every((candidate) => candidate.usesApprovedInternalLayers), true)
  assert.equal(candidates.every((candidate) => candidate.moves.every((move) => move.ref !== 'J1' && !/^H\d+/i.test(move.ref))), true)
  assert.ok(scorePowerCorridorRegenerationCandidate(candidates[0], { targetNetsImproved: 1, errorsBefore: 10, errorsAfter: 9, warningsBefore: 2, warningsAfter: 2 }) > candidates[0].score)
})

test('ESC full internal relayout generates fixed-outline candidates and preserves mechanical refs', () => {
  const footprints = [
    { ref: 'J1', lib: 'AstraRMM:ESC_Battery_1Pad_BottomEdge_OpenESC_Tab', x: 128.59, y: 107.66 },
    { ref: 'J5', lib: 'AstraRMM:Untitled2', x: 150, y: 88 },
    { ref: 'H1', lib: 'MOUNT_30P5_M3_CLEARANCE', x: 119.98, y: 72.4 },
    { ref: 'Q14', lib: 'AstraRMM:EPC2367', x: 132, y: 88 },
    { ref: 'U5', lib: 'AstraRMM:INA240', x: 134, y: 93 },
    { ref: 'R_SHUNT1', lib: 'AstraRMM:RES_L300x_BRN', x: 138, y: 96 },
    { ref: 'U2', lib: 'AstraRMM:TPS62932DRLR', x: 130, y: 100 },
    { ref: 'C1', lib: 'Capacitor_SMD:C_1210_3225Metric', x: 129.375, y: 106.045 },
    { ref: 'R7', lib: 'Resistor_SMD:R_0402_1005Metric', x: 133.4, y: 106.9 },
  ]
  const candidates = generateFullInternalEscRelayoutCandidates({ footprints })
  assert.equal(candidates.length, 5)
  assert.ok(candidates.every((candidate) => candidate.boardOutlineChanged === false))
  assert.ok(candidates.every((candidate) => candidate.mountingHolesMoved === false))
  assert.ok(candidates.every((candidate) => candidate.j1Moved === false))
  assert.ok(candidates.every((candidate) => candidate.motorOutputsMoved === false))
  assert.ok(candidates.every((candidate) => candidate.fixedRefsPreserved.includes('J1') && candidate.fixedRefsPreserved.includes('H1')))
  assert.ok(candidates.some((candidate) => candidate.strategy === 'vbat_highway_first'))
  assert.ok(candidates.some((candidate) => candidate.moves.some((move) => move.ref === 'Q14')))
  assert.ok(scoreFullInternalRelayoutCandidate(candidates[0]) > 0)
})

test('ESC fixed outline preservation relayout writer moves internal parts and preserves J1/H refs', async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'boardforge-full-relayout-'))
  try {
    const pcbFile = path.join(workspace, 'relayout.kicad_pcb')
    await writeFile(pcbFile, `(kicad_pcb (version 20240108)
  (footprint "AstraRMM:ESC_Battery_1Pad_BottomEdge_OpenESC_Tab" (layer "F.Cu") (at 128.59 107.66) (property "Reference" "J1" (at 0 0 0) (layer "F.SilkS")))
  (footprint "MOUNT_30P5_M3_CLEARANCE" (layer "F.Cu") (at 119.98 72.4) (property "Reference" "H1" (at 0 0 0) (layer "F.SilkS")))
  (footprint "AstraRMM:EPC2367" (layer "F.Cu") (at 132 88 180) (property "Reference" "Q14" (at 0 0 0) (layer "F.SilkS")))
)`, 'utf8')
    const applied = await applyCorridorMovesToPcb({ pcbFile, moves: [{ ref: 'Q14', dx: 1.2, dy: -0.6, rotation: 90 }] })
    const next = await readFile(pcbFile, 'utf8')
    assert.equal(applied.applied[0].ref, 'Q14')
    assert.match(next, /\(property "Reference" "J1"/)
    assert.match(next, /\(property "Reference" "H1"/)
    assert.match(next, /\(property "Reference" "Q14"/)
    assert.match(next, /\(at 133\.2 87\.4 90\)/)
    assert.match(next, /\(at 128\.59 107\.66\)/)
    assert.match(next, /\(at 119\.98 72\.4\)/)
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})

test('KiCad footprint geometry extracts pads, fallback courtyard, drills, and rotation-aware boxes', () => {
  const pcb = `(kicad_pcb (version 20240108)
  (footprint "AstraRMM:EPC2367" (layer "F.Cu") (at 10 20 90)
    (property "Reference" "Q1" (at 0 0 0) (layer "F.SilkS"))
    (pad "1" smd rect (at -1 0) (size 1 2) (layers "F.Cu" "F.Mask"))
    (pad "2" thru_hole circle (at 1 0) (size 1.2 1.2) (drill 0.5) (layers "*.Cu" "*.Mask"))
    (fp_line (start -2 -1) (end 2 -1) (stroke (width 0.05) (type solid)) (layer "F.Fab"))
  )
)`
  const [geometry] = extractFootprintGeometry(pcb)
  assert.equal(geometry.ref, 'Q1')
  assert.equal(geometry.pads.length, 2)
  assert.equal(geometry.drills.length, 1)
  assert.equal(geometry.rotation, 90)
  assert.equal(geometry.courtyardFallback, true)
  assert.ok(geometry.maxExtentBox.maxX > geometry.maxExtentBox.minX)
})

test('placement geometry precheck rejects overlaps and preserves mounting hole clearance before KiCad write', () => {
  const pcb = `(kicad_pcb (version 20240108)
  (footprint "MOUNT_30P5_M3_CLEARANCE" (layer "F.Cu") (at 0 0) (property "Reference" "H1" (at 0 0 0) (layer "F.SilkS")) (pad "1" thru_hole circle (at 0 0) (size 3 3) (drill 2) (layers "*.Cu" "*.Mask")))
  (footprint "Resistor_SMD:R_0402_1005Metric" (layer "F.Cu") (at 5 5) (property "Reference" "R1" (at 0 0 0) (layer "F.SilkS")) (pad "1" smd rect (at -0.3 0) (size 0.5 0.5) (layers "F.Cu" "F.Mask")))
  (footprint "Capacitor_SMD:C_0402_1005Metric" (layer "F.Cu") (at 8 8) (property "Reference" "C1" (at 0 0 0) (layer "F.SilkS")) (pad "1" smd rect (at 0.3 0) (size 0.5 0.5) (layers "F.Cu" "F.Mask")))
)`
  const geometries = extractFootprintGeometry(pcb)
  const precheck = precheckPlacementGeometry({ geometries, moves: [{ ref: 'R1', dx: 2.8, dy: 2.8 }, { ref: 'C1', dx: -0.2, dy: -0.2 }], boardBox: { minX: -5, minY: -5, maxX: 15, maxY: 15 } })
  assert.equal(precheck.decision, 'precheck_pass_needs_kicad_drc')
  assert.ok(precheck.componentOverlaps > 0)
})

test('geometry-aware ESC relayout rejects bad mass move before KiCad write', () => {
  const footprints = [
    { ref: 'J1', lib: 'AstraRMM:ESC_Battery_1Pad_BottomEdge_OpenESC_Tab', x: 0, y: 0 },
    { ref: 'H1', lib: 'MOUNT_30P5_M3_CLEARANCE', x: 8, y: 8 },
    ...Array.from({ length: 50 }, (_, index) => ({ ref: `R${index}`, lib: 'Resistor_SMD:R_0402_1005Metric', x: index % 10, y: Math.floor(index / 10) })),
  ]
  const candidates = generateFullInternalEscRelayoutCandidates({ footprints })
  const pcb = `(kicad_pcb (version 20240108)${footprints.map((fp) => `
  (footprint "${fp.lib}" (layer "F.Cu") (at ${fp.x} ${fp.y}) (property "Reference" "${fp.ref}" (at 0 0 0) (layer "F.SilkS")) (pad "1" smd rect (at 0 0) (size 0.8 0.8) (layers "F.Cu" "F.Mask")))`).join('')}
)`
  const geometries = extractFootprintGeometry(pcb)
  const precheck = precheckPlacementGeometry({ geometries, moves: candidates[0].moves, boardBox: { minX: -1, minY: -1, maxX: 12, maxY: 12 } })
  assert.equal(precheck.decision, 'reject_before_kicad_write')
  assert.ok(scoreGeometryAwareCandidate(candidates[0], precheck) < candidates[0].routabilityScore)
})

test('dry-run placement accepts a safe small corridor move without touching fixed objects', () => {
  const pcb = `(kicad_pcb (version 20240108)
  (footprint "AstraRMM:ESC_Battery_1Pad_BottomEdge_OpenESC_Tab" (layer "F.Cu") (at 0 0) (property "Reference" "J1" (at 0 0 0) (layer "F.SilkS")) (pad "1" smd rect (at 0 0) (size 2 2) (layers "F.Cu" "F.Mask")))
  (footprint "Capacitor_SMD:C_0402_1005Metric" (layer "F.Cu") (at 4 4) (property "Reference" "C34" (at 0 0 0) (layer "F.SilkS")) (pad "1" smd rect (at 0 0) (size 0.5 0.5) (layers "F.Cu" "F.Mask")))
)`
  const geometries = extractFootprintGeometry(pcb)
  const moved = applyDryRunMoves(geometries, [{ ref: 'C34', dx: 1, dy: 0 }])
  assert.equal(moved.find((item) => item.ref === 'J1').position.x, 0)
  assert.equal(moved.find((item) => item.ref === 'C34').position.x, 5)
  const precheck = precheckPlacementGeometry({ geometries, moves: [{ ref: 'C34', dx: 1, dy: 0 }], boardBox: { minX: -3, minY: -3, maxX: 8, maxY: 8 } })
  assert.equal(precheck.decision, 'precheck_pass_needs_kicad_drc')
})

test('ESC geometry rejection report extracts exact blocker refs from precheck', () => {
  const geometries = extractFootprintGeometry(`(kicad_pcb (version 20240108)
  (footprint "Capacitor_SMD:C_0402_1005Metric" (layer "F.Cu") (at 1 1) (property "Reference" "C1" (at 0 0 0) (layer "F.SilkS")) (pad "1" smd rect (at 0 0) (size 0.5 0.5) (layers "F.Cu" "F.Mask")))
  (footprint "Resistor_SMD:R_0402_1005Metric" (layer "F.Cu") (at 1.1 1.1) (property "Reference" "R33" (at 0 0 0) (layer "F.SilkS")) (pad "1" smd rect (at 0 0) (size 0.5 0.5) (layers "F.Cu" "F.Mask")))
)`)
  const precheck = precheckPlacementGeometry({
    geometries,
    boardBox: { minX: -2, minY: -2, maxX: 4, maxY: 4 },
    highCurrentCorridors: [{ net: '/VBAT_RAW', source: { x: 0, y: 1 }, target: { x: 3, y: 1 }, widthMm: 1.2 }],
  })
  const blockers = extractPlacementBlockersFromPrecheck(precheck, geometries)
  assert.ok(blockers.some((item) => item.ref === 'C1' && item.blocks.includes('/VBAT_RAW')))
  assert.ok(blockers.some((item) => item.blockTypes.includes('component_overlap')))
})

test('ESC blocker-derived moves generate targeted small candidates', () => {
  const blockers = [
    { ref: 'R33', blocks: ['/VBAT_RAW'], blockTypes: ['corridor_obstruction'], position: { x: 130, y: 105 }, risk: 'low', allowedMoveDirections: ['up', 'left'], suggestedMoveMm: 0.6 },
    { ref: 'J1', blocks: ['/VBAT_RAW'], blockTypes: ['corridor_obstruction'], position: { x: 128, y: 107 }, risk: 'high', allowedMoveDirections: ['up'], suggestedMoveMm: 0.35 },
  ]
  const candidates = generateTargetedMoveCandidates({ blockers, geometries: [] })
  assert.ok(candidates.some((candidate) => candidate.id.includes('R33')))
  assert.ok(candidates.every((candidate) => candidate.moveCount <= 4))
  assert.ok(candidates.some((candidate) => candidate.movedRefs.includes('J1')))
})

test('ESC targeted move dry-run accepts non-worsening geometry delta and rejects worsened collision delta', () => {
  const geometries = extractFootprintGeometry(`(kicad_pcb (version 20240108)
  (footprint "Resistor_SMD:R_0402_1005Metric" (layer "F.Cu") (at 1 1) (property "Reference" "R1" (at 0 0 0) (layer "F.SilkS")) (pad "1" smd rect (at 0 0) (size 0.4 0.4) (layers "F.Cu" "F.Mask")))
  (footprint "Capacitor_SMD:C_0402_1005Metric" (layer "F.Cu") (at 2 1) (property "Reference" "C1" (at 0 0 0) (layer "F.SilkS")) (pad "1" smd rect (at 0 0) (size 0.4 0.4) (layers "F.Cu" "F.Mask")))
  (footprint "Capacitor_SMD:C_0402_1005Metric" (layer "F.Cu") (at 3 1) (property "Reference" "C2" (at 0 0 0) (layer "F.SilkS")) (pad "1" smd rect (at 0 0) (size 0.4 0.4) (layers "F.Cu" "F.Mask")))
)`)
  const boardBox = { minX: 0, minY: 0, maxX: 5, maxY: 5 }
  const baseline = precheckPlacementGeometry({ geometries, boardBox })
  const safe = simulateTargetedMove({ candidate: { id: 'safe', moves: [{ ref: 'R1', dx: 0, dy: 0.5 }], routabilityScore: 50 }, geometries, boardBox, baselinePrecheck: baseline })
  const bad = simulateTargetedMove({ candidate: { id: 'bad', moves: [{ ref: 'R1', dx: 1, dy: 0 }], routabilityScore: 50 }, geometries, boardBox, baselinePrecheck: baseline })
  assert.equal(safe.writeToKicad, true)
  assert.equal(bad.writeToKicad, false)
})

test('ESC VBAT/M2 priority selector rejects lower-priority M3 cleanup while priority nets are blocked', () => {
  const candidates = [
    { id: 'targeted-via-escape-M3_A_SW', corridorsOpened: ['/M3_A_SW'], moves: [{ ref: 'Q4', dx: 0.2, dy: -0.2 }] },
    { id: 'targeted-via-escape-M2_C_SW', corridorsOpened: ['/M2_C_SW'], moves: [{ ref: 'Q14', dx: -0.3, dy: 0.1 }] },
    { id: 'targeted-vbat-c1-j1', corridorsOpened: ['/VBAT_RAW'], moves: [{ ref: 'C1', dx: -0.4, dy: 0 }] },
  ]
  const filtered = filterTargetedMoveCandidatesForPriority({ candidates, activeTargetNets: ['/VBAT_RAW', '/M2_C_SW'] })
  assert.equal(filtered.some((candidate) => candidate.id.includes('M3_A_SW')), false)
  assert.deepEqual(filtered.map((candidate) => candidate.priorityTarget), ['/M2_C_SW', '/VBAT_RAW'])

  const selected = selectPriorityTargetedMoveCandidate({
    activeTargetNets: ['/VBAT_RAW', '/M2_C_SW'],
    simulations: [
      { candidate: candidates[0], writeToKicad: true, score: 100, precheck: { delta: { highCurrentCorridorBlocks: -8 } } },
      { candidate: candidates[1], writeToKicad: true, score: 50, precheck: { delta: { highCurrentCorridorBlocks: -1 } } },
      { candidate: candidates[2], writeToKicad: true, score: 40, precheck: { delta: { highCurrentCorridorBlocks: -1 } } },
    ],
  })
  assert.equal(selected.candidate.id, 'targeted-vbat-c1-j1')
})

test('ESC priority selector requires priority corridor improvement before KiCad write', () => {
  const selected = selectPriorityTargetedMoveCandidate({
    activeTargetNets: ['/VBAT_RAW', '/M2_C_SW'],
    simulations: [
      { candidate: { id: 'm2-no-corridor-gain', corridorsOpened: ['/M2_C_SW'] }, writeToKicad: true, score: 90, precheck: { delta: { highCurrentCorridorBlocks: 0 } } },
      { candidate: { id: 'vbat-worse-corridor', corridorsOpened: ['/VBAT_RAW'] }, writeToKicad: true, score: 80, precheck: { delta: { highCurrentCorridorBlocks: 1 } } },
    ],
  })
  assert.equal(selected, null)
})

test('ESC targeted placement rollback gate rejects worse DRC with zero routing progress', () => {
  const bad = shouldRollbackTargetedPlacement({
    drcBefore: { errors: 885, warnings: 430, unconnected: 499 },
    drcAfter: { errors: 902, warnings: 430, unconnected: 499 },
    routing: { committedRoutes: 0, targetUnconnectedBefore: 71, targetUnconnectedAfter: 71 },
  })
  assert.equal(bad.rollback, true)
  assert.equal(bad.connectivityImproved, false)

  const useful = shouldRollbackTargetedPlacement({
    drcBefore: { errors: 885, warnings: 430, unconnected: 499 },
    drcAfter: { errors: 885, warnings: 430, unconnected: 498 },
    routing: { committedRoutes: 1, targetUnconnectedBefore: 71, targetUnconnectedAfter: 70 },
  })
  assert.equal(useful.rollback, false)
  assert.equal(useful.connectivityImproved, true)
})

test('ESC priority corridor optimizer mutates VBAT moves until corridor gain is measurable', () => {
  const geometries = extractFootprintGeometry(`(kicad_pcb (version 20240108)
  (footprint "Connector:Battery" (layer "F.Cu") (at 0 0) (property "Reference" "J1" (at 0 0 0) (layer "F.SilkS")) (pad "1" smd rect (at 0 0) (size 1 1) (layers "F.Cu" "F.Mask")))
  (footprint "Capacitor_SMD:C_1210" (layer "F.Cu") (at 8 0) (property "Reference" "C1" (at 0 0 0) (layer "F.SilkS")) (pad "1" smd rect (at 0 0) (size 1 1) (layers "F.Cu" "F.Mask")))
  (footprint "Resistor_SMD:R_0402" (layer "F.Cu") (at 4 0) (property "Reference" "R1" (at 0 0 0) (layer "F.SilkS")) (pad "1" smd rect (at 0 0) (size 0.5 0.5) (layers "F.Cu" "F.Mask")))
)`)
  const result = optimizePriorityEscCorridors({
    geometries,
    boardBox: { minX: -3, minY: -3, maxX: 11, maxY: 3 },
    corridors: [{ net: '/VBAT_RAW', sourceRef: 'C1', targetRef: 'J1', source: { x: 8, y: 0 }, target: { x: 0, y: 0 }, widthMm: 1.2 }],
    activeTargetNets: ['/VBAT_RAW'],
    maxCandidateBatches: 4,
    maxCandidatesPerBatch: 20,
  })
  assert.equal(result.status, 'PRIORITY_ESC_CORRIDOR_OPTIMIZER_READY')
  assert.equal(result.results[0].selected.gain.improved, true)
  assert.ok(
    result.results[0].selected.gain.blockerCountAfter < result.results[0].selected.gain.blockerCountBefore
    || result.results[0].selected.gain.minimumCorridorWidthAfterMm > result.results[0].selected.gain.minimumCorridorWidthBeforeMm
    || result.results[0].selected.gain.viaArraySitesAfter > result.results[0].selected.gain.viaArraySitesBefore
    || result.results[0].selected.gain.routeFeasibilityAfter === true,
  )
})

test('ESC optimizer mutations include connector moves inside fixed outline when allowed', () => {
  const candidates = generateMoveMutationsForNet({ net: '/VBAT_RAW', sourceRef: 'C1', targetRef: 'J1', blockerRefs: ['R1'], maxMoveDistanceMm: 0.5, allowConnectorMoveInsideOutline: true })
  assert.ok(candidates.some((candidate) => candidate.movedRefs.includes('J1')))
  const noConnector = generateMoveMutationsForNet({ net: '/VBAT_RAW', sourceRef: 'C1', targetRef: 'J1', blockerRefs: ['R1'], maxMoveDistanceMm: 0.5, allowConnectorMoveInsideOutline: false })
  assert.equal(noConnector.some((candidate) => candidate.movedRefs.includes('J1')), false)
})

test('ESC corridor gain metrics measure blocker count, width, via room, and feasibility', () => {
  const geometries = extractFootprintGeometry(`(kicad_pcb (version 20240108)
  (footprint "Connector:Motor" (layer "F.Cu") (at 0 0) (property "Reference" "J5" (at 0 0 0) (layer "F.SilkS")) (pad "3" smd rect (at 0 0) (size 1 1) (layers "F.Cu" "F.Mask")))
  (footprint "AstraRMM:EPC2367" (layer "F.Cu") (at 8 0) (property "Reference" "Q14" (at 0 0 0) (layer "F.SilkS")) (pad "13" smd rect (at 0 0) (size 1 1) (layers "F.Cu" "F.Mask")))
  (footprint "Diode_SMD:D_SOD-123" (layer "F.Cu") (at 4 0) (property "Reference" "D10" (at 0 0 0) (layer "F.SilkS")) (pad "1" smd rect (at 0 0) (size 0.7 0.7) (layers "F.Cu" "F.Mask")))
)`)
  const gain = evaluateCorridorGain({
    geometries,
    boardBox: { minX: -3, minY: -3, maxX: 11, maxY: 3 },
    corridor: { net: '/M2_C_SW', sourceRef: 'Q14', targetRef: 'J5', source: { x: 8, y: 0 }, target: { x: 0, y: 0 }, widthMm: 1.2 },
    moves: [{ ref: 'D10', dx: 0, dy: 2 }],
  })
  assert.equal(gain.blockerCountBefore > gain.blockerCountAfter, true)
  assert.equal(gain.minimumCorridorWidthAfterMm >= gain.minimumCorridorWidthBeforeMm, true)
  assert.equal(gain.improved, true)
})

test('ESC DRC baseline normalization separates KiCad violations from unconnected items', () => {
  const normalized = normalizeDrcBaseline({
    violations: [{ severity: 'error', type: 'clearance' }, { severity: 'warning', type: 'silk' }],
    unconnected_items: [{ severity: 'error', type: 'unconnected_items' }, { severity: 'error', type: 'unconnected_items' }],
  })
  assert.deepEqual(normalized.counts, { errors: 1, warnings: 1, unconnected: 2 })
  assert.match(normalized.parser, /normalized DRC parser/)
})

test('ESC placement and routing gates are separated for corridor-gain candidates', () => {
  const placement = evaluatePlacementAcceptanceGate({
    candidate: { id: 'optimizer-VBAT_RAW-C1-down-0p75' },
    gain: { improved: true, routeFeasibilityBefore: false, routeFeasibilityAfter: true, viaArraySitesBefore: 0, viaArraySitesAfter: 1 },
    precheck: { offBoard: 0, mountingHoleConflicts: 0, componentOverlaps: 0 },
    drcBefore: { errors: 388 },
    drcAfter: { errors: 390 },
  })
  assert.equal(placement.accepted, true)
  assert.equal(placement.decision, 'keep_as_working_candidate_not_final_release')

  const route = evaluateRoutingAcceptanceGate({
    before: { errors: 388, unconnected: 499 },
    after: { errors: 390, unconnected: 499 },
    verifier: { targetUnconnectedBefore: 71, targetUnconnectedAfter: 71, netIslandsBefore: 120, netIslandsAfter: 120 },
    forbiddenVias: 0,
  })
  assert.equal(route.accepted, false)
  assert.equal(route.decision, 'rollback_route_bundle_continue_loop')
})

test('ESC working candidate stack keeps VBAT and M2 corridor-gain placements queued', () => {
  const stack = createWorkingCandidateStack({
    optimizerResult: {
      results: [
        { net: '/VBAT_RAW', source: 'C1', target: 'J1', selected: { candidate: { id: 'vbat-c1', moves: [{ ref: 'C1', dx: 0, dy: 0.75 }] }, gain: { improved: true }, score: 100 } },
        { net: '/M2_C_SW', source: 'Q14', target: 'J5', selected: { candidate: { id: 'm2-q14', moves: [{ ref: 'Q14', dx: 1.5, dy: 0 }] }, gain: { improved: true }, score: 80 } },
      ],
    },
  })
  assert.equal(stack.status, 'ESC_WORKING_CANDIDATE_STACK_READY')
  assert.deepEqual(stack.workingCandidates.map((item) => item.net), ['/VBAT_RAW', '/M2_C_SW'])
})

test('ESC route strategy sets use all 8-layer routing intent for VBAT and M2', () => {
  const vbat = buildEscRouteStrategySet({ net: '/VBAT_RAW', candidate: { candidate: 'vbat-c1' } })
  const m2 = buildEscRouteStrategySet({ net: '/M2_C_SW', candidate: { candidate: 'm2-q14' } })
  assert.equal(vbat.length, 10)
  assert.ok(vbat.some((item) => item.layers.includes('In2.Cu') && item.throughViasPlanned > 0))
  assert.equal(m2.length, 10)
  assert.ok(m2.some((item) => item.layers.includes('In2.Cu') && item.throughViasPlanned > 0))
})

test('ESC connectivity verifier reports KiCad and BoardForge progress agreement', () => {
  const verifier = verifyConnectivityProgress({
    net: '/VBAT_RAW',
    before: { unconnected: 499, byNet: { '/VBAT_RAW': { unconnected: 71 } } },
    after: { unconnected: 498, byNet: { '/VBAT_RAW': { unconnected: 70 } } },
    graphBefore: { byNet: { '/VBAT_RAW': { islands: 120 } } },
    graphAfter: { byNet: { '/VBAT_RAW': { islands: 119 } } },
  })
  assert.equal(verifier.boardForgeKiCadAgreement, true)
  assert.equal(verifier.targetUnconnectedAfter, 70)
  assert.equal(verifier.netIslandsAfter, 119)
})

test('ESC autonomous routing convergence exhausts strategy loop instead of stopping mid-loop', () => {
  const result = runEscAutonomousRoutingConvergence({
    optimizerResult: {
      results: [
        { net: '/VBAT_RAW', source: 'C1', target: 'J1', selected: { candidate: { id: 'vbat-c1', moves: [{ ref: 'C1', dx: 0, dy: 0.75 }] }, gain: { improved: true }, score: 100 } },
        { net: '/M2_C_SW', source: 'Q14', target: 'J5', selected: { candidate: { id: 'm2-q14', moves: [{ ref: 'Q14', dx: 1.5, dy: 0 }] }, gain: { improved: true }, score: 80 } },
      ],
    },
    initialDrc: { errors: 386, warnings: 430, unconnected: 499 },
    routeEvaluator: ({ net, before }) => ({
      before,
      after: { ...before, unconnected: net === '/M2_C_SW' ? 498 : 499 },
      verifier: verifyConnectivityProgress({
        net,
        before: { ...before, byNet: { [net]: { unconnected: 20 } } },
        after: { ...before, unconnected: net === '/M2_C_SW' ? 498 : 499, byNet: { [net]: { unconnected: net === '/M2_C_SW' ? 19 : 20 } } },
        graphBefore: { byNet: { [net]: { islands: 5 } } },
        graphAfter: { byNet: { [net]: { islands: net === '/M2_C_SW' ? 4 : 5 } } },
      }),
      forbiddenVias: 0,
    }),
  })
  assert.equal(result.stoppedEarly, false)
  assert.equal(result.routeStrategiesTried > 1, true)
  assert.equal(result.committed.length, 1)
  assert.deepEqual(result.unresolved, ['/VBAT_RAW'])
})

test('multilayer autorouter builds obstacle map and finds legal path around blockers', () => {
  const geometries = extractFootprintGeometry(`(kicad_pcb (version 20240108)
  (footprint "Connector:Battery" (layer "F.Cu") (at 0 0) (property "Reference" "J1" (at 0 0 0) (layer "F.SilkS")) (pad "1" smd rect (at 0 0) (size 1 1) (layers "F.Cu" "F.Mask")))
  (footprint "Capacitor_SMD:C_1210" (layer "F.Cu") (at 8 0) (property "Reference" "C1" (at 0 0 0) (layer "F.SilkS")) (pad "1" smd rect (at 0 0) (size 1 1) (layers "F.Cu" "F.Mask")))
  (footprint "Resistor_SMD:R_0402" (layer "F.Cu") (at 4 0) (property "Reference" "R1" (at 0 0 0) (layer "F.SilkS")) (pad "1" smd rect (at 0 0) (size 0.6 0.6) (layers "F.Cu" "F.Mask")))
)`)
  const regions = extractPadConnectionRegions({ geometries, source: { ref: 'C1', pad: '1' }, target: { ref: 'J1', pad: '1' } })
  const obstacleMap = buildLayerObstacleMap({ geometries, boardBox: { minX: -2, minY: -3, maxX: 10, maxY: 3 }, sourceRef: 'C1', targetRef: 'J1', routeWidthMm: 0.6, clearanceMm: 0.15 })
  const grid = buildRoutingGrid({ obstacleMap, gridMm: 0.5 })
  const path = findMultilayerPath({ grid, sourceRegion: regions.source, targetRegion: regions.target, preferredLayers: ['F.Cu', 'In2.Cu', 'B.Cu'] })
  assert.equal(path.pathFound, true)
  assert.ok(path.path.length >= 2)
})

test('multilayer autorouter verifies exact pad contact before route acceptance', () => {
  const sourceRegion = { ref: 'C1', pad: '1', x: 8, y: 0, box: { minX: 7.5, minY: -0.5, maxX: 8.5, maxY: 0.5 } }
  const targetRegion = { ref: 'J1', pad: '1', x: 0, y: 0, box: { minX: -0.5, minY: -0.5, maxX: 0.5, maxY: 0.5 } }
  const good = validatePathTouchesPads({ path: [{ x: 8, y: 0, layer: 'F.Cu' }, { x: 0, y: 0, layer: 'F.Cu' }], sourceRegion, targetRegion })
  assert.equal(good.sourceTouched, true)
  assert.equal(good.targetTouched, true)
  const bad = validatePathTouchesPads({ path: [{ x: 7, y: 0, layer: 'F.Cu' }, { x: 1, y: 0, layer: 'F.Cu' }], sourceRegion, targetRegion })
  assert.equal(bad.sourceTouched, false)
  assert.equal(bad.targetTouched, false)
})

test('multilayer autorouter uses through vias only for high-current via arrays', () => {
  const vias = placeHighCurrentViaArray({ net: '/VBAT_RAW', center: { x: 5, y: 5 }, count: 6 })
  assert.equal(vias.length, 6)
  assert.equal(vias.every((via) => via.viaType === 'through'), true)
  assert.equal(vias.every((via) => via.layers.includes('F.Cu') && via.layers.includes('B.Cu')), true)
})

test('ESC VBAT multilayer route emits KiCad route plan only after path touches pads', () => {
  const geometries = extractFootprintGeometry(`(kicad_pcb (version 20240108)
  (footprint "Connector:Battery" (layer "F.Cu") (at 0 0) (property "Reference" "J1" (at 0 0 0) (layer "F.SilkS")) (pad "1" smd rect (at 0 0) (size 1 1) (layers "F.Cu" "F.Mask")))
  (footprint "Capacitor_SMD:C_1210" (layer "F.Cu") (at 8 0) (property "Reference" "C1" (at 0 0 0) (layer "F.SilkS")) (pad "1" smd rect (at 0 0) (size 1 1) (layers "F.Cu" "F.Mask")))
)`)
  const result = runEscMultilayerAutorouteConvergence({
    geometries,
    boardBox: { minX: -2, minY: -2, maxX: 10, maxY: 2 },
    nets: [{ name: '/VBAT_RAW', source: { ref: 'C1', pad: '1' }, target: { ref: 'J1', pad: '1' }, widthMm: 0.6, clearanceMm: 0.15, preferredLayers: ['F.Cu', 'In2.Cu', 'B.Cu'] }],
    gridMm: 0.5,
  })
  assert.equal(result.status, 'MULTILAYER_AUTOROUTE_CANDIDATES_READY')
  const candidate = result.candidatesReady[0]
  assert.equal(candidate.padContact.sourceTouched, true)
  assert.equal(candidate.padContact.targetTouched, true)
  const plan = createMultilayerRoutePlan({ net: '/VBAT_RAW', pathResult: candidate.pathResult, sourceRegion: candidate.routePlan.routePlan.routes[0].start ? { ref: 'C1', x: 8, y: 0 } : null, targetRegion: { ref: 'J1', x: 0, y: 0 }, widthMm: 0.6 })
  assert.ok(plan.routePlan.routes.length >= 1)
})

test('ESC M2 multilayer route searches F/B/In2 layers without forbidden vias', () => {
  const geometries = extractFootprintGeometry(`(kicad_pcb (version 20240108)
  (footprint "Connector:Motor" (layer "F.Cu") (at 0 0) (property "Reference" "J5" (at 0 0 0) (layer "F.SilkS")) (pad "3" smd rect (at 0 0) (size 1 1) (layers "F.Cu" "F.Mask")))
  (footprint "AstraRMM:EPC2367" (layer "F.Cu") (at 8 0) (property "Reference" "Q14" (at 0 0 0) (layer "F.SilkS")) (pad "13" smd rect (at 0 0) (size 1 1) (layers "F.Cu" "F.Mask")))
)`)
  const result = runEscMultilayerAutorouteConvergence({
    geometries,
    boardBox: { minX: -2, minY: -2, maxX: 10, maxY: 2 },
    nets: [{ name: '/M2_C_SW', source: { ref: 'Q14', pad: '13' }, target: { ref: 'J5', pad: '3' }, widthMm: 0.6, clearanceMm: 0.15, preferredLayers: ['F.Cu', 'B.Cu', 'In2.Cu'] }],
    gridMm: 0.5,
  })
  assert.equal(result.status, 'MULTILAYER_AUTOROUTE_CANDIDATES_READY')
  assert.deepEqual(result.layersSearched, ['F.Cu', 'B.Cu', 'In2.Cu'])
})

test('ESC VBAT status reclassification stops chasing false target when target unconnected is zero', () => {
  const status = reclassifyVbatStatus({
    routeRuns: [{
      net: '/VBAT_RAW',
      verification: { targetUnconnectedBefore: 0, targetUnconnectedAfter: 0, globalUnconnectedBefore: 499, globalUnconnectedAfter: 499 },
    }],
  })
  assert.equal(status.stillBlocker, false)
  assert.equal(status.action, 'vbat_no_action_required_or_not_current_blocker')
})

test('ESC M2 obstruction report names source target blockers widths and searched layers', () => {
  const geometries = extractFootprintGeometry(`(kicad_pcb (version 20240108)
  (footprint "Connector:Motor" (layer "F.Cu") (at 0 0) (property "Reference" "J5" (at 0 0 0) (layer "F.SilkS")) (pad "3" smd rect (at 0 0) (size 1 1) (layers "F.Cu" "F.Mask")))
  (footprint "AstraRMM:EPC2367" (layer "F.Cu") (at 8 0) (property "Reference" "Q14" (at 0 0 0) (layer "F.SilkS")) (pad "13" smd rect (at 0 0) (size 1 1) (layers "F.Cu" "F.Mask")))
  (footprint "AstraRMM:EPC2367" (layer "F.Cu") (at 4 0) (property "Reference" "Q16" (at 0 0 0) (layer "F.SilkS")) (pad "13" smd rect (at 0 0) (size 1 1) (layers "F.Cu" "F.Mask")))
  (footprint "Diode_SMD:D_SOD-123" (layer "F.Cu") (at 5 0) (property "Reference" "D10" (at 0 0 0) (layer "F.SilkS")) (pad "1" smd rect (at 0 0) (size 0.7 0.7) (layers "F.Cu" "F.Mask")))
)`)
  const report = buildM2ObstructionReport({ geometries, boardBox: { minX: -2, minY: -2, maxX: 10, maxY: 2 } })
  assert.equal(report.net, '/M2_C_SW')
  assert.deepEqual(report.requiredWidthsTried, [1.2, 0.8])
  assert.deepEqual(report.layersSearched, ['F.Cu', 'B.Cu', 'In2.Cu'])
  assert.ok(report.blockingRefs.includes('Q16'))
})

test('ESC M2 mutation generator includes J5 moves, phase cluster moves, and support blocker moves', () => {
  const mutations = generateM2PlacementMutations({ maxMoveDistanceMm: 1 })
  assert.ok(mutations.some((item) => item.id.startsWith('m2-j5-') && item.moves.some((move) => move.ref === 'J5')))
  assert.ok(mutations.some((item) => item.type === 'phase_cluster_move' && item.moves.some((move) => move.ref === 'Q14') && item.moves.some((move) => move.ref === 'Q16')))
  assert.ok(mutations.some((item) => item.type === 'support_blocker_move' && item.moves.some((move) => ['D10', 'D11', 'C70', 'C71'].includes(move.ref))))
})

test('ESC M2 placement autoroute mutation loop reruns pathfinder after mutations', () => {
  const geometries = extractFootprintGeometry(`(kicad_pcb (version 20240108)
  (footprint "Connector:Motor" (layer "F.Cu") (at 0 0) (property "Reference" "J5" (at 0 0 0) (layer "F.SilkS")) (pad "3" smd rect (at 0 0) (size 1 1) (layers "F.Cu" "F.Mask")))
  (footprint "AstraRMM:EPC2367" (layer "F.Cu") (at 8 0) (property "Reference" "Q14" (at 0 0 0) (layer "F.SilkS")) (pad "13" smd rect (at 0 0) (size 1 1) (layers "F.Cu" "F.Mask")))
  (footprint "Capacitor_SMD:C_0402" (layer "F.Cu") (at 4 0) (property "Reference" "C70" (at 0 0 0) (layer "F.SilkS")) (pad "1" smd rect (at 0 0) (size 0.5 0.5) (layers "F.Cu" "F.Mask")))
)`)
  const loop = runM2PlacementAutorouteMutationLoop({
    geometries,
    boardBox: { minX: -2, minY: -3, maxX: 10, maxY: 3 },
    maxMutationBatches: 1,
    candidatesPerBatch: 10,
    maxPathSearchesPerCandidate: 3,
    maxMoveDistanceMm: 1,
  })
  assert.equal(loop.candidatesTested > 0, true)
  assert.equal(loop.pathSearches > 0, true)
  assert.ok(['M2_MUTATION_AUTOROUTE_PATH_READY', 'M2_MUTATION_AUTOROUTE_REQUIRES_USER_DECISION'].includes(loop.status))
})

test('ESC route-to-completion returns only valid final states and guards forbidden changes', () => {
  const geometries = extractFootprintGeometry(`(kicad_pcb (version 20240108)
  (footprint "Connector:Motor" (layer "F.Cu") (at 0 0) (property "Reference" "J5" (at 0 0 0) (layer "F.SilkS")) (pad "3" smd rect (at 0 0) (size 1 1) (layers "F.Cu" "F.Mask")))
  (footprint "AstraRMM:EPC2367" (layer "F.Cu") (at 8 0) (property "Reference" "Q14" (at 0 0 0) (layer "F.SilkS")) (pad "13" smd rect (at 0 0) (size 1 1) (layers "F.Cu" "F.Mask")))
)`)
  const result = runEscRouteToCompletion({
    geometries,
    boardBox: { minX: -2, minY: -3, maxX: 10, maxY: 3 },
    previousMultilayerReport: { routeRuns: [{ net: '/VBAT_RAW', verification: { targetUnconnectedBefore: 0, targetUnconnectedAfter: 0 } }] },
    limits: { maxMutationBatches: 1, candidatesPerBatch: 4, maxPathSearchesPerCandidate: 2, maxMoveDistanceMm: 1 },
  })
  assert.equal(result.stoppedMidLoop, false)
  assert.notEqual(result.status, 'needs_stronger_router')
  assert.equal(result.forbiddenChangesUsed.boardOutlineChanged, false)
  assert.equal(result.forbiddenChangesUsed.mountingHolesMoved, false)
  assert.equal(result.vbat.stillBlocker, false)
})

test('ESC unattended route-to-finish returns only approved final states with exact proof', () => {
  const geometries = extractFootprintGeometry(`(kicad_pcb (version 20240108)
  (footprint "Connector:Motor" (layer "F.Cu") (at 0 0) (property "Reference" "J5" (at 0 0 0) (layer "F.SilkS")) (pad "3" smd rect (at 0 0) (size 1 1) (layers "F.Cu" "F.Mask")))
  (footprint "AstraRMM:EPC2367" (layer "F.Cu") (at 8 0) (property "Reference" "Q14" (at 0 0 0) (layer "F.SilkS")) (pad "13" smd rect (at 0 0) (size 1 1) (layers "F.Cu" "F.Mask")))
)`)
  const result = runEscUnattendedRouteToFinish({
    geometries,
    boardBox: { minX: -4, minY: -4, maxX: 12, maxY: 4 },
    previousMultilayerReport: { routeRuns: [{ net: '/VBAT_RAW', targetUnconnectedBefore: 0, targetUnconnectedAfter: 0 }] },
    limits: { maxMutationBatches: 2, candidatesPerBatch: 4, maxPathSearchesPerCandidate: 2, maxMoveDistanceMm: 1 },
    erc: { errors: 0 },
    drc: { totalViolations: 5, unconnectedItems: 1 },
  })
  assert.ok([
    'esc_fully_routed_erc_drc_passed',
    'esc_fully_routed_drc_repair_review_needed',
    'esc_ready_for_manufacturing_export_review',
    'needs_user_approval_board_outline_change',
    'needs_user_approval_mounting_hole_move',
    'needs_user_approval_part_removal_or_replacement',
    'needs_user_approval_blind_buried_microvia_or_via_in_pad',
    'needs_user_approval_package_or_footprint_change',
    'needs_user_approval_electrical_rule_relaxation_exact',
  ].includes(result.state))
  assert.notEqual(result.state, 'needs_width_clearance_relaxation')
  assert.equal(result.stoppedMidLoop, false)
  assert.equal(result.forbiddenChangesUsed.boardOutlineChanged, false)
  assert.equal(result.forbiddenChangesUsed.mountingHolesMoved, false)
  if (result.approvalRequired) {
    assert.equal(result.approvalRequired.exactNet, '/M2_C_SW')
    assert.match(result.approvalRequired.requiredWidth, /1\.2mm/)
    assert.ok(result.approvalRequired.layersTried.includes('In2.Cu'))
  }
})

test('ESC safe rule profile selection permits guarded neckdowns but rejects signal traces', () => {
  const profiles = selectEscSafeRuleProfiles({ net: '/M2_C_SW', role: 'motor_phase', currentA: 20 })
  assert.equal(profiles.status, 'ESC_SAFE_RULE_PROFILES_READY')
  assert.ok(profiles.profiles.some((profile) => profile.name === 'short_calculated_neckdown' && profile.widthMm === 0.5))
  assert.ok(profiles.rejectedProfiles.some((profile) => profile.widthMm === 0.15))
  assert.equal(validateEscSafeRuleProfile(profiles.profiles.find((profile) => profile.name === 'short_calculated_neckdown'), { routeLengthMm: 1.5, role: 'motor_phase' }).status, 'ESC_SAFE_RULE_PROFILE_ACCEPTED')
  assert.equal(validateEscSafeRuleProfile(profiles.profiles.find((profile) => profile.name === 'short_calculated_neckdown'), { routeLengthMm: 3, role: 'motor_phase' }).status, 'ESC_SAFE_RULE_PROFILE_REJECTED')
  assert.equal(validateEscSafeRuleProfile({ widthMm: 0.15, clearanceMm: 0.15 }, { routeLengthMm: 0.5, role: 'motor_phase' }).status, 'ESC_SAFE_RULE_PROFILE_REJECTED')
})

test('ESC standing approval finish gate does not stop for width relaxation', () => {
  const geometries = extractFootprintGeometry(`(kicad_pcb (version 20240108)
  (footprint "Connector:Motor" (layer "F.Cu") (at 0 0) (property "Reference" "J5" (at 0 0 0) (layer "F.SilkS")) (pad "3" smd rect (at 0 0) (size 1 1) (layers "F.Cu" "F.Mask")))
  (footprint "AstraRMM:EPC2367" (layer "F.Cu") (at 8 0) (property "Reference" "Q14" (at 0 0 0) (layer "F.SilkS")) (pad "13" smd rect (at 0 0) (size 1 1) (layers "F.Cu" "F.Mask")))
)`)
  const result = runEscUnattendedRouteToFinishWithStandingApproval({
    geometries,
    boardBox: { minX: -4, minY: -4, maxX: 12, maxY: 4 },
    previousMultilayerReport: { routeRuns: [{ net: '/VBAT_RAW', targetUnconnectedBefore: 0, targetUnconnectedAfter: 0 }] },
    limits: { maxMutationBatches: 2, candidatesPerBatch: 4, maxPathSearchesPerCandidate: 4, maxMoveDistanceMm: 1 },
    erc: { errors: 0 },
    drc: { totalViolations: 5, unconnectedItems: 1 },
  })
  assert.notEqual(result.state, 'needs_user_approval_electrical_rule_relaxation_exact')
  assert.notEqual(result.state, 'needs_width_clearance_relaxation')
  assert.equal(result.stoppedMidLoop, false)
  assert.equal(result.forbiddenChangesUsed.boardOutlineChanged, false)
  assert.equal(result.forbiddenChangesUsed.mountingHolesMoved, false)
  assert.ok(result.routeToCompletion.safeRuleProfiles.profiles.length >= 4)
})

test('part availability layer reports missing supplier API keys without faking stock', async () => {
  const stock = await checkPartAvailability({
    ref: 'Q14',
    replacementPart: 'EPCxxxx-real-mpn-required',
    supplier: 'Digi-Key',
    minimumRequiredQty: 12,
  }, { env: {} })
  assert.equal(stock.status, 'NEEDS_STOCK_VERIFICATION')
  assert.equal(stock.stockVerified, false)
  assert.match(stock.reason, /will not fake live stock/)
})

test('supplier stock check accepts only trusted supplier/manual verified stock', async () => {
  const rejected = await querySupplierStock({ partNumber: 'ABC123', supplier: 'RandomMarketplace', env: {} })
  assert.equal(rejected.status, 'REJECTED_UNTRUSTED_SUPPLIER')
  const accepted = await querySupplierStock({ partNumber: 'ABC123', supplier: 'Mouser', manualStock: { stockQty: 250, supplierSku: '999-ABC123', lifecycleStatus: 'active' } })
  assert.equal(accepted.status, 'STOCK_VERIFIED_MANUAL_REVIEW')
  assert.equal(accepted.stockVerified, true)
  assert.equal(accepted.stockQty, 250)
})

test('replacement rejects out-of-stock and unverified stock before use', async () => {
  const base = {
    ref: 'Q14',
    replacementPart: 'MOSFET-ALT',
    supplier: 'Mouser',
    lifecycleStatus: 'active',
    sameFunction: true,
    sameOrBetterVoltageRating: true,
    sameOrBetterCurrentRating: true,
    sameOrBetterThermalRating: true,
    pinoutVerified: true,
    footprintVerified: true,
    minimumRequiredQty: 10,
  }
  const unverified = await evaluateReplacementCandidate(base, { env: {} })
  assert.equal(unverified.approvedForUse, false)
  assert.equal(unverified.status, 'NEEDS_STOCK_VERIFICATION')
  const out = await evaluateReplacementCandidate({ ...base, manualStock: { stockQty: 0, supplierSku: 'x' } }, { env: {} })
  assert.equal(out.approvedForUse, false)
  assert.equal(out.status, 'REJECTED_OUT_OF_STOCK')
})

test('replacement rating, pinout, and footprint compatibility must pass before approval', async () => {
  const candidate = {
    ref: 'Q14',
    replacementPart: 'MOSFET-ALT',
    supplier: 'Digi-Key',
    lifecycleStatus: 'active',
    sameFunction: true,
    sameOrBetterVoltageRating: true,
    sameOrBetterCurrentRating: true,
    sameOrBetterThermalRating: false,
    pinoutVerified: true,
    footprintVerified: true,
    minimumRequiredQty: 2,
    manualStock: { stockQty: 100, supplierSku: 'DK-MOSFET-ALT', lifecycleStatus: 'active' },
  }
  assert.equal(compareElectricalRatings(candidate).approved, false)
  assert.equal(verifyPinoutCompatibility(candidate).approved, true)
  assert.equal(verifyFootprintCompatibility(candidate).approved, true)
  const evaluated = await evaluateReplacementCandidate(candidate, { env: {} })
  assert.equal(evaluated.approvedForUse, false)
  assert.equal(scoreReplacementAvailability(candidate, evaluated.stock) > 0, true)
})

test('ESC replacement sourcing report rejects unverified theoretical parts', async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'boardforge-replacement-sourcing-'))
  try {
    const report = await generateReplacementSourcingReport({
      projectDir: workspace,
      env: {},
      candidates: [{
        ref: 'Q14',
        currentPart: 'unknown',
        currentFootprint: 'AstraRMM:EPC2367',
        replacementPart: 'THEORETICAL-FET',
        manufacturer: 'ExampleSemi',
        supplier: 'Digi-Key',
        minimumRequiredQty: 12,
        lifecycleStatus: 'active',
        sameFunction: true,
        sameOrBetterVoltageRating: true,
        sameOrBetterCurrentRating: true,
        sameOrBetterThermalRating: true,
        pinoutVerified: true,
        footprintVerified: true,
      }],
    })
    assert.equal(report.supplierLayerImplemented, true)
    assert.equal(report.acceptedCandidates.length, 0)
    assert.equal(report.rejectedCandidates[0].status, 'NEEDS_STOCK_VERIFICATION')
    assert.ok(report.outputFiles.json.endsWith('boardforge-esc-replacement-sourcing.json'))
    const md = await readFile(report.outputFiles.markdown, 'utf8')
    assert.match(md, /Rejected candidates/)
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})

test('ESC exact footprint blocker detection names M2 refs and footprints before replacement', () => {
  const geometries = extractFootprintGeometry(`(kicad_pcb (version 20240108)
  (footprint "Connector:Motor_Output" (layer "F.Cu") (at 0 0) (property "Reference" "J5" (at 0 0 0) (layer "F.SilkS")) (pad "3" smd rect (at 0 0) (size 1 1) (layers "F.Cu" "F.Mask")))
  (footprint "AstraRMM:EPC2367" (layer "F.Cu") (at 8 0) (property "Reference" "Q14" (at 0 0 0) (layer "F.SilkS")) (pad "13" smd rect (at 0 0) (size 1 1) (layers "F.Cu" "F.Mask")))
  (footprint "AstraRMM:EPC2367" (layer "F.Cu") (at 6 0) (property "Reference" "Q16" (at 0 0 0) (layer "F.SilkS")) (pad "13" smd rect (at 0 0) (size 1 1) (layers "F.Cu" "F.Mask")))
  (footprint "Diode_SMD:D_SOD-123" (layer "F.Cu") (at 4 0) (property "Reference" "D10" (at 0 0 0) (layer "F.SilkS")) (pad "1" smd rect (at 0 0) (size 0.7 0.7) (layers "F.Cu" "F.Mask")))
)`)
  const obstruction = buildM2ObstructionReport({ geometries, boardBox: { minX: -2, minY: -2, maxX: 10, maxY: 2 } })
  const blockers = identifyExactM2FootprintBlockers({ geometries, obstructionReport: obstruction })
  const q14 = blockers.find((item) => item.ref === 'Q14')
  const j5 = blockers.find((item) => item.ref === 'J5')
  assert.equal(q14.currentFootprint, 'AstraRMM:EPC2367')
  assert.equal(q14.blocksNet, '/M2_C_SW')
  assert.equal(q14.replacementCouldHelp, true)
  assert.equal(j5.blockerType, 'connector')
})

test('ESC safe footprint replacement candidates are placeholders until exact MPN and stock are verified', () => {
  const candidates = generateM2ReplacementCandidates({
    blockers: [
      { ref: 'Q14', currentPartNumber: 'unknown', currentFootprint: 'AstraRMM:EPC2367', replacementCouldHelp: true },
      { ref: 'D10', currentPartNumber: 'unknown', currentFootprint: 'Diode_SMD:D_SOD-123', replacementCouldHelp: false },
      { ref: 'J5', currentPartNumber: 'unknown', currentFootprint: 'Connector:Motor_Output', replacementCouldHelp: true },
    ],
  })
  assert.deepEqual(candidates.map((item) => item.ref), ['Q14', 'J5'])
  assert.equal(candidates.every((item) => item.approvedForUse === false), true)
  assert.equal(candidates.every((item) => item.pinoutVerified === false && item.footprintVerified === false), true)
})

test('ESC pinout preservation and sourcing gate prevent unverified M2 replacement application', async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'boardforge-m2-sourcing-gate-'))
  try {
    const geometries = extractFootprintGeometry(`(kicad_pcb (version 20240108)
  (footprint "Connector:Motor_Output" (layer "F.Cu") (at 0 0) (property "Reference" "J5" (at 0 0 0) (layer "F.SilkS")) (pad "3" smd rect (at 0 0) (size 1 1) (layers "F.Cu" "F.Mask")))
  (footprint "AstraRMM:EPC2367" (layer "F.Cu") (at 8 0) (property "Reference" "Q14" (at 0 0 0) (layer "F.SilkS")) (pad "13" smd rect (at 0 0) (size 1 1) (layers "F.Cu" "F.Mask")))
)`)
    const result = await continueEscRouteToFinishWithSourcingGate({
      projectDir: workspace,
      geometries,
      boardBox: { minX: -4, minY: -4, maxX: 12, maxY: 4 },
      previousMultilayerReport: { routeRuns: [{ net: '/VBAT_RAW', targetUnconnectedBefore: 0, targetUnconnectedAfter: 0 }] },
      limits: { maxMutationBatches: 1, candidatesPerBatch: 1, maxPathSearchesPerCandidate: 1, maxMoveDistanceMm: 0.5 },
      erc: { errors: 0 },
      drc: { totalViolations: 5, unconnectedItems: 1 },
      env: {},
    })
    assert.equal(result.state, 'needs_live_supplier_api_keys_or_manual_stock_verification')
    assert.equal(result.sourcingGate.active, true)
    assert.equal(result.sourcingGate.selectedReplacement, null)
    assert.equal(result.sourcingGate.report.acceptedCandidates.length, 0)
    assert.ok(result.exactM2Blockers.some((item) => item.ref === 'Q14' && item.currentFootprint === 'AstraRMM:EPC2367'))
    assert.ok(result.approvalRequired.replacementCandidates.every((item) => item.status === 'NEEDS_STOCK_VERIFICATION'))
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})

test('Digi-Key OAuth obtains access token without exposing secrets', async () => {
  const calls = []
  const env = {
    DIGIKEY_CLIENT_ID: 'client-id',
    DIGIKEY_CLIENT_SECRET: 'client-secret',
    DIGIKEY_OAUTH_TOKEN_URL: 'https://oauth.example/token',
    DIGIKEY_BASE_URL: 'https://api.digikey.com',
  }
  const token = await getDigikeyAccessToken({
    env,
    fetchImpl: async (url, options) => {
      calls.push({ url, options })
      assert.equal(url, env.DIGIKEY_OAUTH_TOKEN_URL)
      assert.equal(options.method, 'POST')
      assert.match(String(options.body), /grant_type=client_credentials/)
      return { ok: true, status: 200, json: async () => ({ access_token: 'mock-token', expires_in: 3600 }) }
    },
  })
  assert.equal(token.status, 'DIGIKEY_OAUTH_TOKEN_READY')
  assert.equal(token.accessToken, 'mock-token')
  assert.equal(calls.length, 1)
})

test('Digi-Key KeywordSearch posts to ProductSearch keyword endpoint', async () => {
  const env = { DIGIKEY_CLIENT_ID: 'client-id', DIGIKEY_BASE_URL: 'https://api.digikey.com' }
  const result = await digikeyKeywordSearch({
    keyword: 'EPC2367',
    accessToken: 'mock-token',
    env,
    fetchImpl: async (url, options) => {
      assert.equal(url, 'https://api.digikey.com/products/v4/search/keyword')
      assert.equal(options.method, 'POST')
      assert.equal(options.headers.Authorization, 'Bearer mock-token')
      assert.equal(options.headers['X-DIGIKEY-Client-Id'], 'client-id')
      assert.match(String(options.body), /EPC2367/)
      return { ok: true, status: 200, json: async () => ({ Products: [{ DigiKeyProductNumber: '917-EPC2367-ND', ManufacturerProductNumber: 'EPC2367', QuantityAvailable: 25 }] }) }
    },
  })
  assert.equal(result.status, 'DIGIKEY_KEYWORD_SEARCH_READY')
  assert.equal(result.products[0].supplierSku, '917-EPC2367-ND')
  assert.equal(result.products[0].stockQty, 25)
})

test('Digi-Key ProductDetails gets expanded product info', async () => {
  const result = await digikeyProductDetails({
    productNumber: '917-EPC2367-ND',
    accessToken: 'mock-token',
    env: { DIGIKEY_CLIENT_ID: 'client-id', DIGIKEY_BASE_URL: 'https://api.digikey.com' },
    fetchImpl: async (url, options) => {
      assert.equal(url, 'https://api.digikey.com/products/v4/search/917-EPC2367-ND/productdetails')
      assert.equal(options.method, 'GET')
      return { ok: true, status: 200, json: async () => ({ Product: { DigiKeyProductNumber: '917-EPC2367-ND', ManufacturerProductNumber: 'EPC2367', Manufacturer: { Name: 'EPC' }, ProductStatus: { Status: 'Active' }, DatasheetUrl: 'https://example.test/epc2367.pdf' } }) }
    },
  })
  assert.equal(result.status, 'DIGIKEY_PRODUCT_DETAILS_READY')
  assert.equal(result.product.manufacturerPartNumber, 'EPC2367')
  assert.equal(result.product.lifecycleStatus, 'Active')
})

test('Digi-Key ProductPricing gets pricing endpoint', async () => {
  const result = await digikeyPricing({
    productNumber: '917-EPC2367-ND',
    accessToken: 'mock-token',
    env: { DIGIKEY_CLIENT_ID: 'client-id', DIGIKEY_BASE_URL: 'https://api.digikey.com' },
    fetchImpl: async (url, options) => {
      assert.equal(url, 'https://api.digikey.com/products/v4/search/917-EPC2367-ND/pricing')
      assert.equal(options.method, 'GET')
      return { ok: true, status: 200, json: async () => ({ ProductPricing: [{ BreakQuantity: 1, UnitPrice: 2.5 }] }) }
    },
  })
  assert.equal(result.status, 'DIGIKEY_PRICING_READY')
  assert.equal(result.pricing.unitPrice, 2.5)
})

test('Digi-Key stock verification verifies in-stock and rejects out-of-stock products', async () => {
  const env = {
    DIGIKEY_CLIENT_ID: 'client-id',
    DIGIKEY_CLIENT_SECRET: 'client-secret',
    DIGIKEY_OAUTH_TOKEN_URL: 'https://oauth.example/token',
    DIGIKEY_BASE_URL: 'https://api.digikey.com',
  }
  const fetchImpl = async (url) => {
    if (url === env.DIGIKEY_OAUTH_TOKEN_URL) return { ok: true, status: 200, json: async () => ({ access_token: 'mock-token' }) }
    if (url.endsWith('/products/v4/search/keyword')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ Products: [
          { DigiKeyProductNumber: '917-EPC2367-ND', ManufacturerProductNumber: 'EPC2367', Manufacturer: { Name: 'EPC' }, QuantityAvailable: 25, ProductStatus: { Status: 'Active' } },
        ] }),
      }
    }
    if (url.endsWith('/productdetails')) return { ok: true, status: 200, json: async () => ({ Product: { DigiKeyProductNumber: '917-EPC2367-ND', ManufacturerProductNumber: 'EPC2367', Manufacturer: { Name: 'EPC' }, QuantityAvailable: 25, ProductStatus: { Status: 'Active' }, DatasheetUrl: 'https://example.test/epc2367.pdf' } }) }
    if (url.endsWith('/pricing')) return { ok: true, status: 200, json: async () => ({ ProductPricing: [{ UnitPrice: 2.5 }] }) }
    throw new Error(`unexpected URL ${url}`)
  }
  const verified = await queryDigikeyStock({ partNumber: 'EPC2367', env, fetchImpl, minimumRequiredQty: 10 })
  assert.equal(verified.status, 'DIGIKEY_STOCK_VERIFIED')
  assert.equal(verified.supplierSku, '917-EPC2367-ND')
  assert.equal(verified.stockQty, 25)
  assert.equal(verified.liveApiVerified, true)

  const outOfStock = await queryDigikeyStock({ partNumber: 'EPC2367', env, fetchImpl, minimumRequiredQty: 30 })
  assert.equal(outOfStock.status, 'REJECTED_OUT_OF_STOCK')
})

test('current MPN extraction reads schematic and footprint properties for ESC blockers', async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'boardforge-current-mpn-'))
  try {
    await writeFile(path.join(workspace, 'FN-ESC1.kicad_sch'), `(kicad_sch
  (symbol (lib_id "ESC:EPC2367")
    (property "Reference" "Q14")
    (property "Value" "EPC2367")
    (property "Footprint" "AstraRMM:EPC2367")
    (property "Datasheet" "https://www.digikey.com/en/products/detail/epc/EPC2367/26772296")
    (property "Description" "Enhancement Mode Power Transistor VDS , 100 V RDS(on) , 1.2 m typ I D , 101 A")
    (property "Manufacturer_Name" "EPC")
    (property "Manufacturer_Part_Number" "EPC2367"))
  (symbol (lib_id "Device:C")
    (property "Reference" "C70")
    (property "Value" "100nF 100V X7R")
    (property "Footprint" "Capacitor_SMD:C_0402_1005Metric"))
)`, 'utf8')
    await writeFile(path.join(workspace, 'FN-ESC1.kicad_pcb'), `(kicad_pcb
  (footprint "AstraRMM:EPC2367" (property "Reference" "Q14") (property "Value" "EPC2367"))
)`, 'utf8')
    const records = await extractCurrentMpnRecords({ projectDir: workspace, refs: ['Q14', 'C70'] })
    const q14 = records.find((item) => item.ref === 'Q14')
    const c70 = records.find((item) => item.ref === 'C70')
    assert.equal(q14.currentMpn, 'EPC2367')
    assert.equal(q14.manufacturer, 'EPC')
    assert.equal(q14.ratingsFound.voltage, '100')
    assert.equal(q14.sourceOfTruth, 'schematic field')
    assert.equal(c70.status, 'CURRENT_MPN_UNKNOWN_NEEDS_USER_OR_BOM')
    assert.equal(c70.ratingsFound.capacitance, '100nF')
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})

test('manual stock verification import accepts complete trusted supplier records', async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'boardforge-manual-stock-'))
  try {
    await writeFile(path.join(workspace, 'boardforge-manual-stock-verification.json'), JSON.stringify({
      candidates: [{
        ref: 'Q14',
        replacementPart: 'REAL-MOSFET-123',
        manufacturer: 'ExampleSemi',
        supplier: 'Digi-Key',
        supplierSku: '123-REAL-MOSFET-123-ND',
        stockQty: 50,
        lifecycleStatus: 'active',
        verifiedAt: '2026-06-23',
        verifiedBy: 'manual',
      }],
    }), 'utf8')
    const manual = await loadManualStockVerification({ projectDir: workspace })
    assert.equal(manual.found, true)
    assert.equal(manual.accepted.length, 1)
    assert.equal(manual.accepted[0].status, 'MANUAL_STOCK_VERIFIED')
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})

test('manual stock rejects incomplete data before replacement approval', () => {
  const manual = validateManualStockEntries([
    { ref: 'Q14', replacementPart: 'MOSFET-X', supplier: 'Digi-Key', stockQty: 0 },
    { ref: 'J5', replacementPart: 'CONN-X', manufacturer: 'ConnCo', supplier: 'RandomMarketplace', supplierSku: 'x', stockQty: 10 },
  ])
  assert.equal(manual.accepted.length, 0)
  assert.equal(manual.rejected.length, 2)
  assert.ok(manual.rejected[0].missing.includes('stockQty>0'))
  assert.ok(manual.rejected[1].missing.includes('trustedSupplier'))
})

test('replacement shopping list writes exact manual sourcing requirements', async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'boardforge-shopping-list-'))
  try {
    const records = [
      { ref: 'Q14', currentMpn: 'EPC2367', manufacturer: 'EPC', footprint: 'AstraRMM:EPC2367', value: 'EPC2367', ratingsFound: { voltage: '100', current: '101', rdsOn: '1.2' } },
      { ref: 'J5', currentMpn: '', footprint: 'AstraRMM:Untitled2', value: 'M2_PHASE_OUT', ratingsFound: {} },
      { ref: 'C70', currentMpn: '', footprint: 'Capacitor_SMD:C_0402_1005Metric', value: '100nF 100V X7R', ratingsFound: {} },
    ]
    const analysis = classifyReplacementBlockers(records)
    const report = await writeReplacementShoppingList({ projectDir: workspace, records, blockerAnalysis: analysis })
    assert.ok(report.outputFiles.json.endsWith('boardforge-esc-replacement-shopping-list.json'))
    assert.equal(report.candidates.some((item) => item.ref === 'Q14' && item.currentMpn === 'EPC2367'), true)
    assert.equal(report.candidates.some((item) => item.ref === 'J5'), true)
    assert.equal(report.candidates.some((item) => item.ref === 'C70'), false)
    const md = await readFile(report.outputFiles.markdown, 'utf8')
    assert.match(md, /Manual verification fields required/)
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})

test('sourcing gate no API does not fake stock and emits shopping list instead', async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'boardforge-no-api-shopping-'))
  try {
    await writeFile(path.join(workspace, 'FN-ESC1.kicad_sch'), `(kicad_sch
  (symbol (lib_id "ESC:EPC2367") (property "Reference" "Q14") (property "Value" "EPC2367") (property "Footprint" "AstraRMM:EPC2367") (property "Manufacturer_Part_Number" "EPC2367") (property "Manufacturer_Name" "EPC"))
)`, 'utf8')
    await writeFile(path.join(workspace, 'FN-ESC1.kicad_pcb'), '(kicad_pcb)', 'utf8')
    const records = await extractCurrentMpnRecords({ projectDir: workspace, refs: ['Q14'] })
    const analysis = classifyReplacementBlockers(records)
    const manual = await loadManualStockVerification({ projectDir: workspace })
    const report = await writeReplacementShoppingList({ projectDir: workspace, records, blockerAnalysis: analysis, manualVerification: manual })
    assert.equal(manual.found, false)
    assert.equal(report.apiKeysConfigured.digikey.configured, false)
    assert.equal(report.candidates[0].mustBeInStock, true)
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})

test('sourcing gate manual verified replacement still requires compatibility checks', async () => {
  const manual = validateManualStockEntries([{
    ref: 'Q14',
    replacementPart: 'REAL-MOSFET-123',
    manufacturer: 'ExampleSemi',
    supplier: 'Mouser',
    supplierSku: '555-REAL-MOSFET-123',
    stockQty: 100,
    lifecycleStatus: 'active',
    sameFunction: true,
    sameOrBetterVoltageRating: true,
    sameOrBetterCurrentRating: true,
    sameOrBetterThermalRating: true,
    pinoutVerified: true,
    footprintVerified: true,
  }])
  const evaluated = await evaluateManualVerifiedReplacements({
    manualVerification: manual,
    candidateRequirements: [{ ref: 'Q14', currentMpn: 'EPC2367', currentFootprint: 'AstraRMM:EPC2367', minStockQty: 10 }],
  })
  assert.equal(evaluated[0].approvedForUse, true)
  assert.equal(evaluated[0].stock.status, 'STOCK_VERIFIED_MANUAL_REVIEW')
  assert.equal(evaluated[0].status, 'REPLACEMENT_APPROVED_FOR_USE')
})

test('ESC fixed constraint preservation moves C1 in KiCad text without moving J1', async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'boardforge-corridor-move-'))
  try {
    const pcbFile = path.join(workspace, 'test.kicad_pcb')
    await writeFile(pcbFile, `(kicad_pcb
  (footprint "AstraRMM:ESC_Battery_1Pad_BottomEdge_OpenESC_Tab" (at 128.59 107.66)
    (property "Reference" "J1")
  )
  (footprint "Capacitor_SMD:C_1210_3225Metric" (at 130.175 106.045 0)
    (property "Reference" "C1")
  )
)
`, 'utf8')
    const applied = await applyCorridorMovesToPcb({ pcbFile, moves: [{ ref: 'C1', dx: -0.8, dy: 0 }] })
    const text = await readFile(pcbFile, 'utf8')
    assert.equal(applied.applied[0].ref, 'C1')
    assert.match(text, /\(property "Reference" "J1"\)/)
    assert.match(text, /\(at 129\.375 106\.045 0\)/)
    assert.match(text, /\(at 128\.59 107\.66\)/)
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})

test('job estimate classifies dense ESC work as very high risk', async () => {
  const estimate = await executeJob({
    id: 'estimate_dense_esc',
    type: 'estimate_boardforge_job',
    input: {
      componentCount: 222,
      netCount: 231,
      padCount: 1186,
      widthMm: 41.5,
      heightMm: 40.85,
      layerCount: 2,
      ercErrors: 6,
      drcErrors: 696,
      unconnectedItems: 499,
      highCurrentNets: 45,
    },
  }, process.cwd())
  assert.equal(estimate.status, 'BOARDFORGE_JOB_ESTIMATE_READY')
  assert.equal(estimate.estimate.complexity, 'very_dense_advanced_power_control')
  assert.equal(estimate.estimate.estimatedRuntime.bestCase, '4 hours')
  assert.match(estimate.estimate.estimatedRuntime.likely, /8 hours-16 hours/)
  assert.equal(estimate.estimate.risk, 'very_high')
})

test('autonomous job writes resumable state and stops on step budget', async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'boardforge-autonomous-job-'))
  try {
    const projectDir = path.join(workspace, 'auto-board')
    await mkdir(projectDir, { recursive: true })
    await writeFile(path.join(projectDir, 'auto-board.kicad_pcb'), `(kicad_pcb (version 20240108)
  (paper "A4")
  (layers (0 "F.Cu" signal) (2 "B.Cu" signal) (25 "Edge.Cuts" user))
  (gr_line (start 0 0) (end 20 0) (stroke (width 0.1) (type solid)) (layer "Edge.Cuts"))
  (gr_line (start 20 0) (end 20 12) (stroke (width 0.1) (type solid)) (layer "Edge.Cuts"))
  (gr_line (start 20 12) (end 0 12) (stroke (width 0.1) (type solid)) (layer "Edge.Cuts"))
  (gr_line (start 0 12) (end 0 0) (stroke (width 0.1) (type solid)) (layer "Edge.Cuts"))
)`, 'utf8')
    const run = await executeJob({ id: 'auto_budget', type: 'boardforge_autonomous_pcb_job', input: { projectPath: 'auto-board', mode: 'analyze_only', maxSteps: 1 } }, workspace)
    assert.equal(run.status, 'AUTONOMOUS_JOB_BUDGET_REACHED')
    assert.ok(run.generatedFiles.some((file) => file.endsWith('boardforge-job-state.json')))
    const summary = await executeJob({ id: 'auto_summary', type: 'summarize_boardforge_job', input: { projectPath: 'auto-board' } }, workspace)
    assert.equal(summary.status, 'BOARDFORGE_JOB_SUMMARY_READY')
    assert.ok(summary.autonomousJob.completedStages.includes('scan'))
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})

test('job resume continues from saved autonomous state', async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'boardforge-job-resume-'))
  try {
    const projectDir = path.join(workspace, 'resume-board')
    await mkdir(projectDir, { recursive: true })
    await writeFile(path.join(projectDir, 'resume-board.kicad_pcb'), `(kicad_pcb (version 20240108)
  (paper "A4")
  (layers (0 "F.Cu" signal) (2 "B.Cu" signal) (25 "Edge.Cuts" user))
  (gr_line (start 0 0) (end 20 0) (stroke (width 0.1) (type solid)) (layer "Edge.Cuts"))
  (gr_line (start 20 0) (end 20 12) (stroke (width 0.1) (type solid)) (layer "Edge.Cuts"))
  (gr_line (start 20 12) (end 0 12) (stroke (width 0.1) (type solid)) (layer "Edge.Cuts"))
  (gr_line (start 0 12) (end 0 0) (stroke (width 0.1) (type solid)) (layer "Edge.Cuts"))
)`, 'utf8')
    await executeJob({ id: 'resume_start', type: 'boardforge_autonomous_pcb_job', input: { projectPath: 'resume-board', mode: 'analyze_only', maxSteps: 1 } }, workspace)
    const resumed = await executeJob({ id: 'resume_next', type: 'resume_boardforge_job', input: { projectPath: 'resume-board', maxSteps: 1 } }, workspace)
    assert.ok(['AUTONOMOUS_JOB_BUDGET_REACHED', 'AUTONOMOUS_JOB_NEEDS_USER_DECISION', 'AUTONOMOUS_JOB_CHECKPOINT_COMPLETE'].includes(resumed.status))
    assert.ok(resumed.autonomousJob.completedStages.includes('estimate'))
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})

test('ESC autonomous loop repairs imported library config before validation gates', async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'boardforge-esc-autonomous-loop-'))
  try {
    await writeFile(path.join(workspace, 'ESC.kicad_sym'), '(kicad_symbol_lib (version 20240108))\n', 'utf8')
    await writeFile(path.join(workspace, 'fp-lib-table'), '(fp_lib_table\n  (lib (name "FN_ESC1") (type "KiCad") (uri "${KIPRJMOD}/FN_ESC1.pretty") (options "") (descr ""))\n)\n', 'utf8')
    const projectDir = path.join(workspace, 'esc-loop')
    await mkdir(projectDir, { recursive: true })
    await writeFile(path.join(projectDir, 'esc-loop.kicad_pcb'), `(kicad_pcb (version 20240108)
  (paper "A4")
  (layers (0 "F.Cu" signal) (2 "B.Cu" signal) (25 "Edge.Cuts" user))
  (gr_line (start 0 0) (end 41.5 0) (stroke (width 0.1) (type solid)) (layer "Edge.Cuts"))
  (gr_line (start 41.5 0) (end 41.5 40.85) (stroke (width 0.1) (type solid)) (layer "Edge.Cuts"))
  (gr_line (start 41.5 40.85) (end 0 40.85) (stroke (width 0.1) (type solid)) (layer "Edge.Cuts"))
  (gr_line (start 0 40.85) (end 0 0) (stroke (width 0.1) (type solid)) (layer "Edge.Cuts"))
)`, 'utf8')
    const run = await executeJob({ id: 'esc_loop', type: 'boardforge_autonomous_pcb_job', input: { projectPath: 'esc-loop', mode: 'safe_repair', maxSteps: 3 } }, workspace)
    assert.ok(['AUTONOMOUS_JOB_BUDGET_REACHED', 'AUTONOMOUS_JOB_CHECKPOINT_COMPLETE'].includes(run.status))
    assert.equal(await readFile(path.join(projectDir, 'sym-lib-table'), 'utf8').then((text) => text.includes('ESC')), true)
    assert.equal(await readFile(path.join(projectDir, 'fp-lib-table'), 'utf8').then((text) => text.includes('FN_ESC1')), true)
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})

test('ESC ERC intent classifies bootstrap, switching, and current-sense blockers without global suppression', async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'boardforge-esc-erc-intent-'))
  try {
    const reportFile = path.join(workspace, 'erc.json')
    const schFile = path.join(workspace, 'esc.kicad_sch')
    await writeFile(reportFile, JSON.stringify({
      sheets: [{
        violations: [
          { severity: 'error', type: 'power_pin_not_driven', description: 'Input Power pin not driven by any Output Power pins', items: [{ description: 'Symbol U2 Pin 6 [BST, Power input, Line]' }] },
          { severity: 'error', type: 'power_pin_not_driven', description: 'Input Power pin not driven by any Output Power pins', items: [{ description: 'Symbol U2 Pin 5 [SW, Power input, Line]' }] },
          { severity: 'error', type: 'pin_not_driven', description: 'Input pin not driven by any Output pins', items: [{ description: 'Symbol U5 Pin 4 [-, Input, Line]' }] },
          { severity: 'error', type: 'pin_not_driven', description: 'Input pin not driven by any Output pins', items: [{ description: 'Symbol U99 Pin 1 [IN, Input, Line]' }] },
        ],
      }],
    }), 'utf8')
    await writeFile(schFile, `(kicad_sch
  (symbol (lib_id "ESC:TPS62932DRLR") (property "Reference" "U2") (property "Value" "TPS62932DRLR") (property "Footprint" "SOT8_DRL_TEX") (property "Description" "Buck switching regulator"))
  (symbol (lib_id "Amplifier_Current:INA180A2") (property "Reference" "U5") (property "Value" "INA293A2IDBVR") (property "Description" "Current Sense Amplifier"))
  (symbol (lib_id "Device:Q") (property "Reference" "U99") (property "Value" "UNKNOWN"))
  (label "BST_U2") (label "SW_U2") (label "M1_SHUNT_N") (label "M1_SHUNT_P") (label "ISENSE_M1")
)`, 'utf8')
    const intent = await classifyErcPowerIntent({ reportFile, schFile, outputFile: path.join(workspace, 'intent.json') })
    assert.equal(intent.totalBlockingErc, 4)
    assert.equal(intent.remainingBlockingErc, 1)
    assert.equal(intent.globalSuppression, false)
    assert.equal(intent.classifications.find((item) => item.ref === 'U2' && item.pinName === 'BST').classification, 'AUTO_REPAIR')
    assert.equal(intent.classifications.find((item) => item.ref === 'U2' && item.pinName === 'SW').classification, 'AUTO_REPAIR')
    assert.equal(intent.classifications.find((item) => item.ref === 'U5').classification, 'NEEDS_REVIEW_NONBLOCKING')
    assert.equal(intent.classifications.find((item) => item.ref === 'U99').classification, 'BLOCKED_REQUIRES_USER_DECISION')
    assert.equal(intent.localWaivers.every((item) => item.globalSuppression === false && item.scope === 'exact_pin_net_intent'), true)
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})

test('ESC ERC intent filtering lets autonomous analysis proceed when all blockers are classified locally', async () => {
  const raw = {
    status: 'ERC_ANALYSIS_BLOCKED',
    clusters: [
      { type: 'missing_power_flag', count: 2, blocking: true, recommendedFix: 'Add a real power source/PWR_FLAG only after confirming rail intent.', examples: [] },
      { type: 'no_driver', count: 1, blocking: true, recommendedFix: 'Add or correct the driving source for the net before routing.', examples: [] },
    ],
    blockers: [
      { type: 'missing_power_flag', count: 2, blocking: true },
      { type: 'no_driver', count: 1, blocking: true },
    ],
  }
  const filtered = applyErcIntentPolicy(raw, {
    status: 'ERC_INTENT_POLICY_APPLIED',
    schFile: 'esc.kicad_sch',
    totalBlockingErc: 3,
    resolvedBlockingErc: 3,
    remainingBlockingErc: 0,
    classifications: [
      { ref: 'U2', pinName: 'BST', pinNumber: '6', ercType: 'power_pin_not_driven', clusterType: 'missing_power_flag', classification: 'AUTO_REPAIR', localWaiverAllowed: true },
      { ref: 'U2', pinName: 'SW', pinNumber: '5', ercType: 'power_pin_not_driven', clusterType: 'missing_power_flag', classification: 'AUTO_REPAIR', localWaiverAllowed: true },
      { ref: 'U5', pinName: '-', pinNumber: '4', ercType: 'pin_not_driven', clusterType: 'no_driver', classification: 'NEEDS_REVIEW_NONBLOCKING', localWaiverAllowed: true },
    ],
  })
  assert.equal(filtered.blockers.length, 0)
  assert.equal(filtered.status, 'ERC_ANALYSIS_NEEDS_REVIEW')
  assert.equal(filtered.rawBlockers.length, 2)
})

test('detects off-board components', () => {
  const board = { outline: rectanglePoints(20, 20), mountingHoles: [] }
  const issues = validatePlacement(board, [{ ref: 'U1', x: 21, y: 10, width: 6, height: 6 }], getManufacturerProfile())
  assert.equal(issues.some((issue) => issue.code === 'COMPONENT_OFF_BOARD'), true)
})

test('routing plan does not claim full autorouting', () => {
  const plan = generateRoutingPlan(assignNetsToClasses([{ name: 'USB_DP' }, { name: 'GND' }]), { layerCount: 4, board: { layerCount: 4, widthMm: 40, heightMm: 30, outline: rectanglePoints(40, 30) } })
  assert.equal(plan.status, 'PARTIAL_ROUTING_PLAN')
  assert.deepEqual(plan.routedNets, [])
  assert.equal(plan.unroutedNets.includes('USB_DP'), true)
  assert.equal(plan.designIntent.copperPours.some((pour) => pour.net === 'GND'), true)
    assert.equal(plan.routes.find((route) => route.net === 'USB_DP').viaPlan.maxVias, 0)
    assert.ok(Array.isArray(plan.routes.find((route) => route.net === 'USB_DP').waypoints))
    assert.equal(plan.designIntent.viaRules.preferSameLayerFor.includes('USB_DIFF'), true)
})

test('parses KiCad symbol pins and footprint pads for compatibility checks', () => {
  const symbolText = `(kicad_symbol_lib (version 20241209) (symbol "Device:R" (pin passive line (at 0 0 0) (length 2.54) (name "~") (number "1")) (pin passive line (at 0 2.54 0) (length 2.54) (name "~") (number "2"))))`
  const footprintText = `(footprint "Resistor_SMD:R_0603_1608Metric" (fp_line (start -1 -0.5) (end 1 -0.5) (stroke (width 0.05) (type solid)) (layer "F.CrtYd")) (fp_line (start 1 -0.5) (end 1 0.5) (stroke (width 0.05) (type solid)) (layer "F.CrtYd")) (pad "1" smd roundrect (at -0.8 0) (size 0.8 0.95) (layers "F.Cu")) (pad "2" smd roundrect (at 0.8 0) (size 0.8 0.95) (layers "F.Cu")))`
  assert.deepEqual(parseSymbolPinsFromText(symbolText, 'Device:R').map((pin) => pin.number), ['1', '2'])
  assert.deepEqual(parseFootprintPadsFromText(footprintText).map((pad) => pad.name), ['1', '2'])
  assert.equal(parseFootprintPadsFromText(footprintText)[0].x, -0.8)
  assert.equal(parseFootprintPadsFromText(footprintText)[0].widthMm, 0.8)
  assert.equal(parseFootprintPadsFromText(footprintText)[0].copper, true)
  assert.equal(parseFootprintCourtyardFromText(footprintText).width, 2)
})

test('component binding validation uses pre-parsed resolved asset metadata', async () => {
  const result = await executeJob({
    id: 'metadata_binding',
    type: 'validate_component_bindings',
    input: {
      components: [{
        ref: 'R1',
        group: 'RES',
        value: '10k',
        symbol: { libId: 'Device:R', pins: [{ number: '1', name: '~' }, { number: '2', name: '~' }] },
        footprint: {
          libId: 'Resistor_SMD:R_0603_1608Metric',
          pads: [
            { name: '1', type: 'smd', shape: 'roundrect', x: -0.8, y: 0, widthMm: 0.8, heightMm: 0.95, layers: ['F.Cu'] },
            { name: '2', type: 'smd', shape: 'roundrect', x: 0.8, y: 0, widthMm: 0.8, heightMm: 0.95, layers: ['F.Cu'] },
          ],
        },
        pinMap: { 1: 'SIG_A', 2: 'SIG_B' },
      }],
    },
  }, process.cwd())
  assert.equal(result.results[0].footprintPadCount, 2)
  assert.equal(result.results[0].symbolPinCount, 2)
  assert.equal(result.results[0].issues.some((issue) => issue.code === 'FOOTPRINT_PADS_UNKNOWN'), false)
})

test('pin-map repair adds safe missing USB-C critical pin intent', async () => {
  const result = await executeJob({
    id: 'pin_repair_usb',
    type: 'apply_pin_map_repairs',
    input: {
      components: [{
        ref: 'J1',
        group: 'USB',
        value: 'USB-C receptacle',
        symbol: { libId: 'Connector:USB_C_Receptacle', pins: [{ number: 'A4', name: 'VBUS' }, { number: 'A5', name: 'CC1' }, { number: 'B5', name: 'CC2' }, { number: 'A1', name: 'GND' }, { number: 'A6', name: 'D+' }, { number: 'A7', name: 'D-' }] },
        footprint: {
          libId: 'Connector_USB:USB_C',
          pads: ['A1', 'A4', 'A5', 'A6', 'A7', 'B5'].map((name, index) => ({ name, type: 'smd', shape: 'rect', x: index, y: 0, widthMm: 0.4, heightMm: 0.8, layers: ['F.Cu'] })),
        },
        pinMap: { A6: 'USB_DP', A7: 'USB_DN', A1: 'GND' },
      }],
    },
  }, process.cwd())
  const repaired = result.components.find((component) => component.ref === 'J1')
  assert.equal(repaired.pinMap.A4, 'VUSB')
  assert.equal(repaired.pinMap.A5, 'CC1')
  assert.equal(repaired.pinMap.B5, 'CC2')
})

test('pin assignment synthesizes maps from parsed footprint pad metadata', async () => {
  const result = await executeJob({
    id: 'pin_asset_synthesis',
    type: 'plan_pin_assignments',
    input: {
      components: [
        {
          ref: 'J1',
          group: 'USB',
          value: 'USB-C receptacle',
          footprint: {
            libId: 'Connector_USB:USB_C_Receptacle_USB2.0',
            pads: ['A1', 'A4', 'A5', 'A6', 'A7', 'B5', 'B6', 'B7'].map((name, index) => ({ name, x: index, y: 0, widthMm: 0.4, heightMm: 0.8, layers: ['F.Cu'] })),
          },
        },
      ],
      nets: [{ name: 'VUSB' }, { name: 'GND' }, { name: 'USB_DP' }, { name: 'USB_DN' }, { name: 'CC1' }, { name: 'CC2' }],
      interfaces: ['USB'],
    },
  }, process.cwd())
  const j1 = result.pinAssignments.peripheralPinMaps.find((item) => item.ref === 'J1')
  assert.equal(j1.pinMap.A4, 'VUSB')
  assert.equal(j1.pinMap.A6, 'USB_DP')
  assert.equal(j1.pinMap.A7, 'USB_DN')
  assert.equal(j1.pinMap.A1, 'GND')
  assert.ok(j1.synthesis.synthesizedCount >= 4)
})

test('component binding treats common USB net aliases as critical pin coverage', async () => {
  const result = await executeJob({
    id: 'binding_aliases',
    type: 'validate_component_bindings',
    input: {
      components: [{
        ref: 'J1',
        group: 'USB',
        value: 'USB-C receptacle',
        symbol: { libId: 'Connector:USB_C_Receptacle_USB2.0', pins: [{ number: 'A4', name: 'VBUS' }, { number: 'A6', name: 'D+' }, { number: 'A7', name: 'D-' }, { number: 'A1', name: 'GND' }, { number: 'A5', name: 'CC1' }, { number: 'B5', name: 'CC2' }] },
        footprint: { libId: 'Connector_USB:USB_C_Receptacle_USB2.0', pads: ['A4', 'A6', 'A7', 'A1', 'A5', 'B5'].map((name) => ({ name, type: 'smd', shape: 'rect', x: 0, y: 0, widthMm: 0.4, heightMm: 0.8, layers: ['F.Cu'] })) },
        pinMap: { A4: 'VUSB', A6: 'USB_DP', A7: 'USB_DN', A1: 'GND', A5: 'CC1', B5: 'CC2' },
      }],
    },
  }, process.cwd())
  assert.equal(result.results[0].missingCriticalPins.length, 0)
  assert.equal(result.results[0].issues.some((issue) => issue.code === 'CRITICAL_PIN_INTENT_MISSING'), false)
})

test('canonical pin maps fill critical USB ESP32 and regulator power intent from footprint pads', () => {
  const usb = normalizeCanonicalPinMap(
    { A6: 'USB_DP' },
    { ref: 'J1', group: 'USB' },
    null,
    { pads: ['A1', 'A4', 'A5', 'A6', 'A7', 'B5'].map((name) => ({ name })) },
  )
  assert.equal(usb.A1, 'GND')
  assert.equal(usb.A4, 'VUSB')
  assert.equal(usb.A5, 'CC1')
  assert.equal(usb.B5, 'CC2')
  assert.equal(usb.A7, 'USB_DN')

  const esp32 = normalizeCanonicalPinMap(
    {},
    { ref: 'U1', group: 'ESP32_S3' },
    null,
    { pads: ['1', '2', '3', '13', '14', '27', '40'].map((name) => ({ name })) },
  )
  assert.equal(esp32['1'], 'GND')
  assert.equal(esp32['2'], '3V3')
  assert.equal(esp32['13'], 'USB_DN')
  assert.equal(esp32['14'], 'USB_DP')

  const regulator = normalizeCanonicalPinMap(
    {},
    { ref: 'U2', group: 'REGULATOR', netA: 'VUSB', netB: '3V3' },
    null,
    { pads: ['1', '2', '3', '5'].map((name) => ({ name })) },
  )
  assert.equal(regulator['1'], 'VUSB')
  assert.equal(regulator['2'], 'GND')
  assert.equal(regulator['3'], 'VUSB')
  assert.equal(regulator['5'], '3V3')
})

test('schematic model keeps native symbols when pin geometry is known and falls back otherwise', () => {
  const model = generateSchematicModel(
    { name: 'Native Schematic Test' },
    [
      {
        ref: 'U1',
        group: 'ESP32_S3',
        value: 'ESP32-S3-WROOM-1',
        symbol: 'RF_Module:ESP32-S3-WROOM-1',
        footprint: 'RF_Module:ESP32-S3-WROOM-1',
        pinMap: { 1: 'GND', 2: '3V3', 13: 'USB_DN', 14: 'USB_DP' },
      },
      {
        ref: 'J1',
        group: 'USB',
        value: 'USB-C receptacle',
        symbol: 'Connector:USB_C_Receptacle',
        footprint: 'Connector_USB:USB_C_Receptacle_HRO_TYPE-C-31-M-12',
        pinMap: { A1: 'GND', A4: 'VUSB', A6: 'USB_DP', A7: 'USB_DN' },
      },
    ],
    { nets: [{ name: 'GND' }, { name: '3V3' }, { name: 'USB_DP' }, { name: 'USB_DN' }, { name: 'VUSB' }] },
  )
  const esp = model.symbols.find((symbol) => symbol.ref === 'U1')
  const usb = model.symbols.find((symbol) => symbol.ref === 'J1')
  assert.equal(esp.symbol, 'RF_Module:ESP32-S3-WROOM-1')
  assert.equal(esp.pinMap['13'], 'USB_DN')
  assert.match(usb.symbol, /^BoardForge:BF_CONN_/)
  const sch = kicadSchematicFromModel({ name: 'Native Schematic Test' }, model)
  assert.match(sch, /BoardForge_SourceSymbol/)
  assert.match(sch, /RF_Module:ESP32-S3-WROOM-1/)
})

test('schematic synthesis adds USB ESD, CC pulldowns, debug header, and per-IC decoupling', async () => {
  const result = await executeJob({
    id: 'synthesis_support',
    type: 'synthesize_schematic_design',
    input: {
      board: { widthMm: 60, heightMm: 35, layerCount: 4, outline: rectanglePoints(60, 35) },
      components: [
        { ref: 'U1', group: 'ESP32_S3', value: 'ESP32-S3 module', pinMap: { 2: '3V3', 1: 'GND', 13: 'USB_DN', 14: 'USB_DP' } },
        { ref: 'J1', group: 'USB', value: 'USB-C receptacle', pinMap: { A4: 'VUSB', A5: 'CC1', B5: 'CC2', A6: 'USB_DP', A7: 'USB_DN', A1: 'GND' } },
      ],
      nets: [{ name: '3V3' }, { name: 'GND' }, { name: 'USB_DP' }, { name: 'USB_DN' }, { name: 'VUSB' }],
      programmingHeader: true,
    },
  }, process.cwd())
  assert.ok(result.synthesis.supportComponents.some((component) => /USB ESD/.test(component.value)))
  assert.ok(result.synthesis.supportComponents.some((component) => /CC1 pulldown/.test(component.value)))
  assert.ok(result.synthesis.supportComponents.some((component) => component.group === 'SWD'))
  assert.ok(result.synthesis.supportComponents.some((component) => /3V3 local decoupling/.test(component.value)))
})

test('schematic synthesis blocks disconnected critical routing nets', async () => {
  const result = await executeJob({
    id: 'synthesis_architecture_gate',
    type: 'synthesize_schematic_design',
    input: {
      board: { widthMm: 35, heightMm: 22, layerCount: 4, outline: rectanglePoints(35, 22) },
      components: [
        { ref: 'U1', group: 'MCU', value: 'MCU', pinMap: { 1: '3V3', 2: 'USB_DP' } },
      ],
      nets: [{ name: '3V3' }, { name: 'USB_DP' }],
    },
  }, process.cwd())
  assert.equal(result.status, 'SCHEMATIC_SYNTHESIS_BLOCKED')
  assert.ok(result.errors.some((issue) => issue.code === 'ROUTING_CRITICAL_NET_UNCONNECTED'))
  assert.ok(result.synthesis.architecture.status === 'ARCHITECTURE_BLOCKED')
})

test('schematic graph validation promotes routing-critical single-ended nets to blockers', async () => {
  const result = await executeJob({
    id: 'schematic_graph_critical',
    type: 'validate_schematic_graph',
    input: {
      components: [
        { ref: 'U1', group: 'MCU', pinMap: { 1: '3V3', 2: 'GND', 3: 'USB_DP' } },
        { ref: 'C1', group: 'CAP', supportsRef: 'U1', pinMap: { 1: '3V3', 2: 'GND' } },
      ],
      nets: [{ name: '3V3' }, { name: 'GND' }, { name: 'USB_DP' }],
    },
  }, process.cwd())
  assert.equal(result.status, 'SCHEMATIC_GRAPH_NEEDS_FIX')
  assert.ok(result.errors.some((issue) => issue.code === 'DIFF_PAIR_MEMBER_MISSING' || issue.code === 'CRITICAL_NET_HAS_TOO_FEW_ENDPOINTS'))
})

test('dense placement uses finer optimization and keeps support capacitors near their parent', async () => {
  const board = { widthMm: 32, heightMm: 24, layerCount: 8, outline: rectanglePoints(32, 24), mountingHoles: [] }
  const components = [
    { ref: 'U1', group: 'MCU', value: 'QFN MCU', x: 16, y: 12, width: 7, height: 7, pinMap: { 1: '3V3', 2: 'GND' } },
    { ref: 'C1', group: 'CAP', supportsRef: 'U1', x: 29, y: 21, width: 1.6, height: 0.8, pinMap: { 1: '3V3', 2: 'GND' } },
    { ref: 'J1', group: 'USB', x: 16, y: 12, width: 7, height: 4, pinMap: { A1: 'GND', A4: 'VUSB' } },
  ]
  const result = await executeJob({
    id: 'dense_place',
    type: 'optimize_placement',
    input: { board, components, nets: [{ name: '3V3' }, { name: 'GND' }, { name: 'VUSB' }], densePlacement: true },
  }, process.cwd())
  assert.equal(result.placementPlan.placementMode, 'dense_constraint_repair')
  assert.ok(result.placementPlan.optimizationPasses >= 8)
  const u1 = result.placementPlan.components.find((component) => component.ref === 'U1')
  const c1 = result.placementPlan.components.find((component) => component.ref === 'C1')
  assert.ok(Math.hypot(u1.x - c1.x, u1.y - c1.y) < 14)
})

test('placement optimizer respects keepouts and connector edge access', async () => {
  const board = { widthMm: 44, heightMm: 28, layerCount: 8, outline: rectanglePoints(44, 28), mountingHoles: [] }
  const keepouts = [{ type: 'thermal', x: 22, y: 14, width: 8, height: 7, clearanceMm: 1.2 }]
  const components = [
    { ref: 'J1', group: 'USB', value: 'USB-C', x: 5, y: 14, width: 7, height: 4, pinMap: { A1: 'GND', A4: 'VUSB', A6: 'USB_DP', A7: 'USB_DN' } },
    { ref: 'U1', group: 'MCU', value: 'QFN MCU', x: 22, y: 14, width: 7, height: 7, pinMap: { 1: '3V3', 2: 'GND', 3: 'USB_DP', 4: 'USB_DN' } },
    { ref: 'U2', group: 'SENSOR', value: 'IMU', x: 14, y: 14, width: 5, height: 4, pinMap: { 1: '3V3', 2: 'GND', 3: 'I2C_SDA', 4: 'I2C_SCL' } },
    { ref: 'C1', group: 'CAP', supportsRef: 'U1', x: 23, y: 14, width: 1.6, height: 0.8, pinMap: { 1: '3V3', 2: 'GND' } },
  ]
  const result = await executeJob({
    id: 'placement_keepout_escape',
    type: 'optimize_placement',
    input: {
      board,
      components,
      nets: [{ name: '3V3' }, { name: 'GND' }, { name: 'VUSB' }, { name: 'USB_DP' }, { name: 'USB_DN' }],
      keepouts,
      densePlacement: true,
    },
  }, process.cwd())
  assert.ok(['PLACEMENT_SOLVED', 'OPTIMIZED_PLACEMENT_READY_NEEDS_REVIEW'].includes(result.placementPlan.status))
  const placed = result.placementPlan.components
  assert.equal(placed.some((component) => Math.abs(component.x - 22) < 5.2 && Math.abs(component.y - 14) < 4.7), false)
  const connector = placed.find((component) => component.ref === 'J1')
  assert.ok(Math.min(connector.x, connector.y, board.widthMm - connector.x, board.heightMm - connector.y) <= 3)
})

test('routing readiness blocks dense boards until stackup fanout and via strategies exist', async () => {
  const board = { widthMm: 38, heightMm: 28, layerCount: 8, outline: rectanglePoints(38, 28), mountingHoles: [] }
  const components = [
    { ref: 'U1', group: 'MCU', value: 'QFN MCU', x: 18, y: 14, width: 7, height: 7, package: 'QFN', pinMap: { 1: '3V3', 2: 'GND', 3: 'USB_DP', 4: 'USB_DN' } },
    { ref: 'J1', group: 'USB', x: 4, y: 14, width: 7, height: 4, pinMap: { A1: 'GND', A4: 'VUSB', A6: 'USB_DP', A7: 'USB_DN' } },
  ]
  const blocked = await executeJob({
    id: 'dense_readiness_blocked',
    type: 'check_routing_readiness',
    input: { board, components, nets: [{ name: '3V3' }, { name: 'GND' }, { name: 'VUSB' }, { name: 'USB_DP' }, { name: 'USB_DN' }] },
  }, process.cwd())
  assert.equal(blocked.status, 'ROUTING_READINESS_BLOCKED')
  assert.ok(blocked.errors.some((issue) => issue.code === 'STACKUP_PLAN_REQUIRED'))
  assert.ok(blocked.errors.some((issue) => issue.code === 'FANOUT_PLAN_REQUIRED'))
  assert.ok(blocked.errors.some((issue) => issue.code === 'VIA_STRATEGY_REQUIRED'))
})

test('KiCad scanner feeds pad-centered endpoints into autotracer', async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'boardforge-scan-route-'))
  try {
    const projectDir = path.join(workspace, 'scan-route')
    await mkdir(projectDir, { recursive: true })
    await writeFile(path.join(projectDir, 'scan-route.kicad_pcb'), `(kicad_pcb (version 20240108) (generator "test")
  (layers (0 "F.Cu" signal) (31 "B.Cu" signal) (44 "Edge.Cuts" user))
  (net 0 "")
  (net 1 "SIG")
  (setup)
  (gr_line (start 0 0) (end 40 0) (stroke (width 0.1) (type solid)) (layer "Edge.Cuts") (uuid "e1"))
  (gr_line (start 40 0) (end 40 22) (stroke (width 0.1) (type solid)) (layer "Edge.Cuts") (uuid "e2"))
  (gr_line (start 40 22) (end 0 22) (stroke (width 0.1) (type solid)) (layer "Edge.Cuts") (uuid "e3"))
  (gr_line (start 0 22) (end 0 0) (stroke (width 0.1) (type solid)) (layer "Edge.Cuts") (uuid "e4"))
  (footprint "Connector:TestPad" (layer "F.Cu")
    (at 7 11 0)
    (property "Reference" "J1" (at 0 0 0) (layer "F.SilkS"))
    (property "Value" "PAD" (at 0 1 0) (layer "F.Fab"))
    (pad "1" smd rect (at 0 0) (size 1.4 1.4) (layers "F.Cu" "F.Paste" "F.Mask") (net 1 "SIG"))
  )
  (footprint "Connector:TestPad" (layer "F.Cu")
    (at 33 11 0)
    (property "Reference" "J2" (at 0 0 0) (layer "F.SilkS"))
    (property "Value" "PAD" (at 0 1 0) (layer "F.Fab"))
    (pad "1" smd rect (at 0 0) (size 1.4 1.4) (layers "F.Cu" "F.Paste" "F.Mask") (net 1 "SIG"))
  )
)`, 'utf8')
    await writeFile(path.join(projectDir, 'scan-route.kicad_pro'), '{}', 'utf8')
    const scan = await scanKiCadProject(projectDir)
    assert.equal(scan.boardOutline.length, 4)
    assert.equal(scan.pads.length, 2)
    assert.equal(scan.pads[0].netName, 'SIG')
    const result = runAutotracerPlanning('autotrace_board', {
      scan,
      profile: getManufacturerProfile('jlcpcb'),
      layerStack: { layerCount: 2 },
    })
    assert.equal(['AUTOTRACE_PLANNED_NEEDS_DRC', 'AUTOTRACE_PARTIAL_NEEDS_REVIEW'].includes(result.status) || ['planned', 'partial'].includes(result.status), true)
    assert.ok(result.createdTracks.length > 0)
    assert.equal(result.routingPlan.routes.find((route) => route.net === 'SIG').start.x, 7)
    assert.equal(result.routingPlan.routes.find((route) => route.net === 'SIG').end.x, 33)
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})

test('KiCad scanner parses nested zones and footprint courtyard geometry', async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'boardforge-sexpr-scan-'))
  try {
    const projectDir = path.join(workspace, 'sexpr-scan')
    await mkdir(projectDir, { recursive: true })
    await writeFile(path.join(projectDir, 'sexpr-scan.kicad_pcb'), `(kicad_pcb (version 20240108) (generator "test")
  (layers (0 "F.Cu" signal) (31 "B.Cu" signal) (44 "Edge.Cuts" user) (46 "F.CrtYd" user))
  (net 0 "") (net 1 "GND")
  (setup)
  (gr_line (start 0 0) (end 30 0) (stroke (width 0.1) (type solid)) (layer "Edge.Cuts") (uuid "e1"))
  (gr_line (start 30 0) (end 30 20) (stroke (width 0.1) (type solid)) (layer "Edge.Cuts") (uuid "e2"))
  (gr_line (start 30 20) (end 0 20) (stroke (width 0.1) (type solid)) (layer "Edge.Cuts") (uuid "e3"))
  (gr_line (start 0 20) (end 0 0) (stroke (width 0.1) (type solid)) (layer "Edge.Cuts") (uuid "e4"))
  (footprint "Package_QFN:QFN-16" (layer "F.Cu")
    (at 10 10 90)
    (property "Reference" "U1" (at 0 0 0) (layer "F.SilkS"))
    (property "Value" "MCU" (at 0 1 0) (layer "F.Fab"))
    (fp_rect (start -2 -2) (end 2 2) (stroke (width 0.05) (type solid)) (fill none) (layer "F.CrtYd") (uuid "c1"))
    (pad "1" smd roundrect (at -1 0 90) (size 0.4 1.2) (layers "F.Cu" "F.Paste" "F.Mask") (net 1 "GND"))
  )
  (zone (net 1) (net_name "GND") (layer "F.Cu") (uuid "z1")
    (polygon (pts (xy 1 1) (xy 29 1) (xy 29 19) (xy 1 19)))
  )
)`, 'utf8')
    await writeFile(path.join(projectDir, 'sexpr-scan.kicad_pro'), '{}', 'utf8')
    const scan = await scanKiCadProject(projectDir)
    assert.equal(scan.footprints[0].hasCourtyard, true)
    assert.equal(scan.footprints[0].courtyards.length, 1)
    assert.equal(scan.zones[0].polygon.length, 4)
    assert.equal(scan.pads[0].shape, 'roundrect')
    assert.equal(scan.pads[0].rotation, 180)
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})

test('autorouter creates multiple route legs for multi-terminal nets', () => {
  const board = { widthMm: 60, heightMm: 30, layerCount: 2, outline: rectanglePoints(60, 30), mountingHoles: [] }
  const pads = [
    { id: 'J1:1', ref: 'J1', pad: '1', x: 6, y: 15, widthMm: 0.8, heightMm: 0.8, netName: 'SDA' },
    { id: 'U1:4', ref: 'U1', pad: '4', x: 30, y: 10, widthMm: 0.8, heightMm: 0.8, netName: 'SDA' },
    { id: 'U2:2', ref: 'U2', pad: '2', x: 52, y: 18, widthMm: 0.8, heightMm: 0.8, netName: 'SDA' },
  ]
  const plan = autorouteBoard({ board, pads, nets: [{ name: 'SDA' }], profile: getManufacturerProfile('jlcpcb'), options: { gridMm: 1 } })
  const sdaRoutes = plan.routes.filter((route) => route.net === 'SDA')
  assert.equal(sdaRoutes.length, 2)
  assert.equal(sdaRoutes.every((route) => route.multiTerminal?.totalEndpoints === 3), true)
})

test('endpoint-aware reroute maps DRC nets to real KiCad pad endpoints', async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'boardforge-endpoint-route-'))
  try {
    const projectDir = path.join(workspace, 'endpoint-route')
    await mkdir(path.join(projectDir, 'reports'), { recursive: true })
    await writeFile(path.join(projectDir, 'endpoint-route.kicad_pro'), '{}', 'utf8')
    await writeFile(path.join(projectDir, 'endpoint-route.kicad_pcb'), `(kicad_pcb (version 20240108) (generator "boardforge-test")
  (general)
  (paper "A4")
  (layers
    (0 "F.Cu" signal)
    (31 "B.Cu" signal)
    (32 "B.Adhes" user)
    (33 "F.Adhes" user)
    (34 "B.Paste" user)
    (35 "F.Paste" user)
    (36 "B.SilkS" user)
    (37 "F.SilkS" user)
    (38 "B.Mask" user)
    (39 "F.Mask" user)
    (44 "Edge.Cuts" user)
  )
  (net 0 "")
  (net 1 "SIG")
  (gr_line (start 0 0) (end 40 0) (stroke (width 0.1) (type solid)) (layer "Edge.Cuts") (uuid "e1"))
  (gr_line (start 40 0) (end 40 20) (stroke (width 0.1) (type solid)) (layer "Edge.Cuts") (uuid "e2"))
  (gr_line (start 40 20) (end 0 20) (stroke (width 0.1) (type solid)) (layer "Edge.Cuts") (uuid "e3"))
  (gr_line (start 0 20) (end 0 0) (stroke (width 0.1) (type solid)) (layer "Edge.Cuts") (uuid "e4"))
  (footprint "Test:Pad" (layer "F.Cu") (at 6 10)
    (property "Reference" "J1" (at 0 0 0) (layer "F.SilkS"))
    (pad "1" smd rect (at 0 0) (size 1 1) (layers "F.Cu" "F.Mask") (net 1 "SIG"))
  )
  (footprint "Test:Pad" (layer "F.Cu") (at 34 10)
    (property "Reference" "J2" (at 0 0 0) (layer "F.SilkS"))
    (pad "1" smd rect (at 0 0) (size 1 1) (layers "F.Cu" "F.Mask") (net 1 "SIG"))
  )
)`, 'utf8')
    const drcFile = path.join(projectDir, 'reports', 'drc.json')
    await writeFile(drcFile, JSON.stringify({
      violations: [],
      unconnected_items: [{
        type: 'unconnected_items',
        severity: 'error',
        description: 'Missing connection for net SIG',
        items: [
          { description: 'Pad [SIG] J1:1 on F.Cu', pos: { x: 6, y: 10 } },
          { description: 'Pad [SIG] J2:1 on F.Cu', pos: { x: 34, y: 10 } },
        ],
      }],
    }, null, 2), 'utf8')
    const plan = await planEndpointAwareReroutes({ projectDir, reportFile: drcFile, profile: getManufacturerProfile('JLCPCB_STANDARD') })
    assert.equal(plan.endpointGraph.nets.find((net) => net.name === 'SIG').endpointCount, 2)
    assert.equal(plan.safety.unsafeSameNetStitching, false)
    assert.ok(plan.routingPlan.routes.some((route) => route.net === 'SIG' && route.status === 'routed'))
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})

test('blocked fixture diagnosis calls out endpoint and placement roots', () => {
  const diagnosis = diagnoseFixture({
    id: 'poe_ethernet_sensor',
    name: 'PoE Ethernet Sensor Board',
    drc: { errors: 39 },
    erc: { errors: 0 },
    manufacturing: { zip: false },
    packageStatus: 'JLCPCB_PACKAGE_BLOCKED',
    errors: [
      { code: 'ROUTING_CRITICAL_NET_UNCONNECTED', message: 'ETH_TX_P needs at least two mapped endpoints before placement/routing.' },
      { code: 'SOLVED_PLACEMENT_OVERLAP', message: 'J1 overlaps U1.' },
      { code: 'REGULATOR_THERMAL_REVIEW_REQUIRED', message: 'U2 thermal review required.' },
    ],
  })
  assert.equal(diagnosis.currentDrcErrorCount, 39)
  assert.equal(diagnosis.requiresPlacementChange, true)
  assert.equal(diagnosis.requiresSchematicCategoryFixtureImprovement, true)
  assert.match(diagnosis.rootCause, /PoE fixture combines/)
})

test('autoroute job derives endpoint pads from component footprint metadata', async () => {
  const result = await executeJob({
    id: 'derived_pad_route',
    type: 'autoroute_board',
    input: {
      board: { widthMm: 40, heightMm: 20, layerCount: 2, outline: rectanglePoints(40, 20), mountingHoles: [] },
      components: [
        {
          ref: 'J1',
          group: 'TEST_PAD',
          x: 6,
          y: 10,
          footprint: { libId: 'Test:Pad', pads: [{ name: '1', x: 0, y: 0, widthMm: 1, heightMm: 1, layers: ['F.Cu'] }] },
          pinMap: { 1: 'SIG' },
        },
        {
          ref: 'J2',
          group: 'TEST_PAD',
          x: 34,
          y: 10,
          footprint: { libId: 'Test:Pad', pads: [{ name: '1', x: 0, y: 0, widthMm: 1, heightMm: 1, layers: ['F.Cu'] }] },
          pinMap: { 1: 'SIG' },
        },
      ],
      nets: [{ name: 'SIG' }],
    },
  }, process.cwd())
  assert.ok(['AUTOROUTE_READY_NEEDS_DRC', 'AUTOROUTE_PARTIAL_NEEDS_REVIEW'].includes(result.status))
  assert.equal(result.routingPlan.routes.find((route) => route.net === 'SIG').start.x, 6)
  assert.equal(result.routingPlan.routes.find((route) => route.net === 'SIG').end.x, 34)
})

test('autorouter widens power routes from current intent', async () => {
  const result = await executeJob({
    id: 'power_width_route',
    type: 'autoroute_board',
    input: {
      board: { widthMm: 50, heightMm: 24, layerCount: 2, outline: rectanglePoints(50, 24), mountingHoles: [] },
      components: [
        { ref: 'J1', group: 'POWER_INPUT', x: 6, y: 12, footprint: { pads: [{ name: '1', x: 0, y: 0, widthMm: 1, heightMm: 1, layers: ['F.Cu'] }] }, pinMap: { 1: 'VIN' } },
        { ref: 'U1', group: 'REGULATOR', x: 44, y: 12, footprint: { pads: [{ name: '1', x: 0, y: 0, widthMm: 1, heightMm: 1, layers: ['F.Cu'] }] }, pinMap: { 1: 'VIN' } },
      ],
      nets: [{ name: 'VIN', currentMa: 1800 }],
    },
  }, process.cwd())
  assert.ok(result.routingPlan.routes.find((route) => route.net === 'VIN').widthMm >= 0.8)
})

test('component binding validation reports critical pin coverage and repair actions', async () => {
  const result = await executeJob({
    id: 'binding_quality',
    type: 'validate_component_bindings',
    input: {
      components: [
        {
          ref: 'J1',
          group: 'USB',
          value: 'USB-C receptacle',
          footprint: 'Connector_USB:USB_C_Receptacle',
          pinMap: { A6: 'USB_DP' },
        },
      ],
    },
  }, process.cwd())
  assert.equal(result.status, 'COMPONENT_BINDINGS_NEED_FIX')
  assert.ok(result.results[0].missingCriticalPins.includes('GND'))
  assert.equal(result.results[0].netCoverage.differentialPins, 1)
  assert.ok(result.results[0].recommendedActions.some((action) => /critical pin intent/i.test(action)))
  assert.ok(result.warnings.some((issue) => issue.code === 'GROUND_PIN_MAPPING_MISSING'))
})

test('placement scoring reports ratsnest and edge connector intent', () => {
  const board = { outline: rectanglePoints(50, 30), mountingHoles: [] }
  const components = [
    { ref: 'J1', group: 'USB', x: 4, y: 15, width: 9, height: 7, pinMap: { A6: 'USB_DP' } },
    { ref: 'U1', group: 'ESP32_S3', x: 27, y: 15, width: 18, height: 14, pinMap: { USB_DP: 'USB_DP' } },
    { ref: 'C1', group: 'CAP', x: 25, y: 21, width: 1.6, height: 0.8, pinMap: { 1: '3V3', 2: 'GND' } },
  ]
  const scoring = scorePlacement(board, components, [{ name: 'USB_DP' }], getManufacturerProfile())
  assert.ok(scoring.score > 0)
  assert.ok(scoring.ratsnest.connectionCount >= 1)
  assert.ok(scoring.edgeConnectorScore > 70)
})

test('placement plan enforces edge connector and RF keepout constraints', async () => {
  const result = await executeJob({
    id: 'placement_constraints',
    type: 'generate_placement_plan',
    input: {
      board: { widthMm: 60, heightMm: 36, outline: rectanglePoints(60, 36), mountingHoles: [] },
      components: [
        { ref: 'J1', group: 'USB', value: 'USB-C receptacle', x: 30, y: 18, width: 9, height: 7, pinMap: { A6: 'USB_DP', A7: 'USB_DN', A1: 'GND', A4: 'VBUS' } },
        { ref: 'U1', group: 'ESP32_S3', value: 'ESP32-S3-WROOM', x: 30, y: 18, width: 18, height: 14, pinMap: { '3V3': '3V3', GND: 'GND', USB_DP: 'USB_DP', USB_DN: 'USB_DN' } },
      ],
      nets: [{ name: 'USB_DP' }, { name: 'USB_DN' }, { name: 'GND' }],
    },
  }, process.cwd())
  assert.equal(result.status, 'NEEDS_FIX')
  assert.equal(result.constraints.status, 'PLACEMENT_CONSTRAINTS_NEED_FIX')
  assert.ok(result.errors.some((issue) => issue.code === 'PLACEMENT_CONSTRAINT_VIOLATION'))
  assert.ok(result.constraints.violations.some((rule) => rule.kind === 'edge_connector'))
})

test('optimize_placement repairs overlap and edge-access constraint proposals', async () => {
  const result = await executeJob({
    id: 'placement_optimizer',
    type: 'optimize_placement',
    input: {
      board: { widthMm: 70, heightMm: 42, outline: rectanglePoints(70, 42), mountingHoles: [] },
      components: [
        { ref: 'J1', group: 'USB', value: 'USB-C receptacle', x: 35, y: 21, width: 9, height: 7, pinMap: { A6: 'USB_DP', A7: 'USB_DN', A1: 'GND', A4: 'VBUS' } },
        { ref: 'U1', group: 'ESP32_S3', value: 'ESP32-S3-WROOM', x: 35, y: 21, width: 18, height: 14, pinMap: { '3V3': '3V3', GND: 'GND', USB_DP: 'USB_DP', USB_DN: 'USB_DN' } },
        { ref: 'U2', group: 'REGULATOR', value: '3V3 regulator', x: 36, y: 21, width: 5, height: 5, pinMap: { VIN: '5V', GND: 'GND', OUT: '3V3' } },
      ],
      nets: [{ name: 'USB_DP' }, { name: 'USB_DN' }, { name: 'GND' }, { name: '3V3' }],
      gridMm: 4,
    },
  }, process.cwd())
  assert.ok(['OPTIMIZED_PLACEMENT_READY_NEEDS_REVIEW', 'OPTIMIZED_PLACEMENT_NEEDS_REVIEW'].includes(result.status))
  assert.ok(result.placementPlan.actions.length > 0)
  assert.ok(result.placementPlan.optimizedScore >= result.placementPlan.originalScore)
  assert.ok(result.placementPlan.fixedErrorCount >= 1)
})

test('routing geometry precheck blocks bad vias and off-board routes', () => {
  const board = { outline: rectanglePoints(30, 20), mountingHoles: [{ id: 'MH1', x: 15, y: 10, diameterMm: 3 }] }
  const routingPlan = {
    routes: [
      {
        net: 'VIN',
        className: 'POWER_HIGH_CURRENT',
        start: { x: 5, y: 10 },
        end: { x: 34, y: 10 },
        waypoints: [{ x: 5, y: 10 }, { x: 34, y: 10 }],
        widthMm: 0.1,
        viaPlan: { maxVias: 0, candidates: [{ x: 35, y: 10, diameterMm: 0.2, drillMm: 0.1 }], rules: { diameterMm: 0.45, drillMm: 0.2 } },
      },
    ],
    designIntent: { zones: [], copperPours: [] },
  }
  const output = validateRoutingGeometry({ board, components: [], routingPlan, profile: getManufacturerProfile() })
  assert.equal(output.status, 'ROUTING_GEOMETRY_NEEDS_FIX')
  assert.ok(output.errors.some((issue) => issue.code === 'ROUTE_POINT_OFF_BOARD'))
  assert.ok(output.errors.some((issue) => issue.code === 'VIA_DIAMETER_TOO_SMALL'))
})

test('routing geometry allows endpoints exactly on board outline', () => {
  const board = { outline: rectanglePoints(30, 20), mountingHoles: [] }
  const routingPlan = {
    routes: [{
      net: 'EDGE_CONN',
      className: 'DEFAULT',
      start: { x: 30, y: 10 },
      end: { x: 25, y: 10 },
      waypoints: [{ x: 30, y: 10 }, { x: 25, y: 10 }],
      widthMm: 0.15,
      viaPlan: { candidates: [{ x: 30, y: 10, diameterMm: 0.45, drillMm: 0.2 }], rules: { diameterMm: 0.45, drillMm: 0.2 } },
    }],
    designIntent: { zones: [], copperPours: [] },
  }
  const output = validateRoutingGeometry({ board, components: [], routingPlan, profile: getManufacturerProfile('JLCPCB_STANDARD') })
  assert.equal(output.errors.some((issue) => issue.code === 'ROUTE_POINT_OFF_BOARD'), false)
  assert.equal(output.errors.some((issue) => issue.code === 'VIA_OFF_BOARD'), false)
})

test('routing geometry checks pad clearance at zero coordinates', () => {
  const board = { outline: rectanglePoints(20, 12), mountingHoles: [] }
  const routingPlan = {
    routes: [{
      net: 'SIG',
      className: 'DEFAULT',
      status: 'routed',
      widthMm: 0.15,
      layerPreference: ['F.Cu'],
      waypoints: [{ x: 0, y: 6 }, { x: 10, y: 6 }],
    }],
    pads: [{ id: 'J1:1', ref: 'J1', pad: '1', x: 0, y: 6, widthMm: 0.8, heightMm: 0.8, netName: 'OTHER' }],
  }
  const output = validateRoutingGeometry({ board, components: [], routingPlan, profile: getManufacturerProfile('JLCPCB_STANDARD') })
  assert.equal(output.errors.some((issue) => issue.code === 'ROUTE_PAD_CLEARANCE'), true)
})

test('routing geometry catches parallel trace clearance before KiCad DRC', () => {
  const board = { outline: rectanglePoints(24, 16), mountingHoles: [] }
  const routingPlan = {
    routes: [
      {
        net: 'USB_DP',
        className: 'USB_DIFF',
        status: 'routed',
        widthMm: 0.16,
        layerPreference: ['F.Cu'],
        waypoints: [{ x: 3, y: 8 }, { x: 21, y: 8 }],
      },
      {
        net: 'I2C_SDA',
        className: 'DEFAULT',
        status: 'routed',
        widthMm: 0.15,
        layerPreference: ['F.Cu'],
        waypoints: [{ x: 3, y: 8.2 }, { x: 21, y: 8.2 }],
      },
    ],
    pads: [],
  }
  const output = validateRoutingGeometry({ board, components: [], routingPlan, profile: getManufacturerProfile('JLCPCB_STANDARD') })
  assert.equal(output.errors.some((issue) => issue.code === 'ROUTE_ROUTE_CLEARANCE'), true)
})

test('routing quality scores differential mismatch, sensitive vias, and weak power routes', async () => {
  const routingPlan = {
    routes: [
      {
        net: 'USB_DP',
        className: 'USB_DIFF',
        status: 'planned_not_routed',
        start: { x: 4, y: 4 },
        end: { x: 30, y: 4 },
        waypoints: [{ x: 4, y: 4 }, { x: 16, y: 4 }, { x: 30, y: 4 }],
        widthMm: 0.16,
        viaPlan: { maxVias: 0, candidates: [{ x: 16, y: 4, layers: ['F.Cu', 'B.Cu'] }] },
      },
      {
        net: 'USB_DN',
        className: 'USB_DIFF',
        status: 'planned_not_routed',
        start: { x: 4, y: 6 },
        end: { x: 30, y: 12 },
        waypoints: [{ x: 4, y: 6 }, { x: 18, y: 12 }, { x: 30, y: 12 }],
        widthMm: 0.16,
        viaPlan: { maxVias: 0, candidates: [] },
      },
      {
        net: 'VIN',
        className: 'POWER_HIGH_CURRENT',
        status: 'planned_not_routed',
        start: { x: 4, y: 18 },
        end: { x: 30, y: 18 },
        waypoints: [{ x: 4, y: 18 }, { x: 30, y: 18 }],
        widthMm: 0.15,
        viaPlan: { maxVias: 2, candidates: [] },
      },
    ],
    designIntent: { zones: [], copperPours: [] },
  }
  const output = scoreRoutingPlan({ routingPlan, profile: getManufacturerProfile(), powerTree: { rails: [{ name: 'VIN', estimatedCurrentMa: 700 }] } })
  assert.equal(output.status, 'ROUTING_QUALITY_NEEDS_FIX')
  assert.ok(output.score < 80)
  assert.equal(output.metrics.sensitiveViaCount, 1)
  assert.ok(output.warnings.some((issue) => issue.code === 'SENSITIVE_ROUTE_HAS_VIA'))
  assert.ok(output.issues.some((issue) => issue.code === 'DIFF_PAIR_LENGTH_MISMATCH'))
  assert.ok(output.errors.some((issue) => issue.code === 'POWER_ROUTE_WIDTH_LOW'))

  const job = await executeJob({ id: 'route_quality_job', type: 'score_routing_quality', input: { routingPlan } }, process.cwd())
  assert.equal(job.status, 'ROUTING_QUALITY_NEEDS_FIX')
  assert.ok(job.routeQuality.actions.some((action) => action.command === 'route_diff_pair'))
})

test('routing jobs return keepout, via, and copper-pour logic for compact boards', async () => {
  const board = { widthMm: 36, heightMm: 30, outline: rectanglePoints(36, 30), layerCount: 4 }
  const result = await executeJob({
    id: 'routing_rules',
    type: 'add_ground_zone',
    input: {
      board,
      nets: [{ name: 'GND' }, { name: 'USB_DP' }, { name: 'VIN' }],
      components: [
        { ref: 'U1', group: 'ESP32_S3', value: 'ESP32-S3 WROOM', x: 20, y: 15, width: 18, height: 14 },
        { ref: 'U2', group: 'REGULATOR', value: '3V3 regulator', x: 12, y: 18, width: 5, height: 5 },
      ],
    },
  }, process.cwd())
  assert.equal(result.status, 'GROUND_ZONE_PLAN_READY_NEEDS_REVIEW')
  assert.ok(result.copperPours.some((pour) => pour.net === 'GND'))
  assert.ok(result.keepouts.some((zone) => zone.kind === 'antenna_keepout'))
  assert.ok(result.keepouts.some((zone) => zone.kind === 'thermal_keepout'))
  assert.equal(result.viaRules.compactBoardPolicy.includes('midpoint vias'), true)
})

test('copper writer materializes pour keepouts and design_from_prompt returns controlled workflow', async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'boardforge-prompt-flow-'))
  try {
    await executeJob({ id: 'project', type: 'create_kicad_project', allowOverwrite: true, input: { projectName: 'Prompt Flow', templateId: 'ESP32_S3_SENSOR' } }, workspace)
    const workflow = await executeJob({
      id: 'prompt_workflow',
      type: 'design_from_prompt',
      input: { projectName: 'Prompt Flow', prompt: 'small ESP32-S3 USB sensor board with WiFi antenna keepout and JLCPCB assembly' },
    }, workspace)
    assert.equal(workflow.status, 'CODEX_DESIGN_WORKFLOW_READY')
    assert.ok(workflow.controlledSteps.some((step) => step.type === 'run_kicad_erc'))
    assert.match(workflow.codexPrompt, /Do not manually edit KiCad files/)

    const board = { widthMm: 60, heightMm: 35, layerCount: 2, outline: rectanglePoints(60, 35), mountingHoles: [] }
    const components = [{ ref: 'U1', group: 'ESP32_S3', value: 'ESP32-S3 WROOM RF antenna', x: 45, y: 17, width: 18, height: 14 }]
    const routingPlan = {
      routes: [],
      designIntent: {
        writeHardKeepouts: true,
        copperPours: [{
          net: 'GND',
          layer: 'B.Cu',
          clearanceMm: 0.2,
          avoidZones: [{ id: 'ANT_KEEP_U1', x: 45, y: 17, width: 22, height: 18 }],
        }],
      },
    }
    await executeJob({ id: 'apply_keepout_zone', type: 'apply_routing_plan', input: { projectPath: 'prompt-flow', board, components, nets: [{ name: 'GND' }], routingPlan, allowUnsafeRoutingWrite: true } }, workspace)
    const pcb = await readFile(path.join(workspace, 'prompt-flow', 'prompt-flow.kicad_pcb'), 'utf8')
    assert.match(pcb, /\(keepout \(tracks not_allowed\)/)
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})

test('stackup planner models HDI blind via logic for dense compact boards', async () => {
  const result = await executeJob({
    id: 'hdi_stackup',
    type: 'plan_stackup',
    input: {
      projectName: 'Tiny HDI wearable',
      widthMm: 24,
      heightMm: 18,
      layerCount: 6,
      manufacturerProfile: 'ADVANCED_HDI_REVIEW',
      allowBlindVias: true,
      allowMicrovias: true,
      prompt: 'tiny compact BLE wearable with RF antenna, USB, battery charger, dense BGA, blind vias and microvias',
      components: Array.from({ length: 38 }, (_, index) => ({ ref: `U${index + 1}`, group: index === 0 ? 'ESP32_S3' : 'CAP', x: 5 + (index % 8) * 2, y: 5 + Math.floor(index / 8) * 2, width: 1.2, height: 0.8 })),
    },
  }, process.cwd())
  assert.equal(result.status, 'STACKUP_PLAN_NEEDS_REVIEW')
  assert.equal(result.stackup.hdi.allowed, true)
  assert.equal(result.stackup.hdi.requiresAdvancedReview, true)
  assert.ok(result.stackup.layers.some((layer) => /ground/.test(layer.role)))
})

test('dense 12-layer HDI stackup exposes legal transition matrix and layer roles', async () => {
  const result = await executeJob({
    id: 'dense_12_layer_stackup',
    type: 'plan_stackup',
    input: {
      manufacturerProfile: 'ADVANCED_HDI_REVIEW',
      layerCount: 12,
      allowBlindVias: true,
      allowBuriedVias: true,
      allowMicrovias: true,
      allowViaInPad: true,
      board: { widthMm: 28, heightMm: 28, layerCount: 12, outline: rectanglePoints(28, 28) },
      components: [
        { ref: 'U1', value: '0.5mm BGA application processor', package: 'BGA-256', width: 12, height: 12 },
        { ref: 'U2', value: 'QFN PMIC', package: 'QFN-56', width: 7, height: 7 },
      ],
      nets: [{ name: 'PCIE_TX_P' }, { name: 'PCIE_TX_N' }, { name: 'MIPI_D0_P' }, { name: 'MIPI_D0_N' }, { name: 'GND' }, { name: 'VBAT', currentA: 4 }],
    },
  }, process.cwd())
  assert.equal(result.stackup.layerCount, 12)
  assert.ok(result.stackup.layerRoles.referenceLayers.length >= 3)
  assert.ok(result.stackup.viaTransitionMatrix.blind.length >= 2)
  assert.ok(result.stackup.viaTransitionMatrix.buried.length >= 2)
  assert.equal(result.stackup.hdi.viaInPadAllowed, true)
})

test('via strategy handles compact 12-layer advanced via policies', async () => {
  const stackup = (await executeJob({
    id: 'dense_12_layer_stackup_for_vias',
    type: 'plan_stackup',
    input: { manufacturerProfile: 'ADVANCED_HDI_REVIEW', layerCount: 12, allowBlindVias: true, allowBuriedVias: true, allowMicrovias: true, board: { widthMm: 25, heightMm: 25, layerCount: 12 } },
  }, process.cwd())).stackup
  const result = await executeJob({
    id: 'dense_12_layer_vias',
    type: 'select_via_strategy',
    input: {
      manufacturerProfile: 'ADVANCED_HDI_REVIEW',
      layerCount: 12,
      allowBlindVias: true,
      allowBuriedVias: true,
      allowMicrovias: true,
      board: { widthMm: 25, heightMm: 25, layerCount: 12 },
      stackup,
      nets: [{ name: 'MIPI_D0_P' }, { name: 'MIPI_D0_N' }, { name: 'VBAT', currentA: 5 }, { name: 'GND' }],
    },
  }, process.cwd())
  assert.ok(result.viaStrategy.allowedTransitions.length >= 4)
  assert.equal(result.viaStrategy.strategies.find((item) => item.net === 'MIPI_D0_P').viaType, 'microvia_review')
  assert.equal(result.viaStrategy.strategies.find((item) => item.net === 'VBAT').viaType, 'through_parallel_array')
  assert.ok(result.viaStrategy.strategies.find((item) => item.net === 'VBAT').viaArray.minParallelVias >= 3)
})

test('fanout planner budgets compact BGA and QFN escape routes', async () => {
  const result = await executeJob({
    id: 'dense_fanout',
    type: 'plan_fanout',
    input: {
      layerCount: 8,
      allowMicrovias: true,
      allowViaInPad: true,
      board: { widthMm: 32, heightMm: 26, layerCount: 8 },
      stackup: { layerCount: 8, hdi: { viaInPadAllowed: true }, viaTransitionMatrix: { allAllowed: [['F.Cu', 'In1.Cu'], ['In1.Cu', 'In2.Cu'], ['F.Cu', 'B.Cu']] } },
      components: [
        { ref: 'U1', value: 'BGA application processor', package: 'BGA-144 0.5mm', pinCount: 144, pitchMm: 0.5, width: 10, height: 10 },
        { ref: 'U2', value: 'QFN radio', package: 'QFN-56', pinCount: 56, pitchMm: 0.4, width: 7, height: 7 },
      ],
      nets: [{ name: 'MIPI_D0_P' }, { name: 'MIPI_D0_N' }, { name: '3V3' }, { name: 'GND' }],
    },
  }, process.cwd())
  const bga = result.fanoutPlan.denseComponents.find((item) => item.ref === 'U1')
  const qfn = result.fanoutPlan.denseComponents.find((item) => item.ref === 'U2')
  assert.ok(bga.escape.escapeRings.length >= 3)
  assert.match(bga.escape.viaInPad.status, /ALLOWED|REVIEW/)
  assert.equal(qfn.manufacturability.fabApprovalRequired, true)
})

test('DRC repair planner classifies dangling vias and same-net copper zone review', async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'boardforge-drc-repair-'))
  try {
    const pcbFile = path.join(workspace, 'x.kicad_pcb')
    const reportFile = path.join(workspace, 'drc.json')
    await writeFile(pcbFile, `(kicad_pcb (version 20240108) (generator "test")
  (gr_text "BoardForge review-required copper: run DRC before manufacturing" (at 0 0 0) (layer "Cmts.User") (uuid "txt"))
  (via (at 5 5) (size 0.45) (drill 0.2) (layers "F.Cu" "B.Cu") (net 1) (uuid "via1"))
)`, 'utf8')
    await writeFile(reportFile, JSON.stringify({
      unconnected_items: [{ severity: 'warning', type: 'unconnected_items', boardforgeCode: 'COPPER_ZONE_CONNECTIVITY_REVIEW', description: 'Missing connection between items', items: [{ description: 'Zone [GND] on F.Cu', uuid: 'z1' }, { description: 'Zone [GND] on B.Cu', uuid: 'z2' }] }],
      violations: [{ severity: 'warning', type: 'via_dangling', description: 'Via is not connected or connected on only one layer', items: [{ description: 'Via [GND] on F.Cu - B.Cu', pos: { x: 5, y: 5 } }] }],
    }, null, 2), 'utf8')
    const plan = await planDrcRepairs({ reportFile, pcbFile, profile: getManufacturerProfile('JLCPCB_STANDARD') })
    assert.ok(plan.repairs.some((item) => item.action === 'remove_or_connect_dangling_vias'))
    assert.ok(plan.repairs.some((item) => item.action === 'review_or_refill_same_net_copper_zone'))
    assert.equal(plan.rerouteConstraints.status, 'DRC_REPAIR_CONSTRAINTS_READY')
    assert.ok(plan.rerouteConstraints.forbiddenPoints.some((item) => item.net === 'GND' && item.layer === 'F.Cu'))
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})

test('DRC repair planner extracts reroute, placement, and silkscreen constraints', async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'boardforge-drc-constraints-'))
  try {
    const reportFile = path.join(workspace, 'drc.json')
    await writeFile(reportFile, JSON.stringify({
      violations: [
        {
          severity: 'error',
          type: 'clearance',
          description: 'Track clearance violation between nets',
          items: [
            { description: 'Track [USB_DP] on F.Cu', pos: { x: 12.45, y: 8.35 } },
            { description: 'Track [I2C_SDA] on F.Cu', pos: { x: 12.55, y: 8.36 } },
          ],
        },
        {
          severity: 'error',
          type: 'courtyard_overlap',
          description: 'Footprint courtyard overlap',
          items: [{ description: 'Footprint U3 on F.Cu overlaps U4', pos: { x: 18, y: 11 } }],
        },
        {
          severity: 'warning',
          type: 'silk_over_copper',
          description: 'Silkscreen text overlaps copper',
          items: [{ description: 'Text REF** near R12 on F.SilkS', pos: { x: 7, y: 3 } }],
        },
      ],
    }, null, 2), 'utf8')
    const plan = await planDrcRepairs({ reportFile, profile: getManufacturerProfile('JLCPCB_STANDARD') })
    assert.equal(plan.rerouteConstraints.status, 'DRC_REPAIR_CONSTRAINTS_READY')
    assert.ok(plan.rerouteConstraints.affectedNets.includes('USB_DP'))
    assert.ok(plan.rerouteConstraints.placementRefs.includes('U3'))
    assert.ok(plan.rerouteConstraints.silkscreenRefs.includes('R12'))
    assert.ok(plan.nextJobs.includes('optimize_placement'))
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})

test('complex board planner blocks unsupported blind vias on cheap stackups', async () => {
  const result = await executeJob({
    id: 'bad_hdi',
    type: 'plan_complex_board',
    input: {
      projectName: 'Cheap HDI Attempt',
      widthMm: 30,
      heightMm: 25,
      layerCount: 2,
      manufacturerProfile: 'JLCPCB_STANDARD',
      allowBlindVias: true,
      prompt: 'compact ESP32 board with USB-C, RF antenna, blind vias, buried vias, microvias',
    },
  }, process.cwd())
  assert.equal(result.status, 'COMPLEX_BOARD_PLAN_BLOCKED')
  assert.ok(result.errors.some((issue) => issue.code === 'HDI_REQUIRES_4PLUS_LAYERS'))
})

test('large board complex planner prefers standard vias and separates power thermal strategy', async () => {
  const result = await executeJob({
    id: 'large_controller',
    type: 'plan_complex_board',
    input: {
      projectName: 'Large Robotics Controller',
      widthMm: 130,
      heightMm: 90,
      layerCount: 4,
      manufacturerProfile: 'JLCPCB_STANDARD',
      prompt: 'large robotics controller with CAN, motor drivers, battery input, USB debug, I2C sensors, thermal MOSFET zones',
      interfaces: ['USB', 'I2C', 'CAN'],
    },
  }, process.cwd())
  assert.equal(result.status, 'COMPLEX_BOARD_PLAN_READY_NEEDS_REVIEW')
  assert.equal(result.stackup.hdi.allowed, false)
  assert.ok(result.assemblyPlan.connectorAccess.length > 0)
  assert.ok(result.designIntent.zones.some((zone) => zone.kind === 'thermal_keepout'))
  assert.ok(result.routingPlan.designIntent.copperPours.length > 0)
})

test('component database enriches advanced board blocks with default pin intent', async () => {
  const result = await executeJob({
    id: 'advanced_parts',
    type: 'sync_component_database',
    input: {
      components: [
        { ref: 'U2', group: 'IMU', value: 'ICM-42688-P' },
        { ref: 'U3', group: 'ETHERNET_PHY', value: 'LAN8720A' },
        { ref: 'L1', group: 'INDUCTOR', value: '2.2uH shielded inductor' },
        { ref: 'JTAG1', group: 'SWD', value: 'SWD header' },
      ],
    },
  }, process.cwd())
  assert.ok(['COMPONENT_DATABASE_READY_NEEDS_REVIEW', 'COMPONENT_DATABASE_PARTIAL_NEEDS_REVIEW'].includes(result.status))
  assert.equal(result.components.find((component) => component.ref === 'U2').pinMap.SCL, 'I2C_SCL')
  assert.equal(result.components.find((component) => component.ref === 'U3').pinMap.TXP, 'ETH_TX_P')
  assert.equal(result.components.find((component) => component.ref === 'L1').pinMap[1], 'SW')
  assert.equal(result.components.find((component) => component.ref === 'JTAG1').pinMap.SWDIO, 'SWDIO')
  assert.ok(result.components.every((component) => component.procurement))
  assert.ok(result.components.every((component) => component.footprintConfidence))
  assert.ok(result.components.every((component) => typeof component.selectionScore === 'number'))
  assert.ok(result.procurementSummary.reviewRequired >= 1)
  assert.ok(result.alternates.some((item) => Array.isArray(item.candidates)))
})

test('component database records authoritative asset proof from parsed USB-C metadata', async () => {
  const result = await executeJob({
    id: 'usb_authoritative_part',
    type: 'sync_component_database',
    input: {
      nets: ['VUSB', 'GND', 'USB_DP', 'USB_DN', 'CC1', 'CC2'],
      components: [
        {
          ref: 'J1',
          group: 'USB',
          value: 'USB-C receptacle',
          symbol: {
            libId: 'Connector:USB_C_Receptacle',
            pins: [
              { number: 'A1', name: 'GND' },
              { number: 'A4', name: 'VBUS' },
              { number: 'A5', name: 'CC1' },
              { number: 'B5', name: 'CC2' },
              { number: 'A6', name: 'D+' },
              { number: 'A7', name: 'D-' },
            ],
          },
          footprint: {
            libId: 'Connector_USB:USB_C_Receptacle_HRO_TYPE-C-31-M-12',
            pads: [
              { name: 'A1' },
              { name: 'A4' },
              { name: 'A5' },
              { name: 'B5' },
              { name: 'A6' },
              { name: 'A7' },
            ],
          },
        },
      ],
    },
  }, process.cwd())
  const component = result.components[0]
  assert.equal(component.assetStatus, 'complete_needs_review')
  assert.equal(component.pinMap.A4, 'VUSB')
  assert.equal(component.pinMap.A6, 'USB_DP')
  assert.equal(component.pinMap.A7, 'USB_DN')
  assert.equal(component.authoritativePart.footprint, 'Connector_USB:USB_C_Receptacle_HRO_TYPE-C-31-M-12')
  assert.ok(component.authoritativePart.pinMapEvidence.length >= 5)
  assert.ok(component.bindingCompatibilityScore >= 75)
})

test('3D model paths normalize to KiCad model variables when possible', () => {
  const normalized = normalize3dModelPath('C:\\Program Files\\KiCad\\10.0\\share\\kicad\\3dmodels\\Connector_USB.3dshapes\\USB_C.step', {
    version: '10',
    models3d: 'C:\\Program Files\\KiCad\\10.0\\share\\kicad\\3dmodels',
  })
  assert.equal(normalized, '${KICAD10_3DMODEL_DIR}/Connector_USB.3dshapes/USB_C.step')
  assert.equal(normalize3dModelPath('${KICAD10_3DMODEL_DIR}/Package.step', { version: '10' }), '${KICAD10_3DMODEL_DIR}/Package.step')
})

test('component library audit reports missing assets and 3D model coverage', async () => {
  const result = await executeJob({
    id: 'component_audit',
    type: 'audit_component_library',
    input: {
      components: [
        { ref: 'U1', group: 'MCU', value: 'QFN MCU', symbol: 'MCU:Example', footprint: 'Package_DFN_QFN:QFN-32', model3d: '${KICAD10_3DMODEL_DIR}/Package_DFN_QFN.3dshapes/QFN-32.step', pinMap: { VDD: '3V3', GND: 'GND' }, lcsc: 'C123' },
        { ref: 'U2', group: 'SENSOR', value: 'unresolved sensor' },
      ],
    },
  }, process.cwd())
  assert.equal(result.status, 'COMPONENT_LIBRARY_AUDIT_NEEDS_FIX')
  assert.equal(result.totals.components, 2)
  assert.ok(result.errors.some((issue) => issue.code === 'FOOTPRINT_MISSING'))
  assert.ok(result.warnings.some((issue) => issue.code === 'MODEL_3D_MISSING'))
  assert.ok(result.actions.some((action) => action.includes('resolve_component_assets')))
})

test('component audit blocks weak package and selected-part confidence', async () => {
  const result = await executeJob({
    id: 'component_audit_confidence',
    type: 'audit_component_library',
    input: {
      components: [
        {
          ref: 'U_BAD',
          group: 'MCU',
          value: 'unknown MCU',
          symbol: 'MCU:Unknown',
          footprint: 'Package_QFP:Wrong',
          pinMap: { VDD: '3V3', GND: 'GND' },
          footprintConfidence: { status: 'weak_or_missing_match', score: 20, expectedPackage: 'QFN-56' },
          selectionScore: 35,
          procurement: { lifecycleRisk: 'unknown_requires_supplier_check' },
        },
      ],
    },
  }, process.cwd())
  assert.equal(result.status, 'COMPONENT_LIBRARY_AUDIT_NEEDS_FIX')
  assert.ok(result.errors.some((issue) => issue.code === 'FOOTPRINT_CONFIDENCE_WEAK'))
  assert.ok(result.errors.some((issue) => issue.code === 'COMPONENT_SELECTION_SCORE_LOW'))
  assert.ok(result.actions.some((action) => action.includes('package-to-footprint')))
})

test('requirements planner expands prompts into circuit components and nets', async () => {
  const plan = await executeJob({
    id: 'requirements_plan',
    type: 'plan_requirements',
    input: {
      projectName: 'ESP32 PoE sensor',
      prompt: 'ESP32-S3 PoE Ethernet environmental sensor with USB-C debug, I2C sensor connector, SWD programming, 3V3 regulator',
      interfaces: ['USB', 'Ethernet', 'I2C'],
    },
  }, process.cwd())
  assert.equal(plan.status, 'REQUIREMENTS_PLAN_READY_NEEDS_REVIEW')
  assert.ok(plan.selectedCircuits.includes('esp32_s3_core'))
  assert.ok(plan.selectedCircuits.includes('poe_ethernet'))
  assert.ok(plan.components.some((component) => component.group === 'RJ45'))
  assert.ok(plan.components.some((component) => component.group === 'SWD'))
  assert.ok(plan.nets.some((net) => net.name === 'ETH_TX_P'))
})

test('universal board category planner does not default serious boards to drones', async () => {
  const motor = await executeJob({
    id: 'category_motor',
    type: 'plan_board_category',
    input: {
      projectName: '12S BLDC inverter',
      prompt: 'Build a compact 12S motor controller with gate drivers, MOSFETs, current sensing, CAN, thermal copper and blind via option',
      layerCount: 6,
      manufacturerProfile: 'JLCPCB_STANDARD',
    },
  }, process.cwd())
  assert.equal(motor.status, 'BOARD_CATEGORY_PLAN_NEEDS_USER_DECISIONS')
  assert.equal(motor.categoryPlan.category.id, 'motor_controller')
  assert.ok(motor.categoryPlan.netClasses.includes('MOTOR_PHASE'))
  assert.ok(motor.categoryPlan.routingPriorities.some((item) => /battery|motor phase/i.test(item)))

  const carrier = await executeJob({
    id: 'category_carrier',
    type: 'plan_board_category',
    input: { projectName: 'CM4 carrier', prompt: 'compute module carrier with USB, Ethernet, MIPI CSI, PCIe, power sequencing', layerCount: 8, manufacturerProfile: 'ADVANCED_HDI_REVIEW', stackup: 'manufacturer impedance stackup' },
  }, process.cwd())
  assert.equal(carrier.categoryPlan.category.id, 'compute_module_carrier')
  assert.ok(carrier.categoryPlan.netClasses.includes('MIPI_DIFF'))
  assert.ok(carrier.warnings.some((issue) => /SI\/PI|MIPI|PCIe/i.test(issue.message)))

  const listed = await executeJob({ id: 'category_list', type: 'list_board_categories', input: {} }, process.cwd())
  assert.equal(listed.status, 'BOARD_CATEGORIES_LISTED')
  assert.ok(listed.categories.some((category) => category.id === 'industrial_io'))
})

test('requirements planner selects serious non-drone circuit blocks', async () => {
  const motor = await executeJob({
    id: 'motor_req',
    type: 'plan_requirements',
    input: { projectName: 'Motor controller', prompt: '12S BLDC motor controller with gate driver MOSFET power stage shunt current sense CAN debug' },
  }, process.cwd())
  assert.equal(motor.status, 'REQUIREMENTS_PLAN_READY_NEEDS_REVIEW')
  assert.ok(motor.selectedCircuits.includes('motor_controller_power_stage'))
  assert.ok(motor.components.some((component) => component.group === 'GATE_DRIVER'))
  assert.ok(motor.nets.some((net) => net.name === 'PHASE_A'))

  const carrier = await executeJob({
    id: 'carrier_req',
    type: 'plan_requirements',
    input: { projectName: 'Module carrier', prompt: 'compute module carrier board with USB Ethernet MIPI PCIe and power sequencing' },
  }, process.cwd())
  assert.ok(carrier.selectedCircuits.includes('compute_module_carrier'))
  assert.ok(carrier.nets.some((net) => net.name === 'MIPI_D0_P'))
})

test('user BOM audit applies category-specific gaps outside drone workflows', async () => {
  const audit = await executeJob({
    id: 'motor_bom_audit',
    type: 'audit_user_bom',
    input: {
      projectName: 'User motor controller',
      prompt: '12S motor controller with gate drivers MOSFETs shunt current sensing',
      bomText: 'Ref,Value,MPN,Package\nU1,STM32 MCU,STM32G4,QFN-48\nJ1,XT60 power input,XT60,Connector',
    },
  }, process.cwd())
  assert.equal(audit.status, 'USER_BOM_AUDIT_NEEDS_FIX')
  assert.equal(audit.userBomAudit.categoryPlan.category.id, 'motor_controller')
  assert.ok(audit.missingFunctions.some((gap) => gap.group === 'GATE_DRIVER'))
  assert.ok(audit.errors.some((issue) => issue.code === 'USER_BOM_MISSION_FUNCTION_MISSING'))
})

test('routing report summarizes critical unresolved nets honestly', async () => {
  const report = await executeJob({
    id: 'routing_report',
    type: 'generate_routing_report',
    input: {
      board: { widthMm: 50, heightMm: 32, layerCount: 4, outline: rectanglePoints(50, 32) },
      nets: [{ name: 'USB_DP' }, { name: 'USB_DN' }, { name: 'GND' }],
      components: [{ ref: 'J1', group: 'USB', x: 5, y: 16, width: 9, height: 7, pinMap: { A6: 'USB_DP', A7: 'USB_DN', A1: 'GND' } }],
    },
  }, process.cwd())
  assert.equal(report.status, 'ROUTING_REPORT_NEEDS_FIX')
  assert.equal(report.routingReport.summary.totalNets, 3)
  assert.ok(report.routingReport.criticalNets.some((net) => net.net === 'USB_DP'))
  assert.ok(report.errors.some((issue) => issue.code === 'CRITICAL_NET_UNROUTED_OR_MISSING_ENDPOINT'))
  assert.ok(report.routingReport.nextActions.length > 0)
})

test('schematic graph validation catches missing power, support, and diff-pair intent', async () => {
  const output = await executeJob({
    id: 'schematic_graph',
    type: 'validate_schematic_graph',
    input: {
      components: [
        { ref: 'U1', group: 'MCU', value: 'QFN MCU', pinMap: { DP: 'USB_DP', GND: 'GND' } },
        { ref: 'J1', group: 'USB', value: 'USB-C', pinMap: { DP: 'USB_DP', VBUS: 'VUSB', GND: 'GND' } },
      ],
      nets: [{ name: 'USB_DP' }, { name: 'VUSB' }, { name: 'GND' }],
    },
  }, process.cwd())
  assert.equal(output.status, 'SCHEMATIC_GRAPH_NEEDS_FIX')
  assert.ok(output.errors.some((issue) => issue.code === 'POWER_PIN_UNMAPPED'))
  assert.ok(output.errors.some((issue) => issue.code === 'DIFF_PAIR_MEMBER_MISSING'))
  assert.ok(output.warnings.some((issue) => issue.code === 'SUPPORT_COMPONENT_REVIEW'))
})

test('schematic readiness blocks fake schematics before KiCad writes', async () => {
  const output = await executeJob({
    id: 'schematic_readiness',
    type: 'validate_schematic_readiness',
    input: {
      board: { widthMm: 30, heightMm: 20, layerCount: 2, outline: rectanglePoints(30, 20) },
      components: [
        { ref: 'U1', group: 'MCU', value: 'Unknown MCU', pinMap: { VDD: '3V3' } },
      ],
      nets: [{ name: '3V3' }],
    },
  }, process.cwd())
  assert.equal(output.status, 'SCHEMATIC_READINESS_BLOCKED')
  assert.ok(output.errors.some((issue) => issue.code === 'COMPONENT_FOOTPRINT_UNRESOLVED'))
  assert.ok(output.errors.some((issue) => issue.code === 'COMPONENT_SYMBOL_UNRESOLVED'))
})

test('generate schematic refuses incomplete symbol footprint bindings by default', async () => {
  const output = await executeJob({
    id: 'schematic_generation_gate',
    type: 'generate_schematic',
    input: {
      board: { widthMm: 30, heightMm: 20, layerCount: 2, outline: rectanglePoints(30, 20) },
      components: [
        { ref: 'U1', group: 'MCU', value: 'Unknown MCU', pinMap: { VDD: '3V3' } },
      ],
      nets: [{ name: '3V3' }],
    },
  }, process.cwd())
  assert.equal(output.status, 'SCHEMATIC_GENERATION_BLOCKED_BY_READINESS')
  assert.equal(output.schematicModel, undefined)
  assert.ok(output.schematicReadiness.errors.some((issue) => issue.code === 'COMPONENT_FOOTPRINT_UNRESOLVED'))
})

test('routing readiness blocks copper when endpoints and placement are not ready', async () => {
  const output = await executeJob({
    id: 'routing_ready',
    type: 'check_routing_readiness',
    input: {
      board: { widthMm: 30, heightMm: 20, layerCount: 2, outline: rectanglePoints(30, 20) },
      components: [{ ref: 'U1', group: 'MCU', x: 40, y: 10, width: 5, height: 5, pinMap: { DP: 'USB_DP', DN: 'USB_DN', GND: 'GND' } }],
      nets: [{ name: 'USB_DP' }, { name: 'USB_DN' }, { name: 'GND' }],
    },
  }, process.cwd())
  assert.equal(output.status, 'ROUTING_READINESS_BLOCKED')
  assert.ok(output.routingReadiness.gates.some((gate) => gate.name === 'placement' && gate.status === 'blocked'))
  assert.ok(output.errors.some((issue) => issue.code === 'ROUTE_ENDPOINTS_MISSING'))
})

test('power routing calculator sizes high-current traces and via arrays', async () => {
  const output = await executeJob({
    id: 'power_routing',
    type: 'calculate_power_routing',
    input: {
      nets: [{ name: 'VBAT' }, { name: 'PHASE_A' }, { name: '3V3' }],
      rails: [{ name: 'VBAT', currentMa: 12000 }, { name: '3V3', currentMa: 500 }],
      copperWeightOz: 1,
    },
  }, process.cwd())
  assert.equal(output.status, 'POWER_ROUTING_NEEDS_REVIEW')
  assert.ok(output.powerRouting.calculations.find((item) => item.net === 'VBAT').recommendedWidthMm > 1)
  assert.ok(output.powerRouting.calculations.find((item) => item.net === 'VBAT').minimumViaCountForLayerChange > 1)
})

test('via strategy blocks unsupported advanced vias and reviews sensitive nets', async () => {
  const blocked = await executeJob({
    id: 'via_blocked',
    type: 'select_via_strategy',
    input: {
      manufacturerProfile: 'JLCPCB_STANDARD',
      allowMicrovias: true,
      nets: [{ name: 'USB_DP' }, { name: 'MIPI_D0_P' }, { name: 'VBAT' }],
      board: { widthMm: 24, heightMm: 18, layerCount: 6 },
      components: [{ ref: 'U1', width: 12, height: 12 }, { ref: 'J1', width: 8, height: 5 }],
    },
  }, process.cwd())
  assert.ok(['VIA_STRATEGY_BLOCKED', 'VIA_STRATEGY_NEEDS_REVIEW'].includes(blocked.status))
  assert.ok(blocked.viaStrategy.strategies.some((item) => item.net === 'VBAT' && item.viaType === 'through_parallel_array'))
  assert.equal(blocked.viaStrategy.compactBoard, true)
  assert.ok(blocked.viaStrategy.strategies.some((item) => item.net === 'USB_DP' && item.transitionPlan.maxLayerChanges === 0))
  assert.ok(blocked.viaStrategy.strategies.every((item) => Array.isArray(item.allowedTransitions) && item.allowedTransitions.length > 0))
  assert.ok(blocked.viaStrategy.strategies.find((item) => item.net === 'VBAT').viaArray.minParallelVias >= 2)
  assert.ok(blocked.warnings.some((issue) => issue.code === 'VIA_STRATEGY_REVIEW'))
})

test('noise map detects noisy and sensitive region coupling', async () => {
  const output = await executeJob({
    id: 'noise_map',
    type: 'build_noise_map',
    input: {
      components: [
        { ref: 'U1', group: 'REGULATOR', value: 'buck regulator', x: 10, y: 10, width: 5, height: 5 },
        { ref: 'U2', group: 'SENSOR', value: 'precision ADC sensor', x: 12, y: 11, width: 4, height: 4 },
        { ref: 'U3', group: 'RF_MODULE', value: 'ESP32 WiFi antenna', x: 18, y: 10, width: 8, height: 6 },
      ],
      nets: [{ name: 'ADC_IN' }, { name: 'USB_DP' }, { name: 'RF_FEED' }],
    },
  }, process.cwd())
  assert.equal(output.status, 'NOISE_MAP_NEEDS_REVIEW')
  assert.ok(output.noiseMap.noisyRegions.length >= 1)
  assert.ok(output.noiseMap.criticalRoutes.some((route) => route.net === 'USB_DP' && /return/i.test(route.viaPolicy)))
  assert.ok(output.noiseMap.copperKeepoutRules.some((rule) => rule.allowCopper === false))
  assert.ok(output.warnings.some((issue) => issue.code === 'NOISE_REGION_OVERLAP'))
})

test('copper pour planner creates ground strategy, keepouts, and stitching intent', async () => {
  const output = await executeJob({
    id: 'copper_pour_gate',
    type: 'plan_copper_pours',
    input: {
      board: { widthMm: 46, heightMm: 28, layerCount: 4, outline: rectanglePoints(46, 28) },
      nets: [{ name: 'GND' }, { name: 'AGND' }, { name: '3V3' }, { name: 'VBAT' }],
      components: [
        { ref: 'U1', group: 'ADC_SENSOR', value: 'precision analog ADC', x: 18, y: 12, width: 5, height: 5 },
        { ref: 'U2', group: 'RF_MODULE', value: 'BLE antenna', x: 34, y: 12, width: 8, height: 6 },
        { ref: 'J1', group: 'USB_CONNECTOR', value: 'USB-C', x: 5, y: 14, width: 8, height: 6 },
      ],
      maxStitchingVias: 20,
    },
  }, process.cwd())
  assert.ok(['COPPER_POUR_PLAN_READY_NEEDS_DRC', 'COPPER_POUR_PLAN_NEEDS_REVIEW'].includes(output.status))
  assert.ok(output.copperPourPlan.pours.some((pour) => pour.net === 'GND' && pour.copperRole === 'reference_ground'))
  assert.ok(output.copperPourPlan.starGroundBridges.some((bridge) => bridge.nets.includes('AGND')))
  assert.ok(output.copperPourPlan.avoidZones.some((zone) => zone.kind === 'antenna_rf_keepout' && zone.allowCopper === false))
  assert.ok(output.copperPourPlan.stitchingVias.some((via) => /local return/.test(via.reason)))
})

test('manufacturer rules and project review summarize production blockers', async () => {
  const rules = await executeJob({
    id: 'manufacturer_rules',
    type: 'summarize_manufacturer_rules',
    input: { manufacturerProfile: 'JLCPCB_STANDARD', layerCount: 10, allowMicrovias: true },
  }, process.cwd())
  assert.equal(rules.status, 'MANUFACTURER_RULES_NEEDS_REVIEW')
  assert.equal(rules.manufacturerRules.selected.id, 'JLCPCB_STANDARD')
  assert.ok(rules.manufacturerRules.comparisons.length >= 3)

  const review = await executeJob({
    id: 'project_review',
    type: 'generate_project_review_report',
    input: {
      schematicGraph: { status: 'SCHEMATIC_GRAPH_NEEDS_FIX', errors: [{ severity: 'ERROR', code: 'POWER_PIN_UNMAPPED', message: 'bad' }], warnings: [] },
      routingReadiness: { status: 'ROUTING_READINESS_BLOCKED', errors: [{ severity: 'ERROR', code: 'ROUTE_ENDPOINTS_MISSING', message: 'missing' }], warnings: [] },
      manufacturerRules: rules.manufacturerRules,
    },
  }, process.cwd())
  assert.equal(review.status, 'PROJECT_REVIEW_BLOCKED')
  assert.ok(review.projectReview.blockers.length >= 2)
  assert.ok(review.projectReview.nextActions[0].includes('Fix blockers'))
})

test('mission planner handles long range drone goals before KiCad generation', async () => {
  const plan = await executeJob({
    id: 'mission_drone',
    type: 'plan_mission_requirements',
    input: {
      projectName: '15 mile drone',
      prompt: 'I want a drone that flies 15 miles away and stays alive for 30 mins battery life. Use BoardForge to do it.',
    },
  }, process.cwd())
  assert.equal(plan.status, 'MISSION_PLAN_NEEDS_USER_DECISIONS')
  assert.equal(plan.missionPlan.mission.vehicle, 'multirotor_drone')
  assert.equal(plan.missionPlan.mission.rangeMiles, 15)
  assert.equal(plan.missionPlan.mission.enduranceMinutes, 30)
  assert.ok(plan.missionPlan.decisions.required.some((item) => item.id === 'battery'))
  assert.ok(plan.missionPlan.decisions.required.some((item) => item.id === 'radioLink'))
  assert.ok(plan.missionPlan.requirementsPlan.selectedCircuits.includes('long_range_uav_support'))
  assert.ok(plan.missionPlan.requirementsPlan.components.some((component) => component.ref === 'J60'))
  assert.ok(plan.missionPlan.boardSpecs.recommendedLayerCount >= 4)
})

test('user BOM intake and audit verify parts against long range drone mission', async () => {
  const bomText = [
    'Ref,Value,MPN,Package,Qty',
    'U1,STM32H743 flight controller MCU,STM32H743VIT6,LQFP-100,1',
    'U2,ICM-42688-P IMU,ICM-42688-P,LGA-14,1',
    'J1,USB-C receptacle,TYPE-C-31-M-12,USB-C-SMD,1',
    'U10,5V buck regulator,MP1584,SOP-8,1',
    'J50,4-in-1 ESC connector,PinHeader-1x08,PinHeader-1x08,1',
  ].join('\n')
  const intake = await executeJob({
    id: 'intake_bom',
    type: 'intake_user_bom',
    input: { projectName: 'User Drone BOM', bomText },
  }, process.cwd())
  assert.ok(['USER_BOM_PARSED', 'USER_BOM_PARSED_NEEDS_REVIEW'].includes(intake.status))
  assert.equal(intake.components.length, 5)
  assert.ok(intake.components.some((component) => component.group === 'IMU'))
  const audit = await executeJob({
    id: 'audit_bom',
    type: 'audit_user_bom',
    input: {
      projectName: 'User Drone BOM',
      prompt: 'drone that flies 15 miles and lasts 30 minutes',
      bomText,
      battery: '4S 5000mAh LiPo',
    },
  }, process.cwd())
  assert.equal(audit.status, 'USER_BOM_AUDIT_NEEDS_FIX')
  assert.ok(audit.missingFunctions.some((gap) => gap.group === 'GNSS'))
  assert.ok(audit.questions.some((question) => question.id === 'missing_functions'))
  assert.ok(audit.workflow.some((step) => step.type === 'generate_schematic'))
  assert.ok(audit.powerBudget.batteryWh > 0)
})

test('user BOM jobs persist normalized components into a KiCad project state', async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'boardforge-user-bom-test-'))
  try {
    await executeJob({ id: 'project', type: 'create_outline_board', allowOverwrite: true, input: { projectName: 'User BOM Project', widthMm: 50, heightMm: 35, layerCount: 4 } }, workspace)
    const bomText = 'Ref,Value,MPN,Package\nU1,STM32 flight controller MCU,STM32F405RGT6,LQFP-64\nU2,ICM-42688-P IMU,ICM-42688-P,LGA-14\nJ60,GPS GNSS connector,PinHeader-1x06,PinHeader-1x06'
    const intake = await executeJob({ id: 'project_bom_intake', type: 'intake_user_bom', input: { projectPath: 'user-bom-project', bomText } }, workspace)
    assert.equal(intake.generatedFiles.some((file) => file.endsWith('boardforge-user-bom.json')), true)
    const audit = await executeJob({ id: 'project_bom_audit', type: 'audit_user_bom', input: { projectPath: 'user-bom-project', prompt: 'long range drone 15 miles 30 minutes', battery: '4S 5000mAh' } }, workspace)
    assert.equal(audit.generatedFiles.some((file) => file.endsWith('boardforge-user-bom-audit.json')), true)
    const state = JSON.parse(await readFile(path.join(workspace, 'user-bom-project', 'boardforge-project.json'), 'utf8'))
    assert.equal(state.userBom.components.length, 3)
    assert.ok(state.userBomAudit.questions.length > 0)
    assert.ok(state.components.some((component) => component.ref === 'J60'))
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})

test('pin assignment planner maps MCU interfaces and peripheral pins', async () => {
  const result = await executeJob({
    id: 'pin_assignments',
    type: 'plan_pin_assignments',
    input: {
      interfaces: ['USB', 'I2C', 'SPI', 'SWD'],
      components: [
        { ref: 'U1', group: 'ESP32_S3', value: 'ESP32-S3-WROOM-1-N8R8' },
        { ref: 'J1', group: 'USB', value: 'USB-C receptacle' },
        { ref: 'J20', group: 'SENSOR_CONNECTOR', value: 'I2C sensor connector' },
        { ref: 'J30', group: 'SWD', value: 'SWD programming header' },
      ],
      nets: [{ name: 'USB_DP' }, { name: 'USB_DN' }, { name: 'I2C_SCL' }, { name: 'I2C_SDA' }, { name: 'SWDIO' }, { name: 'SWCLK' }, { name: '3V3' }, { name: 'GND' }],
    },
  }, process.cwd())
  assert.ok(['PIN_ASSIGNMENT_NEEDS_REVIEW', 'PIN_ASSIGNMENT_READY_NEEDS_REVIEW'].includes(result.status))
  assert.equal(result.pinAssignments.controller.ref, 'U1')
  assert.equal(result.pinAssignments.controllerPinMap.GPIO20, 'USB_DP')
  assert.equal(result.pinAssignments.controllerPinMap.GPIO8, 'I2C_SDA')
  assert.ok(result.pinAssignments.peripheralPinMaps.some((item) => item.ref === 'J1' && item.pinMap['D+'] === 'USB_DP'))
  assert.ok(result.pinAssignments.actions.some((action) => action.command === 'generate_schematic'))
})

test('power tree planner budgets rails and thermal review', async () => {
  const plan = await executeJob({
    id: 'power_tree',
    type: 'plan_power_tree',
    input: {
      projectName: 'ESP32 PoE sensor',
      powerInput: 'POE_VDD',
      components: [
        { ref: 'U1', group: 'ESP32_S3', value: 'ESP32-S3-WROOM' },
        { ref: 'U10', group: 'REGULATOR', value: '3V3 buck regulator' },
        { ref: 'U40', group: 'ETHERNET_PHY', value: 'LAN8720A PHY' },
      ],
      nets: [{ name: 'POE_VDD' }, { name: '3V3' }, { name: 'GND' }],
    },
  }, process.cwd())
  assert.ok(['POWER_TREE_READY_NEEDS_REVIEW', 'POWER_TREE_BLOCKED'].includes(plan.status))
  assert.ok(plan.powerTree.rails.some((rail) => rail.name === '3V3' && rail.requiredCurrentMa > 400))
  assert.ok(plan.powerTree.regulators.some((regulator) => regulator.rail === '3V3'))
  assert.ok(plan.powerTree.decoupling.some((item) => item.ref === 'U1'))
  assert.ok(plan.powerTree.constraints.railClasses.some((item) => item.net === '3V3'))
})

test('fanout planner blocks dense packages on too few layers', async () => {
  const plan = await executeJob({
    id: 'fanout',
    type: 'plan_fanout',
    input: {
      layerCount: 2,
      components: [
        { ref: 'U1', group: 'MCU', value: 'BGA processor', package: 'BGA-100', pinCount: 100, pitchMm: 0.5 },
        { ref: 'J1', group: 'USB', value: 'USB-C connector', pinMap: { DP: 'USB_DP', DN: 'USB_DN', VBUS: 'VUSB', GND: 'GND' } },
      ],
      nets: [{ name: 'USB_DP' }, { name: 'USB_DN' }, { name: '3V3' }, { name: 'GND' }],
    },
  }, process.cwd())
  assert.equal(plan.status, 'FANOUT_PLAN_BLOCKED')
  assert.ok(plan.fanoutPlan.errors.some((issue) => issue.code === 'BGA_REQUIRES_4PLUS_LAYERS'))
  assert.ok(plan.fanoutPlan.edgeConnectors.some((connector) => connector.ref === 'J1'))
  assert.ok(plan.fanoutPlan.viaPolicy.allowedTransitions.some((pair) => pair.includes('B.Cu')))
})

test('signal integrity planner creates high-speed routing gates', async () => {
  const board = { widthMm: 55, heightMm: 35, outline: rectanglePoints(55, 35), layerCount: 4 }
  const stackup = {
    status: 'STACKUP_PLAN_READY',
    layerCount: 4,
    layers: [
      { name: 'F.Cu', role: 'components_high_speed_escape', reference: 'In1.Cu' },
      { name: 'In1.Cu', role: 'continuous_ground_reference' },
      { name: 'In2.Cu', role: 'power_planes' },
      { name: 'B.Cu', role: 'bottom_components_secondary_signals', reference: 'In2.Cu' },
    ],
  }
  const result = await executeJob({
    id: 'signal_integrity',
    type: 'plan_signal_integrity',
    input: {
      board,
      stackup,
      components: [
        { ref: 'U1', group: 'ESP32_S3', value: 'ESP32-S3-WROOM RF module', x: 24, y: 17, width: 18, height: 14 },
        { ref: 'Y1', group: 'CRYSTAL', value: '40 MHz crystal', x: 34, y: 17, width: 3, height: 2 },
        { ref: 'U2', group: 'REGULATOR', value: '3V3 buck regulator', x: 12, y: 25, width: 5, height: 5 },
      ],
      nets: [{ name: 'USB_DP' }, { name: 'USB_DN' }, { name: 'XTAL_IN' }, { name: 'XTAL_OUT' }, { name: 'GND' }],
      routingPlan: {
        routes: [
          { net: 'USB_DP', className: 'USB_DIFF', estimatedLengthMm: 28, viaPlan: { candidates: [] } },
          { net: 'USB_DN', className: 'USB_DIFF', estimatedLengthMm: 31, viaPlan: { candidates: [] } },
        ],
      },
    },
  }, process.cwd())
  assert.equal(result.status, 'SIGNAL_INTEGRITY_NEEDS_REVIEW')
  assert.equal(result.signalIntegrity.gates.requireContinuousReferencePlane, true)
  assert.ok(result.signalIntegrity.impedance.some((item) => item.targetOhms === 90))
  assert.ok(result.signalIntegrity.lengthMatching.pairs.some((pair) => pair.status === 'mismatch_review_required'))
  assert.ok(result.warnings.some((issue) => issue.code === 'RF_COMPONENT_KEEP_OUT_REQUIRED'))
})

test('test strategy planner emits test points and bring-up sequence', async () => {
  const result = await executeJob({
    id: 'test_strategy',
    type: 'plan_test_strategy',
    input: {
      board: { widthMm: 55, heightMm: 35, outline: rectanglePoints(55, 35), mountingHoles: [{ id: 'MH1', x: 5, y: 5, diameterMm: 3 }, { id: 'MH2', x: 50, y: 30, diameterMm: 3 }] },
      components: [{ ref: 'J30', group: 'SWD', value: 'SWD programming header' }],
      nets: [{ name: '3V3' }, { name: 'GND' }, { name: 'VUSB' }, { name: 'SWDIO' }, { name: 'SWCLK' }, { name: 'NRST' }],
      pinAssignments: { controllerPinMap: { PA13: 'SWDIO', PA14: 'SWCLK', NRST: 'NRST' } },
      powerTree: { rails: [{ name: '3V3' }, { name: 'VUSB' }] },
    },
  }, process.cwd())
  assert.ok(['TEST_STRATEGY_NEEDS_REVIEW', 'TEST_STRATEGY_READY_NEEDS_REVIEW'].includes(result.status))
  assert.ok(result.testStrategy.requiredTestPoints.some((item) => item.net === 'GND'))
  assert.equal(result.testStrategy.programming.available, true)
  assert.ok(result.testStrategy.bringup.some((step) => step.name === 'current-limited power'))
  assert.equal(result.testStrategy.fixture.boardSupport, 'use mounting holes for fixture location')
})

test('DFM checker catches component and route manufacturing blockers', async () => {
  const dfm = await executeJob({
    id: 'dfm',
    type: 'run_dfm_checks',
    input: {
      board: { widthMm: 30, heightMm: 20, outline: rectanglePoints(30, 20), layerCount: 2 },
      components: [
        { ref: 'U1', group: 'MCU', value: 'QFN MCU', x: 15, y: 10, width: 8, height: 8, footprint: 'Package_DFN_QFN:QFN-32' },
        { ref: 'U2', group: 'SENSOR', value: 'sensor', x: 18, y: 10, width: 8, height: 8, footprint: 'Package_SO:SOIC-8' },
      ],
      routes: [{ net: '3V3', widthMm: 0.05, vias: [{ diameterMm: 0.2, drillMm: 0.1 }] }],
      powerTree: { errors: [], thermalReview: [] },
      fanoutPlan: { errors: [], viaPolicy: { blindViasAllowed: false, microviasAllowed: false } },
    },
  }, process.cwd())
  assert.equal(dfm.status, 'DFM_CHECKS_BLOCKED')
  assert.ok(dfm.dfm.errors.some((issue) => issue.code === 'COMPONENT_SPACING_VIOLATION'))
  assert.ok(dfm.dfm.errors.some((issue) => issue.code === 'TRACE_WIDTH_BELOW_PROFILE'))
  assert.ok(dfm.dfm.actions.some((action) => action.includes('optimize_placement')))
})

test('workflow preset produces ordered controlled Codex plugin steps', async () => {
  const preset = await executeJob({
    id: 'workflow_preset',
    type: 'build_workflow_preset',
    input: { projectName: 'Workflow PoE Sensor', prompt: 'ESP32-S3 PoE Ethernet sensor with USB and I2C' },
  }, process.cwd())
  assert.equal(preset.status, 'WORKFLOW_PRESET_READY_NEEDS_REVIEW')
  assert.equal(preset.workflowPreset.preset, 'poe_esp32_sensor')
  assert.equal(preset.workflowPreset.steps[0].type, 'plan_board_category')
  assert.equal(preset.workflowPreset.steps[1].type, 'classify_board_architecture')
  assert.ok(preset.workflowPreset.steps.findIndex((step) => step.type === 'ingest_reference_design') > preset.workflowPreset.steps.findIndex((step) => step.type === 'classify_board_architecture'))
  assert.ok(preset.workflowPreset.steps.findIndex((step) => step.type === 'synthesize_circuit_blocks') > preset.workflowPreset.steps.findIndex((step) => step.type === 'create_kicad_project'))
  assert.ok(preset.workflowPreset.steps.some((step) => step.type === 'plan_hdi_manufacturing_strategy'))
  assert.ok(preset.workflowPreset.steps.some((step) => step.type === 'audit_return_path_integrity'))
  assert.ok(preset.workflowPreset.steps.some((step) => step.type === 'audit_creepage_clearance'))
  assert.ok(preset.workflowPreset.steps.some((step) => step.type === 'plan_bringup_reliability_matrix'))
  assert.ok(preset.workflowPreset.steps.some((step) => step.type === 'run_advanced_board_suite'))
  assert.ok(preset.workflowPreset.steps.some((step) => step.type === 'plan_power_tree'))
  assert.ok(preset.workflowPreset.steps.some((step) => step.type === 'generate_design_constraints'))
  assert.ok(preset.workflowPreset.steps.some((step) => step.type === 'generate_kicad_rules'))
  assert.ok(preset.workflowPreset.steps.some((step) => step.type === 'plan_pin_map_repairs'))
  assert.ok(preset.workflowPreset.steps.some((step) => step.type === 'apply_schematic_pcb_sync'))
  assert.ok(preset.workflowPreset.exportStepsAfterValidation.some((step) => step.type === 'validate_jlcpcb_package'))
  assert.ok(preset.workflowPreset.steps.some((step) => step.type === 'plan_fanout'))
  assert.ok(preset.workflowPreset.steps.some((step) => step.type === 'plan_copper_pours'))
  assert.ok(preset.workflowPreset.steps.some((step) => step.type === 'autotrace_board'))
  assert.ok(preset.workflowPreset.steps.some((step) => step.type === 'analyze_routing_congestion'))
  assert.ok(preset.workflowPreset.steps.some((step) => step.type === 'validate_power_integrity'))
  assert.ok(preset.workflowPreset.steps.some((step) => step.type === 'score_production_readiness'))
  assert.ok(preset.workflowPreset.steps.some((step) => step.type === 'build_release_gate_report'))
  assert.ok(preset.workflowPreset.steps.some((step) => step.type === 'run_dfm_checks'))
  assert.ok(preset.workflowPreset.exportStepsAfterValidation.some((step) => step.type === 'package_jlcpcb'))
  const dronePreset = await executeJob({
    id: 'workflow_drone_preset',
    type: 'build_workflow_preset',
    input: { projectName: 'Long Range Drone', prompt: 'drone that flies 15 miles and lasts 30 minutes' },
  }, process.cwd())
  assert.equal(dronePreset.workflowPreset.preset, 'drone_flight_controller')
  assert.equal(dronePreset.workflowPreset.steps[0].type, 'plan_board_category')
  assert.equal(dronePreset.workflowPreset.steps[1].type, 'classify_board_architecture')
  assert.ok(dronePreset.workflowPreset.steps.findIndex((step) => step.type === 'plan_mission_requirements') > dronePreset.workflowPreset.steps.findIndex((step) => step.type === 'classify_board_architecture'))
  assert.ok(dronePreset.workflowPreset.steps.some((step) => step.type === 'autoroute_drc_iteration'))
})

test('controlled workflow runner executes preset steps and writes a report', async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'boardforge-workflow-run-test-'))
  try {
    const output = await executeJob({
      id: 'workflow_run',
      type: 'run_boardforge_workflow',
      allowOverwrite: true,
      input: {
        projectName: 'Workflow Run Project',
        templateId: 'ESP32_S3_SENSOR',
        prompt: 'ESP32-S3 USB-C I2C sensor board with 3V3 regulator',
        allowOverwrite: true,
        continueOnBlocked: true,
      },
    }, workspace)
    assert.ok(['BOARDFORGE_WORKFLOW_COMPLETE_NEEDS_REVIEW', 'BOARDFORGE_WORKFLOW_BLOCKED'].includes(output.status))
    assert.ok(output.workflowRun.stepsExecuted >= 4)
    assert.equal(output.generatedFiles.some((file) => file.endsWith('boardforge-workflow-run.json')), true)
    assert.ok(output.workflowRun.results.some((step) => step.step === 'create_kicad_project'))
    const report = JSON.parse(await readFile(path.join(workspace, 'workflow-run-project', 'boardforge-workflow-run.json'), 'utf8'))
    assert.equal(report.humanReviewRequired, true)
    assert.ok(Array.isArray(report.nextActions))
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})

test('DRC repair planner classifies reports and applies safe cleanup only', async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'boardforge-drc-repair-test-'))
  try {
    await executeJob({
      id: 'project',
      type: 'create_outline_board',
      allowOverwrite: true,
      input: { projectName: 'DRC Repair Project', widthMm: 40, heightMm: 24 },
    }, workspace)
    const projectDir = path.join(workspace, 'drc-repair-project')
    const reportsDir = path.join(projectDir, 'reports')
    await mkdir(reportsDir, { recursive: true })
    await writeFile(path.join(reportsDir, 'drc.json'), JSON.stringify({
      violations: [
        { severity: 'error', type: 'clearance', description: 'clearance violation between tracks' },
        { severity: 'error', type: 'zone', description: 'copper pour zone fill issue' },
        { severity: 'warning', type: 'edge', description: 'item near board edge' },
      ],
    }), 'utf8')
    const pcbFile = path.join(projectDir, 'drc-repair-project.kicad_pcb')
    await writeFile(pcbFile, `${await readFile(pcbFile, 'utf8')}\n  (segment (start 1 1) (end 1 1) (width 0.1) (layer "F.Cu") (net 0) (uuid "00000000-0000-0000-0000-000000000001"))\n`, 'utf8')
    const plan = await executeJob({ id: 'repair_plan', type: 'plan_drc_repairs', input: { projectPath: 'drc-repair-project' } }, workspace)
    assert.equal(plan.status, 'DRC_REPAIR_PLAN_READY_NEEDS_REVIEW')
    assert.ok(plan.repairPlan.repairs.some((item) => item.category === 'clearance'))
    assert.ok(plan.repairPlan.blockers.some((item) => item.category === 'mechanical'))
    assert.ok(plan.repairPlan.autoApplicable.some((item) => item.action === 'remove_zero_length_segments'))
    const applied = await executeJob({ id: 'repair_apply', type: 'apply_safe_drc_repairs', input: { projectPath: 'drc-repair-project' } }, workspace)
    assert.equal(applied.status, 'SAFE_DRC_REPAIRS_APPLIED_RERUN_DRC')
    assert.doesNotMatch(await readFile(pcbFile, 'utf8'), /\(segment \(start 1 1\) \(end 1 1\)/)
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})

test('ERC repair planner classifies electrical issues and only applies safe metadata', async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'boardforge-erc-repair-test-'))
  try {
    await executeJob({
      id: 'project',
      type: 'create_kicad_project',
      allowOverwrite: true,
      input: { projectName: 'ERC Repair Project', templateId: 'ESP32_S3_SENSOR' },
    }, workspace)
    const projectDir = path.join(workspace, 'erc-repair-project')
    const reportsDir = path.join(projectDir, 'reports')
    await mkdir(reportsDir, { recursive: true })
    await writeFile(path.join(reportsDir, 'erc.json'), JSON.stringify({
      violations: [
        { severity: 'error', type: 'unconnected_pin', description: 'pin is not connected' },
        { severity: 'error', type: 'power_input_not_driven', description: 'power input pin is not driven' },
        { severity: 'warning', type: 'duplicate_reference', description: 'duplicate reference designator' },
      ],
    }), 'utf8')
    const plan = await executeJob({ id: 'erc_repair_plan', type: 'plan_erc_repairs', input: { projectPath: 'erc-repair-project' } }, workspace)
    assert.equal(plan.status, 'ERC_REPAIR_PLAN_READY_NEEDS_REVIEW')
    assert.ok(plan.repairPlan.repairs.some((item) => item.category === 'connectivity'))
    assert.ok(plan.repairPlan.repairs.some((item) => item.category === 'power_integrity'))
    assert.ok(plan.repairPlan.blockers.length >= 2)
    const applied = await executeJob({ id: 'erc_repair_apply', type: 'apply_safe_erc_repairs', input: { projectPath: 'erc-repair-project' } }, workspace)
    assert.equal(applied.status, 'SAFE_ERC_REPAIRS_APPLIED_RERUN_ERC')
    assert.match(await readFile(path.join(projectDir, 'erc-repair-project.kicad_sch'), 'utf8'), /BoardForge ERC repair review required/)
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})

test('project snapshots can be listed and restored without touching arbitrary files', async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'boardforge-snapshot-test-'))
  try {
    await executeJob({
      id: 'snapshot_project_seed',
      type: 'create_outline_board',
      allowOverwrite: true,
      input: { projectName: 'Snapshot Project', widthMm: 40, heightMm: 24, shape: 'rounded_rectangle' },
    }, workspace)
    const projectPath = 'snapshot-project'
    const pcbPath = path.join(workspace, projectPath, 'snapshot-project.kicad_pcb')
    const originalPcb = await readFile(pcbPath, 'utf8')
    const snapshot = await executeJob({ id: 'snapshot', type: 'snapshot_project', input: { projectPath, label: 'before-edit' } }, workspace)
    assert.equal(snapshot.status, 'PROJECT_SNAPSHOT_CREATED')
    assert.equal(snapshot.snapshot.fileCount >= 4, true)
    await writeFile(pcbPath, '(kicad_pcb (version 20241229) (generator "broken"))\n', 'utf8')
    const listed = await executeJob({ id: 'list_snapshots', type: 'list_project_snapshots', input: { projectPath } }, workspace)
    assert.equal(listed.status, 'PROJECT_SNAPSHOTS_LISTED')
    assert.equal(listed.count, 1)
    const diff = await executeJob({ id: 'diff_snapshot', type: 'diff_project_snapshot', input: { projectPath, snapshotId: snapshot.snapshot.id } }, workspace)
    assert.equal(diff.status, 'PROJECT_DIFF_HAS_CHANGES_NEEDS_REVIEW')
    assert.equal(diff.changedFiles >= 1, true)
    assert.equal(diff.files.some((file) => file.path === 'snapshot-project.kicad_pcb' && file.status === 'modified'), true)
    const restored = await executeJob({ id: 'restore_snapshot', type: 'restore_project_snapshot', input: { projectPath, snapshotId: snapshot.snapshot.id } }, workspace)
    assert.equal(restored.status, 'PROJECT_SNAPSHOT_RESTORED_NEEDS_REVIEW')
    assert.equal(restored.restoredFiles.includes('snapshot-project.kicad_pcb'), true)
    assert.equal(await readFile(pcbPath, 'utf8'), originalPcb)
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})

test('apply_routing_plan writes review-required KiCad copper, vias, and zones', async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'boardforge-copper-test-'))
  try {
    await executeJob({
      id: 'project',
      type: 'create_outline_board',
      allowOverwrite: true,
      input: {
        projectName: 'Copper Test',
        widthMm: 42,
        heightMm: 28,
        layerCount: 4,
        nets: [{ name: 'GND' }, { name: 'VIN' }, { name: 'SCL' }],
      },
    }, workspace)
    const input = {
      projectPath: 'copper-test',
      board: { widthMm: 42, heightMm: 28, layerCount: 4, outline: rectanglePoints(42, 28) },
      nets: [
        { name: 'GND', start: { x: 6, y: 6 }, end: { x: 36, y: 22 } },
        { name: 'VIN', start: { x: 8, y: 20 }, end: { x: 32, y: 8 } },
        { name: 'SCL', start: { x: 10, y: 10 }, end: { x: 30, y: 18 } },
      ],
    }
    const applied = await executeJob({ id: 'apply_routes', type: 'apply_routing_plan', input }, workspace)
    assert.equal(applied.status, 'COPPER_APPLIED_NEEDS_DRC')
    assert.ok(applied.generatedObjects.segments > 0)
    assert.ok(applied.generatedObjects.vias > 0)
    assert.ok(applied.generatedObjects.zones > 0)
    assert.equal(applied.writeProof.retained, true)
    assert.equal(applied.writeProof.actualAdded.segments >= applied.generatedObjects.segments, true)
    const pcb = await readFile(path.join(workspace, 'copper-test', 'copper-test.kicad_pcb'), 'utf8')
    assert.match(pcb, /\(segment /)
    assert.match(pcb, /\(via /)
    assert.match(pcb, /\(zone /)
    assert.match(pcb, /BoardForge review-required copper/)
    const scan = await executeJob({ id: 'scan_copper', type: 'scan_kicad_project', input: { projectPath: 'copper-test' } }, workspace)
    assert.ok(scan.scan.tracks.length > 0)
    assert.ok(scan.scan.vias.length > 0)
    assert.ok(scan.scan.zones.length > 0)
    const state = JSON.parse(await readFile(path.join(workspace, 'copper-test', 'boardforge-project.json'), 'utf8'))
    assert.equal(state.routing.status, 'COPPER_APPLIED_NEEDS_DRC')
    assert.equal(state.routing.drcRequired, true)
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})

test('KiCad post-write copper scan counts retained route objects', async () => {
  const pcb = `(kicad_pcb (version 20240108) (generator "BoardForge")
  (net 0 "")
  (net 1 "SIG")
  (segment (start 1 1) (end 5 1) (width 0.15) (layer "F.Cu") (net 1) (uuid "00000000-0000-0000-0000-000000000001"))
  (via (at 5 1) (size 0.45) (drill 0.2) (layers "F.Cu" "B.Cu") (net 1) (uuid "00000000-0000-0000-0000-000000000002"))
  (zone (net 1) (net_name "SIG") (layer "F.Cu") (uuid "00000000-0000-0000-0000-000000000003")
    (polygon (pts (xy 1 1) (xy 3 1) (xy 3 3) (xy 1 3)))
  )
)`
  assert.deepEqual(scanKicadCopperText(pcb), { segments: 1, vias: 1, zones: 1 })
})

test('route commit proof rejects expected copper that was not retained', () => {
  const proof = compareExpectedVsActualCopper({
    before: { segments: 0, vias: 0, zones: 0 },
    expectedAdded: { segments: 3, vias: 1, zones: 0 },
    after: { segments: 0, vias: 0, zones: 0 },
  })
  assert.equal(proof.retained, false)
  assert.equal(proof.failurePoint, 'KICAD_COPPER_WRITE_NOT_RETAINED')
  assert.throws(() => assertRouteBundleRetained(proof), /not retained/)
})

test('route commit proof accepts cumulative transaction rewrites by total retained copper', () => {
  const proof = compareExpectedVsActualCopper({
    before: { segments: 6, vias: 0, zones: 0 },
    expectedAdded: { segments: 11, vias: 2, zones: 0 },
    after: { segments: 11, vias: 2, zones: 0 },
  })
  assert.equal(proof.retained, false)
  assert.equal(proof.retainedTotal, true)
  assert.equal(proof.failurePoint, null)
  assert.equal(assertRouteBundleRetained(proof), true)
})

test('route trial DRC can run without saving the board', () => {
  const trialArgs = buildDrcArgs({ pcbFile: 'board.kicad_pcb', outputFile: 'drc.json', saveBoard: false })
  assert.equal(trialArgs.includes('--save-board'), false)
  assert.equal(trialArgs.includes('--refill-zones'), false)
  const reviewArgs = buildDrcArgs({ pcbFile: 'board.kicad_pcb', outputFile: 'drc.json' })
  assert.equal(reviewArgs.includes('--save-board'), true)
  assert.equal(reviewArgs.includes('--refill-zones'), true)
})

test('trace route DRC gate keeps warning-only repair debt and rolls back new errors', () => {
  const warningDebt = classifyDrcRegression({ errors: 878, warnings: 430 }, { errors: 878, warnings: 429 })
  assert.equal(warningDebt.rollback, false)
  assert.equal(warningDebt.warningOnly, true)
  assert.equal(warningDebt.reason, 'WARNING_ONLY_REPAIR_DEBT')

  const errorRegression = classifyDrcRegression({ errors: 879, warnings: 429 }, { errors: 878, warnings: 429 })
  assert.equal(errorRegression.rollback, true)
  assert.equal(errorRegression.reason, 'DRC_ERROR_REGRESSION')
})

test('KiCad route writer retention proves actual copper in final file', async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'boardforge-writer-retention-'))
  try {
    const board = { name: 'Writer Retention', widthMm: 24, heightMm: 16, layerCount: 2, outline: rectanglePoints(24, 16) }
    const pcbFile = path.join(workspace, 'writer-retention.kicad_pcb')
    await writeFile(pcbFile, kicadPcbFile(board, { nets: [{ name: 'SIG' }] }), 'utf8')
    const routingPlan = {
      routes: [{
        net: 'SIG',
        className: 'DEFAULT',
        status: 'routed',
        widthMm: 0.15,
        start: { x: 3, y: 3 },
        end: { x: 20, y: 12 },
        waypoints: [{ x: 3, y: 3 }, { x: 12, y: 3 }, { x: 12, y: 12 }, { x: 20, y: 12 }],
        layerPreference: ['F.Cu'],
      }],
      designIntent: { copperPours: [] },
    }
    const write = await applyRoutingPlanToPcb({ pcbFile, board, routingPlan })
    assert.equal(write.generatedObjects.segments, 3)
    assert.equal(write.writeProof.retained, true)
    assert.equal(write.writeProof.after.segments, 3)
    assert.match(await readFile(pcbFile, 'utf8'), /\(segment .*?\(net "SIG"\)/s)
    assert.deepEqual(await scanKicadCopperAfterWrite(pcbFile), { segments: 3, vias: 0, zones: 0 })
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})

test('KiCad route writer inserts generated copper at top level across repeated writes', async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'boardforge-writer-top-level-'))
  try {
    const board = { name: 'Writer Top Level', widthMm: 24, heightMm: 16, layerCount: 2, outline: rectanglePoints(24, 16) }
    const pcbFile = path.join(workspace, 'writer-top-level.kicad_pcb')
    await writeFile(pcbFile, `(kicad_pcb (version 20240108) (generator "BoardForge")
  (net 0 "")
  (net 1 "SIG")
  (gr_line
    (start 0 0)
    (end 10 0)
    (stroke (width 0.1) (type solid))
    (layer "Edge.Cuts")
    (uuid "11111111-1111-1111-1111-111111111111")
  )
)`, 'utf8')
    const routingPlan = {
      routes: [{
        net: 'SIG',
        className: 'DEFAULT',
        status: 'routed',
        widthMm: 0.15,
        start: { x: 1, y: 1 },
        end: { x: 6, y: 1 },
        waypoints: [{ x: 1, y: 1 }, { x: 6, y: 1 }],
      }],
      designIntent: { copperPours: [] },
    }
    await applyRoutingPlanToPcb({ pcbFile, board, routingPlan })
    await applyRoutingPlanToPcb({ pcbFile, board, routingPlan })
    const pcb = await readFile(pcbFile, 'utf8')
    assert.equal((pcb.match(/BoardForge review-required copper/g) || []).length, 1)
    assert.equal(/uuid "[^"]+"\s+\(gr_text "BoardForge review-required copper/.test(pcb), false)
    assert.match(pcb, /\(uuid "11111111-1111-1111-1111-111111111111"\)\s*\)\s*\n\s*\(gr_text "BoardForge review-required copper/)
    assert.deepEqual(scanKicadCopperText(pcb), { segments: 1, vias: 0, zones: 0 })
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})

test('KiCad route writer can append one-net transaction copper without replacing prior route', async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'boardforge-writer-append-'))
  try {
    const board = { name: 'Writer Append', widthMm: 24, heightMm: 16, layerCount: 2, outline: rectanglePoints(24, 16) }
    const pcbFile = path.join(workspace, 'writer-append.kicad_pcb')
    await writeFile(pcbFile, kicadPcbFile(board, { nets: [{ name: 'SIG1' }, { name: 'SIG2' }] }), 'utf8')
    await applyRoutingPlanToPcb({
      pcbFile,
      board,
      routingPlan: { routes: [{ net: 'SIG1', className: 'DEFAULT', status: 'routed', widthMm: 0.15, start: { x: 3, y: 3 }, end: { x: 10, y: 3 }, layerPreference: ['F.Cu'] }] },
      replaceGeneratedCopper: false,
    })
    const second = await applyRoutingPlanToPcb({
      pcbFile,
      board,
      routingPlan: { routes: [{ net: 'SIG2', className: 'DEFAULT', status: 'routed', widthMm: 0.15, start: { x: 3, y: 6 }, end: { x: 10, y: 6 }, layerPreference: ['F.Cu'] }] },
      replaceGeneratedCopper: false,
    })
    assert.equal(second.writeProof.retained, true)
    assert.equal(second.writeProof.after.segments, 2)
    const text = await readFile(pcbFile, 'utf8')
    assert.match(text, /\(segment[^\n]+\(net "SIG1"\)/)
    assert.match(text, /\(segment[^\n]+\(net "SIG2"\)/)
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})

test('KiCad route writer serializes internal-layer transitions as through vias only', async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'boardforge-writer-through-via-'))
  try {
    const board = { name: 'Writer Through Via', widthMm: 24, heightMm: 16, layerCount: 8, outline: rectanglePoints(24, 16) }
    const pcbFile = path.join(workspace, 'writer-through-via.kicad_pcb')
    await writeFile(pcbFile, kicadPcbFile(board, { nets: [{ name: 'SIG' }] }), 'utf8')
    const routingPlan = {
      routes: [{
        net: 'SIG',
        className: 'DEFAULT',
        status: 'routed',
        widthMm: 0.15,
        start: { x: 3, y: 3 },
        end: { x: 20, y: 12 },
        waypoints: [{ x: 3, y: 3 }, { x: 8, y: 3 }, { x: 16, y: 12 }, { x: 20, y: 12 }],
        layerPreference: ['In2.Cu'],
        viaPlan: {
          candidates: [
            { x: 8, y: 3, diameterMm: 0.45, drillMm: 0.2, layers: ['F.Cu', 'In2.Cu'], viaType: 'through' },
            { x: 16, y: 12, diameterMm: 0.45, drillMm: 0.2, layers: ['In2.Cu', 'F.Cu'], viaType: 'through' },
          ],
        },
      }],
      designIntent: { copperPours: [] },
    }
    const write = await applyRoutingPlanToPcb({ pcbFile, board, routingPlan })
    assert.equal(write.writeProof.retained, true)
    const pcb = await readFile(pcbFile, 'utf8')
    assert.match(pcb, /\(via .*?\(layers "F\.Cu" "B\.Cu"\)/s)
    assert.doesNotMatch(pcb, /\(via .*?\(layers "F\.Cu" "In2\.Cu"\)/s)
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})

test('autoroute_board routes simple nets around component obstacles', async () => {
  const board = { widthMm: 50, heightMm: 30, layerCount: 2, outline: rectanglePoints(50, 30), mountingHoles: [] }
  const components = [
    { ref: 'J1', group: 'connector', x: 6, y: 8, width: 3, height: 3, pinMap: { '1': 'SIG' } },
    { ref: 'U1', group: 'mcu', x: 44, y: 22, width: 3, height: 3, pinMap: { '1': 'SIG' } },
    { ref: 'KEEP1', group: 'mechanical', x: 25, y: 15, width: 10, height: 14, pinMap: {} },
  ]
  const routed = await executeJob({
    id: 'autoroute_plan',
    type: 'autoroute_board',
    input: { board, components, nets: [{ name: 'SIG' }], gridMm: 1 },
  }, tmpdir())
  assert.equal(routed.status, 'AUTOROUTE_READY_NEEDS_DRC')
  assert.deepEqual(routed.routingPlan.routedNets, ['SIG'])
  const route = routed.routingPlan.routes.find((item) => item.net === 'SIG')
  assert.equal(route.status, 'routed')
  assert.ok(route.waypoints.length > 2)
  assert.ok(route.estimatedLengthMm > 0)
})

test('autoroute_board avoids generated antenna copper keepouts', async () => {
  const board = { widthMm: 50, heightMm: 30, layerCount: 2, outline: rectanglePoints(50, 30), mountingHoles: [] }
  const components = [
    { ref: 'J1', group: 'connector', x: 8, y: 4, width: 3, height: 3, pinMap: { '1': 'SIG' } },
    { ref: 'U1', group: 'mcu', x: 42, y: 4, width: 3, height: 3, pinMap: { '1': 'SIG' } },
    { ref: 'U2', group: 'ESP32_WROOM_RF', value: 'ESP32-S3-WROOM antenna', x: 25, y: 6, width: 12, height: 8, pinMap: {} },
  ]
  const routed = await executeJob({
    id: 'autoroute_keepout',
    type: 'autoroute_board',
    input: { board, components, nets: [{ name: 'SIG' }], gridMm: 1 },
  }, tmpdir())
  assert.equal(routed.status, 'AUTOROUTE_READY_NEEDS_DRC')
  const keepout = routed.routingPlan.designIntent.zones.find((zone) => zone.id === 'ANT_KEEP_U2')
  assert.equal(Boolean(keepout), true)
  const route = routed.routingPlan.routes.find((item) => item.net === 'SIG')
  assert.equal(route.waypoints.some((point) => pointInPolygon(point, keepout.polygon)), false)
})

test('autoroute_board routes differential pairs with matched geometry', async () => {
  const board = { widthMm: 60, heightMm: 34, layerCount: 4, outline: rectanglePoints(60, 34), mountingHoles: [] }
  const components = [
    { ref: 'J1', group: 'USB_C', x: 8, y: 17, width: 4, height: 6, pinMap: { A6: 'USB_DP', A7: 'USB_DN' } },
    { ref: 'U1', group: 'MCU', x: 50, y: 17, width: 8, height: 8, pinMap: { DP: 'USB_DP', DN: 'USB_DN' } },
    { ref: 'KEEP1', group: 'mechanical', x: 30, y: 17, width: 8, height: 12, pinMap: {} },
  ]
  const routed = await executeJob({
    id: 'autoroute_usb_pair',
    type: 'autoroute_board',
    input: { board, components, nets: [{ name: 'USB_DP' }, { name: 'USB_DN' }], gridMm: 1, diffPairSpacingMm: 0.3 },
  }, tmpdir())
  assert.equal(routed.status, 'AUTOROUTE_READY_NEEDS_DRC')
  const dp = routed.routingPlan.routes.find((route) => route.net === 'USB_DP')
  const dn = routed.routingPlan.routes.find((route) => route.net === 'USB_DN')
  assert.ok(['controlled_astar_matched_diff_pair', 'controlled_diff_pair_lane_router'].includes(dp.strategy))
  assert.ok(['controlled_astar_matched_diff_pair', 'controlled_diff_pair_lane_router'].includes(dn.strategy))
  assert.equal(dp.differentialPair.mate, 'USB_DN')
  assert.equal(dn.differentialPair.mate, 'USB_DP')
  assert.ok(Math.abs(dp.estimatedLengthMm - dn.estimatedLengthMm) <= 0.5)
})

test('autoroute_and_apply writes controlled KiCad copper and marks DRC required', async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'boardforge-autoroute-test-'))
  try {
    await executeJob({
      id: 'project',
      type: 'create_outline_board',
      allowOverwrite: true,
      input: { projectName: 'Autoroute Test', widthMm: 50, heightMm: 30, layerCount: 2 },
    }, workspace)
    const board = { widthMm: 50, heightMm: 30, layerCount: 2, outline: rectanglePoints(50, 30), mountingHoles: [] }
    const components = [
      { ref: 'J1', group: 'connector', x: 6, y: 8, width: 3, height: 3, pinMap: { '1': 'SIG' } },
      { ref: 'U1', group: 'mcu', x: 44, y: 22, width: 3, height: 3, pinMap: { '1': 'SIG' } },
      { ref: 'KEEP1', group: 'mechanical', x: 25, y: 15, width: 10, height: 14, pinMap: {} },
    ]
    const applied = await executeJob({
      id: 'autoroute_apply',
      type: 'autoroute_and_apply',
      input: { projectPath: 'autoroute-test', board, components, nets: [{ name: 'SIG' }], gridMm: 1 },
    }, workspace)
    assert.equal(applied.status, 'AUTOROUTE_COPPER_APPLIED_NEEDS_DRC')
    assert.ok(applied.generatedObjects.segments > 0)
    const pcb = await readFile(path.join(workspace, 'autoroute-test', 'autoroute-test.kicad_pcb'), 'utf8')
    assert.match(pcb, /\(net \d+ "SIG"\)/)
    assert.match(pcb, /\(segment /)
    const state = JSON.parse(await readFile(path.join(workspace, 'autoroute-test', 'boardforge-project.json'), 'utf8'))
    assert.equal(state.routing.status, 'AUTOROUTE_COPPER_APPLIED_NEEDS_DRC')
    assert.equal(state.routing.drcRequired, true)
    assert.equal(state.routing.autoroute.routedNets.includes('SIG'), true)
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})

test('autoroute_drc_iteration applies copper and returns a KiCad DRC report', async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'boardforge-autoroute-drc-test-'))
  try {
    await executeJob({
      id: 'project',
      type: 'create_outline_board',
      allowOverwrite: true,
      input: { projectName: 'Autoroute DRC Test', widthMm: 50, heightMm: 30, layerCount: 2 },
    }, workspace)
    const board = { widthMm: 50, heightMm: 30, layerCount: 2, outline: rectanglePoints(50, 30), mountingHoles: [] }
    const components = [
      { ref: 'J1', group: 'connector', x: 6, y: 8, width: 3, height: 3, pinMap: { '1': 'SIG' } },
      { ref: 'U1', group: 'mcu', x: 44, y: 22, width: 3, height: 3, pinMap: { '1': 'SIG' } },
      { ref: 'KEEP1', group: 'mechanical', x: 25, y: 15, width: 10, height: 14, pinMap: {} },
    ]
    const iteration = await executeJob({
      id: 'autoroute_drc',
      type: 'autoroute_drc_iteration',
      input: { projectPath: 'autoroute-drc-test', board, components, nets: [{ name: 'SIG' }], gridMm: 1 },
    }, workspace)
    assert.ok(['AUTOROUTE_DRC_ITERATION_COMPLETE_NEEDS_REVIEW', 'AUTOROUTE_DRC_ITERATION_NEEDS_FIX'].includes(iteration.status))
    assert.equal(iteration.generatedFiles.some((file) => file.endsWith('autoroute-drc.json')), true)
    assert.equal(iteration.generatedFiles.some((file) => file.endsWith('autoroute-drc-repair-plan.json')), true)
    assert.equal(iteration.generatedFiles.some((file) => file.endsWith('autoroute-drc-final-repair-plan.json')), true)
    assert.ok(iteration.repairPlan)
    assert.ok(iteration.initialRepairPlan)
    assert.equal(typeof iteration.report.issueCounts.errors, 'number')
    const state = JSON.parse(await readFile(path.join(workspace, 'autoroute-drc-test', 'boardforge-project.json'), 'utf8'))
    assert.equal(Boolean(state.validation.autorouteDrc), true)
    assert.equal(Boolean(state.routing.drcGuidedReroute.finalRepairPlanFile), true)
    assert.equal(Boolean(state.routing.drcGuidedReroute.rerouteConstraints), true)
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})

test('trace_existing_board orchestrates scan, pad geometry, via policy, copper intent, and DRC gates', async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'boardforge-trace-existing-'))
  try {
    await executeJob({ id: 'project', type: 'create_kicad_project', allowOverwrite: true, input: { projectName: 'Trace Existing Project', templateId: 'ESP32_S3_SENSOR', layerCount: 4 } }, workspace)
    const result = await executeJob({
      id: 'trace_existing',
      type: 'trace_existing_board',
      dryRun: true,
      input: {
        projectPath: 'trace-existing-project',
        layerCount: 4,
        allowPartialAutorouteWrite: true,
        allowUnsafeRoutingWrite: true,
        enableProtectionSidecars: true,
        enableUsbPadStitching: true,
      },
    }, workspace)
    assert.match(result.status, /^TRACE_EXISTING_BOARD_/)
    assert.equal(result.traceReport.gates.exactFootprintPadGeometry, true)
    assert.equal(result.traceReport.gates.netclassPolicy, 'auto_classified_written_to_kicad')
    assert.ok(result.traceReport.gates.stackupPolicy)
    assert.ok(result.traceReport.gates.viaStrategy)
    assert.ok(result.traceReport.gates.copperPourPolicy)
    assert.ok(result.traceReport.scan.pads >= 0)
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})

test('ESC original spec audit verifies unchanged parts footprints pads nets and outline', async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'boardforge-original-spec-'))
  try {
    const originalDir = path.join(workspace, 'original', 'FN-ESC1')
    const derivativeDir = path.join(workspace, 'BoardForge_ESC_Routable_Working_Copy_20260621_220438', 'FN-ESC1')
    await mkdir(originalDir, { recursive: true })
    await mkdir(derivativeDir, { recursive: true })
    const pcb = `(kicad_pcb (version 20240108)
  (footprint "AstraRMM:EPC2367" (layer "F.Cu") (at 1 1)
    (property "Reference" "Q14")
    (property "Value" "EPC2367")
    (pad "13" smd rect (at 0 0) (size 1 1) (layers "F.Cu" "F.Mask") (net 1 "/M2_C_SW")))
  (footprint "AstraRMM:Untitled2" (layer "F.Cu") (at 5 1)
    (property "Reference" "J5")
    (property "Value" "M2_PHASE_OUT")
    (pad "3" smd rect (at 0 0) (size 1 1) (layers "F.Cu" "F.Mask") (net 1 "/M2_C_SW")))
  (gr_line (start 0 0) (end 10 0) (stroke (width 0.1) (type solid)) (layer "Edge.Cuts"))
)`
    const sch = `(kicad_sch (symbol (lib_id "ESC:EPC2367") (property "Reference" "Q14") (property "Value" "EPC2367") (property "Footprint" "AstraRMM:EPC2367") (property "Manufacturer_Part_Number" "EPC2367")))`
    await writeFile(path.join(originalDir, 'FN-ESC1.kicad_pcb'), pcb, 'utf8')
    await writeFile(path.join(originalDir, 'FN-ESC1.kicad_sch'), sch, 'utf8')
    await writeFile(path.join(derivativeDir, 'FN-ESC1.kicad_pcb'), pcb, 'utf8')
    await writeFile(path.join(derivativeDir, 'FN-ESC1.kicad_sch'), sch, 'utf8')
    const audit = await auditOriginalEscSpec({ derivativeDir, originalDir })
    assert.equal(audit.status, 'ORIGINAL_SPEC_VERIFIED')
    assert.equal(audit.partsAdded.length, 0)
    assert.equal(audit.footprintsChanged.length, 0)
    assert.match(audit.finalOriginalSpecStatus, /Original spec verified/)
    const files = await writeOriginalSpecAuditReport({ projectDir: derivativeDir, audit })
    assert.ok(files.json.endsWith('boardforge-esc-original-spec-audit.json'))
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})

test('ESC original spec audit compares Edge.Cuts geometrically without stackup restoration', async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'boardforge-original-spec-outline-'))
  try {
    const originalDir = path.join(workspace, 'original', 'FN-ESC1')
    const derivativeDir = path.join(workspace, 'BoardForge_ESC_Routable_Working_Copy_20260621_220438', 'FN-ESC1')
    await mkdir(originalDir, { recursive: true })
    await mkdir(derivativeDir, { recursive: true })
    const originalPcb = `(kicad_pcb (version 20240108)
  (layers (0 "F.Cu" signal) (2 "B.Cu" signal) (44 "Edge.Cuts" user))
  (footprint "AstraRMM:EPC2367" (layer "F.Cu") (at 1 1) (property "Reference" "Q14") (pad "13" smd rect (at 0 0) (size 1 1) (layers "F.Cu" "F.Mask") (net 1 "/M2_C_SW")))
  (gr_line (start 0 0) (end 10 0) (stroke (width 0.1) (type solid)) (layer "Edge.Cuts"))
)`
    const derivativePcb = `(kicad_pcb (version 20240108)
  (layers (0 "F.Cu" signal) (4 "In1.Cu" signal) (6 "In2.Cu" signal) (8 "In3.Cu" signal) (10 "In4.Cu" signal) (12 "In5.Cu" signal) (14 "In6.Cu" signal) (2 "B.Cu" signal) (44 "Edge.Cuts" user))
  (footprint "AstraRMM:EPC2367" (layer "F.Cu") (at 1 1) (property "Reference" "Q14") (pad "13" smd rect (at 0 0) (size 1 1) (layers "F.Cu" "F.Mask") (net 1 "/M2_C_SW")))
  (gr_line (layer "Edge.Cuts") (start 0.0000 0.0000) (end 10.0000 0.0000) (stroke (type solid) (width 0.1000)))
)`
    await writeFile(path.join(originalDir, 'FN-ESC1.kicad_pcb'), originalPcb, 'utf8')
    await writeFile(path.join(originalDir, 'FN-ESC1.kicad_sch'), '(kicad_sch)', 'utf8')
    await writeFile(path.join(derivativeDir, 'FN-ESC1.kicad_pcb'), derivativePcb, 'utf8')
    await writeFile(path.join(derivativeDir, 'FN-ESC1.kicad_sch'), '(kicad_sch)', 'utf8')
    const audit = await auditOriginalEscSpec({ derivativeDir, originalDir, restore: true })
    assert.equal(audit.status, 'ORIGINAL_SPEC_VERIFIED')
    assert.equal(audit.boardOutlineChanged, false)
    assert.equal(audit.restorationPerformed.length, 0)
    const retained = await readFile(path.join(derivativeDir, 'FN-ESC1.kicad_pcb'), 'utf8')
    assert.match(retained, /"In2\.Cu"/)
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})

test('ESC original spec audit restores changed footprints before routing', async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'boardforge-original-spec-restore-'))
  try {
    const originalDir = path.join(workspace, 'FN-ESC1')
    const derivativeDir = path.join(workspace, 'BoardForge_ESC_Routable_Working_Copy_20260621_220438', 'FN-ESC1')
    await mkdir(originalDir, { recursive: true })
    await mkdir(derivativeDir, { recursive: true })
    const originalPcb = `(kicad_pcb (footprint "AstraRMM:EPC2367" (layer "F.Cu") (at 1 1) (property "Reference" "Q14") (pad "13" smd rect (at 0 0) (size 1 1) (layers "F.Cu" "F.Mask") (net 1 "/M2_C_SW"))))`
    const mutatedPcb = originalPcb.replace('AstraRMM:EPC2367', 'Package_TO_SOT_SMD:SOT-223')
    await writeFile(path.join(originalDir, 'FN-ESC1.kicad_pcb'), originalPcb, 'utf8')
    await writeFile(path.join(originalDir, 'FN-ESC1.kicad_sch'), '(kicad_sch)', 'utf8')
    await writeFile(path.join(derivativeDir, 'FN-ESC1.kicad_pcb'), mutatedPcb, 'utf8')
    await writeFile(path.join(derivativeDir, 'FN-ESC1.kicad_sch'), '(kicad_sch)', 'utf8')
    const audit = await auditOriginalEscSpec({ derivativeDir, originalDir, restore: true })
    assert.equal(audit.status, 'ORIGINAL_SPEC_RESTORED')
    assert.equal(audit.footprintsChanged[0].ref, 'Q14')
    assert.ok(audit.restorationPerformed.includes('pcb_parts_footprints_pads_nets_outline_mounting_holes'))
    const restored = await readFile(path.join(derivativeDir, 'FN-ESC1.kicad_pcb'), 'utf8')
    assert.match(restored, /AstraRMM:EPC2367/)
    assert.doesNotMatch(restored, /SOT-223/)
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})

test('ESC component binding resolution accepts scanned pads and reviews mechanical holes', () => {
  const report = resolveScannedKiCadPadBindings([
    {
      ref: 'H1',
      group: 'MOUNTING_HOLE',
      footprint: { libId: 'MountingHole:MountingHole_3.2mm', pads: [{ name: '1' }] },
      pinMap: {},
    },
    {
      ref: 'Q14',
      group: 'MOSFET',
      footprint: { libId: 'AstraRMM:EPC2367', pads: [{ name: '13' }, { name: '14' }] },
      pinMap: { 13: '/M2_C_SW', 14: '/VBAT_RAW' },
    },
  ])
  assert.equal(report.errors.length, 0)
  assert.equal(report.status, 'COMPONENT_BINDINGS_VALID_WITH_MECHANICAL_REVIEW')
  assert.equal(report.results.find((item) => item.ref === 'H1').mechanical, true)
})

test('ESC route legalization rejects Edge.Cuts crossings before write', () => {
  const board = { outline: rectanglePoints(10, 10), mountingHoles: [] }
  const routingPlan = {
    routes: [{
      net: 'EDGE_BAD',
      className: 'DEFAULT',
      status: 'routed',
      start: { x: 1, y: 1 },
      end: { x: 9, y: 9 },
      waypoints: [{ x: 1, y: 1 }, { x: 12, y: 1 }, { x: 9, y: 9 }],
      widthMm: 0.15,
      layerPreference: ['F.Cu'],
      viaPlan: { candidates: [], rules: {} },
    }],
    designIntent: { zones: [], copperPours: [] },
  }
  const legal = legalizeTraceRoutingPlan({ board, components: [], routingPlan, profile: getManufacturerProfile('JLCPCB_STANDARD') })
  assert.equal(legal.routes.length, 0)
  assert.equal(legal.legalTrace.blockedRoutes[0].reason, 'ROUTE_POINT_OFF_BOARD')
})

test('ESC via keepout rejection blocks unsafe via candidate', () => {
  const board = { outline: rectanglePoints(20, 20), mountingHoles: [] }
  const routingPlan = {
    routes: [{
      net: 'SIG',
      className: 'DEFAULT',
      status: 'routed',
      start: { x: 2, y: 2 },
      end: { x: 18, y: 2 },
      waypoints: [{ x: 2, y: 2 }, { x: 18, y: 2 }],
      widthMm: 0.15,
      layerPreference: ['F.Cu'],
      viaPlan: { candidates: [{ x: 10, y: 10, diameterMm: 0.45, drillMm: 0.2, layers: ['F.Cu', 'B.Cu'] }], rules: { diameterMm: 0.45, drillMm: 0.2 } },
    }],
    designIntent: { zones: [{ id: 'SENSE_KEEP', allowVias: false, polygon: rectanglePoints(4, 4).map((point) => ({ x: point.x + 8, y: point.y + 8 })) }], copperPours: [] },
  }
  const legal = legalizeTraceRoutingPlan({ board, components: [], routingPlan, profile: getManufacturerProfile('JLCPCB_STANDARD') })
  assert.equal(legal.routes.length, 0)
  assert.equal(legal.legalTrace.blockedRoutes[0].reason, 'VIA_IN_KEEP_OUT')
})

test('ESC via pad clearance rejection blocks vias beside other-net pads', () => {
  const board = { outline: rectanglePoints(20, 20), mountingHoles: [] }
  const routingPlan = {
    routes: [{
      net: '/I2C1_SCL',
      className: 'DEFAULT',
      status: 'routed',
      start: { x: 4, y: 4 },
      end: { x: 15, y: 15 },
      waypoints: [{ x: 4, y: 4 }, { x: 10, y: 10 }, { x: 15, y: 15 }],
      widthMm: 0.15,
      layerPreference: ['In2.Cu'],
      viaPlan: { candidates: [{ x: 10, y: 10, diameterMm: 0.45, drillMm: 0.2, viaType: 'through', layers: ['F.Cu', 'B.Cu'] }] },
    }],
    designIntent: { zones: [], copperPours: [] },
  }
  const pads = [{ id: 'R12:2', ref: 'R12', pad: '2', netName: '/I2C1_SDA', x: 10.08, y: 10.06, widthMm: 0.5, heightMm: 0.5 }]
  const legal = legalizeTraceRoutingPlan({ board, components: [], routingPlan, profile: getManufacturerProfile('JLCPCB_STANDARD'), pads })
  assert.equal(legal.routes.length, 0)
  assert.equal(legal.legalTrace.blockedRoutes[0].errors.includes('VIA_PAD_CLEARANCE'), true)
})

test('pad escape generation finds legal escape outside neighboring pads', () => {
  const board = { outline: rectanglePoints(20, 20), mountingHoles: [] }
  const pad = { id: 'U1:1', ref: 'U1', pad: '1', netName: 'SIG', x: 10, y: 10, widthMm: 0.5, heightMm: 0.5 }
  const pads = [
    pad,
    { id: 'U1:2', ref: 'U1', pad: '2', netName: 'OTHER', x: 10.7, y: 10, widthMm: 0.5, heightMm: 0.5 },
    { id: 'U1:3', ref: 'U1', pad: '3', netName: 'OTHER', x: 10, y: 10.7, widthMm: 0.5, heightMm: 0.5 },
  ]
  const candidates = generatePadEscapeCandidates({ pad, net: { name: 'SIG' }, board, pads, profile: getManufacturerProfile('JLCPCB_STANDARD'), gridMm: 0.25 })
  const escape = findLegalPadEscapePoint({ pad, net: { name: 'SIG' }, board, pads, profile: getManufacturerProfile('JLCPCB_STANDARD'), gridMm: 0.25 })
  assert.ok(candidates.length > 0)
  assert.ok(escape)
  assert.equal(Math.hypot(escape.x - pads[1].x, escape.y - pads[1].y) > 0.5, true)
})

test('legal via-site search rejects other-net pad clearance and finds nearby alternative', () => {
  const board = { outline: rectanglePoints(20, 20), mountingHoles: [] }
  const seed = { ref: 'U1', netName: 'SIG', x: 10, y: 10, diameterMm: 0.45, drillMm: 0.2, viaType: 'through' }
  const pads = [
    { id: 'U2:1', ref: 'U2', pad: '1', netName: 'OTHER', x: 10, y: 10, widthMm: 0.6, heightMm: 0.6 },
  ]
  const via = findNearestLegalThroughViaSite({ seed, net: { name: 'SIG' }, board, pads, profile: getManufacturerProfile('JLCPCB_STANDARD'), gridMm: 0.3 })
  assert.ok(via)
  assert.notEqual(round(via.x), 10)
  assert.equal(via.viaType, 'through')
  assert.deepEqual(via.layers, ['F.Cu', 'B.Cu'])
})

test('ESC DRC-aware route mutations classify pad and via failures', () => {
  const route = {
    net: '/SWDIO',
    className: 'DEFAULT',
    status: 'routed',
    start: { x: 1, y: 1 },
    end: { x: 8, y: 1 },
    waypoints: [{ x: 1, y: 1 }, { x: 8, y: 1 }],
    viaPlan: { candidates: [{ x: 4, y: 1, diameterMm: 0.5, drillMm: 0.25, viaType: 'through', layers: ['F.Cu', 'B.Cu'] }] },
  }
  const failure = classifyRouteDrcFailure({
    route,
    issues: [{ code: 'VIA_PAD_CLEARANCE', details: { via: { x: 4, y: 1 }, pad: 'U1-23', nearestMm: 0.08, requiredMm: 0.2 } }],
  })
  assert.equal(failure.failure, 'VIA_PAD_CLEARANCE')
  assert.equal(failure.nearestPad, 'U1-23')
  const alternatives = generateDrcAwareRouteAlternatives(route, failure, { board: { outline: rectanglePoints(12, 8) } })
  assert.equal(alternatives.some((item) => item.mutation?.type === 'no_via_fallback'), true)
  assert.equal(alternatives.some((item) => item.mutation?.type === 'shift_via_site'), true)
})

test('ESC route without via fallback removes vias when via is blocked', () => {
  const route = {
    net: '/I2C1_SCL',
    className: 'DEFAULT',
    status: 'routed',
    start: { x: 1, y: 1 },
    end: { x: 9, y: 2 },
    waypoints: [{ x: 1, y: 1 }, { x: 9, y: 2 }],
    viaPlan: { candidates: [{ x: 5, y: 1.5, diameterMm: 0.5, drillMm: 0.25, viaType: 'through', layers: ['F.Cu', 'B.Cu'] }] },
  }
  const alternatives = routeWithoutViaWhenViaBlocked(route)
  assert.equal(alternatives.length >= 2, true)
  assert.equal(alternatives.every((item) => item.viaPlan.candidates.length === 0), true)
  assert.equal(alternatives.some((item) => item.layerPreference[0] === 'F.Cu'), true)
  assert.equal(alternatives.some((item) => item.layerPreference[0] === 'B.Cu'), true)
})

test('ESC pad-clearance route mutation can turn a rejected route into an accepted dogleg', () => {
  const board = { outline: rectanglePoints(12, 8), mountingHoles: [] }
  const pads = [{ id: 'U1-1', ref: 'U1', pad: '1', x: 4, y: 1, widthMm: 0.8, heightMm: 0.8, netName: 'OTHER' }]
  const route = {
    net: '/NRST',
    className: 'DEFAULT',
    status: 'routed',
    start: { x: 1, y: 1 },
    end: { x: 8, y: 1 },
    waypoints: [{ x: 1, y: 1 }, { x: 8, y: 1 }],
    widthMm: 0.127,
    layerPreference: ['F.Cu'],
    viaPlan: { candidates: [] },
  }
  const legal = legalizeTraceRoutingPlan({ board, components: [], pads, profile: { minClearanceMm: 0.127 }, routingPlan: { routes: [route], unroutedNets: [] } })
  assert.equal(legal.routes.length, 1)
  assert.match(legal.routes[0].mutation?.type || '', /pad_clearance/)
  assert.equal(legal.legalTrace.blockedRoutes.some((item) => item.status === 'candidate_mutated_and_accepted'), true)
})

test('pad-to-pad connectivity verifier accepts exact pad copper contact', () => {
  const pads = [
    { id: 'U1:1', ref: 'U1', pad: '1', x: 1, y: 1, widthMm: 0.6, heightMm: 0.6, layers: ['F.Cu'], netName: 'SIG' },
    { id: 'J1:1', ref: 'J1', pad: '1', x: 5, y: 1, widthMm: 0.6, heightMm: 0.6, layers: ['F.Cu'], netName: 'SIG' },
  ]
  const result = verifyPadToPadConnectivity({
    net: 'SIG',
    start: pads[0],
    end: pads[1],
    waypoints: [{ x: 1, y: 1 }, { x: 5, y: 1 }],
    layerPreference: ['F.Cu'],
  }, pads)
  assert.equal(result.sourceTouched, true)
  assert.equal(result.targetTouched, true)
  assert.equal(result.continuousCopper, true)
  assert.equal(result.commitAllowed, true)
})

test('pad-to-pad connectivity verifier rejects near-pad copper without contact', () => {
  const pads = [
    { id: 'U1:1', ref: 'U1', pad: '1', x: 1, y: 1, widthMm: 0.4, heightMm: 0.4, layers: ['F.Cu'], netName: 'SIG' },
    { id: 'J1:1', ref: 'J1', pad: '1', x: 5, y: 1, widthMm: 0.4, heightMm: 0.4, layers: ['F.Cu'], netName: 'SIG' },
  ]
  const result = verifyPadToPadConnectivity({
    net: 'SIG',
    start: pads[0],
    end: pads[1],
    waypoints: [{ x: 1.25, y: 1 }, { x: 4.75, y: 1 }],
    layerPreference: ['F.Cu'],
  }, pads)
  assert.equal(result.sourceTouched, false)
  assert.equal(result.targetTouched, false)
  assert.equal(result.commitAllowed, false)
})

test('pad-to-pad connectivity verifier rejects wrong-layer SMD pad contact', () => {
  const pads = [
    { id: 'U1:1', ref: 'U1', pad: '1', x: 1, y: 1, widthMm: 0.6, heightMm: 0.6, layers: ['B.Cu'], throughHole: false, netName: 'SIG' },
    { id: 'J1:1', ref: 'J1', pad: '1', x: 5, y: 1, widthMm: 0.6, heightMm: 0.6, layers: ['B.Cu'], throughHole: false, netName: 'SIG' },
  ]
  const result = verifyPadToPadConnectivity({
    net: 'SIG',
    start: pads[0],
    end: pads[1],
    waypoints: [{ x: 1, y: 1 }, { x: 5, y: 1 }],
    layerPreference: ['F.Cu'],
  }, pads)
  assert.equal(result.sourceTouched, false)
  assert.equal(result.targetTouched, false)
  assert.equal(result.commitAllowed, false)
})

test('pad-to-pad connectivity verifier accepts via located on route path', () => {
  const pads = [
    { id: 'U1:1', ref: 'U1', pad: '1', x: 1, y: 1, widthMm: 0.6, heightMm: 0.6, layers: ['F.Cu'], netName: 'SIG' },
    { id: 'J1:1', ref: 'J1', pad: '1', x: 5, y: 1, widthMm: 0.6, heightMm: 0.6, layers: ['F.Cu'], netName: 'SIG' },
  ]
  const result = verifyPadToPadConnectivity({
    net: 'SIG',
    start: pads[0],
    end: pads[1],
    waypoints: [{ x: 1, y: 1 }, { x: 5, y: 1 }],
    layerPreference: ['In3.Cu'],
    viaPlan: { candidates: [{ x: 3, y: 1, diameterMm: 0.45, drillMm: 0.2 }] },
  }, pads)
  assert.equal(result.continuousCopper, true)
  assert.equal(result.commitAllowed, true)
})

test('pad copper geometry extraction preserves pad extents and layers', () => {
  const geometry = extractPadCopperGeometry({ ref: 'U1', pad: '7', x: 10, y: 5, widthMm: 1.2, heightMm: 0.6, rotation: 90, layers: ['F.Cu'] })
  assert.equal(geometry.ref, 'U1')
  assert.equal(geometry.pad, '7')
  assert.equal(geometry.layers.includes('F.Cu'), true)
  assert.equal(geometry.corners.length, 4)
  assert.ok(geometry.box.maxX > geometry.box.minX)
  assert.ok(geometry.box.maxY > geometry.box.minY)
})

test('pad-edge contact generation returns legal edge points on copper', () => {
  const board = { outline: rectanglePoints(20, 20), mountingHoles: [] }
  const pad = { id: 'U1:1', ref: 'U1', pad: '1', x: 5, y: 5, widthMm: 1, heightMm: 0.5, layers: ['F.Cu'], netName: 'SIG' }
  const contacts = generatePadEdgeContactPoints({ pad, layer: 'F.Cu', board, approachPoint: { x: 9, y: 5 }, pads: [pad], net: { name: 'SIG' } })
  assert.ok(contacts.length >= 4)
  assert.equal(contacts[0].legal, true)
  assert.ok(Math.abs(contacts[0].point.x - 5.5) < 0.01 || Math.abs(contacts[0].point.x - 4.5) < 0.01 || Math.abs(contacts[0].point.y - 5.25) < 0.01 || Math.abs(contacts[0].point.y - 4.75) < 0.01)
})

test('route endpoint snaps to pad copper edge and satisfies verifier', () => {
  const board = { outline: rectanglePoints(20, 20), mountingHoles: [] }
  const pads = [
    { id: 'U1:1', ref: 'U1', pad: '1', x: 5, y: 5, widthMm: 1, heightMm: 0.5, layers: ['F.Cu'], netName: 'SIG' },
    { id: 'J1:1', ref: 'J1', pad: '1', x: 12, y: 5, widthMm: 1, heightMm: 0.5, layers: ['F.Cu'], netName: 'SIG' },
  ]
  const start = snapEndpointToPadCopper({ pad: pads[0], layer: 'F.Cu', board, approachPoint: { x: 8, y: 5 } })
  const end = snapEndpointToPadCopper({ pad: pads[1], layer: 'F.Cu', board, approachPoint: { x: 8, y: 5 } })
  const result = verifyPadToPadConnectivity({
    net: 'SIG',
    start: pads[0],
    end: pads[1],
    waypoints: [start, { x: 8, y: 5 }, end],
    layerPreference: ['F.Cu'],
  }, pads)
  assert.equal(result.sourceTouched, true)
  assert.equal(result.targetTouched, true)
  assert.equal(result.commitAllowed, true)
})

test('pad escape segment starts exactly on pad copper', () => {
  const board = { outline: rectanglePoints(20, 20), mountingHoles: [] }
  const pad = { id: 'U1:1', ref: 'U1', pad: '1', x: 5, y: 5, widthMm: 1, heightMm: 0.5, layers: ['F.Cu'], netName: 'SIG' }
  const segment = buildPadEscapeSegment({ pad, escapePoint: { x: 7, y: 5 }, layer: 'F.Cu', board })
  assert.equal(segment.length, 2)
  assert.equal(verifyPadToPadConnectivity({
    net: 'SIG',
    start: pad,
    end: pad,
    waypoints: [segment[0], segment[1], segment[0]],
    layerPreference: ['F.Cu'],
  }, [pad]).sourceTouched, true)
})

test('autorouter preserves mixed F.Cu to B.Cu SMD endpoint contact layers', () => {
  const board = { outline: rectanglePoints(20, 12), mountingHoles: [], layerCount: 2 }
  const pads = [
    { id: 'R1:1', ref: 'R1', pad: '1', x: 2, y: 6, widthMm: 1, heightMm: 0.5, layers: ['F.Cu'], netName: 'SIG' },
    { id: 'U1:A3', ref: 'U1', pad: 'A3', x: 15, y: 6, widthMm: 0.5, heightMm: 0.5, layers: ['B.Cu'], netName: 'SIG' },
  ]
  const plan = autorouteBoard({ board, pads, nets: [{ name: 'SIG', className: 'DEFAULT' }], profile: getManufacturerProfile('JLCPCB_STANDARD'), options: { gridMm: 0.5 } })
  const route = plan.routes.find((item) => item.net === 'SIG')
  assert.equal(route?.status, 'routed')
  assert.equal(route.endpointContactLayers.source, 'F.Cu')
  assert.equal(route.endpointContactLayers.target, 'B.Cu')
  assert.ok((route.viaPlan?.candidates || []).length >= 1)
  const result = verifyPadToPadConnectivity(route, pads)
  assert.equal(result.sourceTouched, true)
  assert.equal(result.targetTouched, true)
  assert.equal(result.commitAllowed, true)
})

test('ESC autonomous supervisor classifies blockers into internal repair tasks', () => {
  const traceResult = {
    status: 'TRACE_EXISTING_BOARD_BLOCKED_BY_DRC',
    traceReport: {
      routing: {
        unrouted: ['/VREG5'],
        legalTrace: {
          transactionResults: [
            {
              net: '/M2_C_VDD',
              status: 'route_pad_to_pad_connectivity_rejected',
              reason: 'ROUTE_DOES_NOT_PROVE_PAD_TO_PAD_CONNECTIVITY',
              connectivity: {
                sourcePad: 'U8 pad 4',
                targetPad: 'U8 pad 6',
                sourceTouched: true,
                targetTouched: false,
                continuousCopper: true,
              },
            },
            {
              net: '/VREG5',
              status: 'route_drc_worsened_rolled_back',
              sourceRef: 'U3',
              sourcePad: '4',
              targetRef: 'L1',
              targetPad: '2',
              drcRegression: { reason: 'DRC_ERROR_REGRESSION' },
              beforeDrc: { errors: 878, warnings: 433 },
              afterDrc: { errors: 889, warnings: 434 },
            },
          ],
        },
      },
    },
  }
  const classified = classifyEscBlocker({ traceResult, previousCopper: { segments: 15 }, currentCopper: { segments: 15 } })
  assert.equal(classified.status, 'internal_repair_tasks_required')
  assert.ok(classified.blockers.some((blocker) => blocker.code === 'DENSE_ENDPOINT_CONTACT'))
  assert.ok(classified.blockers.some((blocker) => blocker.code === 'GENERATED_ROUTE_DRC_REGRESSION'))
  const task = createInternalRepairTask(classified.blockers[0], { cycleIndex: 0, traceIndex: 0, taskIndex: 0 })
  assert.match(task.type, /^FIX_/)
  assert.ok(task.focusedTests.length >= 1)
})

test('ESC internal repair task executes as resumable supervisor work item', () => {
  const task = createInternalRepairTask({
    code: 'GENERATED_ROUTE_DRC_REGRESSION',
    net: '/VREG5',
    reason: 'DRC_ERROR_REGRESSION',
  }, { cycleIndex: 1, traceIndex: 0, taskIndex: 2 })
  const completed = executeInternalRepairTask(task, { currentCopper: { segments: 15, vias: 0, zones: 0 } })
  assert.equal(completed.status, 'completed')
  assert.equal(completed.traceResumeRequired, true)
  assert.ok(completed.action.includes('DRC') || completed.action.includes('route'))
})

test('ESC supervisor focused tests map avoids vague next-action states', () => {
  const tests = runFocusedTestsForRepair('FIX_DENSE_BCU_SMD_ENDPOINT_CONTACT')
  assert.deepEqual(tests, ['test:routing', 'test:routing-endpoints'])
  const fallback = runFocusedTestsForRepair('UNKNOWN_INTERNAL_TASK')
  assert.deepEqual(fallback, ['test:routing'])
})

test('ESC strict final-state gate rejects premature bounded supervisor result', () => {
  const traceResult = {
    traceReport: {
      finalDrc: { issueCounts: { errors: 879, warnings: 433 } },
      routing: {
        unrouted: ['/NRST', '/SWDIO', '/SWCLK', '/I2C1_SCL', '/I2C1_SDA', '/VREG5', 'VIN', '/M2_B_VDD', '/M2_C_VDD', '/M4_A_VDD', '/M4_C_VDD'],
        legalTrace: {
          transactionResults: [
            {
              net: '/M2_B_VDD',
              status: 'route_pad_to_pad_connectivity_rejected',
              reason: 'ROUTE_DOES_NOT_PROVE_PAD_TO_PAD_CONNECTIVITY',
              connectivity: {
                sourcePad: 'U16 pad 6',
                targetPad: 'U16 pad 4',
                sourceTouched: true,
                targetTouched: false,
                continuousCopper: true,
                floatingGeneratedIslands: 1,
              },
            },
          ],
          blockedRoutes: [],
        },
      },
    },
  }
  const gate = validateEscFinalState({
    traceResult,
    cycles: [{ tasks: [{ type: 'FIX_SAME_FOOTPRINT_PAD_TO_PAD_LOCAL_ROUTE' }] }],
    input: { minimumAttemptedNetsForStrictFinalState: 10 },
  })
  assert.equal(gate.valid, false)
  assert.equal(gate.rejectedPrematureBoundedFinalState, true)
  assert.equal(gate.attemptedNetCount, 1)
})

test('ESC same-footprint pad blockers generate local pad-to-pad repair task', () => {
  const task = createInternalRepairTask({
    code: 'DENSE_ENDPOINT_CONTACT',
    net: '/M2_B_VDD',
    source: 'U16 pad 6',
    target: 'U16 pad 4',
    reason: 'ROUTE_DOES_NOT_PROVE_PAD_TO_PAD_CONNECTIVITY',
    details: {
      sourcePad: 'U16 pad 6',
      targetPad: 'U16 pad 4',
      sourceTouched: true,
      targetTouched: false,
      floatingGeneratedIslands: 1,
    },
  }, { cycleIndex: 0, traceIndex: 0, taskIndex: 0 })
  assert.equal(task.type, 'FIX_SAME_FOOTPRINT_PAD_TO_PAD_LOCAL_ROUTE')
  assert.ok(task.focusedTests.includes('test:routing-endpoints'))
  const executed = executeInternalRepairTask(task, { currentCopper: { segments: 18 } })
  assert.equal(executed.status, 'completed')
  assert.match(executed.action, /same-footprint pad pairs/i)
})

test('ESC same-footprint pad-pair detection classifies local route need', () => {
  const pads = [
    { id: 'U16:6', ref: 'U16', pad: '6', x: 10, y: 10, widthMm: 0.6, heightMm: 0.3, layers: ['B.Cu'], netName: '/M2_B_VDD' },
    { id: 'U16:4', ref: 'U16', pad: '4', x: 12, y: 10, widthMm: 0.6, heightMm: 0.3, layers: ['B.Cu'], netName: '/M2_B_VDD' },
  ]
  const route = { net: '/M2_B_VDD', start: { ref: 'U16', pad: '6', netName: '/M2_B_VDD' }, end: { ref: 'U16', pad: '4', netName: '/M2_B_VDD' }, layerPreference: ['B.Cu'] }
  const pair = detectSameFootprintPadPair(route, pads)
  assert.equal(pair.sameFootprint, true)
  assert.equal(pair.ref, 'U16')
  const need = classifySameFootprintRouteNeed(route, pads)
  assert.equal(need.sameFootprint, true)
  assert.equal(need.alreadyConnected, false)
  assert.equal(need.routeNeeded, true)
})

test('ESC same-footprint local route touches both pads without floating island', () => {
  const board = { outline: rectanglePoints(30, 20), mountingHoles: [] }
  const pads = [
    { id: 'U11:6', ref: 'U11', pad: '6', x: 10, y: 10, widthMm: 0.6, heightMm: 0.3, layers: ['B.Cu'], netName: '/M4_A_VDD' },
    { id: 'U11:4', ref: 'U11', pad: '4', x: 12, y: 10.8, widthMm: 0.6, heightMm: 0.3, layers: ['B.Cu'], netName: '/M4_A_VDD' },
  ]
  const route = {
    net: '/M4_A_VDD',
    start: { ref: 'U11', pad: '6', netName: '/M4_A_VDD' },
    end: { ref: 'U11', pad: '4', netName: '/M4_A_VDD' },
    widthMm: 0.15,
    layerPreference: ['B.Cu'],
    viaPlan: { candidates: [] },
  }
  const local = routeSameFootprintPadPair({ route, pads, board })
  assert.equal(local.sameFootprintLocalRoute.ref, 'U11')
  assert.equal(local.endpointContactLayers.source, 'B.Cu')
  assert.equal(local.endpointContactLayers.target, 'B.Cu')
  const contact = verifySameFootprintPadContact(local, pads)
  assert.equal(contact.sourceTouched, true)
  assert.equal(contact.targetTouched, true)
  assert.equal(contact.commitAllowed, true)
  assert.equal(verifyGeneratedCopperBelongsToNetIsland(local, pads), true)
})

test('ESC same-footprint dogleg candidates preserve pad contact', () => {
  const board = { outline: rectanglePoints(30, 20), mountingHoles: [] }
  const sourcePad = { id: 'U8:4', ref: 'U8', pad: '4', x: 10, y: 8, widthMm: 0.5, heightMm: 0.35, layers: ['F.Cu'], netName: '/M2_C_VDD' }
  const targetPad = { id: 'U8:6', ref: 'U8', pad: '6', x: 11.4, y: 9.4, widthMm: 0.5, heightMm: 0.35, layers: ['F.Cu'], netName: '/M2_C_VDD' }
  const route = { net: '/M2_C_VDD', start: { ref: 'U8', pad: '4' }, end: { ref: 'U8', pad: '6' }, widthMm: 0.15, layerPreference: ['F.Cu'] }
  const candidates = generateLocalPadBridgeCandidates({ route, sourcePad, targetPad, board })
  assert.ok(candidates.length >= 2)
  const dogleg = candidates.find((candidate) => /dogleg|perimeter/.test(candidate.sameFootprintLocalRoute.type))
  assert.ok(dogleg)
  const validation = validateSameFootprintRoute(dogleg, [sourcePad, targetPad])
  assert.equal(validation.sourceTouched, true)
  assert.equal(validation.targetTouched, true)
})

test('ESC same-footprint floating island rejection catches near-pad local route', () => {
  const pads = [
    { id: 'U15:4', ref: 'U15', pad: '4', x: 10, y: 10, widthMm: 0.5, heightMm: 0.3, layers: ['F.Cu'], netName: '/M4_C_VDD' },
    { id: 'U15:6', ref: 'U15', pad: '6', x: 12, y: 10, widthMm: 0.5, heightMm: 0.3, layers: ['F.Cu'], netName: '/M4_C_VDD' },
  ]
  const bad = {
    net: '/M4_C_VDD',
    start: { ref: 'U15', pad: '4' },
    end: { ref: 'U15', pad: '6' },
    waypoints: [{ x: 10.4, y: 10 }, { x: 11.6, y: 10 }],
    layerPreference: ['F.Cu'],
  }
  assert.equal(rejectSameFootprintFloatingIsland(bad, pads), true)
  assert.equal(validateSameFootprintRoute(bad, pads).commitAllowed, false)
})

test('ESC strict final-state gate rejects deeply attempted internal blockers', () => {
  const nets = Array.from({ length: 12 }, (_, index) => `/N${index}`)
  const traceResult = {
    traceReport: {
      finalDrc: { issueCounts: { errors: 12, warnings: 1 } },
      routing: {
        unrouted: nets,
        legalTrace: {
          transactionResults: nets.map((net, index) => index % 2
            ? {
                net,
                status: 'route_drc_worsened_rolled_back',
                drcRegression: { reason: 'DRC_ERROR_REGRESSION', errorDelta: 1, rollback: true },
              }
            : {
                net,
                status: 'route_pad_to_pad_connectivity_rejected',
                reason: 'ROUTE_DOES_NOT_PROVE_PAD_TO_PAD_CONNECTIVITY',
                connectivity: {
                  sourcePad: `U${index} pad 1`,
                  targetPad: `U${index} pad 2`,
                  sourceTouched: true,
                  targetTouched: false,
                  continuousCopper: true,
                  floatingGeneratedIslands: 1,
                },
              }),
          blockedRoutes: [],
        },
      },
    },
  }
  const gate = validateEscFinalState({
    traceResult,
    cycles: [{ tasks: [{ type: 'FIX_DRC_AWARE_ROUTE_MUTATION_AFTER_CONTACT_SUCCESS' }] }],
    input: { minimumAttemptedNetsForStrictFinalState: 10 },
  })
  assert.equal(gate.valid, false)
  assert.equal(gate.finalState, 'esc_existing_footprints_routeable_nets_completed_drc_repair_needed')
  assert.equal(gate.allRouteableNetsAttempted, true)
  assert.equal(gate.blockerProofComplete, true)
  assert.equal(gate.internalBlockerCount > 0, true)
})

test('ESC sequential route clearance keeps first route and blocks colliding later route', () => {
  const board = { outline: rectanglePoints(30, 20), mountingHoles: [] }
  const route = (net, y) => ({
    net,
    className: 'DEFAULT',
    status: 'routed',
    start: { x: 2, y },
    end: { x: 20, y },
    waypoints: [{ x: 2, y }, { x: 20, y }],
    widthMm: 0.2,
    layerPreference: ['F.Cu'],
    viaPlan: { candidates: [], rules: {} },
  })
  const routingPlan = { routes: [route('A', 5), route('B', 5.1)], designIntent: { zones: [], copperPours: [] } }
  const legal = legalizeTraceRoutingPlan({ board, components: [], routingPlan, profile: getManufacturerProfile('JLCPCB_STANDARD') })
  assert.deepEqual(legal.routedNets, ['A'])
  assert.equal(legal.legalTrace.blockedRoutes[0].net, 'B')
  assert.equal(legal.legalTrace.blockedRoutes[0].reason, 'ROUTE_ROUTE_CLEARANCE')
})

test('engineering intelligence jobs persist congestion, escape, power, thermal, assembly, cost, and release gates', async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'boardforge-intelligence-test-'))
  try {
    await executeJob({ id: 'project', type: 'create_kicad_project', allowOverwrite: true, input: { projectName: 'Intelligence Project', templateId: 'ESP32_S3_SENSOR', layerCount: 4 } }, workspace)
    const projectPath = 'intelligence-project'
    const board = {
      widthMm: 44,
      heightMm: 28,
      layerCount: 4,
      outline: rectanglePoints(44, 28),
    }
    const components = [
      { ref: 'U1', group: 'MCU', value: 'ESP32-S3 QFN', x: 20, y: 14, width: 8, height: 8, pinCount: 56, pitchMm: 0.5, pinMap: { USB_DP: 'USB_DP', USB_DN: 'USB_DN', GND: 'GND', VDD: '3V3' } },
      { ref: 'J1', group: 'USB_CONNECTOR', value: 'USB-C', x: 5, y: 14, width: 8, height: 6, rotation: 0, pinMap: { A6: 'USB_DP', A7: 'USB_DN', A1: 'GND', A4: 'VUSB' } },
      { ref: 'U2', group: 'BUCK_REGULATOR', value: '5V buck', x: 33, y: 14, width: 6, height: 5, pinMap: { VIN: 'VIN', VOUT: '5V', GND: 'GND' } },
      { ref: 'C1', group: 'CAPACITOR', value: '0.1uF', x: 16, y: 8, width: 1.6, height: 0.8, pinMap: { '1': '3V3', '2': 'GND' } },
    ]
    const nets = [{ name: 'USB_DP' }, { name: 'USB_DN' }, { name: 'GND' }, { name: '3V3', currentMa: 300 }, { name: '5V', currentMa: 1200 }, { name: 'VIN', currentMa: 1800 }]
    const routingPlan = {
      routes: [
        { net: 'USB_DP', className: 'USB_DIFF', waypoints: [{ x: 5, y: 13 }, { x: 20, y: 13 }], widthMm: 0.15 },
        { net: 'USB_DN', className: 'USB_DIFF', waypoints: [{ x: 5, y: 15 }, { x: 22, y: 16 }], widthMm: 0.15 },
        { net: '5V', className: 'POWER_HIGH_CURRENT', waypoints: [{ x: 33, y: 14 }, { x: 20, y: 14 }], widthMm: 0.2 },
      ],
    }
    const common = { projectPath, board, components, nets, routingPlan }
    const questions = await executeJob({ id: 'questions', type: 'generate_engineering_questions', input: { ...common, prompt: 'compact USB sensor board with buck regulator' } }, workspace)
    assert.ok(['ENGINEERING_QUESTIONS_REQUIRED', 'ENGINEERING_QUESTIONS_COMPLETE'].includes(questions.status))
    const escape = await executeJob({ id: 'escape', type: 'plan_escape_routing', input: common }, workspace)
    assert.ok(['ESCAPE_ROUTING_BLOCKED', 'ESCAPE_ROUTING_NEEDS_REVIEW', 'ESCAPE_ROUTING_READY_NEEDS_REVIEW'].includes(escape.status))
    assert.equal(escape.escapeRouting.denseComponentCount, 1)
    const congestion = await executeJob({ id: 'congestion', type: 'analyze_routing_congestion', input: common }, workspace)
    assert.ok(['ROUTING_CONGESTION_BLOCKED', 'ROUTING_CONGESTION_NEEDS_REVIEW', 'ROUTING_CONGESTION_ACCEPTABLE'].includes(congestion.status))
    assert.equal(typeof congestion.routingCongestion.metrics.maxUtilization, 'number')
    const diff = await executeJob({ id: 'diff', type: 'plan_diff_pair_tuning', input: common }, workspace)
    assert.ok(['DIFF_PAIR_TUNING_BLOCKED', 'DIFF_PAIR_TUNING_NEEDS_REVIEW', 'DIFF_PAIR_TUNING_READY'].includes(diff.status))
    assert.equal(diff.diffPairTuning.pairs.length, 1)
    const power = await executeJob({ id: 'pi', type: 'validate_power_integrity', input: { ...common, powerTree: { rails: nets } } }, workspace)
    assert.ok(['POWER_INTEGRITY_BLOCKED', 'POWER_INTEGRITY_NEEDS_REVIEW', 'POWER_INTEGRITY_READY_NEEDS_DRC'].includes(power.status))
    const thermal = await executeJob({ id: 'thermal', type: 'analyze_thermal_bottlenecks', input: { ...common, powerTree: { rails: nets } } }, workspace)
    assert.ok(['THERMAL_BOTTLENECKS_BLOCKED', 'THERMAL_BOTTLENECKS_NEED_REVIEW', 'THERMAL_BOTTLENECKS_READY'].includes(thermal.status))
    const assembly = await executeJob({ id: 'assembly', type: 'validate_assembly_orientation', input: common }, workspace)
    assert.ok(['ASSEMBLY_ORIENTATION_NEEDS_REVIEW', 'ASSEMBLY_ORIENTATION_READY'].includes(assembly.status))
    const cost = await executeJob({ id: 'cost', type: 'estimate_board_cost', input: common }, workspace)
    assert.ok(['BOARD_COST_NEEDS_HDI_REVIEW', 'BOARD_COST_ESTIMATED_NEEDS_QUOTE'].includes(cost.status))
    const readiness = await executeJob({ id: 'ready', type: 'score_production_readiness', input: common }, workspace)
    assert.ok(['PRODUCTION_READINESS_BLOCKED', 'PRODUCTION_READINESS_READY_FOR_HUMAN_REVIEW'].includes(readiness.status))
    const release = await executeJob({ id: 'release', type: 'build_release_gate_report', input: common }, workspace)
    assert.ok(['RELEASE_GATE_BLOCKED', 'RELEASE_GATE_READY_FOR_FINAL_REVIEW'].includes(release.status))
    const state = JSON.parse(await readFile(path.join(workspace, projectPath, 'boardforge-project.json'), 'utf8'))
    assert.ok(state.routingCongestion)
    assert.ok(state.escapeRouting)
    assert.ok(state.diffPairTuning)
    assert.ok(state.powerIntegrity)
    assert.ok(state.thermalBottlenecks)
    assert.ok(state.assemblyOrientation)
    assert.ok(state.boardCost)
    assert.ok(state.engineeringQuestions)
    assert.ok(state.productionReadiness)
    assert.ok(state.releaseGateReport)
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})

test('production workflow jobs ingest references, synthesize blocks, solve placement, and plan repair/demo pipelines', async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'boardforge-production-workflow-test-'))
  try {
    await executeJob({ id: 'project', type: 'create_kicad_project', allowOverwrite: true, input: { projectName: 'Production Workflow', templateId: 'ESP32_S3_SENSOR', layerCount: 4 } }, workspace)
    const projectPath = 'production-workflow'
    const board = { widthMm: 50, heightMm: 32, layerCount: 4, outline: rectanglePoints(50, 32) }
    const components = [
      { ref: 'J1', group: 'USB_CONNECTOR', value: 'USB-C', width: 8, height: 6, pinMap: { A6: 'USB_DP', A7: 'USB_DN', A1: 'GND' } },
      { ref: 'U1', group: 'MCU', value: 'ESP32-S3', width: 8, height: 8, pinMap: { USB_DP: 'USB_DP', USB_DN: 'USB_DN', GND: 'GND', VDD: '3V3' } },
      { ref: 'U2', group: 'LDO_REGULATOR', value: '3V3 LDO', width: 4, height: 3, pinMap: { IN: '5V', OUT: '3V3', GND: 'GND' } },
      { ref: 'C1', group: 'CAPACITOR', value: '0.1uF', width: 1.6, height: 0.8, pinMap: { '1': '3V3', '2': 'GND' } },
    ]
    const referenceText = 'USB Type-C device with ESD TVS, CC resistors, 3V3 LDO regulator, decoupling capacitors, reset boot pads, 90 ohm USB differential pair, no antenna.'
    const reference = await executeJob({ id: 'ref', type: 'ingest_reference_design', input: { projectPath, referenceText } }, workspace)
    assert.ok(['REFERENCE_DESIGN_INGESTED', 'REFERENCE_DESIGN_NEEDS_REVIEW'].includes(reference.status))
    assert.equal(reference.referenceDesign.interfaces.includes('USB'), true)
    const blocks = await executeJob({ id: 'blocks', type: 'synthesize_circuit_blocks', input: { projectPath, referenceDesign: reference.referenceDesign } }, workspace)
    assert.ok(['CIRCUIT_BLOCKS_READY_NEEDS_REVIEW', 'CIRCUIT_BLOCKS_NEED_REQUIREMENTS'].includes(blocks.status))
    assert.ok(blocks.circuitBlocks.blocks.some((block) => block.id === 'usb_interface'))
    const solved = await executeJob({ id: 'solve', type: 'solve_placement', input: { projectPath, board, components } }, workspace)
    assert.ok(['PLACEMENT_SOLVER_BLOCKED', 'PLACEMENT_SOLVER_NEEDS_REVIEW', 'PLACEMENT_SOLVER_READY_NEEDS_DRC'].includes(solved.status))
    assert.equal(solved.placementSolver.components.length, components.length)
    const repairLoop = await executeJob({
      id: 'repair_loop',
      type: 'plan_autoroute_repair_loop',
      input: { projectPath, drcReport: { issues: [{ code: 'CLEARANCE', message: 'track clearance' }, { code: 'UNCONNECTED_NET', message: 'unconnected' }] } },
    }, workspace)
    assert.equal(repairLoop.autorouteRepairLoop.iterations.length >= 1, true)
    const recipe = await executeJob({ id: 'recipe', type: 'build_verified_demo_recipe', input: { projectPath, preset: 'usb_sensor' } }, workspace)
    assert.equal(recipe.status, 'VERIFIED_DEMO_RECIPE_READY')
    assert.ok(recipe.verifiedDemoRecipe.steps.some((step) => step.type === 'autoroute_drc_iteration'))
    const demo = await executeJob({ id: 'demo', type: 'run_verified_demo', allowOverwrite: true, input: { projectPath: 'verified-demo-usb', preset: 'usb_sensor', continueOnBlocked: true, diagnosticAllowIncompleteSchematic: true } }, workspace)
    assert.ok(['VERIFIED_DEMO_BLOCKED', 'VERIFIED_DEMO_COMPLETE_NEEDS_HUMAN_REVIEW'].includes(demo.status))
    assert.ok(demo.verifiedDemoRun.gates.some((gate) => gate.name === 'schematic_model'))
    assert.ok(demo.verifiedDemoRun.results.some((item) => item.step === 'create_kicad_project'))
    assert.ok(demo.generatedFiles.some((file) => file.endsWith('boardforge-verified-demo-report.json')))
    const pipeline = await executeJob({ id: 'pipeline', type: 'plan_production_pipeline', input: { projectPath, projectName: 'Production Workflow' } }, workspace)
    assert.equal(pipeline.status, 'PRODUCTION_PIPELINE_READY_NEEDS_REVIEW')
    assert.ok(pipeline.productionPipeline.steps.some((step) => step.type === 'build_release_gate_report'))
    const state = JSON.parse(await readFile(path.join(workspace, projectPath, 'boardforge-project.json'), 'utf8'))
    assert.ok(state.referenceDesign)
    assert.ok(state.circuitBlocks)
    assert.ok(state.placementSolver)
    assert.ok(state.autorouteRepairLoop)
    assert.ok(state.verifiedDemoRecipe)
    assert.ok(state.productionPipeline)
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})

test('production readiness suite builds canonical model, audits assets and gates release', async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'boardforge-production-suite-test-'))
  try {
    await executeJob({ id: 'project', type: 'create_kicad_project', allowOverwrite: true, input: { projectName: 'Production Suite', templateId: 'ESP32_S3_SENSOR', layerCount: 4 } }, workspace)
    const projectPath = 'production-suite'
    const board = { widthMm: 54, heightMm: 34, layerCount: 4, outline: rectanglePoints(54, 34) }
    const components = [
      { ref: 'J1', group: 'USB_CONNECTOR', value: 'USB-C', symbol: 'Connector:USB_C_Receptacle_USB2.0', footprint: 'Connector_USB:USB_C_Receptacle', model3d: 'usb.step', x: 4, y: 17, width: 7, height: 6, pinMap: { VBUS: 'VUSB', GND: 'GND', 'D+': 'USB_DP', 'D-': 'USB_DN' } },
      { ref: 'U1', group: 'MCU', value: 'ESP32-S3', symbol: 'RF_Module:ESP32-S3-WROOM-1', footprint: 'RF_Module:ESP32-S3-WROOM-1', model3d: 'esp32.step', x: 27, y: 17, width: 12, height: 14, pinMap: { VDD: '3V3', GND: 'GND', USB_DP: 'USB_DP', USB_DN: 'USB_DN' } },
      { ref: 'U2', group: 'LDO_REGULATOR', value: '3V3 LDO', symbol: 'Regulator_Linear:AP2112K-3.3', footprint: 'Package_TO_SOT_SMD:SOT-23-5', model3d: 'sot23.step', x: 43, y: 17, width: 3, height: 3, pinMap: { IN: 'VUSB', OUT: '3V3', GND: 'GND' } },
    ]
    const canonical = await executeJob({ id: 'canonical', type: 'build_canonical_net_model', input: { projectPath, board, components } }, workspace)
    assert.ok(['CANONICAL_NET_MODEL_READY', 'CANONICAL_NET_MODEL_NEEDS_REVIEW'].includes(canonical.status))
    assert.ok(canonical.canonicalNetModelReport.canonicalNetModel.nets.some((net) => net.name === 'USB_DP'))
    const assets = await executeJob({ id: 'assets', type: 'audit_asset_resolution', input: { projectPath, components } }, workspace)
    assert.equal(assets.status, 'ASSET_RESOLUTION_READY')
    const placement = await executeJob({ id: 'placement', type: 'audit_placement_legality', input: { projectPath, board, components } }, workspace)
    assert.ok(['PLACEMENT_LEGALITY_READY_NEEDS_DRC', 'PLACEMENT_LEGALITY_NEEDS_REVIEW'].includes(placement.status))
    const routing = await executeJob({ id: 'strategy', type: 'compile_routing_execution_strategy', input: { projectPath, board, components, nets: canonical.canonicalNetModelReport.canonicalNetModel.nets } }, workspace)
    assert.equal(routing.status, 'ROUTING_EXECUTION_STRATEGY_READY_NEEDS_REVIEW')
    assert.ok(routing.routingExecutionStrategyReport.routingExecutionStrategy.strategy.some((step) => step.id === 'critical_nets_first'))
    const gates = await executeJob({ id: 'gates', type: 'audit_release_export_gates', input: { projectPath, board, components, schematicModel: {}, designConstraints: {}, stackup: { layerCount: 4 }, referenceDesign: {}, bomSourcing: {}, placementSolver: {}, powerRouting: {}, copperPourPlan: {}, routingPlan: {}, releaseGateReport: {}, verifiedDemoRecipe: {}, productionPipeline: {} } }, workspace)
    assert.ok(['RELEASE_EXPORT_GATES_BLOCKED', 'RELEASE_EXPORT_GATES_NEED_REVIEW', 'RELEASE_EXPORT_GATES_READY_FOR_FINAL_REVIEW'].includes(gates.status))
    assert.equal(gates.releaseExportGateAudit.releaseExportGates.checks.length, 25)
    const suite = await executeJob({ id: 'suite', type: 'run_production_readiness_suite', input: { projectPath, board, components, schematicModel: {}, designConstraints: {}, stackup: { layerCount: 4 }, referenceDesign: {}, bomSourcing: {}, placementSolver: {}, powerRouting: {}, copperPourPlan: {}, routingPlan: {}, releaseGateReport: {}, verifiedDemoRecipe: {}, productionPipeline: {} } }, workspace)
    assert.ok(['PRODUCTION_SUITE_BLOCKED', 'PRODUCTION_SUITE_NEEDS_REVIEW', 'PRODUCTION_SUITE_READY_FOR_FINAL_REVIEW'].includes(suite.status))
    assert.ok(suite.productionReadinessSuite.productionSuite.releaseExportGates.checks.some((check) => check.id === 'JLCPCB_VALIDATOR'))
    const state = JSON.parse(await readFile(path.join(workspace, projectPath, 'boardforge-project.json'), 'utf8'))
    assert.ok(state.canonicalNetModelReport)
    assert.ok(state.productionReadinessSuite)
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})

test('placement legality blocks off-board overlaps and RF hot-zone conflicts', async () => {
  const board = { widthMm: 22, heightMm: 14, layerCount: 4, outline: rectanglePoints(22, 14), mountingHoles: [{ id: 'MH1', x: 3, y: 3, diameterMm: 2.2 }] }
  const components = [
    { ref: 'J1', group: 'USB_CONNECTOR', value: 'USB-C', x: 11, y: 7, width: 8, height: 6, pinMap: { VBUS: '5V', GND: 'GND' } },
    { ref: 'U1', group: 'RF_MODULE', value: 'WiFi BLE module', x: 15, y: 7, width: 9, height: 8, pinMap: { VDD: '3V3', GND: 'GND', ANT: 'RF_FEED' } },
    { ref: 'U2', group: 'BUCK', value: 'switching regulator', x: 16, y: 7, width: 6, height: 5, pinMap: { IN: '5V', OUT: '3V3', GND: 'GND' } },
    { ref: 'C1', group: 'CAP', value: 'decoupling cap', x: 2.5, y: 3, width: 2, height: 1.2, pinMap: { '1': '3V3', '2': 'GND' } },
  ]
  const output = await executeJob({
    id: 'placement_gate_bad',
    type: 'audit_placement_legality',
    input: { board, components, clearanceMm: 0.4 },
  }, process.cwd())
  assert.equal(output.status, 'PLACEMENT_LEGALITY_BLOCKED')
  assert.ok(output.errors.some((issue) => issue.code === 'COMPONENT_OVERLAP'))
  assert.ok(output.errors.some((issue) => issue.code === 'CONNECTOR_NOT_SERVICEABLE_ON_EDGE'))
  assert.ok(output.errors.some((issue) => issue.code === 'HOT_PART_INSIDE_RF_KEEPOUT'))
  assert.ok(output.placementLegalityReport.placementLegality.gates.some((gate) => gate.name === 'rf_hot_keepouts' && gate.status === 'blocked'))
  assert.ok(output.placementLegalityReport.actions.includes('optimize_placement'))
})

test('advanced board suite classifies complex boards and adds HDI return-path creepage bring-up gates', async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'boardforge-advanced-suite-test-'))
  try {
    await executeJob({ id: 'project', type: 'create_kicad_project', allowOverwrite: true, input: { projectName: 'Advanced Suite', templateId: 'ESP32_S3_SENSOR', layerCount: 6 } }, workspace)
    const projectPath = 'advanced-suite'
    const board = { widthMm: 35, heightMm: 22, layerCount: 6, allowBlindVias: true, outline: rectanglePoints(35, 22) }
    const components = [
      { ref: 'J1', group: 'USB_CONNECTOR', value: 'USB-C', x: 3, y: 11, width: 7, height: 6, pinMap: { 'D+': 'USB_DP', 'D-': 'USB_DN', VBUS: '5V', GND: 'GND' } },
      { ref: 'U1', group: 'MCU', value: 'ESP32-S3 WiFi BLE', x: 17, y: 11, width: 12, height: 12, pinMap: { USB_DP: 'USB_DP', USB_DN: 'USB_DN', VDD: '3V3', GND: 'GND', ANT: 'RF_FEED' } },
      { ref: 'U2', group: 'BUCK', value: '5V to 3V3 regulator', x: 29, y: 11, width: 4, height: 4, pinMap: { IN: '5V', OUT: '3V3', GND: 'GND' } },
    ]
    const nets = [{ name: 'USB_DP' }, { name: 'USB_DN' }, { name: 'RF_FEED' }, { name: '5V' }, { name: '3V3' }, { name: 'GND' }]
    const prompt = 'Compact HDI WiFi BLE USB-C sensor with microvias, RF antenna keepout, 60V PoE isolation review and switching regulator.'
    const architecture = await executeJob({ id: 'architecture', type: 'classify_board_architecture', input: { projectPath, prompt, board, components, nets } }, workspace)
    assert.ok(['BOARD_ARCHITECTURE_CLASSIFIED', 'BOARD_ARCHITECTURE_NEEDS_REVIEW'].includes(architecture.status))
    assert.ok(architecture.boardArchitectureReport.boardArchitecture.families.some((family) => family.id === 'rf_wireless'))
    const hdi = await executeJob({ id: 'hdi', type: 'plan_hdi_manufacturing_strategy', input: { projectPath, prompt, board, components, nets, allowBlindVias: true } }, workspace)
    assert.ok(['HDI_MANUFACTURING_STRATEGY_BLOCKED', 'HDI_MANUFACTURING_STRATEGY_NEEDS_REVIEW', 'HDI_MANUFACTURING_STRATEGY_READY'].includes(hdi.status))
    assert.ok(hdi.hdiManufacturingStrategyReport.hdiManufacturingStrategy.allowedViaTypes.includes('blind_review'))
    const returnPath = await executeJob({ id: 'return', type: 'audit_return_path_integrity', input: { projectPath, board, components, nets } }, workspace)
    assert.ok(['RETURN_PATH_INTEGRITY_BLOCKED', 'RETURN_PATH_INTEGRITY_NEEDS_REVIEW', 'RETURN_PATH_INTEGRITY_READY'].includes(returnPath.status))
    assert.ok(returnPath.returnPathIntegrityReport.returnPathIntegrity.returnPathPlan.some((item) => item.net === 'USB_DP'))
    const creepage = await executeJob({ id: 'creepage', type: 'audit_creepage_clearance', input: { projectPath, prompt, board, components, nets, designIntent: { zones: [{ id: 'primary-secondary-isolation', polygon: rectanglePoints(10, 10) }] } } }, workspace)
    assert.ok(['CREEPAGE_CLEARANCE_BLOCKED', 'CREEPAGE_CLEARANCE_NEEDS_REVIEW', 'CREEPAGE_CLEARANCE_READY'].includes(creepage.status))
    const bringup = await executeJob({ id: 'bringup', type: 'plan_bringup_reliability_matrix', input: { projectPath, board, components, nets } }, workspace)
    assert.ok(['BRINGUP_RELIABILITY_MATRIX_NEEDS_REVIEW', 'BRINGUP_RELIABILITY_MATRIX_READY'].includes(bringup.status))
    assert.ok(bringup.bringupReliabilityMatrixReport.bringupReliabilityMatrix.rows.some((row) => row.id === 'thermal_soak'))
    const suite = await executeJob({ id: 'advanced_suite', type: 'run_advanced_board_suite', input: { projectPath, prompt, board, components, nets, designIntent: { zones: [{ id: 'primary-secondary-isolation', polygon: rectanglePoints(10, 10) }] } } }, workspace)
    assert.ok(['ADVANCED_BOARD_SUITE_BLOCKED', 'ADVANCED_BOARD_SUITE_NEEDS_REVIEW', 'ADVANCED_BOARD_SUITE_READY'].includes(suite.status))
    assert.equal(suite.advancedBoardSuite.advancedBoardSuite.majorUpgradeCoverage.length, 25)
    const state = JSON.parse(await readFile(path.join(workspace, projectPath, 'boardforge-project.json'), 'utf8'))
    assert.ok(state.advancedBoardSuite)
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})

test('autotracer blocks broken geometry and plans real routed KiCad copper objects honestly', async () => {
  const board = { widthMm: 60, heightMm: 34, layerCount: 4, outline: rectanglePoints(60, 34), mountingHoles: [{ id: 'H1', x: 5, y: 5, diameterMm: 3 }] }
  const components = [
    { ref: 'J1', group: 'CONNECTOR', value: 'USB-C', x: 7, y: 17, width: 4, height: 4, pinMap: { '1': 'SIG', 'D+': 'USB_DP', 'D-': 'USB_DN', GND: 'GND' } },
    { ref: 'U1', group: 'MCU', value: 'ESP32-S3', x: 48, y: 17, width: 5, height: 5, pinMap: { '1': 'SIG', USB_DP: 'USB_DP', USB_DN: 'USB_DN', GND: 'GND' } },
  ]
  const blocked = await executeJob({
    id: 'autotrace_blocked',
    type: 'autotrace_board',
    dryRun: true,
    input: { board: { widthMm: 20, heightMm: 10, outline: [] }, components, nets: [{ name: 'SIG' }], layerStack: { layerCount: 2 } },
  }, process.cwd())
  assert.equal(blocked.status, 'AUTOTRACE_FAILED')
  assert.ok(blocked.autotraceResult.reportMarkdown.includes('Routing blocked before trace generation'))

  const routed = await executeJob({
    id: 'autotrace_simple',
    type: 'autotrace_board',
    dryRun: true,
    input: { board, components, nets: [{ name: 'SIG' }, { name: 'USB_DP' }, { name: 'USB_DN' }, { name: 'GND' }], layerStack: { layerCount: 4 } },
  }, process.cwd())
  assert.ok(['AUTOTRACE_PLANNED_NEEDS_DRC', 'AUTOTRACE_PARTIAL_NEEDS_REVIEW'].includes(routed.status))
  assert.ok(routed.autotraceResult.createdTracks.length > 0)
  assert.ok(routed.autotraceResult.netClassReport.nets.some((net) => net.name === 'USB_DP' && net.className === 'USB_DIFF'))
  assert.ok(routed.autotraceResult.differentialPairReport.pairs.some((pair) => pair.nets.includes('USB_DP')))
  assert.ok(['ROUTE_REPAIR_PLAN_CLEAN', 'ROUTE_REPAIR_PLAN_REQUIRED'].includes(routed.autotraceResult.routeRepairPlan.status))
  assert.ok(routed.autotraceResult.reportMarkdown.includes('Structured Repair Plan'))

  const traceWidth = await executeJob({
    id: 'trace_width',
    type: 'calculate_trace_width',
    input: { netName: 'VBAT', currentA: 4, manufacturerProfile: 'JLCPCB_STANDARD' },
  }, process.cwd())
  assert.equal(traceWidth.status, 'TRACE_WIDTH_CALCULATED')
  assert.equal(traceWidth.traceWidthCalculation.traceWidth.preferCopperPour, true)

  const via = await executeJob({
    id: 'via_check',
    type: 'validate_via_manufacturability',
    input: { board, vias: [{ x: 10, y: 10, diameterMm: 0.2, drillMm: 0.1, viaType: 'through' }] },
  }, process.cwd())
  assert.equal(via.status, 'VIA_MANUFACTURABILITY_BLOCKED')
})

test('advanced jobs build component database, schematic model, interactive edits, and DRC repair plan', async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'boardforge-advanced-test-'))
  try {
    await executeJob({ id: 'project', type: 'create_kicad_project', allowOverwrite: true, input: { projectName: 'Advanced Project', templateId: 'ESP32_S3_SENSOR' } }, workspace)
    const projectPath = 'advanced-project'
    const db = await executeJob({ id: 'db', type: 'sync_component_database', input: { projectPath } }, workspace)
    assert.ok(['COMPONENT_DATABASE_READY_NEEDS_REVIEW', 'COMPONENT_DATABASE_PARTIAL_NEEDS_REVIEW'].includes(db.status))
    assert.ok(db.components.length >= 4)
    const componentAudit = await executeJob({ id: 'component_audit_project', type: 'audit_component_library', input: { projectPath } }, workspace)
    assert.ok(['COMPONENT_LIBRARY_AUDIT_NEEDS_FIX', 'COMPONENT_LIBRARY_AUDIT_NEEDS_REVIEW', 'COMPONENT_LIBRARY_AUDIT_READY_NEEDS_REVIEW'].includes(componentAudit.status))
    assert.equal(componentAudit.generatedFiles.some((file) => file.endsWith('boardforge-component-audit.json')), true)
    const preflight = await executeJob({ id: 'preflight', type: 'run_project_preflight', input: { projectPath } }, workspace)
    assert.ok(['PROJECT_PREFLIGHT_BLOCKED', 'PROJECT_PREFLIGHT_NEEDS_REVIEW', 'PROJECT_PREFLIGHT_READY_NEEDS_REVIEW'].includes(preflight.status))
    assert.equal(preflight.generatedFiles.some((file) => file.endsWith('boardforge-preflight.json')), true)
    assert.ok(preflight.gates.some((gate) => gate.name === 'component_library'))
    const bindings = await executeJob({ id: 'bindings', type: 'validate_component_bindings', input: { projectPath } }, workspace)
    assert.ok(['COMPONENT_BINDINGS_VALID_NEEDS_REVIEW', 'COMPONENT_BINDINGS_NEED_REVIEW', 'COMPONENT_BINDINGS_NEED_FIX'].includes(bindings.status))
    assert.ok(bindings.checked >= 4)
    const pinRepairs = await executeJob({ id: 'pin_repairs', type: 'plan_pin_map_repairs', input: { projectPath } }, workspace)
    assert.ok(['PIN_MAP_REPAIR_NEEDS_REVIEW', 'PIN_MAP_REPAIR_READY_NEEDS_REVIEW', 'PIN_MAP_REPAIR_NO_ACTIONS'].includes(pinRepairs.status))
    assert.ok(pinRepairs.generatedFiles.some((file) => file.endsWith('boardforge-pin-map-repair-plan.json')))
    const netlist = await executeJob({ id: 'netlist', type: 'generate_netlist', input: { projectPath } }, workspace)
    assert.ok(['NETLIST_GENERATED_NEEDS_REVIEW', 'NETLIST_GENERATED_NEEDS_ERC'].includes(netlist.status))
    assert.ok(netlist.netlist.nets.length > 0)
    const synthesis = await executeJob({ id: 'synth', type: 'synthesize_schematic_design', input: { projectPath } }, workspace)
    assert.ok(['SCHEMATIC_SYNTHESIS_BLOCKED', 'SCHEMATIC_SYNTHESIS_NEEDS_REVIEW', 'SCHEMATIC_SYNTHESIS_READY_NEEDS_ERC'].includes(synthesis.status))
    assert.ok(synthesis.synthesis.components.length >= db.components.length)
    assert.ok(synthesis.synthesis.graph.edges.length > 0)
    assert.ok(synthesis.generatedFiles.some((file) => file.endsWith('boardforge-schematic-synthesis.json')))
    const sync = await executeJob({ id: 'sync', type: 'validate_schematic_pcb_sync', input: { projectPath } }, workspace)
    assert.ok(['SCHEMATIC_PCB_SYNC_BLOCKED', 'SCHEMATIC_PCB_SYNC_NEEDS_REVIEW', 'SCHEMATIC_PCB_SYNC_READY_NEEDS_ERC_DRC'].includes(sync.status))
    assert.ok(sync.generatedFiles.some((file) => file.endsWith('boardforge-schematic-pcb-sync.json')))
    const syncApply = await executeJob({ id: 'sync_apply', type: 'apply_schematic_pcb_sync', input: { projectPath } }, workspace)
    assert.ok(['PCB_NET_SYNC_APPLIED_NEEDS_DRC', 'PCB_NET_SYNC_NO_CHANGES'].includes(syncApply.status))
    assert.equal(typeof syncApply.syncApply.netCount, 'number')
    const modelCoverage = await executeJob({ id: 'models', type: 'validate_3d_model_coverage', input: { projectPath } }, workspace)
    assert.ok(['MODEL_3D_COVERAGE_BLOCKED', 'MODEL_3D_COVERAGE_NEEDS_REVIEW', 'MODEL_3D_COVERAGE_READY'].includes(modelCoverage.status))
    assert.ok(modelCoverage.generatedFiles.some((file) => file.endsWith('boardforge-3d-model-coverage.json')))
    const sourcing = await executeJob({ id: 'sourcing', type: 'audit_bom_sourcing', input: { projectPath } }, workspace)
    assert.ok(['BOM_SOURCING_BLOCKED', 'BOM_SOURCING_NEEDS_REVIEW', 'BOM_SOURCING_READY_NEEDS_STOCK_CHECK'].includes(sourcing.status))
    assert.ok(sourcing.generatedFiles.some((file) => file.endsWith('boardforge-bom-sourcing-audit.json')))
    const audit = await executeJob({ id: 'audit', type: 'run_design_audit', input: { projectPath } }, workspace)
    assert.ok(['DESIGN_AUDIT_NEEDS_FIX', 'DESIGN_AUDIT_NEEDS_REVIEW', 'DESIGN_AUDIT_READY_NEEDS_ERC_DRC'].includes(audit.status))
    assert.ok(audit.audit.netlist.nets.length > 0)
    assert.ok(Array.isArray(audit.audit.actions))
    const readiness = await executeJob({ id: 'readiness', type: 'validate_schematic_readiness', input: { projectPath } }, workspace)
    assert.ok(['SCHEMATIC_READINESS_BLOCKED', 'SCHEMATIC_READINESS_NEEDS_REVIEW', 'SCHEMATIC_READINESS_READY_NEEDS_ERC'].includes(readiness.status))
    assert.ok(readiness.generatedFiles.some((file) => file.endsWith('boardforge-schematic-readiness.json')))
    const gatedSchematic = await executeJob({ id: 'sch_gated', type: 'generate_schematic', input: { projectPath } }, workspace)
    assert.ok(['SCHEMATIC_GENERATION_BLOCKED_BY_READINESS', 'SCHEMATIC_MODEL_READY_NEEDS_ERC', 'SCHEMATIC_MODEL_NEEDS_ASSET_REVIEW'].includes(gatedSchematic.status))
    const schematic = await executeJob({ id: 'sch', type: 'generate_schematic', input: { projectPath, allowIncompleteSchematic: true } }, workspace)
    assert.ok(['SCHEMATIC_MODEL_READY_NEEDS_ERC', 'SCHEMATIC_MODEL_NEEDS_ASSET_REVIEW'].includes(schematic.status))
    assert.ok(schematic.schematicModel.symbols.length >= 4)
    assert.equal(schematic.schematicModel.schemaVersion, 2)
    assert.ok(schematic.schematicModel.summary.powerRails.includes('GND'))
    assert.ok(schematic.schematicModel.differentialPairs.some((pair) => pair.positive === 'USB_DP' && pair.negative === 'USB_DN'))
    assert.ok(schematic.schematicModel.readinessGates.some((gate) => gate.name === 'erc_required' && gate.status === 'blocked'))
    assert.ok(schematic.schematicModel.symbols.some((symbol) => symbol.role === 'support_component' && symbol.footprint))
    const schText = await readFile(path.join(workspace, projectPath, 'advanced-project.kicad_sch'), 'utf8')
    assert.match(schText, /BoardForge schematic model/)
    assert.match(schText, /Power rails:/)
    assert.match(schText, /Differential pairs: USB_DP\/USB_DN/)
    assert.match(schText, /BoardForge_AssetConfidence/)
    assert.match(schText, /\(symbol\s+/)
    assert.match(schText, /BoardForge:BF_CONN_/)
    assert.doesNotMatch(schText, /wire_dangling/)
    const edit = await executeJob({ id: 'edit', type: 'interactive_edit', input: { projectPath, prompt: 'make the board 10mm wider and round the corners' } }, workspace)
    assert.equal(edit.status, 'INTERACTIVE_EDITS_APPLIED_NEEDS_REVIEW')
    assert.ok(edit.edits.length >= 2)
    const copper = await executeJob({ id: 'copper', type: 'plan_copper_pours', input: { projectPath, nets: [{ name: 'GND' }, { name: '3V3' }], maxStitchingVias: 12 } }, workspace)
    assert.ok(['COPPER_POUR_PLAN_READY_NEEDS_DRC', 'COPPER_POUR_PLAN_NEEDS_REVIEW'].includes(copper.status))
    assert.ok(copper.copperPourPlan.pours.length >= 1)
    assert.ok(copper.generatedFiles.some((file) => file.endsWith('boardforge-copper-pour-plan.json')))
    await executeJob({ id: 'drc', type: 'run_kicad_drc', input: { projectPath } }, workspace)
    const repair = await executeJob({ id: 'repair', type: 'plan_drc_repairs', input: { projectPath } }, workspace)
    assert.ok(['DRC_REPAIR_PLAN_READY_NEEDS_REVIEW', 'DRC_REPAIR_NO_ACTIONS_FOUND'].includes(repair.status))
    const state = JSON.parse(await readFile(path.join(workspace, projectPath, 'boardforge-project.json'), 'utf8'))
    assert.ok(state.componentDatabase)
    assert.ok(state.componentAudit)
    assert.ok(state.preflight)
    assert.ok(state.componentBindings)
    assert.ok(state.pinMapRepairPlan)
    assert.ok(state.netlist)
    assert.ok(state.schematicSynthesis)
    assert.ok(state.schematicPcbSync)
    assert.ok(state.schematicPcbSyncApply)
    assert.ok(state.model3dCoverage)
    assert.ok(state.bomSourcing)
    assert.ok(state.designAudit)
    assert.ok(state.schematic)
    assert.ok(state.interactiveEdits.length > 0)
    assert.ok(state.copperPourPlan)
    assert.ok(state.drcRepair)
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})

test('routing infers endpoints from component pin maps and assigns PCB pad nets', async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'boardforge-net-sync-test-'))
  try {
    await executeJob({ id: 'project', type: 'create_kicad_project', allowOverwrite: true, input: { projectName: 'Net Sync Project', templateId: 'ESP32_S3_SENSOR' } }, workspace)
    const components = [
      { ref: 'J1', group: 'USB', x: 6, y: 16, width: 9, height: 7, pinMap: { 'A6': 'USB_DP', 'A7': 'USB_DN', 'B6': 'USB_DP', 'B7': 'USB_DN', A1: 'GND', B1: 'GND' } },
      { ref: 'U1', group: 'ESP32_S3', x: 29, y: 16, width: 18, height: 14, pinMap: { USB_DP: 'USB_DP', USB_DN: 'USB_DN', GND: 'GND' } },
    ]
    const applied = await executeJob({
      id: 'net_sync_routes',
      type: 'apply_routing_plan',
      input: {
        projectPath: 'net-sync-project',
        board: { widthMm: 58, heightMm: 32, layerCount: 4, outline: rectanglePoints(58, 32) },
        components,
        nets: [{ name: 'USB_DP' }, { name: 'USB_DN' }, { name: 'GND' }],
      },
    }, workspace)
    assert.equal(applied.status, 'COPPER_APPLIED_NEEDS_DRC')
    assert.ok(applied.routes.some((route) => route.net === 'USB_DP'))
    const pcb = await readFile(path.join(workspace, 'net-sync-project', 'net-sync-project.kicad_pcb'), 'utf8')
    assert.match(pcb, /\(net \d+ "USB_DP"\)/)
    assert.match(pcb, /\(pad "A6"[\s\S]*?\(net \d+ "USB_DP"\)[\s\S]*?\n\t\)/)
    assert.match(pcb, /\(segment .*"?.*\(net \d+\)/s)
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})

test('create_outline_board writes real KiCad files and review JSON only', async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'boardforge-test-'))
  try {
    const job = {
      id: 'test_outline',
      type: 'create_outline_board',
      allowOverwrite: false,
      input: { projectName: 'Test Outline', templateId: 'ESP32_S3_SENSOR' },
    }
    const result = await executeJob(job, workspace)
    assert.equal(result.status, 'OUTLINE_GENERATED_NEEDS_REVIEW')
    assert.equal(result.generatedFiles.length, 6)
    assert.equal(result.generatedFiles.some((file) => file.endsWith('boardforge-outline-plan.json')), true)
    const pcb = await readFile(path.join(result.projectPath, 'test-outline.kicad_pcb'), 'utf8')
    assert.match(pcb, /Edge\.Cuts/)
    assert.match(pcb, /BoardForge outline-only/)
    const state = JSON.parse(await readFile(path.join(result.projectPath, 'boardforge-project.json'), 'utf8'))
    assert.equal(state.mode, 'outline_only')
    assert.equal(state.board.outline.length > 2, true)
    assert.equal(result.generatedFiles.some((file) => file.endsWith('gerbers.zip')), false)
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})

test('create_kicad_project writes a KiCad schematic scaffold', async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'boardforge-project-test-'))
  try {
    const result = await executeJob({ id: 'project', type: 'create_kicad_project', input: { projectName: 'Sensor Project', templateId: 'ESP32_S3_SENSOR' } }, workspace)
    assert.equal(result.status, 'KICAD_PROJECT_CREATED_NEEDS_REVIEW')
    assert.equal(result.generatedFiles.some((file) => file.endsWith('.kicad_sch')), true)
    assert.equal(result.generatedFiles.some((file) => file.endsWith('boardforge-power-tree.json')), true)
    assert.equal(result.generatedFiles.some((file) => file.endsWith('boardforge-stackup-plan.json')), true)
    assert.equal(result.generatedFiles.some((file) => file.endsWith('boardforge-fanout-plan.json')), true)
    assert.equal(result.generatedFiles.some((file) => file.endsWith('boardforge-dfm-report.json')), true)
    assert.equal(result.generatedFiles.some((file) => file.endsWith('boardforge-assembly-plan.json')), true)
    assert.equal(result.generatedFiles.some((file) => file.endsWith('boardforge-constraints.json')), true)
    assert.equal(result.generatedFiles.some((file) => file.endsWith('boardforge.kicad_dru')), true)
    const schematic = await readFile(path.join(result.projectPath, 'sensor-project.kicad_sch'), 'utf8')
    assert.match(schematic, /kicad_sch/)
    assert.match(schematic, /BoardForge component manifest/)
    const pcb = await readFile(path.join(result.projectPath, 'sensor-project.kicad_pcb'), 'utf8')
    assert.match(pcb, /footprint/)
    assert.match(pcb, /USB-C/)
    const state = JSON.parse(await readFile(path.join(result.projectPath, 'boardforge-project.json'), 'utf8'))
    assert.equal(state.mode, 'full_project_scaffold')
    assert.ok(state.stackup.layerCount >= 2)
    assert.ok(state.powerTree.rails.some((rail) => rail.name === '3V3'))
    assert.ok(state.fanoutPlan.denseComponents.length >= 1)
    assert.ok(state.dfmReport.status.startsWith('DFM_CHECKS_'))
    assert.ok(state.assemblyPlan.sidePlan.length >= 4)
    assert.equal(state.designConstraints.status, 'CONSTRAINTS_READY_NEEDS_REVIEW')
    assert.ok(state.components.length >= 4)
    assert.equal(result.projectState.components.count >= 4, true)
    const scan = await executeJob({ id: 'scan', type: 'scan_kicad_project', input: { projectPath: 'sensor-project' } }, workspace)
    assert.equal(scan.status, 'SCAN_COMPLETE_NEEDS_REVIEW')
    assert.ok(scan.scan.footprints.length >= 4)
    const preflight = await executeJob({ id: 'project_preflight_manifest', type: 'run_project_preflight', input: { projectPath: 'sensor-project' } }, workspace)
    assert.ok(['PROJECT_PREFLIGHT_BLOCKED', 'PROJECT_PREFLIGHT_NEEDS_REVIEW', 'PROJECT_PREFLIGHT_READY_NEEDS_REVIEW'].includes(preflight.status))
    const manifest = await executeJob({ id: 'manifest', type: 'generate_manufacturing_manifest', input: { projectPath: 'sensor-project' } }, workspace)
    assert.ok(['MANUFACTURING_MANIFEST_BLOCKED', 'MANUFACTURING_MANIFEST_NEEDS_REVIEW', 'MANUFACTURING_MANIFEST_READY_NEEDS_REVIEW'].includes(manifest.status))
    assert.equal(manifest.generatedFiles.some((file) => file.endsWith('boardforge-manufacturing-manifest.json')), true)
    assert.ok(manifest.manifest.files.some((file) => file.label === 'KiCad PCB' && file.exists))
    const constraints = await executeJob({ id: 'constraints', type: 'generate_design_constraints', input: { projectPath: 'sensor-project' } }, workspace)
    assert.equal(constraints.status, 'CONSTRAINTS_READY_NEEDS_REVIEW')
    assert.equal(constraints.generatedFiles.some((file) => file.endsWith('boardforge-constraints.json')), true)
    const rules = await executeJob({ id: 'rules', type: 'generate_kicad_rules', input: { projectPath: 'sensor-project', includeText: true } }, workspace)
    assert.equal(rules.status, 'KICAD_RULES_READY_NEEDS_REVIEW')
    assert.equal(rules.generatedFiles.some((file) => file.endsWith('boardforge.kicad_dru')), true)
    assert.match(rules.rulesText, /track_width|trace width/)
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})

test('apply_placement_plan writes optimized footprint coordinates into KiCad PCB', async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'boardforge-placement-apply-test-'))
  try {
    await executeJob({ id: 'project', type: 'create_kicad_project', allowOverwrite: true, input: { projectName: 'Placement Apply Project', templateId: 'ESP32_S3_SENSOR' } }, workspace)
    const moved = await executeJob({
      id: 'move_u1',
      type: 'move_component',
      input: { projectPath: 'placement-apply-project', ref: 'U1', x: 20, y: 15, rotation: 45, optimize: false },
    }, workspace)
    assert.equal(moved.status, 'PLACEMENT_APPLIED_NEEDS_DRC')
    assert.ok(moved.updatedRefs.includes('U1'))
    const pcb = await readFile(path.join(workspace, 'placement-apply-project', 'placement-apply-project.kicad_pcb'), 'utf8')
    assert.match(pcb, /\(property\s+"Reference"\s+"U1"/)
    assert.match(pcb, /\(at\s+20\s+15\s+45\)/)
    const state = JSON.parse(await readFile(path.join(workspace, 'placement-apply-project', 'boardforge-project.json'), 'utf8'))
    assert.equal(state.placement.status, 'PLACEMENT_APPLIED_NEEDS_DRC')
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})

test('create_kicad_project can use requirements planner output', async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'boardforge-planned-project-test-'))
  try {
    const result = await executeJob({
      id: 'planned_project',
      type: 'create_kicad_project',
      input: {
        projectName: 'Planned PoE Sensor',
        templateId: 'ESP32_S3_POE_SENSOR',
        prompt: 'ESP32-S3 PoE Ethernet sensor with USB-C debug, I2C sensor header, SWD, 3V3 regulator',
        interfaces: ['USB', 'Ethernet', 'I2C'],
      },
    }, workspace)
    assert.equal(result.status, 'KICAD_PROJECT_CREATED_NEEDS_REVIEW')
    assert.ok(result.requirementsPlan.selectedCircuits.includes('poe_ethernet'))
    assert.ok(result.generatedFiles.some((file) => file.endsWith('boardforge-requirements-plan.json')))
    assert.ok(result.generatedFiles.some((file) => file.endsWith('boardforge-netlist.json')))
    assert.ok(result.generatedFiles.some((file) => file.endsWith('boardforge-schematic-model.json')))
    const synthesis = await executeJob({ id: 'planned_synthesis', type: 'synthesize_schematic_design', input: { projectPath: 'planned-poe-sensor' } }, workspace)
    assert.ok(['SCHEMATIC_SYNTHESIS_BLOCKED', 'SCHEMATIC_SYNTHESIS_NEEDS_REVIEW', 'SCHEMATIC_SYNTHESIS_READY_NEEDS_ERC'].includes(synthesis.status))
    assert.ok(synthesis.synthesis.supportComponents.length > 0)
    const planText = await readFile(path.join(result.projectPath, 'boardforge-requirements-plan.json'), 'utf8')
    assert.match(planText, /poe_ethernet/)
    const netlist = JSON.parse(await readFile(path.join(result.projectPath, 'boardforge-netlist.json'), 'utf8'))
    assert.ok(netlist.nets.some((net) => net.name === 'ETH_TX_P'))
    const schematicModel = JSON.parse(await readFile(path.join(result.projectPath, 'boardforge-schematic-model.json'), 'utf8'))
    assert.ok(schematicModel.nets.some((net) => net.name === 'ETH_TX_P'))
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})

test('library adapter indexes installed KiCad 10 footprints and resolves component assets', async (context) => {
  const roots = detectKiCadLibraryRoots({ kicadMajorVersion: 10 })
  if (!roots.footprints || !roots.symbols) {
    context.skip('KiCad symbol/footprint libraries are not installed on this machine')
    return
  }
  const workspace = await mkdtemp(path.join(tmpdir(), 'boardforge-library-test-'))
  try {
    const sync = await executeJob({
      id: 'library_sync',
      type: 'sync_kicad_libraries',
      input: { kicadMajorVersion: 10, include3dModels: true, maxAssets: 25000 },
    }, workspace)
    assert.equal(sync.status, 'LIBRARY_SYNCED_NEEDS_REVIEW')
    assert.ok(sync.counts.footprints > 100)
    assert.ok(sync.counts.symbols > 100)
    const search = await executeJob({ id: 'library_search', type: 'search_library_assets', input: { query: 'USB C receptacle', limit: 8 } }, workspace)
    assert.equal(search.status, 'LIBRARY_SEARCH_COMPLETE_NEEDS_REVIEW')
    assert.ok(search.footprints.length > 0)
    const resolved = await executeJob({
      id: 'resolve_assets',
      type: 'resolve_component_assets',
      input: {
        components: [
          { ref: 'J1', group: 'USB', value: 'USB-C receptacle' },
          { ref: 'R1', group: 'RES', value: '10k 0603 resistor' },
        ],
      },
    }, workspace)
    assert.ok(['COMPONENT_ASSETS_RESOLVED_NEEDS_REVIEW', 'COMPONENT_ASSETS_NEED_REVIEW'].includes(resolved.status))
    assert.equal(resolved.components.length, 2)
    assert.ok(resolved.components[0].footprint)
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})

test('package_jlcpcb blocks when required export files are missing', async () => {
  const result = await executeJob({ id: 'pkg', type: 'package_jlcpcb', input: {} }, process.cwd())
  assert.ok(['BLOCKED_MISSING_ADAPTER', 'NEEDS_FIX', 'PACKAGE_BLOCKED_MISSING_FILES', 'PACKAGE_BLOCKED_JLCPCB_VALIDATION'].includes(result.status))
  assert.deepEqual(result.generatedFiles, [])
})

test('JLCPCB validator blocks BOM and CPL reference mismatches', async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'boardforge-jlcpcb-mismatch-'))
  try {
    await mkdir(path.join(workspace, 'fab'), { recursive: true })
    await writeFile(path.join(workspace, 'boardforge-components.json'), JSON.stringify([
      { ref: 'U1', group: 'MCU', footprint: 'Package_DFN_QFN:QFN-32', model3d: '${KICAD10_3DMODEL_DIR}/Package.step', x: 10, y: 10 },
      { ref: 'J1', group: 'USB', footprint: 'Connector_USB:USB_C_Receptacle_HRO_TYPE-C-31-M-12', model3d: '${KICAD10_3DMODEL_DIR}/USB.step', x: 2, y: 10 },
    ]), 'utf8')
    await writeFile(path.join(workspace, 'fab', 'bom.csv'), 'Refs,Value,Footprint,LCSC\nU1,MCU,QFN,C123\nJ2,Extra,USB,C456\n', 'utf8')
    await writeFile(path.join(workspace, 'fab', 'cpl.csv'), 'Ref,Val,Package,PosX,PosY,Rot,Side\nU1,MCU,QFN,10,10,0,top\nJ1,USB,USB-C,2,10,0,top\n', 'utf8')
    const result = await validateJlcpcbPackage(workspace, { write: false })
    assert.equal(result.status, 'JLCPCB_PACKAGE_BLOCKED')
    assert.ok(result.errors.some((issue) => issue.code === 'ASSEMBLY_REFS_MISSING_FROM_BOM'))
    assert.ok(result.errors.some((issue) => issue.code === 'BOM_REFS_MISSING_FROM_CPL'))
    assert.ok(result.errors.some((issue) => issue.code === 'CPL_REFS_MISSING_FROM_BOM'))
    assert.ok(result.assembly.readinessScore < 100)
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})

test('KiCad CLI adapter runs DRC and exports board files when KiCad is installed', async (context) => {
  const detected = await detectKiCadCli()
  if (!detected.available) {
    context.skip('kicad-cli is not installed on this machine')
    return
  }
  const workspace = await mkdtemp(path.join(tmpdir(), 'boardforge-kicad-test-'))
  try {
    await executeJob({ id: 'project', type: 'create_kicad_project', input: { projectName: 'Adapter Project', templateId: 'ESP32_S3_SENSOR' } }, workspace)
    const input = { projectPath: 'adapter-project' }
    const drc = await executeJob({ id: 'drc', type: 'run_kicad_drc', input }, workspace)
    assert.ok(['DRC_PASSED', 'DRC_PASSED_WITH_WARNINGS', 'DRC_NEEDS_FIX'].includes(drc.status))
    assert.equal(typeof drc.report.issueCounts.errors, 'number')
    assert.equal(drc.status === 'DRC_NEEDS_FIX', drc.report.issueCounts.errors > 0)
    const erc = await executeJob({ id: 'erc', type: 'run_kicad_erc', input }, workspace)
    assert.equal(erc.status, 'ERC_PASSED')
    const blockedGerbers = await executeJob({ id: 'blocked_gerbers', type: 'export_gerbers', input }, workspace)
    assert.equal(blockedGerbers.status, 'GERBERS_BLOCKED_VALIDATION_REQUIRED')
    const readiness = await executeJob({ id: 'readiness', type: 'validate_manufacturing_readiness', input }, workspace)
    assert.equal(readiness.status, 'MANUFACTURING_READINESS_BLOCKED')
    assert.ok(readiness.errors.some((issue) => ['DRC_ERRORS', 'BOM_MISSING', 'CPL_MISSING'].includes(issue.code)))
    assert.ok(readiness.readiness.releaseProof.gates.some((gate) => gate.name === 'bom_export' && gate.status === 'blocked'))
    assert.equal(typeof readiness.readiness.releaseProof.score, 'number')
    assert.ok(readiness.readiness.releaseProof.nextActions.includes('export_bom'))
    const gerbers = await executeJob({ id: 'gerbers', type: 'export_gerbers', input: { ...input, allowUnvalidatedExport: true } }, workspace)
    assert.equal(gerbers.status, 'GERBERS_EXPORTED')
    assert.ok(gerbers.generatedFiles.length > 0)
    const bom = await executeJob({ id: 'bom', type: 'export_bom', input: { ...input, allowUnvalidatedExport: true } }, workspace)
    assert.equal(bom.status, 'BOM_EXPORTED_FROM_PLACEMENT_NEEDS_REVIEW')
    const bomCsv = await readFile(path.join(workspace, 'adapter-project', 'fab', 'bom.csv'), 'utf8')
    assert.match(bomCsv, /BoardForge schematic model/)
    assert.match(bomCsv, /USB-C/)
    const drill = await executeJob({ id: 'drill', type: 'export_drill_files', input: { ...input, allowUnvalidatedExport: true } }, workspace)
    assert.equal(drill.status, 'DRILL_EXPORTED')
    const cpl = await executeJob({ id: 'cpl', type: 'export_cpl', input: { ...input, allowUnvalidatedExport: true } }, workspace)
    assert.equal(cpl.status, 'CPL_EXPORTED')
    const jlcpcbValidation = await executeJob({ id: 'jlcpcb_validation', type: 'validate_jlcpcb_package', input }, workspace)
    assert.ok(['JLCPCB_PACKAGE_BLOCKED', 'JLCPCB_PACKAGE_NEEDS_REVIEW', 'JLCPCB_PACKAGE_READY_NEEDS_FINAL_HUMAN_REVIEW'].includes(jlcpcbValidation.status))
    assert.equal(typeof jlcpcbValidation.packageValidation.readiness.releaseProof.exportPolicy.jlcpcb, 'boolean')
    assert.ok(jlcpcbValidation.generatedFiles.some((file) => file.endsWith('boardforge-jlcpcb-package-validation.json')))
    const pkg = await executeJob({ id: 'pkg', type: 'package_jlcpcb', input }, workspace)
    assert.ok(['PACKAGE_BLOCKED_DRC_ERRORS', 'PACKAGE_BLOCKED_MISSING_FILES', 'PACKAGE_BLOCKED_JLCPCB_VALIDATION'].includes(pkg.status))
    if (pkg.status === 'PACKAGE_BLOCKED_JLCPCB_VALIDATION') assert.ok(pkg.generatedFiles.some((file) => file.endsWith('boardforge-jlcpcb-package-validation.json')))
    else assert.deepEqual(pkg.generatedFiles, [])
    const state = JSON.parse(await readFile(path.join(workspace, 'adapter-project', 'boardforge-project.json'), 'utf8'))
    assert.ok(['DRC_PASSED', 'DRC_PASSED_WITH_WARNINGS', 'DRC_NEEDS_FIX'].includes(state.validation.drc.status))
    assert.equal(state.validation.erc.status, 'ERC_PASSED')
    assert.equal(state.exports.gerbers.status, 'GERBERS_EXPORTED')
    assert.equal(state.exports.drill.status, 'DRILL_EXPORTED')
    assert.equal(state.exports.bom.status, 'BOM_EXPORTED_FROM_PLACEMENT_NEEDS_REVIEW')
    assert.equal(state.exports.cpl.status, 'CPL_EXPORTED')
    assert.ok(['PACKAGE_BLOCKED_DRC_ERRORS', 'PACKAGE_BLOCKED_MISSING_FILES', 'PACKAGE_BLOCKED_JLCPCB_VALIDATION'].includes(state.exports.jlcpcb.status))
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})

test('universal board engine classifies complexity and recommends adaptive stackups', async () => {
  const simple = await executeJob({
    id: 'simple_led_complexity',
    type: 'classify_board_complexity',
    input: {
      projectName: 'Simple LED board',
      prompt: 'cheap two layer LED board with one MOSFET output and screw terminal',
      widthMm: 80,
      heightMm: 35,
      components: [
        { ref: 'J1', group: 'POWER_INPUT' },
        { ref: 'Q1', group: 'MOSFET' },
        { ref: 'J2', group: 'LED_OUTPUT' },
      ],
      nets: [{ name: 'VIN' }, { name: 'LED_CH1' }, { name: 'GND' }],
    },
  }, process.cwd())
  assert.equal(simple.complexityClassification.level, 'simple')

  const advanced = await executeJob({
    id: 'compute_carrier_complexity',
    type: 'classify_board_complexity',
    input: {
      projectName: 'Compute Carrier',
      prompt: 'dense compute module carrier with MIPI CSI, PCIe, Ethernet, USB-C, power sequencing and DDR review',
      widthMm: 65,
      heightMm: 45,
      layerCount: 4,
      components: Array.from({ length: 36 }, (_, index) => ({ ref: `U${index + 1}`, group: index === 0 ? 'MODULE_CONNECTOR' : 'DEFAULT' })),
      nets: [{ name: 'PCIE_TX_P' }, { name: 'PCIE_TX_N' }, { name: 'MIPI_D0_P' }, { name: 'MIPI_D0_N' }, { name: 'USB_DP' }, { name: 'USB_DN' }],
    },
  }, process.cwd())
  assert.equal(advanced.complexityClassification.level, 'advanced_review_required')

  const stackup = await executeJob({
    id: 'compute_carrier_stackup',
    type: 'recommend_adaptive_stackup',
    input: {
      projectName: 'Compute Carrier',
      prompt: 'dense compute module carrier with MIPI CSI, PCIe, Ethernet, USB-C, power sequencing and DDR review',
      widthMm: 65,
      heightMm: 45,
      components: Array.from({ length: 36 }, (_, index) => ({ ref: `U${index + 1}`, group: index === 0 ? 'MODULE_CONNECTOR' : 'DEFAULT' })),
      nets: [{ name: 'PCIE_TX_P' }, { name: 'MIPI_D0_P' }, { name: 'USB_DP' }],
    },
  }, process.cwd())
  assert.ok(stackup.adaptiveStackup.recommendation.layerCount >= 8)
  assert.equal(stackup.adaptiveStackup.complexity.level, 'advanced_review_required')
})

test('universal board engine blocks conflicting tiny high-current constraints before routing', async () => {
  const common = {
    projectName: 'Tiny Motor Controller',
    prompt: 'make it tiny 30mm x 20mm two layer high current BLDC motor controller with phase outputs and MOSFETs',
    widthMm: 30,
    heightMm: 20,
    layerCount: 2,
    components: Array.from({ length: 22 }, (_, index) => ({ ref: `P${index + 1}`, group: index < 6 ? 'MOSFET' : 'DEFAULT' })),
    nets: [{ name: 'VBAT' }, { name: 'PHASE_A' }, { name: 'PHASE_B' }, { name: 'PHASE_C' }, { name: 'GND' }],
  }
  const conflicts = await executeJob({ id: 'tiny_motor_conflicts', type: 'detect_constraint_conflicts', input: common }, process.cwd())
  assert.equal(conflicts.constraintConflicts.status, 'CONSTRAINT_CONFLICTS_BLOCKED')
  assert.ok(conflicts.constraintConflicts.conflicts.some((item) => item.code === 'HIGH_CURRENT_BOARD_TOO_SMALL'))

  const routability = await executeJob({ id: 'tiny_motor_routability', type: 'score_routability', input: common }, process.cwd())
  assert.equal(routability.routability.status, 'ROUTABILITY_REGENERATE_REQUIRED')
  assert.ok(['regenerate_or_change_constraints', 'regenerate_placement'].includes(routability.routability.decision))
})

test('universal scenarios and anti-template audit prevent category boards from being identical coupons', async () => {
  const scenarios = await executeJob({ id: 'scenario_list', type: 'list_universal_board_scenarios', input: {} }, process.cwd())
  assert.ok(scenarios.scenarios.length >= 16)
  assert.ok(scenarios.scenarios.some((item) => item.id === 'motor_controller'))
  assert.ok(scenarios.scenarios.some((item) => item.id === 'l_shaped_pcb'))

  const audit = await executeJob({
    id: 'anti_template_ok',
    type: 'detect_template_reuse',
    input: {
      designs: [
        {
          id: 'usb_sensor',
          category: 'usb_device',
          routingMode: 'controlled_embedded_routing',
          board: { widthMm: 42, heightMm: 28, outline: rectanglePoints(42, 28) },
          components: [{ ref: 'J1', group: 'USB', role: 'edge_usb', x: 1, y: 14 }, { ref: 'U1', group: 'MCU', x: 20, y: 14 }],
          nets: [{ name: 'USB_DP', className: 'USB_DIFF' }, { name: '3V3', className: 'POWER_LOW_CURRENT' }],
        },
        {
          id: 'poe_sensor',
          category: 'poe_device',
          routingMode: 'power_context_routing',
          board: { widthMm: 70, heightMm: 45, outline: rectanglePoints(70, 45) },
          components: [{ ref: 'J1', group: 'RJ45', role: 'edge_ethernet', x: 69, y: 22 }, { ref: 'U2', group: 'POE_FRONT_END', x: 45, y: 28 }],
          nets: [{ name: 'ETH_TX_P', className: 'ETHERNET_DIFF' }, { name: 'POE_VDD', className: 'HIGH_VOLTAGE' }],
        },
        {
          id: 'industrial_io',
          category: 'industrial_io',
          routingMode: 'dense_context_routing',
          board: { widthMm: 96, heightMm: 55, outline: rectanglePoints(96, 55) },
          components: [{ ref: 'J1', group: 'TERMINAL_BLOCK', role: 'edge_field_io', x: 96, y: 28 }, { ref: 'U2', group: 'ISOLATOR', x: 50, y: 28 }],
          nets: [{ name: 'FIELD_IN1', className: 'HIGH_VOLTAGE' }, { name: 'RS485_A', className: 'RS485_DIFF' }],
        },
        {
          id: 'motor_controller',
          category: 'motor_controller',
          routingMode: 'power_context_routing',
          board: { widthMm: 82, heightMm: 60, outline: rectanglePoints(82, 60) },
          components: [{ ref: 'J1', group: 'POWER_INPUT', role: 'edge_power_input', x: 0, y: 30 }, { ref: 'Q1', group: 'MOSFET', x: 55, y: 18 }],
          nets: [{ name: 'PHASE_A', className: 'MOTOR_PHASE' }, { name: 'VBAT', className: 'BATTERY' }],
        },
      ],
    },
  }, process.cwd())
  assert.equal(audit.templateReuseAudit.status, 'TEMPLATE_REUSE_CHECK_PASSED')

  const reused = await executeJob({
    id: 'anti_template_block',
    type: 'detect_template_reuse',
    input: {
      designs: [
        { id: 'a', category: 'usb_device', routingMode: 'controlled_embedded_routing', board: { widthMm: 50, heightMm: 30, outline: rectanglePoints(50, 30) }, components: [{ ref: 'J1', group: 'USB', x: 1, y: 15 }, { ref: 'U1', group: 'MCU', x: 25, y: 15 }], nets: [{ name: 'USB_DP', className: 'USB_DIFF' }] },
        { id: 'b', category: 'usb_device', routingMode: 'controlled_embedded_routing', board: { widthMm: 50, heightMm: 30, outline: rectanglePoints(50, 30) }, components: [{ ref: 'J1', group: 'USB', x: 1, y: 15 }, { ref: 'U1', group: 'MCU', x: 25, y: 15 }], nets: [{ name: 'USB_DP', className: 'USB_DIFF' }] },
      ],
    },
  }, process.cwd())
  assert.equal(reused.templateReuseAudit.status, 'TEMPLATE_REUSE_BLOCKED')
})

test('placement candidate engine generates board-specific placements across universal scenarios', async () => {
  const scenarios = [
    {
      id: 'led_load',
      prompt: 'LED load controller with 12V input, MOSFET output, screw terminals, and wide power route',
      board: { widthMm: 78, heightMm: 36, layerCount: 2, outline: rectanglePoints(78, 36) },
      components: [{ ref: 'J1', group: 'POWER_INPUT' }, { ref: 'Q1', group: 'MOSFET' }, { ref: 'J2', group: 'LED_OUTPUT' }, { ref: 'U1', group: 'MCU' }],
      nets: [{ name: 'VIN' }, { name: 'LED_CH1' }, { name: 'GND' }],
    },
    {
      id: 'esp32_sensor',
      prompt: 'ESP32-S3 USB-C sensor board with I2C header, regulator, reset, boot, Wi-Fi keepout',
      board: { widthMm: 52, heightMm: 34, layerCount: 4, outline: rectanglePoints(52, 34) },
      components: [{ ref: 'J1', group: 'USB' }, { ref: 'U1', group: 'ESP32_S3' }, { ref: 'U2', group: 'REGULATOR' }, { ref: 'J2', group: 'SENSOR_CONNECTOR' }, { ref: 'C1', group: 'CAP' }],
      nets: [{ name: 'USB_DP' }, { name: 'USB_DN' }, { name: '3V3' }, { name: 'I2C_SCL' }, { name: 'GND' }],
    },
    {
      id: 'poe',
      prompt: 'PoE Ethernet sensor with RJ45 on edge, PoE front end, Ethernet PHY, 5V and 3V3 rails',
      board: { widthMm: 84, heightMm: 48, layerCount: 4, outline: rectanglePoints(84, 48) },
      components: [{ ref: 'J1', group: 'RJ45' }, { ref: 'U1', group: 'POE_FRONT_END' }, { ref: 'U2', group: 'ETHERNET_PHY' }, { ref: 'U3', group: 'REGULATOR' }, { ref: 'J2', group: 'SENSOR_CONNECTOR' }],
      nets: [{ name: 'ETH_TX_P' }, { name: 'ETH_TX_N' }, { name: 'POE_VDD' }, { name: '5V' }, { name: '3V3' }, { name: 'GND' }],
    },
    {
      id: 'robotics',
      prompt: 'compact robotics controller with CAN, UART, 12V input, 5V/3V3 rails, terminal outputs, debug header',
      board: { widthMm: 72, heightMm: 44, layerCount: 4, outline: rectanglePoints(72, 44) },
      components: [{ ref: 'J1', group: 'POWER_INPUT' }, { ref: 'U1', group: 'MCU' }, { ref: 'J2', group: 'TERMINAL_BLOCK' }, { ref: 'J3', group: 'SENSOR_CONNECTOR' }, { ref: 'U2', group: 'REGULATOR' }],
      nets: [{ name: 'VIN' }, { name: 'CANH' }, { name: 'CANL' }, { name: 'UART_TX' }, { name: '3V3' }, { name: 'GND' }],
    },
    {
      id: 'industrial',
      prompt: 'industrial IO board with field terminal block, isolator, protection devices, logic MCU, wider clearances',
      board: { widthMm: 96, heightMm: 55, layerCount: 4, outline: rectanglePoints(96, 55) },
      components: [{ ref: 'J1', group: 'TERMINAL_BLOCK' }, { ref: 'U1', group: 'ISOLATOR' }, { ref: 'D1', group: 'TVS' }, { ref: 'U2', group: 'MCU' }, { ref: 'K1', group: 'RELAY_OR_DRIVER' }],
      nets: [{ name: 'FIELD_IN1' }, { name: 'FIELD_GND' }, { name: '3V3' }, { name: 'GND' }, { name: 'RS485_A' }, { name: 'RS485_B' }],
    },
    {
      id: 'motor_controller',
      prompt: 'BLDC motor controller with MOSFETs, gate driver, shunt, phase outputs, battery input, thermal copper',
      board: { widthMm: 88, heightMm: 58, layerCount: 6, outline: rectanglePoints(88, 58) },
      components: [{ ref: 'J1', group: 'POWER_INPUT' }, { ref: 'Q1', group: 'MOSFET' }, { ref: 'Q2', group: 'MOSFET' }, { ref: 'U1', group: 'GATE_DRIVER' }, { ref: 'RSH1', group: 'SHUNT' }, { ref: 'J2', group: 'MOTOR_HEADER' }],
      nets: [{ name: 'VBAT' }, { name: 'PHASE_A' }, { name: 'PHASE_B' }, { name: 'PHASE_C' }, { name: 'GND' }],
    },
    {
      id: 'wearable',
      prompt: 'odd wearable circular sensor board with USB-C, battery connector, antenna keepout, IMU sensor',
      board: { widthMm: 42, heightMm: 38, layerCount: 4, outline: [{ x: 4, y: 2 }, { x: 38, y: 2 }, { x: 42, y: 18 }, { x: 32, y: 36 }, { x: 10, y: 36 }, { x: 0, y: 18 }] },
      components: [{ ref: 'J1', group: 'USB' }, { ref: 'BT1', group: 'BATTERY_CONNECTOR' }, { ref: 'U1', group: 'MCU' }, { ref: 'U2', group: 'SENSOR_CONNECTOR' }],
      nets: [{ name: 'VBAT' }, { name: 'USB_DP' }, { name: 'USB_DN' }, { name: 'I2C_SCL' }, { name: 'GND' }],
    },
    {
      id: 'l_shaped',
      prompt: 'L-shaped custom controller board with USB-C on flat edge and sensor connector at the opposite edge',
      board: { widthMm: 62, heightMm: 46, layerCount: 4, outline: [{ x: 0, y: 0 }, { x: 62, y: 0 }, { x: 62, y: 26 }, { x: 38, y: 26 }, { x: 38, y: 46 }, { x: 0, y: 46 }] },
      components: [{ ref: 'J1', group: 'USB' }, { ref: 'U1', group: 'MCU' }, { ref: 'J2', group: 'SENSOR_CONNECTOR' }, { ref: 'U2', group: 'REGULATOR' }],
      nets: [{ name: 'USB_DP' }, { name: 'USB_DN' }, { name: '3V3' }, { name: 'GND' }],
    },
    {
      id: 'dense_mixed_signal',
      prompt: 'dense mixed-signal board with USB, analog sensor front end, MCU, regulator, SPI flash, test points',
      board: { widthMm: 46, heightMm: 30, layerCount: 6, outline: rectanglePoints(46, 30) },
      components: Array.from({ length: 20 }, (_, index) => ({ ref: index === 0 ? 'J1' : `U${index}`, group: index === 0 ? 'USB' : index === 1 ? 'MCU' : index < 5 ? 'SENSOR_CONNECTOR' : index < 8 ? 'REGULATOR' : index % 2 ? 'CAP' : 'RES' })),
      nets: [{ name: 'USB_DP' }, { name: 'USB_DN' }, { name: '3V3' }, { name: 'AVDD' }, { name: 'SPI_MOSI' }, { name: 'GND' }],
    },
  ]
  const designs = []
  for (const scenario of scenarios) {
    const generated = await executeJob({ id: `${scenario.id}_placement_candidates`, type: 'generate_placement_candidates', input: { ...scenario, manufacturerProfile: 'JLCPCB_STANDARD' } }, process.cwd())
    assert.ok(['PLACEMENT_CANDIDATES_READY', 'PLACEMENT_CANDIDATES_REGENERATED_NEEDS_REVIEW'].includes(generated.status), scenario.id)
    assert.ok(generated.placementCandidates.candidates.length >= 3, scenario.id)
    assert.ok(generated.placementCandidates.selectedCandidate.score > 0, scenario.id)
    assert.ok(generated.placementCandidates.selectedCandidate.functionalRegions.length > 0, scenario.id)
    assert.ok(generated.placementCandidates.selectedCandidate.routingCorridors.length > 0, scenario.id)
    assert.ok(generated.placementCandidates.selectedCandidate.templateReuseRisk < 70, scenario.id)
    designs.push({
      id: scenario.id,
      category: generated.placementCandidates.category.id,
      routingMode: generated.placementCandidates.complexity.routingMode,
      board: generated.placementCandidates.board,
      components: generated.placementCandidates.selectedCandidate.components,
      nets: scenario.nets,
    })
  }
  const audit = await executeJob({ id: 'placement_candidate_anti_template', type: 'detect_template_reuse', input: { designs } }, process.cwd())
  assert.notEqual(audit.templateReuseAudit.status, 'TEMPLATE_REUSE_BLOCKED')
})

test('universal placement selection can regenerate weak compact placements before routing', async () => {
  const input = {
    projectName: 'Tiny Dense Motor Controller',
    prompt: 'tiny 24mm x 16mm two layer high-current BLDC motor controller with MOSFET bridge, shunt, battery input, phase outputs, sensor header, and USB service',
    widthMm: 24,
    heightMm: 16,
    layerCount: 2,
    allowBoardResize: true,
    allowLayerIncrease: true,
    components: [
      { ref: 'J1', group: 'POWER_INPUT' },
      { ref: 'J2', group: 'MOTOR_HEADER' },
      { ref: 'J3', group: 'USB' },
      { ref: 'Q1', group: 'MOSFET' },
      { ref: 'Q2', group: 'MOSFET' },
      { ref: 'Q3', group: 'MOSFET' },
      { ref: 'U1', group: 'GATE_DRIVER' },
      { ref: 'U2', group: 'MCU' },
      { ref: 'RSH1', group: 'SHUNT' },
      ...Array.from({ length: 14 }, (_, index) => ({ ref: `C${index + 1}`, group: index % 2 ? 'CAP' : 'RES' })),
    ],
    nets: [{ name: 'VBAT' }, { name: 'PHASE_A' }, { name: 'PHASE_B' }, { name: 'PHASE_C' }, { name: 'USB_DP' }, { name: 'USB_DN' }, { name: 'GND' }],
  }
  const generated = await executeJob({ id: 'tiny_dense_regen', type: 'generate_placement_candidates', input }, process.cwd())
  assert.equal(generated.placementCandidates.regeneration.regenerated, true)
  assert.ok(generated.placementCandidates.regeneration.newScore > generated.placementCandidates.regeneration.oldScore)
  assert.ok(generated.placementCandidates.regeneration.changes.length > 0)
})

test('ESC placement application preserves imported coordinates as repairable baseline before proposing movement', async () => {
  const input = {
    projectName: 'Imported 4-in-1 ESC',
    prompt: 'imported dense 4-in-1 BLDC ESC with battery pads, motor phase outputs, EPC MOSFETs, gate drivers, shunts, MCU control, and 30.5mm mounting pattern',
    board: { widthMm: 41.5, heightMm: 40.85, layerCount: 2, outline: rectanglePoints(41.5, 40.85) },
    components: [
      { ref: 'J1', group: 'POWER_INPUT', x: 20.75, y: 4, locked: true },
      { ref: 'J4', group: 'MOTOR_HEADER', x: 4, y: 20, locked: true },
      { ref: 'J5', group: 'MOTOR_HEADER', x: 37.5, y: 20, locked: true },
      { ref: 'Q1', group: 'MOSFET', x: 14, y: 14 },
      { ref: 'Q2', group: 'MOSFET', x: 18, y: 14 },
      { ref: 'U1', group: 'GATE_DRIVER', x: 16, y: 22 },
      { ref: 'R_SHUNT1', group: 'SHUNT', x: 12, y: 29 },
      { ref: 'U3', group: 'MCU', x: 27, y: 22 },
      { ref: 'H1', group: 'MOUNTING_HOLE', x: 5.5, y: 5.2, locked: true },
      { ref: 'H2', group: 'MOUNTING_HOLE', x: 36, y: 5.2, locked: true },
    ],
    nets: [
      { name: 'VBAT_RAW', className: 'BATTERY' },
      { name: 'PGND', className: 'GROUND' },
      { name: 'M1_A_SW', className: 'SWITCHING_NODE' },
      { name: 'M1_A_HG', className: 'GATE_DRIVE' },
      { name: 'M1_SHUNT_P', className: 'CURRENT_SENSE' },
    ],
    allowBoardResize: false,
    allowLayerIncrease: false,
  }
  const generated = await executeJob({ id: 'imported_esc_preserve', type: 'generate_placement_candidates', input }, process.cwd())
  assert.equal(generated.placementCandidates.strategies[0], 'preserve_existing')
  const preserve = generated.placementCandidates.candidates.find((candidate) => candidate.strategy === 'preserve_existing')
  assert.ok(preserve)
  assert.equal(preserve.components.find((component) => component.ref === 'J1').x, 20.75)
  assert.equal(preserve.components.find((component) => component.ref === 'U3').y, 22)
  assert.ok((preserve.repairReasons?.length || preserve.rejectionReasons?.length) > 0)
  assert.notEqual(generated.placementCandidates.templateReuseAudit.status, 'TEMPLATE_REUSE_BLOCKED')
  assert.ok(generated.placementCandidates.nextActions.includes('audit imported placement') || generated.placementCandidates.nextActions.includes('relax constraints or regenerate board outline/stackup before routing'))
})

test('universal placement KiCad imported baseline selection does not hard-block without geometry errors', async () => {
  const input = {
    projectName: 'Imported ESC Baseline',
    board: { widthMm: 41.5, heightMm: 40.85, layerCount: 6, outline: rectanglePoints(41.5, 40.85) },
    components: [
      { ref: 'J1', group: 'POWER_INPUT', x: 20, y: 4, locked: true },
      { ref: 'Q1', group: 'MOSFET', x: 12, y: 16 },
      { ref: 'Q2', group: 'MOSFET', x: 16, y: 16 },
      { ref: 'U1', group: 'GATE_DRIVER', x: 14, y: 22 },
      { ref: 'R_SHUNT1', group: 'SHUNT', x: 12, y: 29 },
      { ref: 'U3', group: 'MCU', x: 27, y: 22 },
    ],
    nets: [{ name: 'VBAT_RAW' }, { name: 'PGND' }, { name: 'M1_A_SW' }, { name: 'M1_A_HG' }, { name: 'M1_SHUNT_P' }],
    allowBoardResize: false,
    allowLayerIncrease: false,
  }
  const generated = await executeJob({ id: 'imported_esc_baseline', type: 'generate_placement_candidates', input }, process.cwd())
  const selected = await executeJob({ id: 'imported_esc_select', type: 'select_placement_candidate', input: { ...input, candidatePlan: generated.placementCandidates } }, process.cwd())
  assert.notEqual(selected.status, 'PLACEMENT_SELECTION_BLOCKED')
  assert.ok(['preserve_existing', 'routing_corridor_optimized', 'power_first', 'edge_connector_first'].includes(selected.placementSelection.selectedCandidate.strategy))
})

test('universal placement jobs persist candidate selection into project state', async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'boardforge-placement-flow-'))
  try {
    const input = {
      projectName: 'Placement Flow Sensor',
      projectPath: 'placement-flow-sensor',
      board: { widthMm: 55, heightMm: 34, layerCount: 4, outline: rectanglePoints(55, 34) },
      prompt: 'ESP32-S3 USB-C environmental sensor with I2C header and 3V3 regulator',
      components: [{ ref: 'J1', group: 'USB' }, { ref: 'U1', group: 'ESP32_S3' }, { ref: 'U2', group: 'REGULATOR' }, { ref: 'J2', group: 'SENSOR_CONNECTOR' }],
      nets: [{ name: 'USB_DP' }, { name: 'USB_DN' }, { name: '3V3' }, { name: 'GND' }],
    }
    await executeJob({ id: 'create_placement_flow', type: 'create_kicad_project', input, allowOverwrite: true }, workspace)
    const candidates = await executeJob({ id: 'candidate_flow', type: 'generate_placement_candidates', input }, workspace)
    assert.ok(candidates.generatedFiles.some((file) => file.endsWith('boardforge-placement-candidates.json')))
    const selection = await executeJob({ id: 'select_flow', type: 'select_placement_candidate', input }, workspace)
    assert.ok(['PLACEMENT_SELECTION_READY', 'PLACEMENT_SELECTION_NEEDS_REPAIR'].includes(selection.status))
    const applied = await executeJob({ id: 'apply_flow', type: 'apply_universal_placement', input }, workspace)
    assert.equal(applied.status, 'UNIVERSAL_PLACEMENT_READY_TO_APPLY')
    const state = JSON.parse(await readFile(path.join(workspace, 'placement-flow-sensor', 'boardforge-project.json'), 'utf8'))
    assert.equal(state.placement.status, 'UNIVERSAL_PLACEMENT_READY_TO_APPLY')
    assert.equal(state.components.length, input.components.length)
    assert.ok(state.placement.scoring.candidateId)
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})

test('ESC high-density router classifies routes and orders ESC priorities', () => {
  const routes = [
    { net: '/I2C1_SCL', start: { x: 1, y: 1 }, end: { x: 5, y: 1 } },
    { net: '/M2_C_SW', start: { x: 1, y: 4 }, end: { x: 8, y: 4 } },
    { net: 'VIN', start: { x: 1, y: 6 }, end: { x: 8, y: 6 } },
    { net: '/Q1_GATE', start: { x: 1, y: 8 }, end: { x: 4, y: 8 } },
  ]
  const result = highDensityEscRouter({ routes, nets: routes })
  assert.equal(result.status, 'HIGH_DENSITY_ESC_ROUTER_READY')
  assert.equal(result.netClasses.find((net) => net.name === '/M2_C_SW').type, 'MOTOR_PHASE')
  assert.equal(result.routes[0].highDensityPolicy.netType, 'HIGH_CURRENT_POWER')
  assert.ok(result.routes.find((route) => route.net === '/I2C1_SCL').highDensityPolicy.noiseSensitive)
})

test('ESC net classification routing rules choose layer intent', () => {
  assert.equal(classifyEscRouteNet('VIN'), 'HIGH_CURRENT_POWER')
  assert.equal(classifyEscRouteNet('/M2_C_SW'), 'MOTOR_PHASE')
  assert.equal(classifyEscRouteNet('/M1_SHUNT_P'), 'CURRENT_SENSE_KELVIN')
  assert.equal(classifyEscRouteNet('/Q1_GATE'), 'GATE_DRIVE')
  assert.equal(classifyEscRouteNet('/I2C1_SCL'), 'I2C')
  assert.equal(classifyEscRouteNet('HSE_OSC_IN'), 'RF_OR_CLOCK')
  assert.equal(buildHighDensityRoutePolicy({ net: '/M1_SHUNT_P' }).layerPreference[0], 'In5.Cu')
  assert.equal(buildHighDensityRoutePolicy({ net: 'VIN' }).profile.allowViaArrays, true)
})

test('ESC GaN power stage routing protects gate bootstrap and switch nodes', () => {
  const region = classifyGanPowerStageRegion([{ net: '/M2_C_SW' }, { net: '/Q1_GATE' }, { net: '/M1_BOOT' }, { net: 'PGND' }])
  assert.deepEqual(region.switchingNets, ['/M2_C_SW'])
  assert.deepEqual(region.gateDriveNets, ['/Q1_GATE'])
  assert.equal(protectGateDriveLoops({ net: '/Q1_GATE' }).maxViaCount, 0)
  assert.ok(scoreEscPowerStageRouting({ net: '/M2_C_SW', layerPreference: ['F.Cu'], viaPlan: { candidates: [] } }).score >= 80)
})

test('ESC current-sense Kelvin protection rejects switching noise corridor', () => {
  const pair = routeKelvinSensePair({ net: '/M1_SHUNT_P' }, { net: '/M1_SHUNT_N' })
  assert.equal(pair[0].kelvinPair, true)
  assert.equal(pair[0].layerPreference[0], 'In5.Cu')
  assert.equal(protectCurrentSenseCorridor({ net: '/M1_SHUNT_P' }).protected, true)
  assert.equal(rejectSenseRouteThroughSwitchingNoise({ net: '/M1_SHUNT_P' }, [{ net: '/M2_C_SW' }]), true)
})

test('ESC motor phase high-current routing uses width and via-array policy', () => {
  const policy = buildHighDensityRoutePolicy({ net: '/M2_C_SW' })
  assert.equal(policy.netType, 'MOTOR_PHASE')
  assert.ok(policy.profile.widthMm >= 0.8)
  assert.equal(policy.profile.allowViaArrays, true)
  const vias = placeThroughViaArray({ net: '/M2_C_SW', start: { x: 0, y: 0 }, end: { x: 4, y: 4 } }, 4)
  assert.equal(vias.length, 4)
  assert.equal(vias.every((via) => via.viaType === 'through'), true)
})

test('ESC via-array and site scoring rejects pad-crowded through via', () => {
  const crowded = scoreViaSite({ x: 1, y: 1, net: 'VIN' }, { pads: [{ x: 1.1, y: 1.1, netName: '/I2C1_SCL' }], board: { outline: rectanglePoints(10, 10) } })
  const open = scoreViaSite({ x: 5, y: 5, net: 'VIN' }, { pads: [{ x: 1, y: 1, netName: '/I2C1_SCL' }], board: { outline: rectanglePoints(10, 10) } })
  assert.equal(crowded.legal, false)
  assert.equal(open.legal, true)
})

test('ESC ripup reroute generated copper ranks generated blockers', () => {
  const committed = [{ net: '/I2C1_SCL', generated: true }, { net: '/Q1_GATE', generated: true }]
  const future = [{ net: '/M2_C_SW' }, { net: 'VIN' }, { net: '/I2C1_SCL' }]
  const blockers = identifyGeneratedRouteBlockingFutureNets(committed, future)
  assert.equal(blockers.length, 2)
  assert.equal(ripupGeneratedRoute(blockers[0].route).ripupGeneratedCopperOnly, true)
  assert.equal(rerouteWithHigherPriorityOrder(future)[0].net, 'VIN')
})

test('ESC noise-sensitive routing avoids In2 and switch nodes', () => {
  const sensitive = classifyNoiseSensitiveNets([{ name: '/I2C1_SCL' }, { name: '/M2_C_SW' }, { name: 'HSE_OSC_IN' }])
  assert.deepEqual(sensitive.map((net) => net.name), ['/I2C1_SCL', 'HSE_OSC_IN'])
  const routed = routeSensitiveNetWithReference({ net: '/I2C1_SCL', layerPreference: ['In2.Cu', 'In3.Cu'], viaPlan: { candidates: [{ x: 1, y: 1 }, { x: 2, y: 2 }] } })
  assert.equal(routed.layerPreference.includes('In2.Cu'), false)
  assert.equal(routed.viaPlan.candidates.length, 1)
})

test('ESC PGND/GND zone strategy uses In1/In6 stitching policy', () => {
  const strategy = createPgndGndZoneStrategy([{ name: 'PGND' }])
  assert.equal(strategy.enabled, true)
  assert.deepEqual(strategy.zones.map((zone) => zone.layer), ['In1.Cu', 'In6.Cu'])
  assert.match(strategy.viaPolicy, /no_via_in_pad/)
})

test('ESC DRC regression repair loop emits high-density mutations', () => {
  const route = { net: '/M2_C_SW', start: { x: 0, y: 0 }, end: { x: 8, y: 2 }, waypoints: [{ x: 0, y: 0 }, { x: 8, y: 2 }], viaPlan: { candidates: [{ x: 4, y: 1 }] } }
  const mutations = mutateHighDensityRouteAfterDrcFailure(route, { failure: 'ROUTE_PAD_CLEARANCE' })
  assert.ok(mutations.some((candidate) => candidate.mutation.type === 'high_density_alternate_layer'))
  assert.ok(mutations.some((candidate) => candidate.mutation.type === 'high_density_dogleg_y'))
  assert.ok(mutations.some((candidate) => candidate.mutation.type === 'high_density_no_via_retry'))
})

test('ESC supervisor does not stop on router gap tasks', () => {
  const task = createInternalRepairTask({ code: 'GENERATED_ROUTE_DRC_REGRESSION', net: '/I2C1_SCL', reason: 'DRC_ERROR_REGRESSION' }, { cycleIndex: 0, traceIndex: 0, taskIndex: 0 })
  assert.equal(task.type, 'FIX_HIGH_DENSITY_DRC_AWARE_ROUTER')
  assert.ok(runFocusedTestsForRepair('FIX_HIGH_DENSITY_DRC_AWARE_ROUTER').includes('test:esc-high-density-router'))
  assert.ok(runFocusedTestsForRepair('FIX_DRC_REGRESSION_REPAIR_LOOP').includes('test:esc-drc-regression-repair-loop'))
})

test('ESC final gate rejects DRC regression only blockers', () => {
  const gate = validateEscFinalState({
    input: { minimumAttemptedNetsForStrictFinalState: 2 },
    cycles: [{ tasks: [{ type: 'FIX_HIGH_DENSITY_DRC_AWARE_ROUTER' }] }],
    traceResult: {
      routing: {
        unrouted: ['VIN'],
        legalTrace: {
          transactionResults: [
            { net: 'VIN', status: 'route_drc_worsened_rolled_back', drcRegression: { reason: 'DRC_ERROR_REGRESSION', errorDelta: 9 } },
            { net: '/I2C1_SDA', status: 'blocked_candidate_rejected', reason: 'ROUTE_PAD_CLEARANCE' },
          ],
          blockedRoutes: [{ net: '/I2C1_SDA', status: 'blocked_candidate_rejected', reason: 'ROUTE_PAD_CLEARANCE' }],
        },
      },
      finalDrc: { issueCounts: { errors: 894, warnings: 448 } },
      erc: { issueCounts: { errors: 6, warnings: 74 } },
    },
  })
  assert.equal(gate.valid, false)
  assert.equal(gate.finalState, 'esc_existing_footprints_routeable_nets_completed_drc_repair_needed')
  assert.equal(gate.internalBlockerCount > 0, true)
  assert.equal(gate.rejectedPrematureBoundedFinalState, true)
})

test('ESC final gate requires ERC and DRC work before routed-except state', () => {
  const gate = validateEscFinalState({
    input: { minimumAttemptedNetsForStrictFinalState: 1 },
    cycles: [{ tasks: [{ type: 'FIX_HIGH_DENSITY_DRC_AWARE_ROUTER' }] }],
    traceResult: {
      routing: {
        unrouted: ['VIN'],
        legalTrace: {
          transactionResults: [
            {
              net: 'VIN',
              status: 'route_drc_worsened_rolled_back',
              sourceRef: 'J1',
              sourcePad: '1',
              targetRef: 'C1',
              targetPad: '1',
              drcRegression: { reason: 'DRC_ERROR_REGRESSION' },
            },
          ],
          blockedRoutes: [],
        },
      },
    },
  })
  assert.equal(gate.valid, false)
  assert.equal(gate.drcIssuesClassified, true)
  assert.equal(gate.ercIssuesClassified, false)
})

test('ESC final gate requires unconnected proof to be forbidden before final blocker state', () => {
  const gate = validateEscFinalState({
    input: { minimumAttemptedNetsForStrictFinalState: 1 },
    cycles: [{ tasks: [{ type: 'FIX_DRC_REGRESSION_REPAIR_LOOP' }] }],
    traceResult: {
      routing: {
        unrouted: ['/NRST'],
        legalTrace: {
          transactionResults: [
            { net: '/NRST', status: 'route_pad_to_pad_connectivity_rejected', reason: 'ROUTE_DOES_NOT_PROVE_PAD_TO_PAD_CONNECTIVITY', connectivity: { sourcePad: 'IC1 pad A1', targetPad: 'J1 pad 1' } },
          ],
          blockedRoutes: [],
        },
      },
      finalDrc: { issueCounts: { errors: 1, warnings: 0 } },
      erc: { issueCounts: { errors: 0, warnings: 0 } },
    },
  })
  assert.equal(gate.valid, false)
  assert.equal(gate.forbiddenBlockerCount, 0)
})

test('ESC VIN DRC regression repair creates internal mutation candidates', () => {
  const route = { net: 'VIN', start: { x: 1, y: 1 }, end: { x: 8, y: 2 }, waypoints: [{ x: 1, y: 1 }, { x: 8, y: 2 }], viaPlan: { candidates: [{ x: 4, y: 1.5 }] } }
  const repair = repairVinDrcRegression(route, { reason: 'DRC_ERROR_REGRESSION', errorDelta: 9 })
  assert.equal(repair.finalStateAllowed, false)
  assert.equal(repair.classified.net, 'VIN')
  assert.ok(repair.mutations.length > 0)
})

test('ESC DRC parser count normalization explains stdout JSON mismatch', () => {
  const output = {
    report: { stdout: 'Found 843 violations\r\nFound 499 unconnected items\r\n' },
    errors: [{ code: 'DRC_ERRORS', message: '894 DRC errors found.' }],
    warnings: [{ code: 'DRC_WARNINGS', message: '448 DRC warnings found.' }],
  }
  const counts = normalizeKicadDrcCounts(output)
  assert.equal(counts.kicadStdoutViolations, 843)
  assert.equal(counts.kicadUnconnected, 499)
  assert.equal(counts.boardforgeErrors, 894)
  const compared = compareDrcStdoutVsJson(output)
  assert.equal(compared.mismatch, true)
  assert.equal(classifyDrcParserMismatch(output).parserFixed, true)
})

test('ESC ERC repair track classifies errors without global suppression', () => {
  const erc = {
    report: {
      report: {
        issueCounts: { errors: 1, warnings: 2 },
        sheets: [{ violations: [{ severity: 'error', type: 'power_pin_not_driven', description: 'Input Power pin not driven by any Output Power pins' }] }],
      },
    },
  }
  const classified = classifyEscErcErrors(erc)
  assert.equal(classified.status, 'ESC_ERC_ERRORS_CLASSIFIED')
  assert.equal(classified.classifications[0].globalSuppression, false)
  assert.equal(repairEscErcErrors(erc).globalSuppression, false)
})

test('ESC DRC family repair track classifies generated DRC families', () => {
  const drc = {
    report: {
      report: {
        unconnected_items: [{ type: 'unconnected_items', description: 'Missing connection between items' }],
        violations: [
          { type: 'clearance', description: 'Track too close to pad' },
          { type: 'hole_clearance', description: 'Via too close to pad' },
          { type: 'edge_clearance', description: 'Copper too close to board edge' },
        ],
      },
    },
  }
  const classified = classifyEscDrcFamilies(drc)
  assert.equal(classified.families.unconnected, 1)
  assert.equal(classified.families.pad_clearance >= 1, true)
  assert.equal(repairGeneratedCopperDrc(drc).status, 'GENERATED_COPPER_DRC_REPAIR_TRACK_READY')
})

test('ESC supervisor continues after VIN fail by requiring source target repair first', () => {
  const blocker = classifyEscBlocker({
    traceResult: {
      routing: {
        unrouted: ['VIN', '/NRST'],
        legalTrace: {
          transactionResults: [{ net: 'VIN', status: 'route_drc_worsened_rolled_back', drcRegression: { reason: 'DRC_ERROR_REGRESSION' }, beforeDrc: { errors: 890 }, afterDrc: { errors: 899 } }],
          blockedRoutes: [],
        },
      },
    },
    previousCopper: { segments: 69 },
    currentCopper: { segments: 69 },
  })
  const task = createInternalRepairTask(blocker.blockers[0], { cycleIndex: 0, traceIndex: 0, taskIndex: 0 })
  assert.equal(task.type, 'FIX_ROUTE_TRANSACTION_SOURCE_TARGET_PROOF')
})

test('internal repair task queue records executable repair tasks', async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'boardforge-internal-task-log-'))
  try {
    const task = createInternalRepairTask({ code: 'VIN_SOURCE_TARGET_UNKNOWN', net: 'VIN', reason: 'missing source target' }, { cycleIndex: 0, traceIndex: 0, taskIndex: 0 })
    const queue = enqueueInternalRepairTask([], task)
    const completed = executeInternalRepairTask(queue[0], { currentCopper: { segments: 70 } })
    assert.equal(completed.type, 'FIX_ROUTE_TRANSACTION_SOURCE_TARGET_PROOF')
    assert.equal(verifyInternalRepairTask(completed).verified, true)
    assert.equal(resumeEscSupervisorAfterTask(completed).resumeCommand, 'runEscAutonomousSupervisor')
    const jsonFile = path.join(workspace, 'boardforge-internal-repair-tasks.json')
    const markdownFile = path.join(workspace, 'BoardForge_Internal_Repair_Task_Log.md')
    await saveInternalRepairTaskLog({ jsonFile, markdownFile, tasks: [completed] })
    assert.match(await readFile(markdownFile, 'utf8'), /FIX_ROUTE_TRANSACTION_SOURCE_TARGET_PROOF/)
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})

test('blocker to repair task mapping routes missing VIN source target internally', () => {
  const task = createInternalRepairTask({ code: 'VIN_SOURCE_TARGET_UNKNOWN', net: 'VIN' }, { cycleIndex: 0, traceIndex: 0, taskIndex: 0 })
  assert.equal(task.type, 'FIX_ROUTE_TRANSACTION_SOURCE_TARGET_PROOF')
  assert.ok(task.focusedTests.includes('test:route-transaction-requires-source-target'))
})

test('VIN connectivity graph selects exact source and target pads', () => {
  const pads = [
    { id: 'J1:1', ref: 'J1', pad: '1', x: 0, y: 0, netName: 'VIN', layers: ['F.Cu'] },
    { id: 'C1:1', ref: 'C1', pad: '1', x: 5, y: 0, netName: 'VIN', layers: ['F.Cu'] },
    { id: 'U1:1', ref: 'U1', pad: '1', x: 10, y: 0, netName: '/VREG5', layers: ['F.Cu'] },
  ]
  const graph = buildNetSpecificConnectivityGraph({ net: 'VIN', pads })
  assert.equal(graph.pads.length, 2)
  assert.equal(graph.requiredConnections.length, 1)
  const selected = selectNextConnectionForNet({ net: 'VIN', pads })
  assert.equal(selected.source, 'J1 pad 1')
  assert.equal(selected.target, 'C1 pad 1')
})

test('VIN connectivity graph rejects self target and selects distinct pads', () => {
  const pads = [
    { id: 'J7:2:F', ref: 'J7', pad: '2', x: 0, y: 0, netName: 'VIN', layers: ['F.Cu'] },
    { id: 'J7:2:B', ref: 'J7', pad: '2', x: 0, y: 0, netName: 'VIN', layers: ['B.Cu'] },
    { id: 'C1:1', ref: 'C1', pad: '1', x: 5, y: 0, netName: 'VIN', layers: ['F.Cu'] },
  ]
  const selected = selectNextConnectionForNet({
    net: 'VIN',
    route: { net: 'VIN', start: { ref: 'J7', pad: '2', x: 0, y: 0 }, end: { ref: 'J7', pad: '2', x: 0, y: 0 } },
    pads,
  })
  assert.equal(selected.source, 'J7 pad 2')
  assert.equal(selected.target, 'C1 pad 1')
  assert.notEqual(selected.source, selected.target)
})

test('route transaction requires source target proof', () => {
  const pads = [
    { id: 'J1:1', ref: 'J1', pad: '1', x: 0, y: 0, widthMm: 1, heightMm: 1, netName: 'VIN', layers: ['F.Cu'] },
    { id: 'C1:1', ref: 'C1', pad: '1', x: 5, y: 0, widthMm: 1, heightMm: 1, netName: 'VIN', layers: ['F.Cu'] },
  ]
  const proof = recordTransactionSourceTarget({ route: { net: 'VIN', start: { ref: 'J1', pad: '1', x: 0, y: 0 }, end: { ref: 'C1', pad: '1', x: 5, y: 0 } }, pads })
  assert.equal(proof.sourceRef, 'J1')
  assert.equal(proof.sourcePad, '1')
  assert.equal(proof.targetRef, 'C1')
  assert.equal(proof.targetPad, '1')
  assert.equal(proof.sourceTargetProof.proofComplete, true)
})

test('VIN blocker requires source target proof', () => {
  const missing = requireSourceTargetInBlockerReport({ net: 'VIN', reason: 'missing proof' })
  assert.equal(missing.proofComplete, false)
  assert.equal(missing.blockerType, 'VIN_SOURCE_TARGET_UNKNOWN')
  const self = requireSourceTargetInBlockerReport({ net: 'VIN', source: 'J7 pad 2', target: 'J7 pad 2' })
  assert.equal(self.proofComplete, false)
  assert.equal(self.blockerType, 'VIN_SOURCE_TARGET_UNKNOWN')
  const proven = requireSourceTargetInBlockerReport({ net: 'VIN', sourceRef: 'J1', sourcePad: '1', targetRef: 'C1', targetPad: '1' })
  assert.equal(proven.proofComplete, true)
})

test('VIN DRC regression repair can skip exact VIN connection after failed repair', () => {
  const repair = repairVinDrcRegression({ net: 'VIN', start: { x: 0, y: 0 }, end: { x: 4, y: 0 }, waypoints: [{ x: 0, y: 0 }, { x: 4, y: 0 }] }, { reason: 'DRC_ERROR_REGRESSION' })
  assert.equal(repair.finalStateAllowed, false)
  assert.ok(repair.mutations.length > 0)
})

test('strict final gate rejects unknown source target blocker', () => {
  const gate = validateEscFinalState({
    input: { minimumAttemptedNetsForStrictFinalState: 1 },
    cycles: [{ tasks: [{ type: 'FIX_ROUTE_TRANSACTION_SOURCE_TARGET_PROOF' }] }],
    traceResult: {
      routing: {
        unrouted: ['VIN'],
        legalTrace: {
          transactionResults: [{ net: 'VIN', status: 'route_drc_worsened_rolled_back', drcRegression: { reason: 'DRC_ERROR_REGRESSION' } }],
          blockedRoutes: [],
        },
      },
      finalDrc: { issueCounts: { errors: 1, warnings: 0 } },
      erc: { issueCounts: { errors: 0, warnings: 0 } },
    },
  })
  assert.equal(gate.valid, false)
  assert.equal(gate.blockerFamilies.includes('ROUTE_TRANSACTION_SOURCE_TARGET_UNKNOWN'), true)
})

test('ESC continue from retained 101 segments preserves retained copper evidence', () => {
  const retained = {
    segments: 101,
    vias: 2,
    zones: 0,
    retainedNets: {
      '/EN_U1': 3,
      '/M3_B_HG': 1,
      '/M3_B_SW': 3,
      '/M4_B_LG': 1,
      '/M4_B_SW': 5,
      '/M4_SHUNT_P': 18,
    },
  }
  const blocker = classifyEscBlocker({
    traceResult: { routing: { unrouted: ['/NRST'], legalTrace: { transactionResults: [], blockedRoutes: [] } } },
    previousCopper: retained,
    currentCopper: retained,
  })
  assert.equal(blocker.status, 'internal_repair_tasks_required')
  assert.equal(retained.segments, 101)
  assert.equal(retained.vias, 2)
})

test('ESC ERC repair classification creates local non-suppression repair policy', async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'boardforge-erc-report-'))
  try {
    const erc = {
      issueCounts: { errors: 1, warnings: 2 },
      violations: [{ severity: 'error', type: 'power_pin_not_driven', description: 'Power pin not driven' }],
    }
    const repair = repairEscErcErrorsLocally(erc)
    assert.equal(repair.globalSuppression, false)
    assert.equal(repair.allowedRepairs[0].globalSuppression, false)
    const files = await writeEscErcRepairReport({ projectDir: workspace, ercOutput: erc })
    assert.match(await readFile(files.markdown, 'utf8'), /global suppression: false/)
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})

test('ESC DRC family cleanup writes family and repair-track reports', async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'boardforge-drc-report-'))
  try {
    const drc = {
      issueCounts: { errors: 3, warnings: 1 },
      report: {
        violations: [
          { type: 'clearance', description: 'Track clearance' },
          { type: 'edge_clearance', description: 'Copper to edge' },
        ],
        unconnected_items: [{ type: 'unconnected_items', description: 'Missing connection' }],
      },
    }
    const classified = classifyEscDrcFamilies(drc)
    const repairs = { generatedCopper: repairGeneratedCopperDrc(drc) }
    const files = await writeEscDrcCleanupReport({ projectDir: workspace, drcOutput: drc, drcClassification: classified, drcRepairs: repairs })
    const markdown = await readFile(files.markdown, 'utf8')
    assert.match(markdown, /unconnected: 1/)
    assert.match(markdown, /generatedCopper: GENERATED_COPPER_DRC_REPAIR_TRACK_READY/)
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})

test('ESC final gate rejects DRC repair needed as user-facing final state', () => {
  const gate = validateEscFinalState({
    input: { minimumAttemptedNetsForStrictFinalState: 1 },
    cycles: [{ tasks: [{ type: 'FIX_DRC_REGRESSION_REPAIR_LOOP' }] }],
    traceResult: {
      routing: { unrouted: [], legalTrace: { transactionResults: [], blockedRoutes: [{ net: '/NRST', reason: 'ROUTE_PAD_CLEARANCE' }] } },
      finalDrc: { issueCounts: { errors: 899, warnings: 449 } },
      erc: { issueCounts: { errors: 6, warnings: 74 } },
    },
  })
  assert.equal(gate.valid, false)
  assert.equal(gate.finalState, 'esc_existing_footprints_routeable_nets_completed_drc_repair_needed')
})

test('ESC ERC repair executes local action planning without global suppression', async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'boardforge-erc-execute-'))
  try {
    const erc = {
      issueCounts: { errors: 1, warnings: 0 },
      violations: [{ severity: 'error', type: 'pin_not_driven', description: 'Power input pin is not driven' }],
    }
    const repair = repairEscErcErrorsLocally(erc)
    const files = await writeEscErcRepairReport({ projectDir: workspace, ercOutput: erc, ercRepair: repair })
    const report = JSON.parse(await readFile(files.json, 'utf8'))
    assert.equal(report.globalSuppression, false)
    assert.equal(report.repair.allowedRepairs.length, 1)
    assert.match(report.repair.allowedRepairs[0].action, /local_|document_/)
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})

test('ESC DRC cleanup executes generated copper repair track planning', async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'boardforge-drc-execute-'))
  try {
    const drc = {
      issueCounts: { errors: 2, warnings: 0 },
      report: {
        violations: [
          { type: 'tracks_crossing', description: 'Generated tracks crossing' },
          { type: 'edge_clearance', description: 'Generated copper edge clearance' },
        ],
      },
    }
    const classified = classifyEscDrcFamilies(drc)
    const repairs = {
      generatedCopper: repairGeneratedCopperDrc(drc),
      boardEdge: repairBoardEdgeDrc(drc),
    }
    const files = await writeEscDrcCleanupReport({ projectDir: workspace, drcOutput: drc, drcClassification: classified, drcRepairs: repairs })
    const report = JSON.parse(await readFile(files.json, 'utf8'))
    assert.equal(report.globalSuppression, false)
    assert.equal(report.repairs.generatedCopper.status, 'GENERATED_COPPER_DRC_REPAIR_TRACK_READY')
    assert.equal(report.repairs.boardEdge.status, 'BOARD_EDGE_DRC_REPAIR_TRACK_READY')
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})

test('ESC routes after cleanup classification keeps cleanup checkpoint internal', () => {
  const gate = validateEscFinalState({
    input: { minimumAttemptedNetsForStrictFinalState: 2 },
    cycles: [{ tasks: [{ type: 'FIX_DRC_REGRESSION_REPAIR_LOOP' }] }],
    traceResult: {
      status: 'esc_existing_footprints_internal_cleanup_continuing',
      routing: {
        unrouted: ['/BOOT_SEL_ESC'],
        legalTrace: {
          transactionResults: [{ net: '/BOOT_SEL_ESC', status: 'route_drc_worsened_rolled_back', sourceRef: 'R1', sourcePad: '1', targetRef: 'U1', targetPad: '1', drcRegression: { reason: 'DRC_ERROR_REGRESSION' } }],
          blockedRoutes: [{ net: '/RAMP12', reason: 'ROUTE_PAD_CLEARANCE' }],
        },
      },
      finalDrc: { issueCounts: { errors: 10, warnings: 1 } },
      erc: { issueCounts: { errors: 1, warnings: 0 } },
    },
  })
  assert.equal(gate.valid, false)
  assert.equal(gate.rejectedPrematureBoundedFinalState, true)
})

async function writeTinyBranchProject(root, name = 'tiny') {
  await mkdir(root, { recursive: true })
  const pcb = `(kicad_pcb
  (version 20260206)
  (generator "boardforge-test")
  (layers
    (0 "F.Cu" signal)
    (2 "B.Cu" signal)
    (25 "Edge.Cuts" user)
  )
  (net 1 "/A")
  (segment
    (start 1 1)
    (end 2 1)
    (width 0.127)
    (layer "F.Cu")
    (net "/A")
    (uuid "11111111-1111-4111-8111-111111111111")
  )
)`
  await writeFile(path.join(root, `${name}.kicad_pcb`), pcb)
  await writeFile(path.join(root, `${name}.kicad_sch`), '(kicad_sch (version 20231120) (generator "boardforge-test"))')
  await writeFile(path.join(root, `${name}.kicad_pro`), '{}')
}

test('ESC branch scoring prefers lower unconnected with no forbidden changes', () => {
  const better = { forbiddenChanges: 0, globalUnconnected: 400, netsRouted: 5, drcErrors: 10, ercErrors: 0, score: 1 }
  const worse = { forbiddenChanges: 0, globalUnconnected: 499, netsRouted: 20, drcErrors: 0, ercErrors: 0, score: 100 }
  assert.equal(compareEscRoutingBranches(better, worse), 1)
  assert.equal(compareEscRoutingBranches({ ...better, forbiddenChanges: 1 }, worse), -1)
})

test('ESC branch score punishes no progress', () => {
  const before = { segments: 101, vias: 2, zones: 0, netsRouted: 27, globalUnconnected: 499, ercErrors: 6, drcErrors: 899, drcWarnings: 449 }
  const delta = scoreEscRoutingBranchDelta({ before, after: { ...before } })
  assert.equal(delta.noProgress, true)
  assert.ok(delta.score < 0)
  const improved = scoreEscRoutingBranchDelta({ before, after: { ...before, netsRouted: 28, globalUnconnected: 498, segments: 104 } })
  assert.equal(improved.noProgress, false)
  assert.ok(improved.score > 0)
})

test('ESC reject no-op branch', () => {
  const before = { segments: 101, vias: 2, zones: 0, netsRouted: 27, globalUnconnected: 499, ercErrors: 6, drcErrors: 899, drcWarnings: 449 }
  const rejected = rejectNoOpBranch({ before, after: { ...before }, routesAttempted: 40, drcAfter: { issueCounts: { errors: 899, warnings: 449 } } })
  assert.equal(rejected.status, 'NO_OP_BRANCH_FAILED')
  assert.equal(rejected.rejected, true)
})

test('ESC branch must write or prove blocker', () => {
  assert.equal(requireBranchExecutionEvidence({}).valid, false)
  assert.equal(requireBranchExecutionEvidence({ routesAttempted: 2, drcAfter: { issueCounts: { errors: 1 } } }).valid, true)
  assert.equal(requireBranchExecutionEvidence({ exactBlockerProofCount: 1 }).valid, true)
})

test('ESC branch executes selected priority net batches', () => {
  const plan = {
    routes: [
      { net: '/VIN', status: 'routed' },
      { net: '/SWDIO', status: 'routed' },
      { net: '/NRST', status: 'routed' },
      { net: '/M2_C_SW', status: 'routed' },
    ],
    unroutedNets: [],
  }
  const selected = applyTraceBranchRoutingSelection({
    routingPlan: plan,
    input: { branchStrategy: 'signal-first', branchStrictPriority: true, priorityNets: ['/NRST', '/SWDIO'], maxRouteNets: 4 },
  })
  assert.deepEqual(selected.routes.map((route) => route.net), ['/NRST', '/SWDIO'])
  assert.equal(selected.legalTrace.branchSelection.selectedRoutes, 2)
  assert.ok(selected.unroutedNets.includes('/VIN'))
})

test('ESC autoroute queue honors branch priority before route budget slice', () => {
  const board = { outline: rectanglePoints(30, 20), mountingHoles: [], layerCount: 8 }
  const pads = [
    { id: 'A:1', ref: 'A', pad: '1', netName: '/VIN', x: 1, y: 1, widthMm: 0.5, heightMm: 0.5, layers: ['F.Cu'] },
    { id: 'B:1', ref: 'B', pad: '1', netName: '/VIN', x: 5, y: 1, widthMm: 0.5, heightMm: 0.5, layers: ['F.Cu'] },
    { id: 'C:1', ref: 'C', pad: '1', netName: '/BOOT_SEL_ESC', x: 1, y: 5, widthMm: 0.5, heightMm: 0.5, layers: ['F.Cu'] },
    { id: 'D:1', ref: 'D', pad: '1', netName: '/BOOT_SEL_ESC', x: 5, y: 5, widthMm: 0.5, heightMm: 0.5, layers: ['F.Cu'] },
  ]
  const routed = autorouteBoard({
    board,
    pads,
    components: [],
    nets: [{ name: '/VIN' }, { name: '/BOOT_SEL_ESC' }],
    profile: getManufacturerProfile('JLCPCB_STANDARD'),
    options: { maxRouteNets: 1, priorityNets: ['/BOOT_SEL_ESC'], requirePadEndpoints: true, layerCount: 8 },
  })
  assert.equal(routed.routes.length, 1)
  assert.equal(routed.routes[0].net, '/BOOT_SEL_ESC')
})

test('ESC signal branch no-via fallback reaches transactional KiCad trial', () => {
  const board = { outline: rectanglePoints(20, 20), mountingHoles: [] }
  const pads = [{ id: 'U1:2', ref: 'U1', pad: '2', netName: '/OTHER', x: 10, y: 5, widthMm: 0.8, heightMm: 0.8 }]
  const route = {
    net: '/SWDIO',
    className: 'DEBUG',
    status: 'routed',
    start: { x: 2, y: 5 },
    end: { x: 18, y: 5 },
    waypoints: [{ x: 2, y: 5 }, { x: 18, y: 5 }],
    widthMm: 0.127,
    layerPreference: ['F.Cu'],
    viaPlan: { candidates: [{ x: 10, y: 10, diameterMm: 0.45, drillMm: 0.2, viaType: 'through', layers: ['F.Cu', 'B.Cu'] }] },
  }
  const routingPlan = {
    branchStrategy: 'signal-first',
    allowBranchPrecheckDrcTrial: true,
    routes: [route],
    unroutedNets: [],
    designIntent: {
      zones: [{ id: 'SENSE_KEEP', allowVias: false, polygon: rectanglePoints(4, 4).map((point) => ({ x: point.x + 8, y: point.y + 8 })) }],
      copperPours: [],
    },
  }
  const legal = legalizeTraceRoutingPlan({ board, components: [], pads, profile: getManufacturerProfile('JLCPCB_STANDARD'), routingPlan })
  assert.equal(legal.routes.length, 1)
  assert.equal(legal.routes[0].viaPlan.candidates.length, 0)
  assert.equal(legal.legalTrace.blockedRoutes[0].status, 'candidate_mutated_and_accepted')
  assert.equal(legal.legalTrace.blockedRoutes[0].deferredToKiCadDrc, true)
})

test('report:90 quick has explicit timeout guard', async () => {
  const pkg = JSON.parse(await readFile(path.resolve('package.json'), 'utf8'))
  const script = pkg.scripts['report:90:quick']
  assert.match(script, /--total-budget-ms\s+90000/)
  assert.match(script, /--fixture-budget-ms\s+25000/)
  assert.match(script, /--repair-budget-ms\s+8000/)
})

test('ESC supervisor continues after report timeout state', () => {
  const gate = validateEscFinalState({
    traceResult: {
      status: 'report_timeout',
      routing: {
        unrouted: ['/NRST'],
        legalTrace: {
          transactionResults: [],
          blockedRoutes: [{ net: '/NRST', reason: 'report:90 timeout' }],
        },
      },
      finalDrc: { issueCounts: { errors: 10, warnings: 1 } },
      erc: { issueCounts: { errors: 1, warnings: 0 } },
    },
    cycles: [{ tasks: [{ taskId: 'FIX_REPORT_90_QUICK_TIMEOUT' }] }],
    input: { minimumAttemptedNetsForStrictFinalState: 1 },
  })
  assert.equal(gate.valid, false)
  assert.equal(gate.rejectedPrematureBoundedFinalState, true)
})

test('ESC external autorouter detection does not block when FreeRouting is unavailable', async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'bf-external-autorouter-'))
  try {
    const detected = detectExternalAutorouterAvailability({ projectDir: workspace, env: { PATH: '' } })
    assert.equal(detected.checked, true)
    assert.equal(detected.available, false)
    assert.match(detected.reason, /FreeRouting jar not found/)
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})

test('ESC promote best routing branch restores promoted snapshot', async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'bf-promote-branch-'))
  try {
    await writeTinyBranchProject(workspace)
    const baseline = await createEscRoutingBranch({ projectDir: workspace, branchId: 'baseline', strategy: 'baseline' })
    await writeFile(path.join(workspace, 'tiny.kicad_pcb'), '(kicad_pcb (version 20260206) (generator "modified"))')
    const candidate = await createEscRoutingBranch({ projectDir: workspace, branchId: 'candidate', strategy: 'candidate' })
    await restoreEscRoutingBranch({ projectDir: workspace, branch: baseline })
    const promoted = await promoteBestEscRoutingBranch({
      projectDir: workspace,
      baselineBranch: baseline,
      branches: [
        { branch: baseline, score: { forbiddenChanges: 0, globalUnconnected: 499, netsRouted: 1, drcErrors: 9, ercErrors: 0, score: 1 } },
        { branch: candidate, score: { forbiddenChanges: 0, globalUnconnected: 498, netsRouted: 2, drcErrors: 9, ercErrors: 0, score: 2 } },
      ],
    })
    assert.equal(promoted.bestBranch, 'candidate')
    assert.match(await readFile(path.join(workspace, 'tiny.kicad_pcb'), 'utf8'), /modified/)
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})

test('ESC branch rollback does not stop job when cleanup branch fails', async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'bf-branch-rollback-'))
  try {
    await writeTinyBranchProject(workspace)
    const branch = await createEscRoutingBranch({ projectDir: workspace, branchId: 'failed-cleanup', strategy: 'cleanup' })
    const discarded = await discardFailedEscRoutingBranch({ branch, reason: 'worse DRC' })
    assert.equal(discarded.status, 'BRANCH_DISCARDED')
    assert.equal(discarded.discardReason, 'worse DRC')
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})

test('ESC cleanup branch discard records worse DRC without promoting it', async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'bf-cleanup-branch-'))
  try {
    await writeTinyBranchProject(workspace)
    const result = await runMultiBranchEscRouting({
      projectDir: workspace,
      workspace,
      cleanupPhase: {
        drcBefore: { issueCounts: { errors: 10, warnings: 1 } },
        drcAfter: { issueCounts: { errors: 12, warnings: 1 } },
        ercBefore: { issueCounts: { errors: 1, warnings: 1 } },
        ercAfter: { issueCounts: { errors: 1, warnings: 2 } },
        drcRepairActions: [{ family: 'clearance' }],
      },
      input: { originalReferencePath: workspace },
    })
    assert.equal(result.implemented, true)
    assert.equal(result.branchPromoted, 'baseline_preserved')
    assert.ok(result.branches.some((branch) => branch.status === 'BRANCH_DISCARDED'))
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})

test('ESC multi-branch routing writes branch report and keeps baseline when no branch improves', async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'bf-multi-branch-'))
  try {
    await writeTinyBranchProject(workspace)
    const result = await runMultiBranchEscRouting({
      projectDir: workspace,
      workspace,
      cleanupPhase: {
        drcBefore: { issueCounts: { errors: 10, warnings: 1 } },
        drcAfter: { issueCounts: { errors: 10, warnings: 1 } },
        ercBefore: { issueCounts: { errors: 1, warnings: 1 } },
        ercAfter: { issueCounts: { errors: 1, warnings: 1 } },
      },
      input: { originalReferencePath: workspace },
    })
    assert.equal(result.status, 'ESC_MULTI_BRANCH_ROUTING_EVALUATED')
    assert.equal(result.externalAutorouterChecked, true)
    assert.ok(result.generatedFiles.some((file) => file.endsWith('boardforge-esc-multi-branch-routing.json')))
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})

test('ESC branch executes net batches and promotes real improvement', async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'bf-branch-improvement-'))
  try {
    await writeTinyBranchProject(workspace)
    let callCount = 0
    const result = await runMultiBranchEscRouting({
      projectDir: workspace,
      workspace,
      cleanupPhase: {
        drcBefore: { issueCounts: { errors: 10, warnings: 1 } },
        drcAfter: { issueCounts: { errors: 10, warnings: 1 } },
        ercBefore: { issueCounts: { errors: 1, warnings: 1 } },
        ercAfter: { issueCounts: { errors: 1, warnings: 1 } },
      },
      input: { originalReferencePath: workspace, maxRoutingBranches: 2 },
      branchExecutor: async ({ baselineMetrics, workload }) => {
        callCount += 1
        const improved = workload.id === 'conservative-continuation'
        return {
          before: baselineMetrics,
          after: improved
            ? { ...baselineMetrics, segments: baselineMetrics.segments + 3, netsRouted: baselineMetrics.netsRouted + 1, globalUnconnected: baselineMetrics.globalUnconnected - 1 }
            : { ...baselineMetrics },
          routesAttempted: 40,
          wroteCopper: improved,
          drcAfter: { issueCounts: { errors: improved ? 9 : 10, warnings: 1 } },
          ercAfter: { issueCounts: { errors: 1, warnings: 1 } },
        }
      },
    })
    assert.equal(callCount, 2)
    assert.match(result.bestBranch, /conservative-continuation/)
    assert.notEqual(result.branchPromoted, 'baseline_preserved')
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})

test('ESC no branch improvement creates repair task', async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'bf-no-branch-improvement-'))
  try {
    await writeTinyBranchProject(workspace)
    const result = await runMultiBranchEscRouting({
      projectDir: workspace,
      workspace,
      cleanupPhase: {
        drcBefore: { issueCounts: { errors: 10, warnings: 1 } },
        drcAfter: { issueCounts: { errors: 10, warnings: 1 } },
        ercBefore: { issueCounts: { errors: 1, warnings: 1 } },
        ercAfter: { issueCounts: { errors: 1, warnings: 1 } },
      },
      input: { originalReferencePath: workspace, maxRoutingBranches: 2 },
      branchExecutor: async ({ baselineMetrics }) => ({
        before: baselineMetrics,
        after: { ...baselineMetrics },
        routesAttempted: 40,
        wroteCopper: false,
        drcAfter: { issueCounts: { errors: 10, warnings: 1 } },
        ercAfter: { issueCounts: { errors: 1, warnings: 1 } },
      }),
    })
    assert.equal(result.noBranchImproved, true)
    assert.equal(result.internalRepairTask.status, 'completed')
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})

test('ESC branch execution allows precheck DRC trial in isolated branch', async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'bf-branch-drc-trial-'))
  try {
    await writeTinyBranchProject(workspace)
    const result = await runMultiBranchEscRouting({
      projectDir: workspace,
      workspace,
      cleanupPhase: {
        drcBefore: { issueCounts: { errors: 10, warnings: 1 } },
        drcAfter: { issueCounts: { errors: 10, warnings: 1 } },
        ercBefore: { issueCounts: { errors: 1, warnings: 1 } },
        ercAfter: { issueCounts: { errors: 1, warnings: 1 } },
      },
      input: { originalReferencePath: workspace, maxRoutingBranches: 1 },
      branchExecutor: async ({ input, baselineMetrics }) => ({
        before: baselineMetrics,
        after: { ...baselineMetrics, drcErrors: baselineMetrics.drcErrors - 1 },
        routesAttempted: input.branchAllowPrecheckDrcTrial !== false ? 1 : 0,
        wroteCopper: false,
        drcAfter: { issueCounts: { errors: 9, warnings: 1 } },
      }),
    })
    assert.equal(result.noBranchImproved, false)
    assert.match(result.bestBranch, /conservative-continuation/)
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})
