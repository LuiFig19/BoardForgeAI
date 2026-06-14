import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { createNetClasses, assignNetsToClasses, validateNetClasses } from './net-classes.mjs'
import { getManufacturerProfile } from './manufacturers.mjs'
import { createBoardShape, createTemplateBoard, boardTemplates } from './templates.mjs'
import { generatePlacementPlan } from './placement.mjs'
import { generateRoutingPlan } from './routing.mjs'
import { kicadPcbFile, kicadProjectFile, readmeFile, scanKiCadProject } from './kicad.mjs'
import { runFullSelfReview, validateBoardOutline } from './validation.mjs'

export const allowedJobTypes = new Set(['create_outline_board', 'create_kicad_project', 'apply_edge_cuts', 'add_mounting_holes', 'round_board_corners', 'add_usb_c_edge_cutout', 'add_rj45_edge_clearance', 'validate_board_outline', 'scan_kicad_project', 'find_missing_footprints', 'link_3d_models', 'create_net_classes', 'assign_net_to_class', 'validate_net_classes', 'report_unclassified_nets', 'generate_placement_plan', 'apply_placement_plan', 'validate_placement', 'move_component', 'fix_component_off_board', 'fix_component_overlap', 'fix_mounting_hole_conflicts', 'generate_routing_plan', 'route_critical_nets', 'route_power_nets', 'route_diff_pair', 'route_signal_net', 'add_ground_zone', 'stitch_ground_vias', 'validate_routes', 'report_unrouted_nets', 'fix_route_clearance_violations', 'run_full_self_review', 'run_kicad_drc', 'run_kicad_erc', 'export_gerbers', 'export_drill_files', 'export_bom', 'export_cpl', 'package_jlcpcb', 'summarize_project'])
export const sanitizeName = (name) => (String(name || 'boardforge-project').trim().replace(/[^a-zA-Z0-9-_ ]/g, '').replace(/\s+/g, '-').slice(0, 64).toLowerCase() || 'boardforge-project')
export function resolveInsideWorkspace(workspace, target) {
  const root = path.resolve(workspace)
  const resolved = path.resolve(root, target)
  if (resolved !== root && !resolved.startsWith(root + path.sep)) throw new Error(`Refusing path outside workspace: ${target}`)
  return resolved
}
export const loadJob = async (jobPath) => JSON.parse(await readFile(path.resolve(jobPath), 'utf8'))
export function validateJob(job) {
  if (!job || typeof job !== 'object') throw new Error('Job must be a JSON object')
  if (!allowedJobTypes.has(job.type)) throw new Error(`Unsupported job type: ${job.type}`)
}
const result = (job, status, warnings = [], errors = [], extra = {}) => ({ id: `${job.id || 'job'}_result`, jobId: job.id, type: job.type, status, warnings, errors, ...extra })

function boardFromJob(job) {
  const input = job.input || {}
  if (input.templateId) return createTemplateBoard(input.templateId, input)
  if (input.board?.outline) return { name: input.projectName || input.board.name || 'BoardForge Board', units: input.board.units || 'mm', widthMm: input.board.widthMm || input.board.width || 50, heightMm: input.board.heightMm || input.board.height || 30, layerCount: input.board.layerCount || input.layerCount || 2, outline: input.board.outline, mountingHoles: input.board.mountingHoles || [], requiredNetClasses: input.board.requiredNetClasses || [], componentGroups: input.board.componentGroups || [] }
  if (input.board?.segments) return { name: input.projectName || input.board.name || 'BoardForge Board', units: input.board.units || 'mm', widthMm: input.board.widthMm || input.board.width || 50, heightMm: input.board.heightMm || input.board.height || 30, layerCount: input.board.layerCount || input.layerCount || 2, outline: input.board.segments.map((segment) => segment.start), mountingHoles: input.board.mountingHoles || [], requiredNetClasses: input.board.requiredNetClasses || [], componentGroups: input.board.componentGroups || [] }
  const widthMm = input.widthMm || input.board?.widthMm || 50
  const heightMm = input.heightMm || input.board?.heightMm || 30
  return { name: input.projectName || input.name || 'BoardForge Board', units: 'mm', widthMm, heightMm, layerCount: input.layerCount || 2, outline: createBoardShape(input.shape || 'rectangle', widthMm, heightMm, input), mountingHoles: input.mountingHoles || input.board?.mountingHoles || [], requiredNetClasses: input.requiredNetClasses || [], componentGroups: input.componentGroups || [] }
}

