import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

test('local server exposes status, KiCad status, and create project job', async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'boardforge-server-test-'))
  const port = 48000 + Math.floor(Math.random() * 1000)
  const child = spawn(process.execPath, ['./plugins/boardforge-plugin/bin/boardforge-server.mjs', '--port', String(port), '--workspace', workspace], {
    cwd: process.cwd(),
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  try {
    await waitForServer(port)
    const status = await getJson(`http://127.0.0.1:${port}/status`)
    assert.equal(status.status, 'ok')
    const kicad = await getJson(`http://127.0.0.1:${port}/kicad/status`)
    assert.equal(typeof kicad.available, 'boolean')
    const created = await postJson(`http://127.0.0.1:${port}/jobs/create-project`, {
      id: 'server_project',
      input: { projectName: 'Server Project', templateId: 'ESP32_S3_SENSOR' },
    })
    assert.equal(created.status, 'KICAD_PROJECT_CREATED_NEEDS_REVIEW')
    assert.equal(created.generatedFiles.some((file) => file.endsWith('.kicad_pcb')), true)
    const fetched = await getJson(`http://127.0.0.1:${port}/jobs/server_project`)
    assert.equal(fetched.status, 'KICAD_PROJECT_CREATED_NEEDS_REVIEW')
    const search = await postJson(`http://127.0.0.1:${port}/jobs/search-library`, {
      id: 'server_library_search',
      input: { query: '0603 resistor', maxAssets: 2000, limit: 5 },
    })
    assert.equal(search.status, 'LIBRARY_SEARCH_COMPLETE_NEEDS_REVIEW')
    const plan = await postJson(`http://127.0.0.1:${port}/jobs/plan-requirements`, {
      id: 'server_plan',
      input: { projectName: 'Server ESP32 sensor', prompt: 'ESP32-S3 USB I2C sensor with SWD debug' },
    })
    assert.equal(plan.status, 'REQUIREMENTS_PLAN_READY_NEEDS_REVIEW')
    assert.ok(plan.components.length > 0)
    const category = await postJson(`http://127.0.0.1:${port}/jobs/plan-category`, {
      id: 'server_category',
      input: { projectName: 'Server industrial IO', prompt: 'industrial RS485 isolated terminal block relay controller', manufacturerProfile: 'JLCPCB_STANDARD' },
    })
    assert.equal(category.categoryPlan.category.id, 'industrial_io')
    const pins = await postJson(`http://127.0.0.1:${port}/jobs/plan-pin-assignments`, {
      id: 'server_pins',
      input: { components: plan.components, nets: plan.nets, interfaces: ['USB', 'I2C', 'SWD'] },
    })
    assert.ok(['PIN_ASSIGNMENT_NEEDS_REVIEW', 'PIN_ASSIGNMENT_READY_NEEDS_REVIEW'].includes(pins.status))
    assert.equal(pins.pinAssignments.controller.ref, 'U1')
    const schematicGraph = await postJson(`http://127.0.0.1:${port}/jobs/validate-schematic-graph`, {
      id: 'server_schematic_graph',
      input: { components: plan.components, nets: plan.nets },
    })
    assert.ok(['SCHEMATIC_GRAPH_NEEDS_FIX', 'SCHEMATIC_GRAPH_NEEDS_REVIEW', 'SCHEMATIC_GRAPH_READY_NEEDS_ERC'].includes(schematicGraph.status))
    const schematicSynthesis = await postJson(`http://127.0.0.1:${port}/jobs/synthesize-schematic`, {
      id: 'server_schematic_synthesis',
      input: { components: plan.components, nets: plan.nets, interfaces: ['USB', 'I2C', 'SWD'] },
    })
    assert.ok(['SCHEMATIC_SYNTHESIS_BLOCKED', 'SCHEMATIC_SYNTHESIS_NEEDS_REVIEW', 'SCHEMATIC_SYNTHESIS_READY_NEEDS_ERC'].includes(schematicSynthesis.status))
    assert.ok(schematicSynthesis.synthesis.graph.edges.length > 0)
    const schematicPcbSync = await postJson(`http://127.0.0.1:${port}/jobs/validate-schematic-pcb-sync`, {
      id: 'server_schematic_pcb_sync',
      input: { projectPath: 'server-project' },
    })
    assert.ok(['SCHEMATIC_PCB_SYNC_BLOCKED', 'SCHEMATIC_PCB_SYNC_NEEDS_REVIEW', 'SCHEMATIC_PCB_SYNC_READY_NEEDS_ERC_DRC'].includes(schematicPcbSync.status))
    const applySchematicPcbSync = await postJson(`http://127.0.0.1:${port}/jobs/apply-schematic-pcb-sync`, {
      id: 'server_schematic_pcb_sync_apply',
      input: { projectPath: 'server-project' },
    })
    assert.ok(['PCB_NET_SYNC_APPLIED_NEEDS_DRC', 'PCB_NET_SYNC_NO_CHANGES'].includes(applySchematicPcbSync.status))
    const modelCoverage = await postJson(`http://127.0.0.1:${port}/jobs/validate-3d-models`, {
      id: 'server_model_coverage',
      input: { projectPath: 'server-project' },
    })
    assert.ok(['MODEL_3D_COVERAGE_BLOCKED', 'MODEL_3D_COVERAGE_NEEDS_REVIEW', 'MODEL_3D_COVERAGE_READY'].includes(modelCoverage.status))
    const bomSourcing = await postJson(`http://127.0.0.1:${port}/jobs/audit-bom-sourcing`, {
      id: 'server_bom_sourcing',
      input: { projectPath: 'server-project' },
    })
    assert.ok(['BOM_SOURCING_BLOCKED', 'BOM_SOURCING_NEEDS_REVIEW', 'BOM_SOURCING_READY_NEEDS_STOCK_CHECK'].includes(bomSourcing.status))
    const mission = await postJson(`http://127.0.0.1:${port}/jobs/plan-mission`, {
      id: 'server_mission',
      input: { projectName: 'Server drone', prompt: 'drone that flies 15 miles and lasts 30 minutes' },
    })
    assert.equal(mission.status, 'MISSION_PLAN_NEEDS_USER_DECISIONS')
    assert.equal(mission.missionPlan.requirementsPlan.selectedCircuits.includes('long_range_uav_support'), true)
    const bomAudit = await postJson(`http://127.0.0.1:${port}/jobs/audit-bom`, {
      id: 'server_bom_audit',
      input: { projectName: 'Server drone', prompt: 'drone that flies 15 miles and lasts 30 minutes', bomText: 'Ref,Value,MPN,Package\\nU1,STM32 MCU,STM32F405,LQFP-64\\nU2,ICM-42688 IMU,ICM-42688,LGA-14' },
    })
    assert.ok(['USER_BOM_AUDIT_NEEDS_FIX', 'USER_BOM_AUDIT_NEEDS_REVIEW'].includes(bomAudit.status))
    assert.equal(bomAudit.missingFunctions.some((gap) => gap.group === 'GNSS'), true)
    const reference = await postJson(`http://127.0.0.1:${port}/jobs/ingest-reference`, {
      id: 'server_reference',
      input: { projectPath: 'server-project', referenceText: 'USB-C sensor reference design with ESD, CC resistors, 3V3 LDO, decoupling, SWD reset boot, 90 ohm DP DN.' },
    })
    assert.ok(['REFERENCE_DESIGN_INGESTED', 'REFERENCE_DESIGN_NEEDS_REVIEW'].includes(reference.status))
    const circuitBlocks = await postJson(`http://127.0.0.1:${port}/jobs/synthesize-circuit-blocks`, {
      id: 'server_circuit_blocks',
      input: { projectPath: 'server-project', referenceDesign: reference.referenceDesign },
    })
    assert.ok(['CIRCUIT_BLOCKS_READY_NEEDS_REVIEW', 'CIRCUIT_BLOCKS_NEED_REQUIREMENTS'].includes(circuitBlocks.status))
    const stackup = await postJson(`http://127.0.0.1:${port}/jobs/plan-stackup`, {
      id: 'server_stackup',
      input: { projectName: 'Server HDI sensor', prompt: 'compact USB sensor with blind vias', layerCount: 6, manufacturerProfile: 'ADVANCED_HDI_REVIEW', allowBlindVias: true },
    })
    assert.equal(stackup.status, 'STACKUP_PLAN_NEEDS_REVIEW')
    assert.equal(stackup.stackup.hdi.allowed, true)
    const si = await postJson(`http://127.0.0.1:${port}/jobs/plan-signal-integrity`, {
      id: 'server_si',
      input: { projectName: 'Server USB board', stackup: stackup.stackup, nets: [{ name: 'USB_DP' }, { name: 'USB_DN' }], board: { widthMm: 40, heightMm: 28, layerCount: 4 } },
    })
    assert.ok(['SIGNAL_INTEGRITY_NEEDS_REVIEW', 'SIGNAL_INTEGRITY_READY'].includes(si.status))
    assert.equal(si.signalIntegrity.highSpeedNetCount, 2)
    const testStrategy = await postJson(`http://127.0.0.1:${port}/jobs/plan-test-strategy`, {
      id: 'server_test_strategy',
      input: { projectPath: 'server-project' },
    })
    assert.ok(['TEST_STRATEGY_BLOCKED', 'TEST_STRATEGY_NEEDS_REVIEW', 'TEST_STRATEGY_READY_NEEDS_REVIEW'].includes(testStrategy.status))
    assert.ok(Array.isArray(testStrategy.testStrategy.requiredTestPoints))
    const audit = await postJson(`http://127.0.0.1:${port}/jobs/audit-component-library`, {
      id: 'server_component_audit',
      input: { projectPath: 'server-project' },
    })
    assert.ok(['COMPONENT_LIBRARY_AUDIT_NEEDS_FIX', 'COMPONENT_LIBRARY_AUDIT_NEEDS_REVIEW', 'COMPONENT_LIBRARY_AUDIT_READY_NEEDS_REVIEW'].includes(audit.status))
    const pinRepairs = await postJson(`http://127.0.0.1:${port}/jobs/plan-pin-map-repairs`, {
      id: 'server_pin_repairs',
      input: { projectPath: 'server-project' },
    })
    assert.ok(['PIN_MAP_REPAIR_NEEDS_REVIEW', 'PIN_MAP_REPAIR_READY_NEEDS_REVIEW', 'PIN_MAP_REPAIR_NO_ACTIONS'].includes(pinRepairs.status))
    const appliedPinRepairs = await postJson(`http://127.0.0.1:${port}/jobs/apply-pin-map-repairs`, {
      id: 'server_apply_pin_repairs',
      input: { projectPath: 'server-project' },
    })
    assert.ok(['PIN_MAP_REPAIRS_APPLIED_NEEDS_BINDING_RECHECK', 'PIN_MAP_REPAIR_NEEDS_REVIEW', 'PIN_MAP_REPAIR_READY_NEEDS_REVIEW', 'PIN_MAP_REPAIR_NO_ACTIONS'].includes(appliedPinRepairs.status))
    const preflight = await postJson(`http://127.0.0.1:${port}/jobs/preflight`, {
      id: 'server_preflight',
      input: { projectPath: 'server-project' },
    })
    assert.ok(['PROJECT_PREFLIGHT_BLOCKED', 'PROJECT_PREFLIGHT_NEEDS_REVIEW', 'PROJECT_PREFLIGHT_READY_NEEDS_REVIEW'].includes(preflight.status))
    const manifest = await postJson(`http://127.0.0.1:${port}/jobs/manufacturing-manifest`, {
      id: 'server_manifest',
      input: { projectPath: 'server-project' },
    })
    assert.ok(['MANUFACTURING_MANIFEST_BLOCKED', 'MANUFACTURING_MANIFEST_NEEDS_REVIEW', 'MANUFACTURING_MANIFEST_READY_NEEDS_REVIEW'].includes(manifest.status))
    assert.equal(manifest.generatedFiles.some((file) => file.endsWith('boardforge-manufacturing-manifest.json')), true)
    const jlcpcbValidation = await postJson(`http://127.0.0.1:${port}/jobs/validate-jlcpcb-package`, {
      id: 'server_jlcpcb_validation',
      input: { projectPath: 'server-project' },
    })
    assert.ok(['JLCPCB_PACKAGE_BLOCKED', 'JLCPCB_PACKAGE_NEEDS_REVIEW', 'JLCPCB_PACKAGE_READY_NEEDS_FINAL_HUMAN_REVIEW'].includes(jlcpcbValidation.status))
    assert.equal(jlcpcbValidation.generatedFiles.some((file) => file.endsWith('boardforge-jlcpcb-package-validation.json')), true)
    const routeScore = await postJson(`http://127.0.0.1:${port}/jobs/score-routing`, {
      id: 'server_route_score',
      input: { nets: [{ name: 'USB_DP' }, { name: 'USB_DN' }], board: { widthMm: 40, heightMm: 30 } },
    })
    assert.ok(['ROUTING_QUALITY_NEEDS_FIX', 'ROUTING_QUALITY_NEEDS_REVIEW', 'ROUTING_QUALITY_READY_NEEDS_DRC'].includes(routeScore.status))
    assert.equal(typeof routeScore.routeQuality.score, 'number')
    const readiness = await postJson(`http://127.0.0.1:${port}/jobs/routing-readiness`, {
      id: 'server_routing_readiness',
      input: { nets: [{ name: 'USB_DP' }, { name: 'USB_DN' }], board: { widthMm: 40, heightMm: 30, outline: [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 30 }, { x: 0, y: 30 }] } },
    })
    assert.ok(['ROUTING_READINESS_BLOCKED', 'ROUTING_READINESS_NEEDS_REVIEW', 'ROUTING_READINESS_READY'].includes(readiness.status))
    const powerRouting = await postJson(`http://127.0.0.1:${port}/jobs/power-routing`, {
      id: 'server_power_routing',
      input: { nets: [{ name: 'VBAT' }, { name: '5V' }], rails: [{ name: 'VBAT', currentMa: 4000 }] },
    })
    assert.ok(['POWER_ROUTING_NEEDS_FIX', 'POWER_ROUTING_NEEDS_REVIEW', 'POWER_ROUTING_READY_NEEDS_DRC'].includes(powerRouting.status))
    const viaStrategy = await postJson(`http://127.0.0.1:${port}/jobs/via-strategy`, {
      id: 'server_via_strategy',
      input: { nets: [{ name: 'USB_DP' }, { name: 'VBAT' }], board: { layerCount: 4 } },
    })
    assert.ok(['VIA_STRATEGY_BLOCKED', 'VIA_STRATEGY_NEEDS_REVIEW', 'VIA_STRATEGY_READY'].includes(viaStrategy.status))
    const copperPours = await postJson(`http://127.0.0.1:${port}/jobs/copper-pours`, {
      id: 'server_copper_pours',
      input: { projectPath: 'server-project', nets: [{ name: 'GND' }, { name: '3V3' }], maxStitchingVias: 8 },
    })
    assert.ok(['COPPER_POUR_PLAN_READY_NEEDS_DRC', 'COPPER_POUR_PLAN_NEEDS_REVIEW'].includes(copperPours.status))
    assert.equal(copperPours.generatedFiles.some((file) => file.endsWith('boardforge-copper-pour-plan.json')), true)
    const questions = await postJson(`http://127.0.0.1:${port}/jobs/engineering-questions`, {
      id: 'server_engineering_questions',
      input: { projectPath: 'server-project', prompt: 'compact USB sensor with buck regulator' },
    })
    assert.ok(['ENGINEERING_QUESTIONS_REQUIRED', 'ENGINEERING_QUESTIONS_COMPLETE'].includes(questions.status))
    const congestion = await postJson(`http://127.0.0.1:${port}/jobs/routing-congestion`, {
      id: 'server_congestion',
      input: { projectPath: 'server-project', nets: [{ name: 'USB_DP' }, { name: 'USB_DN' }] },
    })
    assert.ok(['ROUTING_CONGESTION_BLOCKED', 'ROUTING_CONGESTION_NEEDS_REVIEW', 'ROUTING_CONGESTION_ACCEPTABLE'].includes(congestion.status))
    const releaseGate = await postJson(`http://127.0.0.1:${port}/jobs/release-gate`, {
      id: 'server_release_gate',
      input: { projectPath: 'server-project' },
    })
    assert.ok(['RELEASE_GATE_BLOCKED', 'RELEASE_GATE_READY_FOR_FINAL_REVIEW'].includes(releaseGate.status))
    const repairLoop = await postJson(`http://127.0.0.1:${port}/jobs/autoroute-repair-loop`, {
      id: 'server_repair_loop',
      input: { projectPath: 'server-project', drcReport: { issues: [{ code: 'CLEARANCE' }] } },
    })
    assert.ok(['AUTOROUTE_REPAIR_LOOP_READY_NEEDS_REVIEW', 'AUTOROUTE_REPAIR_LOOP_BASELINE_READY'].includes(repairLoop.status))
    const demoRecipe = await postJson(`http://127.0.0.1:${port}/jobs/verified-demo-recipe`, {
      id: 'server_demo_recipe',
      input: { projectPath: 'server-project', preset: 'usb_sensor' },
    })
    assert.equal(demoRecipe.status, 'VERIFIED_DEMO_RECIPE_READY')
    const canonicalNetModel = await postJson(`http://127.0.0.1:${port}/jobs/canonical-net-model`, {
      id: 'server_canonical_net_model',
      input: { projectPath: 'server-project', components: plan.components, nets: plan.nets },
    })
    assert.ok(['CANONICAL_NET_MODEL_BLOCKED', 'CANONICAL_NET_MODEL_NEEDS_REVIEW', 'CANONICAL_NET_MODEL_READY'].includes(canonicalNetModel.status))
    const assetAudit = await postJson(`http://127.0.0.1:${port}/jobs/audit-assets`, {
      id: 'server_asset_audit',
      input: { projectPath: 'server-project', components: plan.components },
    })
    assert.ok(['ASSET_RESOLUTION_BLOCKED', 'ASSET_RESOLUTION_NEEDS_REVIEW', 'ASSET_RESOLUTION_READY'].includes(assetAudit.status))
    const placementAudit = await postJson(`http://127.0.0.1:${port}/jobs/audit-placement-legality`, {
      id: 'server_placement_audit',
      input: { projectPath: 'server-project', board: { widthMm: 50, heightMm: 30, outline: [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 30 }, { x: 0, y: 30 }] }, components: [{ ref: 'J1', x: 4, y: 15, width: 4, height: 4 }, { ref: 'U1', x: 25, y: 15, width: 8, height: 8 }] },
    })
    assert.ok(['PLACEMENT_LEGALITY_BLOCKED', 'PLACEMENT_LEGALITY_NEEDS_REVIEW', 'PLACEMENT_LEGALITY_READY_NEEDS_DRC'].includes(placementAudit.status))
    const routingStrategy = await postJson(`http://127.0.0.1:${port}/jobs/routing-execution-strategy`, {
      id: 'server_routing_strategy',
      input: { projectPath: 'server-project', board: { widthMm: 50, heightMm: 30, layerCount: 4 }, nets: [{ name: 'USB_DP' }, { name: 'USB_DN' }, { name: '3V3' }] },
    })
    assert.equal(routingStrategy.status, 'ROUTING_EXECUTION_STRATEGY_READY_NEEDS_REVIEW')
    const releaseExportGates = await postJson(`http://127.0.0.1:${port}/jobs/release-export-gates`, {
      id: 'server_release_export_gates',
      input: { projectPath: 'server-project', components: plan.components, nets: plan.nets },
    })
    assert.ok(['RELEASE_EXPORT_GATES_BLOCKED', 'RELEASE_EXPORT_GATES_NEED_REVIEW', 'RELEASE_EXPORT_GATES_READY_FOR_FINAL_REVIEW'].includes(releaseExportGates.status))
    assert.equal(releaseExportGates.releaseExportGateAudit.releaseExportGates.checks.length, 25)
    const productionSuite = await postJson(`http://127.0.0.1:${port}/jobs/production-readiness-suite`, {
      id: 'server_production_suite',
      input: { projectPath: 'server-project', components: plan.components, nets: plan.nets },
    })
    assert.ok(['PRODUCTION_SUITE_BLOCKED', 'PRODUCTION_SUITE_NEEDS_REVIEW', 'PRODUCTION_SUITE_READY_FOR_FINAL_REVIEW'].includes(productionSuite.status))
    const architecture = await postJson(`http://127.0.0.1:${port}/jobs/classify-board-architecture`, {
      id: 'server_architecture',
      input: { projectPath: 'server-project', prompt: 'compact industrial USB Ethernet RF sensor with PoE isolation and blind vias' },
    })
    assert.ok(['BOARD_ARCHITECTURE_CLASSIFIED', 'BOARD_ARCHITECTURE_NEEDS_REVIEW'].includes(architecture.status))
    const hdiStrategy = await postJson(`http://127.0.0.1:${port}/jobs/hdi-manufacturing-strategy`, {
      id: 'server_hdi_strategy',
      input: { projectPath: 'server-project', board: { widthMm: 25, heightMm: 20, layerCount: 6, allowBlindVias: true }, allowBlindVias: true },
    })
    assert.ok(['HDI_MANUFACTURING_STRATEGY_BLOCKED', 'HDI_MANUFACTURING_STRATEGY_NEEDS_REVIEW', 'HDI_MANUFACTURING_STRATEGY_READY'].includes(hdiStrategy.status))
    const returnPathIntegrity = await postJson(`http://127.0.0.1:${port}/jobs/return-path-integrity`, {
      id: 'server_return_path',
      input: { projectPath: 'server-project', board: { layerCount: 4 }, nets: [{ name: 'USB_DP' }, { name: 'USB_DN' }, { name: 'GND' }] },
    })
    assert.ok(['RETURN_PATH_INTEGRITY_BLOCKED', 'RETURN_PATH_INTEGRITY_NEEDS_REVIEW', 'RETURN_PATH_INTEGRITY_READY'].includes(returnPathIntegrity.status))
    const creepageClearance = await postJson(`http://127.0.0.1:${port}/jobs/creepage-clearance`, {
      id: 'server_creepage',
      input: { projectPath: 'server-project', prompt: '60V PoE isolated sensor with surge protection', designIntent: { zones: [{ id: 'primary-secondary-isolation', polygon: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }] }] } },
    })
    assert.ok(['CREEPAGE_CLEARANCE_BLOCKED', 'CREEPAGE_CLEARANCE_NEEDS_REVIEW', 'CREEPAGE_CLEARANCE_READY'].includes(creepageClearance.status))
    const bringupMatrix = await postJson(`http://127.0.0.1:${port}/jobs/bringup-reliability-matrix`, {
      id: 'server_bringup',
      input: { projectPath: 'server-project', nets: [{ name: '5V' }, { name: '3V3' }, { name: 'USB_DP' }, { name: 'USB_DN' }] },
    })
    assert.ok(['BRINGUP_RELIABILITY_MATRIX_NEEDS_REVIEW', 'BRINGUP_RELIABILITY_MATRIX_READY'].includes(bringupMatrix.status))
    const advancedSuite = await postJson(`http://127.0.0.1:${port}/jobs/advanced-board-suite`, {
      id: 'server_advanced_suite',
      input: { projectPath: 'server-project', prompt: 'compact industrial USB Ethernet RF sensor with PoE isolation and blind vias', nets: [{ name: '5V' }, { name: '3V3' }, { name: 'USB_DP' }, { name: 'USB_DN' }, { name: 'GND' }] },
    })
    assert.ok(['ADVANCED_BOARD_SUITE_BLOCKED', 'ADVANCED_BOARD_SUITE_NEEDS_REVIEW', 'ADVANCED_BOARD_SUITE_READY'].includes(advancedSuite.status))
    const routeReport = await postJson(`http://127.0.0.1:${port}/jobs/routing-report`, {
      id: 'server_route_report',
      input: { nets: [{ name: 'USB_DP' }, { name: 'USB_DN' }], board: { widthMm: 40, heightMm: 30 } },
    })
    assert.ok(['ROUTING_REPORT_NEEDS_FIX', 'ROUTING_REPORT_PARTIAL_NEEDS_REVIEW', 'ROUTING_REPORT_READY_NEEDS_DRC'].includes(routeReport.status))
    assert.equal(typeof routeReport.routingReport.summary.totalNets, 'number')
    const autoroute = await postJson(`http://127.0.0.1:${port}/jobs/autoroute`, {
      id: 'server_autoroute',
      input: {
        board: { widthMm: 50, heightMm: 30, layerCount: 2, outline: [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 30 }, { x: 0, y: 30 }] },
        components: [
          { ref: 'J1', x: 6, y: 8, width: 3, height: 3, pinMap: { '1': 'SIG' } },
          { ref: 'U1', x: 44, y: 22, width: 3, height: 3, pinMap: { '1': 'SIG' } },
          { ref: 'KEEP1', x: 25, y: 15, width: 10, height: 14, pinMap: {} },
        ],
        nets: [{ name: 'SIG' }],
      },
    })
    assert.equal(autoroute.status, 'AUTOROUTE_READY_NEEDS_DRC')
    assert.equal(autoroute.routingPlan.routedNets.includes('SIG'), true)
    const snapshot = await postJson(`http://127.0.0.1:${port}/jobs/snapshot`, {
      id: 'server_snapshot',
      input: { projectPath: 'server-project', label: 'server-smoke' },
    })
    assert.equal(snapshot.status, 'PROJECT_SNAPSHOT_CREATED')
    const listed = await postJson(`http://127.0.0.1:${port}/jobs/list-snapshots`, {
      id: 'server_snapshots',
      input: { projectPath: 'server-project' },
    })
    assert.equal(listed.count, 1)
    const diff = await postJson(`http://127.0.0.1:${port}/jobs/diff-snapshot`, {
      id: 'server_snapshot_diff',
      input: { projectPath: 'server-project', snapshotId: snapshot.snapshot.id },
    })
    assert.equal(diff.status, 'PROJECT_DIFF_NO_CHANGES')
  } finally {
    child.kill('SIGTERM')
    await rm(workspace, { recursive: true, force: true })
  }
})

async function waitForServer(port) {
  const started = Date.now()
  while (Date.now() - started < 10000) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/status`)
      if (response.ok) return
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  }
  throw new Error('server did not start')
}

async function getJson(url) {
  const response = await fetch(url)
  assert.equal(response.ok, true)
  return response.json()
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  assert.equal(response.ok, true)
  return response.json()
}
