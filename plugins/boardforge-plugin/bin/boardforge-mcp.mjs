#!/usr/bin/env node
import path from 'node:path'
import readline from 'node:readline'
import { executeJob } from '../lib/jobs.mjs'
import { detectKiCadCli } from '../lib/kicad-cli.mjs'

function argValue(name) {
  const index = process.argv.indexOf(name)
  return index === -1 ? null : process.argv[index + 1] || null
}

const workspace = path.resolve(argValue('--workspace') || process.env.BOARDFORGE_WORKSPACE || process.cwd())
const protocolVersion = '2024-11-05'

const toolToJobType = {
  create_outline_board: 'create_outline_board',
  create_kicad_project: 'create_kicad_project',
  apply_edge_cuts: 'apply_edge_cuts',
  validate_board_outline: 'validate_board_outline',
  snapshot_project: 'snapshot_project',
  list_project_snapshots: 'list_project_snapshots',
  diff_project_snapshot: 'diff_project_snapshot',
  restore_project_snapshot: 'restore_project_snapshot',
  run_project_preflight: 'run_project_preflight',
  list_board_categories: 'list_board_categories',
  plan_board_category: 'plan_board_category',
  build_workflow_preset: 'build_workflow_preset',
  run_boardforge_workflow: 'run_boardforge_workflow',
  plan_mission_requirements: 'plan_mission_requirements',
  intake_user_bom: 'intake_user_bom',
  audit_user_bom: 'audit_user_bom',
  plan_requirements: 'plan_requirements',
  plan_pin_assignments: 'plan_pin_assignments',
  plan_power_tree: 'plan_power_tree',
  plan_stackup: 'plan_stackup',
  plan_fanout: 'plan_fanout',
  plan_signal_integrity: 'plan_signal_integrity',
  plan_test_strategy: 'plan_test_strategy',
  run_dfm_checks: 'run_dfm_checks',
  compare_manufacturers: 'compare_manufacturers',
  plan_complex_board: 'plan_complex_board',
  generate_design_constraints: 'generate_design_constraints',
  generate_kicad_rules: 'generate_kicad_rules',
  sync_kicad_libraries: 'sync_kicad_libraries',
  search_library_assets: 'search_library_assets',
  resolve_component_assets: 'resolve_component_assets',
  sync_component_database: 'sync_component_database',
  resolve_bom_parts: 'resolve_bom_parts',
  audit_component_library: 'audit_component_library',
  validate_component_bindings: 'validate_component_bindings',
  validate_manufacturing_readiness: 'validate_manufacturing_readiness',
  generate_manufacturing_manifest: 'generate_manufacturing_manifest',
  generate_netlist: 'generate_netlist',
  run_design_audit: 'run_design_audit',
  generate_schematic: 'generate_schematic',
  plan_erc_repairs: 'plan_erc_repairs',
  apply_safe_erc_repairs: 'apply_safe_erc_repairs',
  plan_drc_repairs: 'plan_drc_repairs',
  apply_safe_drc_repairs: 'apply_safe_drc_repairs',
  interactive_edit: 'interactive_edit',
  find_missing_footprints: 'find_missing_footprints',
  link_3d_models: 'link_3d_models',
  scan_kicad_project: 'scan_kicad_project',
  run_kicad_drc: 'run_kicad_drc',
  run_kicad_erc: 'run_kicad_erc',
  generate_routing_plan: 'generate_routing_plan',
  generate_routing_report: 'generate_routing_report',
  classify_nets: 'classify_nets',
  assign_net_classes: 'assign_net_classes',
  autoroute_board: 'autoroute_board',
  autoroute_and_apply: 'autoroute_and_apply',
  autoroute_drc_iteration: 'autoroute_drc_iteration',
  score_routing_quality: 'score_routing_quality',
  validate_routing_geometry: 'validate_routing_geometry',
  optimize_placement: 'optimize_placement',
  apply_placement_plan: 'apply_placement_plan',
  apply_routing_plan: 'apply_routing_plan',
  route_critical_nets: 'route_critical_nets',
  route_power_nets: 'route_power_nets',
  route_diff_pair: 'route_diff_pair',
  route_signal_net: 'route_signal_net',
  add_ground_zone: 'add_ground_zone',
  stitch_ground_vias: 'stitch_ground_vias',
  validate_routes: 'validate_routes',
  report_unrouted_nets: 'report_unrouted_nets',
  export_gerbers: 'export_gerbers',
  export_drill_files: 'export_drill_files',
  export_bom: 'export_bom',
  export_cpl: 'export_cpl',
  package_jlcpcb: 'package_jlcpcb',
  summarize_project: 'summarize_project',
}

