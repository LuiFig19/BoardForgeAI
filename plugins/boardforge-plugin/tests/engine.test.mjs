import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pointInPolygon, rectanglePoints } from '../lib/geometry.mjs'
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
import { scoreRoutingPlan } from '../lib/routing-quality.mjs'
import { scanKiCadProject } from '../lib/kicad.mjs'
import { runAutotracerPlanning } from '../lib/autotracer-engine.mjs'
import { autorouteBoard } from '../lib/autorouter.mjs'

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
  assert.ok(result.components.every((component) => component.procurement))
  assert.ok(result.components.every((component) => component.footprintConfidence))
  assert.ok(result.components.every((component) => typeof component.selectionScore === 'number'))
  assert.ok(result.procurementSummary.reviewRequired >= 1)
  assert.ok(result.alternates.some((item) => Array.isArray(item.candidates)))
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
  assert.equal(dp.strategy, 'controlled_astar_matched_diff_pair')
  assert.equal(dn.strategy, 'controlled_astar_matched_diff_pair')
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
    assert.equal(typeof iteration.report.issueCounts.errors, 'number')
    const state = JSON.parse(await readFile(path.join(workspace, 'autoroute-drc-test', 'boardforge-project.json'), 'utf8'))
    assert.equal(Boolean(state.validation.autorouteDrc), true)
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
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
    const schText = await readFile(path.join(workspace, projectPath, 'advanced-project.kicad_sch'), 'utf8')
    assert.match(schText, /BoardForge schematic model/)
    assert.match(schText, /\(symbol\s+/)
    assert.match(schText, /\(global_label\s+"GND"/)
    assert.match(schText, /\(wire\s+/)
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
    assert.ok(['DRC_PASSED', 'DRC_NEEDS_FIX'].includes(drc.status))
    assert.equal(typeof drc.report.issueCounts.errors, 'number')
    assert.equal(drc.status === 'DRC_NEEDS_FIX', drc.report.issueCounts.errors > 0)
    const erc = await executeJob({ id: 'erc', type: 'run_kicad_erc', input }, workspace)
    assert.equal(erc.status, 'ERC_PASSED')
    const blockedGerbers = await executeJob({ id: 'blocked_gerbers', type: 'export_gerbers', input }, workspace)
    assert.equal(blockedGerbers.status, 'GERBERS_BLOCKED_VALIDATION_REQUIRED')
    const readiness = await executeJob({ id: 'readiness', type: 'validate_manufacturing_readiness', input }, workspace)
    assert.equal(readiness.status, 'MANUFACTURING_READINESS_BLOCKED')
    assert.ok(readiness.errors.some((issue) => ['DRC_ERRORS', 'BOM_MISSING', 'CPL_MISSING'].includes(issue.code)))
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
    const jlcpcbValidation = await executeJob({ id: 'jlcpcb_validation', type: 'validate_jlcpcb_package', input }, workspace)
    assert.ok(['JLCPCB_PACKAGE_BLOCKED', 'JLCPCB_PACKAGE_NEEDS_REVIEW', 'JLCPCB_PACKAGE_READY_NEEDS_FINAL_HUMAN_REVIEW'].includes(jlcpcbValidation.status))
    assert.ok(jlcpcbValidation.generatedFiles.some((file) => file.endsWith('boardforge-jlcpcb-package-validation.json')))
    const pkg = await executeJob({ id: 'pkg', type: 'package_jlcpcb', input }, workspace)
    assert.ok(['PACKAGE_BLOCKED_DRC_ERRORS', 'PACKAGE_BLOCKED_MISSING_FILES', 'PACKAGE_BLOCKED_JLCPCB_VALIDATION'].includes(pkg.status))
    if (pkg.status === 'PACKAGE_BLOCKED_JLCPCB_VALIDATION') assert.ok(pkg.generatedFiles.some((file) => file.endsWith('boardforge-jlcpcb-package-validation.json')))
    else assert.deepEqual(pkg.generatedFiles, [])
    const state = JSON.parse(await readFile(path.join(workspace, 'adapter-project', 'boardforge-project.json'), 'utf8'))
    assert.ok(['DRC_PASSED', 'DRC_NEEDS_FIX'].includes(state.validation.drc.status))
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
