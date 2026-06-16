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
  'POST /jobs/workflow-preset': 'build_workflow_preset',
  'POST /jobs/run-workflow': 'run_boardforge_workflow',
  'POST /jobs/plan-requirements': 'plan_requirements',
  'POST /jobs/plan-power-tree': 'plan_power_tree',
  'POST /jobs/plan-stackup': 'plan_stackup',
  'POST /jobs/plan-fanout': 'plan_fanout',
  'POST /jobs/plan-signal-integrity': 'plan_signal_integrity',
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
  'POST /jobs/validate-manufacturing': 'validate_manufacturing_readiness',
  'POST /jobs/manufacturing-manifest': 'generate_manufacturing_manifest',
  'POST /jobs/generate-netlist': 'generate_netlist',
  'POST /jobs/design-audit': 'run_design_audit',
  'POST /jobs/plan-erc-repairs': 'plan_erc_repairs',
  'POST /jobs/apply-safe-erc-repairs': 'apply_safe_erc_repairs',
  'POST /jobs/find-missing-footprints': 'find_missing_footprints',
  'POST /jobs/link-3d-models': 'link_3d_models',
  'POST /jobs/score-routing': 'score_routing_quality',
  'POST /jobs/validate-routing': 'validate_routing_geometry',
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