const commonInputSchema = {
  type: 'object',
  additionalProperties: true,
  properties: {
    id: { type: 'string', description: 'Optional stable job id.' },
    input: { type: 'object', description: 'BoardForge job input payload.', additionalProperties: true },
    allowOverwrite: { type: 'boolean', description: 'Allow replacing an existing generated project folder.' },
    dryRun: { type: 'boolean', description: 'Validate and plan without writing files.' },
  },
}

const tools = [
  {
    name: 'status',
    description: 'Return BoardForge MCP status, workspace, and available controlled workflows.',
    inputSchema: { type: 'object', additionalProperties: false, properties: {} },
  },
  {
    name: 'kicad_status',
    description: 'Detect the local KiCad CLI adapter without running edits or exports.',
    inputSchema: { type: 'object', additionalProperties: true, properties: { kicadCliPath: { type: 'string' } } },
  },
  ...Object.keys(toolToJobType).map((name) => ({
    name,
    description: `Run BoardForge controlled workflow: ${toolToJobType[name]}.`,
    inputSchema: commonInputSchema,
  })),
]

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity })

rl.on('line', async (line) => {
  if (!line.trim()) return
  let request
  try {
    request = JSON.parse(line)
  } catch (error) {
    sendError(null, -32700, `Parse error: ${error.message}`)
    return
  }
  if (!Object.prototype.hasOwnProperty.call(request, 'id')) {
    return
  }
  try {
    const result = await handleRequest(request)
    sendResult(request.id, result)
  } catch (error) {
    sendError(request.id, -32603, error.message)
  }
})

async function handleRequest(request) {
  if (request.jsonrpc !== '2.0') throw new Error('BoardForge MCP expects JSON-RPC 2.0 messages.')
  if (request.method === 'initialize') {
    return {
      protocolVersion,
      serverInfo: { name: 'boardforge-plugin', version: '0.1.0' },
      capabilities: { tools: {} },
      instructions: [
        'Use BoardForge tools with structured JSON only.',
      'Do not run arbitrary KiCad shell commands.',
      'After apply_routing_plan or autoroute_and_apply, run run_kicad_drc before any export or manufacturing claim.',
      'Treat generated KiCad output as review-required until DRC/ERC/export results prove otherwise.',
      ].join(' '),
    }
  }
  if (request.method === 'tools/list') {
    return { tools }
  }
  if (request.method === 'tools/call') {
    const params = request.params || {}
    return callTool(params.name, params.arguments || {})
  }
  throw new Error(`Unsupported MCP method: ${request.method}`)
}

async function callTool(name, args) {
  if (name === 'status') {
    return toToolResult({
      status: 'ok',
      service: 'boardforge-mcp',
      workspace,
      tools: tools.map((tool) => tool.name),
      safety: 'BoardForge writes only through whitelisted structured jobs.',
    })
  }
  if (name === 'kicad_status') {
    return toToolResult(await detectKiCadCli({ kicadCliPath: args.kicadCliPath }))
  }
  const type = toolToJobType[name]
  if (!type) throw new Error(`Unknown BoardForge tool: ${name}`)
  const input = args.input && typeof args.input === 'object' ? { ...args.input } : { ...args }
  delete input.id
  delete input.allowOverwrite
  delete input.dryRun
  const job = {
    id: args.id || `${name}_${Date.now()}`,
    type,
    input,
    allowOverwrite: Boolean(args.allowOverwrite),
    dryRun: Boolean(args.dryRun),
  }
  return toToolResult(await executeJob(job, workspace))
}

function toToolResult(payload) {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(payload, null, 2),
      },
    ],
  }
}

function sendResult(id, result) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`)
}

function sendError(id, code, message) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } })}\n`)
}
