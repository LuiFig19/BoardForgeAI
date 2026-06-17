#!/usr/bin/env node
import http from 'node:http'
import path from 'node:path'
import { executeJob } from '../lib/jobs.mjs'
import { detectKiCadCli } from '../lib/kicad-cli.mjs'

function argValue(name) {
  const index = process.argv.indexOf(name)
  return index === -1 ? null : process.argv[index + 1] || null
}

const port = Number(argValue('--port') || process.env.BOARDFORGE_PORT || 47321)
const workspace = path.resolve(argValue('--workspace') || process.env.BOARDFORGE_WORKSPACE || process.cwd())

const routes = {
  'POST /jobs/create-outline': 'create_outline_board',
  'POST /jobs/create-project': 'create_kicad_project',
  'POST /jobs/snapshot': 'snapshot_project',
  'POST /jobs/list-snapshots': 'list_project_snapshots',
  'POST /jobs/diff-snapshot': 'diff_project_snapshot',
  'POST /jobs/restore-snapshot': 'restore_project_snapshot',
  'POST /jobs/preflight': 'run_project_preflight',
  'POST /jobs/list-board-categories': 'list_board_categories',
  'POST /jobs/plan-category': 'plan_board_category',
  'POST /jobs/validate-schematic-graph': 'validate_schematic_graph',
  'POST /jobs/synthesize-schematic': 'synthesize_schematic_design',
  'POST /jobs/validate-schematic-pcb-sync': 'validate_schematic_pcb_sync',
  'POST /jobs/apply-schematic-pcb-sync': 'apply_schematic_pcb_sync',
  'POST /jobs/routing-readiness': 'check_routing_readiness',
  'POST /jobs/power-routing': 'calculate_power_routing',
  'POST /jobs/via-strategy': 'select_via_strategy',
  'POST /jobs/noise-map': 'build_noise_map',
  'POST /jobs/manufacturer-rules': 'summarize_manufacturer_rules',
  'POST /jobs/project-review': 'generate_project_review_report',
  'POST /jobs/workflow-preset': 'build_workflow_preset',
  'POST /jobs/run-workflow': 'run_boardforge_workflow',
  'POST /jobs/plan-mission': 'plan_mission_requirements',
  'POST /jobs/intake-bom': 'intake_user_bom',
  'POST /jobs/audit-bom': 'audit_user_bom',
  'POST /jobs/ingest-reference': 'ingest_reference_design',
  'POST /jobs/synthesize-circuit-blocks': 'synthesize_circuit_blocks',
  'POST /jobs/production-pipeline': 'plan_production_pipeline',
  'POST /jobs/verified-demo-recipe': 'build_verified_demo_recipe',
  'POST /jobs/canonical-net-model': 'build_canonical_net_model',
  'POST /jobs/audit-assets': 'audit_asset_resolution',
  'POST /jobs/audit-placement-legality': 'audit_placement_legality',
  'POST /jobs/routing-execution-strategy': 'compile_routing_execution_strategy',
  'POST /jobs/release-export-gates': 'audit_release_export_gates',
  'POST /jobs/production-readiness-suite': 'run_production_readiness_suite',
  'POST /jobs/classify-board-architecture': 'classify_board_architecture',
  'POST /jobs/hdi-manufacturing-strategy': 'plan_hdi_manufacturing_strategy',
  'POST /jobs/return-path-integrity': 'audit_return_path_integrity',
  'POST /jobs/creepage-clearance': 'audit_creepage_clearance',
  'POST /jobs/bringup-reliability-matrix': 'plan_bringup_reliability_matrix',
  'POST /jobs/advanced-board-suite': 'run_advanced_board_suite',
  'POST /jobs/plan-requirements': 'plan_requirements',
  'POST /jobs/plan-pin-assignments': 'plan_pin_assignments',
  'POST /jobs/plan-power-tree': 'plan_power_tree',
  'POST /jobs/plan-stackup': 'plan_stackup',
  'POST /jobs/plan-fanout': 'plan_fanout',
  'POST /jobs/plan-signal-integrity': 'plan_signal_integrity',
  'POST /jobs/plan-test-strategy': 'plan_test_strategy',
  'POST /jobs/dfm-checks': 'run_dfm_checks',
  'POST /jobs/compare-manufacturers': 'compare_manufacturers',
  'POST /jobs/plan-complex-board': 'plan_complex_board',
  'POST /jobs/design-constraints': 'generate_design_constraints',
  'POST /jobs/kicad-rules': 'generate_kicad_rules',
  'POST /jobs/sync-libraries': 'sync_kicad_libraries',
  'POST /jobs/search-library': 'search_library_assets',
  'POST /jobs/resolve-assets': 'resolve_component_assets',
  'POST /jobs/audit-component-library': 'audit_component_library',
  'POST /jobs/validate-bindings': 'validate_component_bindings',
  'POST /jobs/plan-pin-map-repairs': 'plan_pin_map_repairs',
  'POST /jobs/apply-pin-map-repairs': 'apply_pin_map_repairs',
  'POST /jobs/validate-3d-models': 'validate_3d_model_coverage',
  'POST /jobs/audit-bom-sourcing': 'audit_bom_sourcing',
  'POST /jobs/validate-manufacturing': 'validate_manufacturing_readiness',
  'POST /jobs/validate-jlcpcb-package': 'validate_jlcpcb_package',
  'POST /jobs/manufacturing-manifest': 'generate_manufacturing_manifest',
  'POST /jobs/generate-netlist': 'generate_netlist',
  'POST /jobs/design-audit': 'run_design_audit',
  'POST /jobs/plan-erc-repairs': 'plan_erc_repairs',
  'POST /jobs/apply-safe-erc-repairs': 'apply_safe_erc_repairs',
  'POST /jobs/find-missing-footprints': 'find_missing_footprints',
  'POST /jobs/link-3d-models': 'link_3d_models',
  'POST /jobs/autoroute': 'autoroute_board',
  'POST /jobs/routing-report': 'generate_routing_report',
  'POST /jobs/copper-pours': 'plan_copper_pours',
  'POST /jobs/autoroute-apply': 'autoroute_and_apply',
  'POST /jobs/autoroute-drc-iteration': 'autoroute_drc_iteration',
  'POST /jobs/score-routing': 'score_routing_quality',
  'POST /jobs/validate-routing': 'validate_routing_geometry',
  'POST /jobs/autoroute-repair-loop': 'plan_autoroute_repair_loop',
  'POST /jobs/routing-congestion': 'analyze_routing_congestion',
  'POST /jobs/escape-routing': 'plan_escape_routing',
  'POST /jobs/diff-pair-tuning': 'plan_diff_pair_tuning',
  'POST /jobs/power-integrity': 'validate_power_integrity',
  'POST /jobs/thermal-bottlenecks': 'analyze_thermal_bottlenecks',
  'POST /jobs/assembly-orientation': 'validate_assembly_orientation',
  'POST /jobs/cost-estimate': 'estimate_board_cost',
  'POST /jobs/engineering-questions': 'generate_engineering_questions',
  'POST /jobs/production-readiness': 'score_production_readiness',
  'POST /jobs/release-gate': 'build_release_gate_report',
  'POST /jobs/solve-placement': 'solve_placement',
  'POST /jobs/apply-placement': 'apply_placement_plan',
  'POST /jobs/validate': 'run_full_self_review',
  'POST /jobs/export': 'package_jlcpcb',
  'POST /jobs/run-drc': 'run_kicad_drc',
  'POST /jobs/run-erc': 'run_kicad_erc',
  'POST /jobs/export-gerbers': 'export_gerbers',
  'POST /jobs/export-drill': 'export_drill_files',
  'POST /jobs/export-bom': 'export_bom',
  'POST /jobs/export-cpl': 'export_cpl',
  'POST /jobs/scan': 'scan_kicad_project',
}

