import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

test('MCP server exposes BoardForge tools and runs controlled jobs', async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'boardforge-mcp-test-'))
  const child = spawn(process.execPath, ['./plugins/boardforge-plugin/bin/boardforge-mcp.mjs', '--workspace', workspace], {
    cwd: process.cwd(),
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  const client = createJsonRpcClient(child)
  try {
    const initialized = await client.request('initialize', {})
    assert.equal(initialized.serverInfo.name, 'boardforge-plugin')
    assert.equal(initialized.capabilities.tools instanceof Object, true)

    const listed = await client.request('tools/list', {})
    assert.equal(listed.tools.some((tool) => tool.name === 'create_outline_board'), true)
    assert.equal(listed.tools.some((tool) => tool.name === 'resolve_component_assets'), true)
    assert.equal(listed.tools.some((tool) => tool.name === 'generate_schematic'), true)
    assert.equal(listed.tools.some((tool) => tool.name === 'interactive_edit'), true)
    assert.equal(listed.tools.some((tool) => tool.name === 'audit_component_library'), true)
    assert.equal(listed.tools.some((tool) => tool.name === 'run_project_preflight'), true)
    assert.equal(listed.tools.some((tool) => tool.name === 'list_board_categories'), true)
    assert.equal(listed.tools.some((tool) => tool.name === 'plan_board_category'), true)
    assert.equal(listed.tools.some((tool) => tool.name === 'validate_schematic_graph'), true)
    assert.equal(listed.tools.some((tool) => tool.name === 'synthesize_schematic_design'), true)
    assert.equal(listed.tools.some((tool) => tool.name === 'validate_schematic_pcb_sync'), true)
    assert.equal(listed.tools.some((tool) => tool.name === 'apply_schematic_pcb_sync'), true)
    assert.equal(listed.tools.some((tool) => tool.name === 'check_routing_readiness'), true)
    assert.equal(listed.tools.some((tool) => tool.name === 'calculate_power_routing'), true)
    assert.equal(listed.tools.some((tool) => tool.name === 'select_via_strategy'), true)
    assert.equal(listed.tools.some((tool) => tool.name === 'build_noise_map'), true)
    assert.equal(listed.tools.some((tool) => tool.name === 'generate_project_review_report'), true)
    assert.equal(listed.tools.some((tool) => tool.name === 'build_workflow_preset'), true)
    assert.equal(listed.tools.some((tool) => tool.name === 'run_boardforge_workflow'), true)
    assert.equal(listed.tools.some((tool) => tool.name === 'plan_mission_requirements'), true)
    assert.equal(listed.tools.some((tool) => tool.name === 'intake_user_bom'), true)
    assert.equal(listed.tools.some((tool) => tool.name === 'audit_user_bom'), true)
    assert.equal(listed.tools.some((tool) => tool.name === 'ingest_reference_design'), true)
    assert.equal(listed.tools.some((tool) => tool.name === 'synthesize_circuit_blocks'), true)
    assert.equal(listed.tools.some((tool) => tool.name === 'plan_production_pipeline'), true)
    assert.equal(listed.tools.some((tool) => tool.name === 'build_verified_demo_recipe'), true)
    assert.equal(listed.tools.some((tool) => tool.name === 'build_canonical_net_model'), true)
    assert.equal(listed.tools.some((tool) => tool.name === 'audit_asset_resolution'), true)
    assert.equal(listed.tools.some((tool) => tool.name === 'audit_placement_legality'), true)
    assert.equal(listed.tools.some((tool) => tool.name === 'compile_routing_execution_strategy'), true)
    assert.equal(listed.tools.some((tool) => tool.name === 'audit_release_export_gates'), true)
    assert.equal(listed.tools.some((tool) => tool.name === 'run_production_readiness_suite'), true)
    assert.equal(listed.tools.some((tool) => tool.name === 'classify_board_architecture'), true)
    assert.equal(listed.tools.some((tool) => tool.name === 'plan_hdi_manufacturing_strategy'), true)
    assert.equal(listed.tools.some((tool) => tool.name === 'audit_return_path_integrity'), true)
    assert.equal(listed.tools.some((tool) => tool.name === 'audit_creepage_clearance'), true)
    assert.equal(listed.tools.some((tool) => tool.name === 'plan_bringup_reliability_matrix'), true)
    assert.equal(listed.tools.some((tool) => tool.name === 'run_advanced_board_suite'), true)
    assert.equal(listed.tools.some((tool) => tool.name === 'plan_requirements'), true)
    assert.equal(listed.tools.some((tool) => tool.name === 'plan_pin_assignments'), true)
    assert.equal(listed.tools.some((tool) => tool.name === 'plan_power_tree'), true)
    assert.equal(listed.tools.some((tool) => tool.name === 'plan_stackup'), true)
    assert.equal(listed.tools.some((tool) => tool.name === 'plan_fanout'), true)
    assert.equal(listed.tools.some((tool) => tool.name === 'plan_signal_integrity'), true)
    assert.equal(listed.tools.some((tool) => tool.name === 'plan_test_strategy'), true)
    assert.equal(listed.tools.some((tool) => tool.name === 'run_dfm_checks'), true)
    assert.equal(listed.tools.some((tool) => tool.name === 'plan_complex_board'), true)
    assert.equal(listed.tools.some((tool) => tool.name === 'generate_design_constraints'), true)
    assert.equal(listed.tools.some((tool) => tool.name === 'generate_kicad_rules'), true)
    assert.equal(listed.tools.some((tool) => tool.name === 'score_routing_quality'), true)
    assert.equal(listed.tools.some((tool) => tool.name === 'generate_routing_report'), true)
    assert.equal(listed.tools.some((tool) => tool.name === 'classify_nets'), true)
    assert.equal(listed.tools.some((tool) => tool.name === 'autoroute_board'), true)
    assert.equal(listed.tools.some((tool) => tool.name === 'autoroute_and_apply'), true)
    assert.equal(listed.tools.some((tool) => tool.name === 'autoroute_drc_iteration'), true)
    assert.equal(listed.tools.some((tool) => tool.name === 'add_ground_zone'), true)
    assert.equal(listed.tools.some((tool) => tool.name === 'apply_routing_plan'), true)
    assert.equal(listed.tools.some((tool) => tool.name === 'apply_placement_plan'), true)
    assert.equal(listed.tools.some((tool) => tool.name === 'snapshot_project'), true)
    assert.equal(listed.tools.some((tool) => tool.name === 'generate_manufacturing_manifest'), true)
    assert.equal(listed.tools.some((tool) => tool.name === 'plan_erc_repairs'), true)
    assert.equal(listed.tools.some((tool) => tool.name === 'apply_safe_erc_repairs'), true)
    assert.equal(listed.tools.some((tool) => tool.name === 'validate_jlcpcb_package'), true)
    assert.equal(listed.tools.some((tool) => tool.name === 'validate_3d_model_coverage'), true)
    assert.equal(listed.tools.some((tool) => tool.name === 'audit_bom_sourcing'), true)
    assert.equal(listed.tools.some((tool) => tool.name === 'plan_pin_map_repairs'), true)
    assert.equal(listed.tools.some((tool) => tool.name === 'apply_pin_map_repairs'), true)
    assert.equal(listed.tools.some((tool) => tool.name === 'plan_copper_pours'), true)
    assert.equal(listed.tools.some((tool) => tool.name === 'solve_placement'), true)
    assert.equal(listed.tools.some((tool) => tool.name === 'plan_autoroute_repair_loop'), true)
    assert.equal(listed.tools.some((tool) => tool.name === 'analyze_routing_congestion'), true)
    assert.equal(listed.tools.some((tool) => tool.name === 'plan_escape_routing'), true)
    assert.equal(listed.tools.some((tool) => tool.name === 'plan_diff_pair_tuning'), true)
    assert.equal(listed.tools.some((tool) => tool.name === 'validate_power_integrity'), true)
    assert.equal(listed.tools.some((tool) => tool.name === 'analyze_thermal_bottlenecks'), true)
    assert.equal(listed.tools.some((tool) => tool.name === 'validate_assembly_orientation'), true)
    assert.equal(listed.tools.some((tool) => tool.name === 'estimate_board_cost'), true)
    assert.equal(listed.tools.some((tool) => tool.name === 'generate_engineering_questions'), true)
    assert.equal(listed.tools.some((tool) => tool.name === 'score_production_readiness'), true)
    assert.equal(listed.tools.some((tool) => tool.name === 'build_release_gate_report'), true)

    const status = await client.request('tools/call', { name: 'status', arguments: {} })
    const statusPayload = JSON.parse(status.content[0].text)
    assert.equal(statusPayload.status, 'ok')
    assert.equal(statusPayload.workspace, workspace)

    const category = await client.request('tools/call', {
      name: 'plan_board_category',
      arguments: {
        id: 'mcp_category',
        input: { projectName: 'MCP Motor', prompt: 'motor controller with MOSFETs gate driver shunt and CAN', manufacturerProfile: 'JLCPCB_STANDARD' },
      },
    })
    const categoryPayload = JSON.parse(category.content[0].text)
    assert.equal(categoryPayload.categoryPlan.category.id, 'motor_controller')

    const outline = await client.request('tools/call', {
      name: 'create_outline_board',
      arguments: {
        id: 'mcp_outline',
        input: { projectName: 'MCP Outline', widthMm: 42, heightMm: 28, shape: 'rounded_rectangle' },
      },
    })
    const outlinePayload = JSON.parse(outline.content[0].text)
    assert.equal(outlinePayload.status, 'OUTLINE_GENERATED_NEEDS_REVIEW')
    assert.equal(outlinePayload.generatedFiles.some((file) => file.endsWith('.kicad_pcb')), true)
    const snapshot = await client.request('tools/call', {
      name: 'snapshot_project',
      arguments: { id: 'mcp_snapshot', input: { projectPath: 'mcp-outline', label: 'mcp-smoke' } },
    })
    const snapshotPayload = JSON.parse(snapshot.content[0].text)
    assert.equal(snapshotPayload.status, 'PROJECT_SNAPSHOT_CREATED')
    const diff = await client.request('tools/call', {
      name: 'diff_project_snapshot',
      arguments: { id: 'mcp_diff', input: { projectPath: 'mcp-outline', snapshotId: snapshotPayload.snapshot.id } },
    })
    const diffPayload = JSON.parse(diff.content[0].text)
    assert.equal(diffPayload.status, 'PROJECT_DIFF_NO_CHANGES')
  } finally {
    child.kill('SIGTERM')
    await rm(workspace, { recursive: true, force: true })
  }
})