export async function executeJob(job, workspace) {
  validateJob(job)
  const profile = getManufacturerProfile(job.input?.manufacturerProfile || job.input?.manufacturer || 'JLCPCB_STANDARD')
  if (job.type === 'create_outline_board') return createOutlineBoard(job, workspace, profile)
  if (job.type === 'validate_board_outline') return validateOutlineJob(job, profile)
  if (job.type === 'create_net_classes') return result(job, 'NET_CLASSES_CREATED', [], [], { netClasses: createNetClasses(profile), humanReviewRequired: true })
  if (job.type === 'validate_net_classes' || job.type === 'report_unclassified_nets') return validateNetClassesJob(job)
  if (job.type === 'generate_placement_plan') return placementPlanJob(job, profile)
  if (job.type === 'generate_routing_plan' || job.type === 'report_unrouted_nets') return routingPlanJob(job)
  if (job.type === 'run_full_self_review') return selfReviewJob(job, profile)
  if (job.type === 'scan_kicad_project' || job.type === 'summarize_project') return scanProjectJob(job, workspace)
  if (['run_kicad_drc', 'run_kicad_erc', 'export_gerbers', 'export_drill_files', 'export_bom', 'export_cpl', 'package_jlcpcb'].includes(job.type)) return result(job, 'BLOCKED_MISSING_ADAPTER', [`${job.type} requires the KiCad CLI adapter. No success or export package was generated.`], [], { generatedFiles: [], humanReviewRequired: true })
  return result(job, 'NOT_IMPLEMENTED', [`${job.type} is declared in the workflow but not implemented in this CLI build.`], [], { humanReviewRequired: true })
}

async function createOutlineBoard(job, workspace, profile) {
  const board = boardFromJob(job)
  const outlineIssues = validateBoardOutline(board, profile)
  if (outlineIssues.some((item) => item.severity === 'BLOCKER')) return result(job, 'VALIDATION_FAILED', [], outlineIssues, { generatedFiles: [], humanReviewRequired: true })
  const review = runFullSelfReview({ board, components: [], nets: [], routes: [], profile, kicad: { cliAvailable: false } })
  const safeName = sanitizeName(job.input?.projectName || board.name)
  const projectDir = resolveInsideWorkspace(workspace, safeName)
  if (existsSync(projectDir) && !job.allowOverwrite) return result(job, 'NEEDS_FIX', [], [{ severity: 'ERROR', code: 'PROJECT_EXISTS', message: `Project already exists. Set allowOverwrite true to replace files: ${projectDir}` }], { projectPath: projectDir, generatedFiles: [] })
  const files = [{ path: `${safeName}.kicad_pro`, content: kicadProjectFile(board, createNetClasses(profile)) }, { path: `${safeName}.kicad_pcb`, content: kicadPcbFile(board, { netClasses: createNetClasses(profile) }) }, { path: 'boardforge-review.json', content: JSON.stringify(review, null, 2) }, { path: 'README.md', content: readmeFile(job, board, review) }]
  if (!job.dryRun) {
    await mkdir(projectDir, { recursive: true })
    for (const file of files) await writeFile(resolveInsideWorkspace(projectDir, file.path), file.content, 'utf8')
  }
  return result(job, 'OUTLINE_GENERATED_NEEDS_REVIEW', review.issues.filter((item) => item.severity === 'WARNING'), review.issues.filter((item) => ['BLOCKER', 'ERROR'].includes(item.severity)), { projectPath: projectDir, generatedFiles: files.map((file) => path.join(projectDir, file.path)), qualityGates: review.qualityGates, summary: review.summary, humanReviewRequired: true })
}

function validateOutlineJob(job, profile) {
  const board = boardFromJob(job)
  const issues = validateBoardOutline(board, profile)
  return result(job, issues.some((item) => ['BLOCKER', 'ERROR'].includes(item.severity)) ? 'NEEDS_FIX' : 'OUTLINE_VALID_NEEDS_REVIEW', issues.filter((item) => item.severity === 'WARNING'), issues.filter((item) => ['BLOCKER', 'ERROR'].includes(item.severity)), { board })
}

function validateNetClassesJob(job) {
  const nets = assignNetsToClasses(job.input?.nets || [])
  const issues = validateNetClasses(nets)
  return result(job, issues.length ? 'NEEDS_FIX' : 'NET_CLASSES_VALID_NEEDS_REVIEW', [], issues, { nets })
}

function placementPlanJob(job, profile) {
  const plan = generatePlacementPlan(boardFromJob(job), boardTemplates[job.input?.templateId], profile)
  return result(job, plan.status, plan.issues.filter((item) => item.severity === 'WARNING'), plan.issues.filter((item) => ['BLOCKER', 'ERROR'].includes(item.severity)), { placementPlan: plan, humanReviewRequired: true })
}

function routingPlanJob(job) {
  const plan = generateRoutingPlan(assignNetsToClasses(job.input?.nets || []), { layerCount: job.input?.layerCount })
  return result(job, plan.status, plan.warnings, [], { routingPlan: plan, humanReviewRequired: true })
}

function selfReviewJob(job, profile) {
  const review = runFullSelfReview({ board: boardFromJob(job), components: job.input?.components || [], nets: assignNetsToClasses(job.input?.nets || []), routes: job.input?.routes || [], profile, kicad: { cliAvailable: Boolean(job.input?.kicadCliAvailable) } })
  return result(job, review.status, review.issues.filter((item) => item.severity === 'WARNING'), review.issues.filter((item) => ['BLOCKER', 'ERROR'].includes(item.severity)), { review, humanReviewRequired: true })
}

async function scanProjectJob(job, workspace) {
  const target = job.input?.projectPath ? resolveInsideWorkspace(workspace, job.input.projectPath) : workspace
  const scan = await scanKiCadProject(target)
  return result(job, scan.errors.length ? 'SCAN_FAILED' : 'SCAN_COMPLETE_NEEDS_REVIEW', scan.warnings, scan.errors, { scan, humanReviewRequired: true })
}