const jobs = new Map()

const server = http.createServer(async (request, response) => {
  try {
    response.setHeader('Access-Control-Allow-Origin', 'http://localhost:3000')
    response.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type')
    if (request.method === 'OPTIONS') return send(response, 204, null)

    const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`)
    if (request.method === 'GET' && url.pathname === '/status') {
      return send(response, 200, { status: 'ok', service: 'boardforge-local-server', workspace, routes: Object.keys(routes) })
    }
    if (request.method === 'GET' && url.pathname === '/kicad/status') {
      return send(response, 200, await detectKiCadCli())
    }
    const jobMatch = url.pathname.match(/^\/jobs\/([^/]+)$/)
    if (request.method === 'GET' && jobMatch) {
      const job = jobs.get(jobMatch[1])
      return send(response, job ? 200 : 404, job || { status: 'not_found' })
    }

    const routeKey = `${request.method} ${url.pathname}`
    const type = routes[routeKey]
    if (!type) return send(response, 404, { status: 'not_found', route: routeKey })

    const body = await readJson(request)
    const job = {
      id: body.id || `job_${Date.now()}`,
      type: body.type || type,
      input: body.input || body,
      allowOverwrite: Boolean(body.allowOverwrite),
      dryRun: Boolean(body.dryRun),
    }
    if (job.type !== type && !['/jobs/validate'].includes(url.pathname)) {
      return send(response, 400, { status: 'rejected', error: `Route ${url.pathname} only accepts ${type}` })
    }
    jobs.set(job.id, { id: job.id, status: 'running', type: job.type, createdAt: new Date().toISOString() })
    const result = await executeJob(job, workspace)
    jobs.set(job.id, { ...result, completedAt: new Date().toISOString() })
    return send(response, 200, result)
  } catch (error) {
    return send(response, 500, { status: 'failed', error: error.message })
  }
})

server.listen(port, '127.0.0.1', () => {
  console.log(JSON.stringify({ status: 'listening', service: 'boardforge-local-server', url: `http://127.0.0.1:${port}`, workspace }, null, 2))
})

function send(response, statusCode, payload) {
  response.statusCode = statusCode
  if (payload === null) return response.end()
  response.setHeader('Content-Type', 'application/json')
  response.end(JSON.stringify(payload, null, 2))
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let body = ''
    request.on('data', (chunk) => {
      body += chunk.toString()
      if (body.length > 1024 * 1024) reject(new Error('Request body too large'))
    })
    request.on('end', () => {
      if (!body.trim()) return resolve({})
      try {
        resolve(JSON.parse(body))
      } catch (error) {
        reject(error)
      }
    })
  })
}