function createJsonRpcClient(child) {
  let nextId = 1
  let buffer = ''
  const pending = new Map()
  const stderr = []

  child.stderr.on('data', (chunk) => stderr.push(chunk.toString()))
  child.stdout.on('data', (chunk) => {
    buffer += chunk.toString()
    let newline = buffer.indexOf('\n')
    while (newline !== -1) {
      const line = buffer.slice(0, newline).trim()
      buffer = buffer.slice(newline + 1)
      if (line) resolveLine(line, pending)
      newline = buffer.indexOf('\n')
    }
  })
  child.on('exit', (code) => {
    for (const { reject } of pending.values()) reject(new Error(`MCP process exited ${code}: ${stderr.join('')}`))
    pending.clear()
  })

  return {
    request(method, params) {
      const id = nextId++
      const payload = { jsonrpc: '2.0', id, method, params }
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject })
        child.stdin.write(`${JSON.stringify(payload)}\n`)
        setTimeout(() => {
          if (!pending.has(id)) return
          pending.delete(id)
          reject(new Error(`Timed out waiting for MCP response to ${method}: ${stderr.join('')}`))
        }, 10000).unref()
      })
    },
  }
}

function resolveLine(line, pending) {
  const message = JSON.parse(line)
  const waiter = pending.get(message.id)
  if (!waiter) return
  pending.delete(message.id)
  if (message.error) waiter.reject(new Error(message.error.message))
  else waiter.resolve(message.result)
}
