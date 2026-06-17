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
