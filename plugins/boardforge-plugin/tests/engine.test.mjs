import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { rectanglePoints } from '../lib/geometry.mjs'
import { getManufacturerProfile } from '../lib/manufacturers.mjs'
import { assignNetsToClasses } from '../lib/net-classes.mjs'
import { validateBoardOutline, validatePlacement } from '../lib/validation.mjs'
import { generateRoutingPlan } from '../lib/routing.mjs'
import { executeJob } from '../lib/jobs.mjs'
import { detectKiCadCli } from '../lib/kicad-cli.mjs'
import { detectKiCadLibraryRoots, normalize3dModelPath } from '../lib/library-adapter.mjs'
import { parseFootprintCourtyardFromText, parseFootprintPadsFromText, parseSymbolPinsFromText } from '../lib/component-compatibility.mjs'
import { scorePlacement } from '../lib/placement.mjs'
import { validateRoutingGeometry } from '../lib/routing-validation.mjs'

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

test('assigns USB and battery nets to strict classes', () => {
  const nets = assignNetsToClasses([{ name: 'USB_DP' }, { name: 'USB_DN' }, { name: 'VBAT' }, { name: 'SCL' }])
  assert.equal(nets.find((net) => net.name === 'USB_DP').className, 'USB_DIFF')
  assert.equal(nets.find((net) => net.name === 'VBAT').className, 'BATTERY')
  assert.equal(nets.find((net) => net.name === 'SCL').className, 'I2C')
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
  assert.equal(parseFootprintCourtyardFromText(footprintText).width, 2)
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
    const netlist = await executeJob({ id: 'netlist', type: 'generate_netlist', input: { projectPath } }, workspace)
    assert.ok(['NETLIST_GENERATED_NEEDS_REVIEW', 'NETLIST_GENERATED_NEEDS_ERC'].includes(netlist.status))
    assert.ok(netlist.netlist.nets.length > 0)
    const audit = await executeJob({ id: 'audit', type: 'run_design_audit', input: { projectPath } }, workspace)
    assert.ok(['DESIGN_AUDIT_NEEDS_FIX', 'DESIGN_AUDIT_NEEDS_REVIEW', 'DESIGN_AUDIT_READY_NEEDS_ERC_DRC'].includes(audit.status))
    assert.ok(audit.audit.netlist.nets.length > 0)
    assert.ok(Array.isArray(audit.audit.actions))
    const schematic = await executeJob({ id: 'sch', type: 'generate_schematic', input: { projectPath } }, workspace)
    assert.ok(['SCHEMATIC_MODEL_READY_NEEDS_ERC', 'SCHEMATIC_MODEL_NEEDS_ASSET_REVIEW'].includes(schematic.status))
    assert.ok(schematic.schematicModel.symbols.length >= 4)
    const schText = await readFile(path.join(workspace, projectPath, 'advanced-project.kicad_sch'), 'utf8')
    assert.match(schText, /BoardForge schematic model/)
    assert.match(schText, /\(symbol\s+/)
    assert.match(schText, /\(global_label\s+"GND"/)
    assert.match(schText, /\(wire\s+/)
    const edit = await executeJob({ id: 'edit', type: 'interactive_edit', input: { projectPath, prompt: 'make the board 10mm wider and round the corners' } }, workspace)
    assert.equal(edit.status, 'INTERACTIVE_EDITS_APPLIED_NEEDS_REVIEW')
    assert.ok(edit.edits.length >= 2)
    await executeJob({ id: 'drc', type: 'run_kicad_drc', input: { projectPath } }, workspace)
    const repair = await executeJob({ id: 'repair', type: 'plan_drc_repairs', input: { projectPath } }, workspace)
    assert.ok(['DRC_REPAIR_PLAN_READY_NEEDS_REVIEW', 'DRC_REPAIR_NO_ACTIONS_FOUND'].includes(repair.status))
    const state = JSON.parse(await readFile(path.join(workspace, projectPath, 'boardforge-project.json'), 'utf8'))
    assert.ok(state.componentDatabase)
    assert.ok(state.componentAudit)
    assert.ok(state.preflight)
    assert.ok(state.componentBindings)
    assert.ok(state.netlist)
    assert.ok(state.designAudit)
    assert.ok(state.schematic)
    assert.ok(state.interactiveEdits.length > 0)
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
    assert.equal(result.generatedFiles.length, 5)
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
    assert.equal(result.generatedFiles.some((file) => file.endsWith('boardforge-stackup-plan.json')), true)
    assert.equal(result.generatedFiles.some((file) => file.endsWith('boardforge-assembly-plan.json')), true)
    const schematic = await readFile(path.join(result.projectPath, 'sensor-project.kicad_sch'), 'utf8')
    assert.match(schematic, /kicad_sch/)
    assert.match(schematic, /BoardForge component manifest/)
    const pcb = await readFile(path.join(result.projectPath, 'sensor-project.kicad_pcb'), 'utf8')
    assert.match(pcb, /footprint/)
    assert.match(pcb, /USB-C/)
    const state = JSON.parse(await readFile(path.join(result.projectPath, 'boardforge-project.json'), 'utf8'))
    assert.equal(state.mode, 'full_project_scaffold')
    assert.ok(state.stackup.layerCount >= 2)
    assert.ok(state.assemblyPlan.sidePlan.length >= 4)
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
  assert.ok(['BLOCKED_MISSING_ADAPTER', 'NEEDS_FIX', 'PACKAGE_BLOCKED_MISSING_FILES'].includes(result.status))
  assert.deepEqual(result.generatedFiles, [])
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
    assert.equal(drc.status, 'DRC_NEEDS_FIX')
    assert.ok(drc.errors.length > 0)
    const erc = await executeJob({ id: 'erc', type: 'run_kicad_erc', input }, workspace)
    assert.equal(erc.status, 'ERC_PASSED')
    const blockedGerbers = await executeJob({ id: 'blocked_gerbers', type: 'export_gerbers', input }, workspace)
    assert.equal(blockedGerbers.status, 'GERBERS_BLOCKED_VALIDATION_REQUIRED')
    const readiness = await executeJob({ id: 'readiness', type: 'validate_manufacturing_readiness', input }, workspace)
    assert.equal(readiness.status, 'MANUFACTURING_READINESS_BLOCKED')
    assert.ok(readiness.errors.some((issue) => issue.code === 'DRC_ERRORS'))
    const gerbers = await executeJob({ id: 'gerbers', type: 'export_gerbers', input: { ...input, allowUnvalidatedExport: true } }, workspace)
    assert.equal(gerbers.status, 'GERBERS_EXPORTED')
    assert.ok(gerbers.generatedFiles.length > 0)
    const bom = await executeJob({ id: 'bom', type: 'export_bom', input: { ...input, allowUnvalidatedExport: true } }, workspace)
    assert.equal(bom.status, 'BOM_EXPORTED_FROM_PLACEMENT_NEEDS_REVIEW')
    const bomCsv = await readFile(path.join(workspace, 'adapter-project', 'fab', 'bom.csv'), 'utf8')
    assert.match(bomCsv, /BoardForge placed components/)
    assert.match(bomCsv, /USB-C/)
    const drill = await executeJob({ id: 'drill', type: 'export_drill_files', input: { ...input, allowUnvalidatedExport: true } }, workspace)
    assert.equal(drill.status, 'DRILL_EXPORTED')
    const cpl = await executeJob({ id: 'cpl', type: 'export_cpl', input: { ...input, allowUnvalidatedExport: true } }, workspace)
    assert.equal(cpl.status, 'CPL_EXPORTED')
    const pkg = await executeJob({ id: 'pkg', type: 'package_jlcpcb', input }, workspace)
    assert.equal(pkg.status, 'PACKAGE_BLOCKED_DRC_ERRORS')
    assert.deepEqual(pkg.generatedFiles, [])
    const state = JSON.parse(await readFile(path.join(workspace, 'adapter-project', 'boardforge-project.json'), 'utf8'))
    assert.equal(state.validation.drc.status, 'DRC_NEEDS_FIX')
    assert.equal(state.validation.erc.status, 'ERC_PASSED')
    assert.equal(state.exports.gerbers.status, 'GERBERS_EXPORTED')
    assert.equal(state.exports.drill.status, 'DRILL_EXPORTED')
    assert.equal(state.exports.bom.status, 'BOM_EXPORTED_FROM_PLACEMENT_NEEDS_REVIEW')
    assert.equal(state.exports.cpl.status, 'CPL_EXPORTED')
    assert.equal(state.exports.jlcpcb.status, 'PACKAGE_BLOCKED_DRC_ERRORS')
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})
