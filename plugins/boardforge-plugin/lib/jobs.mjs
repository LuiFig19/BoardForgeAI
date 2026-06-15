import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { createNetClasses, assignNetsToClasses, validateNetClasses } from './net-classes.mjs'
import { getManufacturerProfile } from './manufacturers.mjs'
import { createBoardShape, createTemplateBoard, boardTemplates } from './templates.mjs'
import { generatePlacementPlan } from './placement.mjs'
import { generateRoutingPlan } from './routing.mjs'
import { kicadPcbFile, kicadProjectFile, kicadSchematicFile, projectReadmeFile, readmeFile, scanKiCadProject } from './kicad.mjs'
import { runFullSelfReview, validateBoardOutline, validatePlacement } from './validation.mjs'
import { detectKiCadCli, exportBom, exportCpl, exportDrill, exportGerbers, findKiCadProjectFiles, packageJlcpcb, runDrc, runErc } from './kicad-cli.mjs'
import { generateTemplateComponents, renderPlacedFootprints } from './components.mjs'
import { findMissingFootprints, link3dModels, resolveComponentAssets, searchLibraryAssets, syncKiCadLibraries } from './library-adapter.mjs'
import { createProjectState, normalizeComponents, readProjectState, stateFileName, summarizeProjectState, updateProjectState } from './project-state.mjs'
import { createDesignIntent, validateZones } from './design-rules.mjs'
import { applyRoutingPlanToPcb } from './copper-writer.mjs'
import { buildComponentDatabase, enrichComponents } from './component-database.mjs'
import { generateSchematicModel, kicadSchematicFromModel } from './schematic-generator.mjs'
import { applySafeDrcRepairs, planDrcRepairs } from './drc-repair.mjs'
import { applyInteractiveEdits } from './interactive-edits.mjs'

export const allowedJobTypes = new Set(['create_outline_board', 'create_kicad_project', 'apply_edge_cuts', 'add_mounting_holes', 'round_board_corners', 'add_usb_c_edge_cutout', 'add_rj45_edge_clearance', 'validate_board_outline', 'scan_kicad_project', 'sync_kicad_libraries', 'search_library_assets', 'resolve_component_assets', 'sync_component_database', 'resolve_bom_parts', 'generate_schematic', 'plan_drc_repairs', 'apply_safe_drc_repairs', 'interactive_edit', 'find_missing_footprints', 'link_3d_models', 'create_net_classes', 'assign_net_to_class', 'validate_net_classes', 'report_unclassified_nets', 'generate_placement_plan', 'optimize_placement', 'apply_placement_plan', 'validate_placement', 'move_component', 'fix_component_off_board', 'fix_component_overlap', 'fix_mounting_hole_conflicts', 'generate_routing_plan', 'apply_routing_plan', 'route_critical_nets', 'route_power_nets', 'route_diff_pair', 'route_signal_net', 'add_ground_zone', 'stitch_ground_vias', 'validate_routes', 'report_unrouted_nets', 'fix_route_clearance_violations', 'run_full_self_review', 'run_kicad_drc', 'run_kicad_erc', 'export_gerbers', 'export_drill_files', 'export_bom', 'export_cpl', 'package_jlcpcb', 'summarize_project'])
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
  if (job.type === 'create_kicad_project') return createKiCadProject(job, workspace, profile)
  if (job.type === 'validate_board_outline') return validateOutlineJob(job, profile)
  if (job.type === 'sync_kicad_libraries') return librarySyncJob(job, workspace)
  if (job.type === 'search_library_assets') return librarySearchJob(job, workspace)
  if (job.type === 'resolve_component_assets') return resolveAssetsJob(job, workspace)
  if (job.type === 'sync_component_database' || job.type === 'resolve_bom_parts') return componentDatabaseJob(job, workspace)
  if (job.type === 'generate_schematic') return generateSchematicJob(job, workspace)
  if (job.type === 'plan_drc_repairs') return planDrcRepairsJob(job, workspace)
  if (job.type === 'apply_safe_drc_repairs') return applySafeDrcRepairsJob(job, workspace)
  if (job.type === 'interactive_edit') return interactiveEditJob(job, workspace, profile)
  if (job.type === 'find_missing_footprints') return missingFootprintsJob(job, workspace)
  if (job.type === 'link_3d_models') return link3dModelsJob(job, workspace)
  if (job.type === 'create_net_classes') return result(job, 'NET_CLASSES_CREATED', [], [], { netClasses: createNetClasses(profile), humanReviewRequired: true })
  if (job.type === 'validate_net_classes' || job.type === 'report_unclassified_nets') return validateNetClassesJob(job)
  if (job.type === 'generate_placement_plan' || job.type === 'optimize_placement') return placementPlanJob(job, profile)
  if (job.type === 'apply_routing_plan') return applyRoutingPlanJob(job, workspace, profile)
  if (['generate_routing_plan', 'report_unrouted_nets', 'route_critical_nets', 'route_power_nets', 'route_diff_pair', 'route_signal_net', 'add_ground_zone', 'stitch_ground_vias', 'validate_routes'].includes(job.type)) return routingPlanJob(job)
  if (job.type === 'run_full_self_review') return selfReviewJob(job, profile)
  if (job.type === 'scan_kicad_project' || job.type === 'summarize_project') return scanProjectJob(job, workspace)
  if (job.type === 'run_kicad_drc') return runDrcJob(job, workspace)
  if (job.type === 'run_kicad_erc') return runErcJob(job, workspace)
  if (job.type === 'export_gerbers') return exportGerbersJob(job, workspace)
  if (job.type === 'export_drill_files') return exportDrillJob(job, workspace)
  if (job.type === 'export_bom') return exportBomJob(job, workspace)
  if (job.type === 'export_cpl') return exportCplJob(job, workspace)
  if (job.type === 'package_jlcpcb') return packageJlcpcbJob(job, workspace)
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
  const state = createProjectState({ job, board, mode: 'outline_only', profile, review, generatedFiles: files.map((file) => path.join(projectDir, file.path)) })
  files.push({ path: stateFileName, content: JSON.stringify(state, null, 2) })
  if (!job.dryRun) {
    await mkdir(projectDir, { recursive: true })
    for (const file of files) await writeFile(resolveInsideWorkspace(projectDir, file.path), file.content, 'utf8')
  }
  return result(job, 'OUTLINE_GENERATED_NEEDS_REVIEW', review.issues.filter((item) => item.severity === 'WARNING'), review.issues.filter((item) => ['BLOCKER', 'ERROR'].includes(item.severity)), { projectPath: projectDir, generatedFiles: files.map((file) => path.join(projectDir, file.path)), qualityGates: review.qualityGates, summary: review.summary, humanReviewRequired: true })
}

async function createKiCadProject(job, workspace, profile) {
  const board = boardFromJob(job)
  const outlineIssues = validateBoardOutline(board, profile)
  if (outlineIssues.some((item) => item.severity === 'BLOCKER')) return result(job, 'VALIDATION_FAILED', [], outlineIssues, { generatedFiles: [], humanReviewRequired: true })
  const review = runFullSelfReview({ board, components: [], nets: assignNetsToClasses(job.input?.nets || []), routes: [], profile, kicad: { cliAvailable: false } })
  const safeName = sanitizeName(job.input?.projectName || board.name)
  const projectDir = resolveInsideWorkspace(workspace, safeName)
  if (existsSync(projectDir) && !job.allowOverwrite) return result(job, 'NEEDS_FIX', [], [{ severity: 'ERROR', code: 'PROJECT_EXISTS', message: `Project already exists. Set allowOverwrite true to replace files: ${projectDir}` }], { projectPath: projectDir, generatedFiles: [] })
  const netClasses = createNetClasses(profile)
  const components = generateTemplateComponents(board, job.input?.templateId)
  const designIntent = createDesignIntent(board, components, assignNetsToClasses(job.input?.nets || []), profile)
  const zoneIssues = validateZones(board, designIntent.zones)
  const placementIssues = validatePlacement(board, components, profile)
  const blockingPlacementIssues = [...placementIssues, ...zoneIssues].filter((item) => ['BLOCKER', 'ERROR'].includes(item.severity) && item.code !== 'ANTENNA_KEEPOUT_ALLOWS_COPPER')
  if (blockingPlacementIssues.length) {
    return result(job, 'PLACEMENT_NEEDS_FIX', [...placementIssues, ...zoneIssues].filter((item) => item.severity === 'WARNING'), blockingPlacementIssues, { projectPath: projectDir, components, designIntent, generatedFiles: [], humanReviewRequired: true })
  }
  const library = await resolveComponentAssets({ workspace, input: { ...job.input, components } })
  const footprintsResult = await renderPlacedFootprints(components, { workspace, ...job.input })
  const footprints = Array.isArray(footprintsResult) ? footprintsResult : footprintsResult.rendered
  const resolvedComponents = components.map((component) => {
    const resolved = library.components?.find((item) => item.ref === component.ref)
    return { ...component, symbol: resolved?.symbol || component.symbol || null, footprint: resolved?.footprint || component.footprint, model3d: resolved?.model3d || component.model3d || null, confidence: resolved?.confidence || 'needs_review' }
  })
  const state = createProjectState({ job: { ...job, input: { ...job.input, designIntent } }, board, mode: 'full_project_scaffold', profile, components: resolvedComponents, library, review: { ...review, placementIssues, zoneIssues }, generatedFiles: [] })
  const files = [
    { path: `${safeName}.kicad_pro`, content: kicadProjectFile(board, netClasses) },
    { path: `${safeName}.kicad_sch`, content: kicadSchematicFile(board, { components: resolvedComponents }) },
    { path: `${safeName}.kicad_pcb`, content: kicadPcbFile(board, { netClasses, footprints }) },
    { path: 'boardforge-components.json', content: JSON.stringify(resolvedComponents, null, 2) },
    { path: 'boardforge-library.json', content: JSON.stringify(library, null, 2) },
    { path: 'boardforge-review.json', content: JSON.stringify({ ...review, components }, null, 2) },
    { path: stateFileName, content: JSON.stringify({ ...state, generatedFiles: [] }, null, 2) },
    { path: 'README.md', content: projectReadmeFile(job, board, review) },
  ]
  const generatedFiles = files.map((file) => path.join(projectDir, file.path))
  files[6] = { path: stateFileName, content: JSON.stringify({ ...state, generatedFiles }, null, 2) }
  if (!job.dryRun) {
    await mkdir(projectDir, { recursive: true })
    for (const file of files) await writeFile(resolveInsideWorkspace(projectDir, file.path), file.content, 'utf8')
  }
  return result(job, 'KICAD_PROJECT_CREATED_NEEDS_REVIEW', review.issues.filter((item) => item.severity === 'WARNING'), review.issues.filter((item) => ['BLOCKER', 'ERROR'].includes(item.severity)), { projectPath: projectDir, generatedFiles, projectState: summarizeProjectState({ ...state, generatedFiles }), qualityGates: review.qualityGates, summary: review.summary, humanReviewRequired: true })
}

async function librarySyncJob(job, workspace) {
  const output = await syncKiCadLibraries({ workspace, input: job.input || {} })
  return result(job, output.status, output.warnings || [], [], output)
}

async function librarySearchJob(job, workspace) {
  const output = await searchLibraryAssets({ workspace, input: job.input || {} })
  return result(job, output.status, [], [], output)
}

async function resolveAssetsJob(job, workspace) {
  const output = await resolveComponentAssets({ workspace, input: job.input || {} })
  await updateStateForProjectInput(job, workspace, async (state) => ({
    ...state,
    status: output.status,
    components: output.components ? normalizeComponents(output.components) : state.components,
    library: output,
    lastJobType: job.type,
    lastHistoryMessage: `Resolved ${output.components?.length || 0} component library assets.`,
  }))
  return result(job, output.status, output.warnings || [], [], output)
}

async function componentDatabaseJob(job, workspace) {
  const projectDir = job.input?.projectPath ? resolveInsideWorkspace(workspace, job.input.projectPath) : null
  const state = projectDir ? await readProjectState(projectDir) : null
  const components = job.input?.components || state?.components || []
  const output = await buildComponentDatabase({ workspace, input: { ...job.input, components } })
  if (projectDir) {
    await updateProjectState(projectDir, async (current) => ({
      ...current,
      status: output.status,
      components: normalizeComponents(output.components),
      componentDatabase: output,
      lastJobType: job.type,
      lastHistoryMessage: `Component database resolved ${output.components.length} components.`,
    }))
  }
  return result(job, output.status, output.riskSummary.missingAssets ? [{ severity: 'WARNING', code: 'COMPONENT_ASSETS_MISSING', message: `${output.riskSummary.missingAssets} components are missing complete symbol/footprint assets.` }] : [], [], output)
}

async function generateSchematicJob(job, workspace) {
  const projectDir = job.input?.projectPath ? resolveInsideWorkspace(workspace, job.input.projectPath) : null
  const state = projectDir ? await readProjectState(projectDir) : null
  const board = job.input?.board || state?.board || boardFromJob(job)
  const rawComponents = job.input?.components || state?.components || []
  const components = await enrichComponents({ workspace, components: rawComponents, input: job.input || {} })
  const schematicModel = generateSchematicModel(board, components, job.input || state?.requirements || {})
  const generatedFiles = []
  if (projectDir && !job.dryRun) {
    const files = await findKiCadProjectFiles(projectDir)
    if (files.schFile) {
      await writeFile(files.schFile, kicadSchematicFromModel(board, schematicModel), 'utf8')
      generatedFiles.push(files.schFile)
    }
    await updateProjectState(projectDir, async (current) => ({
      ...current,
      status: schematicModel.status,
      schematic: schematicModel,
      components: normalizeComponents(components),
      generatedFiles: [...new Set([...(current.generatedFiles || []), ...generatedFiles])],
      lastJobType: job.type,
      lastHistoryMessage: `Generated schematic model with ${schematicModel.symbols.length} symbols and ${schematicModel.nets.length} nets.`,
    }))
  }
  return result(job, schematicModel.status, schematicModel.warnings, [], { schematicModel, generatedFiles, humanReviewRequired: true })
}

async function missingFootprintsJob(job, workspace) {
  const output = await findMissingFootprints({ workspace, input: job.input || {} })
  return result(job, output.status, [], [], output)
}

async function planDrcRepairsJob(job, workspace) {
  const context = await getKiCadContext(job, workspace, 'pcb')
  if (context.blocked) return context.blocked
  const reportFile = job.input?.reportFile ? resolveInsideWorkspace(workspace, job.input.reportFile) : path.join(context.files.projectDir, 'reports', 'drc.json')
  const repairPlan = await planDrcRepairs({ reportFile, pcbFile: context.files.pcbFile })
  await updateProjectState(context.files.projectDir, async (current) => ({
    ...current,
    status: repairPlan.status,
    drcRepair: repairPlan,
    lastJobType: job.type,
    lastHistoryMessage: `Planned ${repairPlan.repairs.length} DRC repair actions.`,
  }))
  return result(job, repairPlan.status, repairPlan.repairs.length ? [{ severity: 'WARNING', code: 'REPAIR_REVIEW_REQUIRED', message: 'DRC repair plan requires review before applying geometry changes.' }] : [], [], { repairPlan, humanReviewRequired: true })
}

async function applySafeDrcRepairsJob(job, workspace) {
  const context = await getKiCadContext(job, workspace, 'pcb')
  if (context.blocked) return context.blocked
  const state = await readProjectState(context.files.projectDir)
  const repairPlan = job.input?.repairPlan || state?.drcRepair
  if (!repairPlan) return result(job, 'NEEDS_FIX', [], [{ severity: 'ERROR', code: 'MISSING_REPAIR_PLAN', message: 'Run plan_drc_repairs before apply_safe_drc_repairs.' }], { generatedFiles: [], humanReviewRequired: true })
  const output = await applySafeDrcRepairs({ pcbFile: context.files.pcbFile, repairPlan })
  await updateProjectState(context.files.projectDir, async (current) => ({
    ...current,
    status: output.status,
    drcRepair: { ...(current.drcRepair || repairPlan), applied: output },
    lastJobType: job.type,
    lastHistoryMessage: `Applied ${output.applied} safe DRC repair actions. Rerun DRC.`,
  }))
  return result(job, output.status, [{ severity: 'WARNING', code: 'RERUN_DRC_REQUIRED', message: 'Safe repairs were attempted. Run run_kicad_drc again.' }], [], { ...output, generatedFiles: [context.files.pcbFile], humanReviewRequired: true })
}

async function interactiveEditJob(job, workspace, profile) {
  const projectDir = job.input?.projectPath ? resolveInsideWorkspace(workspace, job.input.projectPath) : null
  const state = projectDir ? await readProjectState(projectDir) : null
  const board = job.input?.board || state?.board || boardFromJob(job)
  const components = job.input?.components || state?.components || []
  const output = applyInteractiveEdits({ board, components, profile, prompt: job.input?.prompt || job.input?.edit || '' })
  if (projectDir) {
    await updateProjectState(projectDir, async (current) => ({
      ...current,
      status: output.status,
      board: output.board,
      components: normalizeComponents(output.components),
      interactiveEdits: [...(current.interactiveEdits || []), { prompt: output.prompt, edits: output.edits, status: output.status }],
      lastJobType: job.type,
      lastHistoryMessage: `Applied ${output.edits.length} interactive edit intents.`,
    }))
  }
  return result(job, output.status, output.status.includes('CLARIFICATION') ? [{ severity: 'WARNING', code: 'EDIT_NEEDS_CLARIFICATION', message: 'No supported edit intent was recognized.' }] : [], [], output)
}

async function link3dModelsJob(job, workspace) {
  const output = await link3dModels({ workspace, input: job.input || {} })
  await updateStateForProjectInput(job, workspace, async (state) => ({
    ...state,
    status: output.status,
    components: output.components ? normalizeComponents(output.components) : state.components,
    lastJobType: job.type,
    lastHistoryMessage: `Linked 3D models for ${output.components?.length || 0} components.`,
  }))
  return result(job, output.status, [], [], output)
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
  const board = boardFromJob(job)
  const plan = generateRoutingPlan(assignNetsToClasses(job.input?.nets || []), { layerCount: job.input?.layerCount || board.layerCount, board, components: job.input?.components || [], profile: getManufacturerProfile(job.input?.manufacturerProfile || job.input?.manufacturer || 'JLCPCB_STANDARD') })
  const statusByType = {
    add_ground_zone: plan.designIntent.copperPours.some((pour) => pour.net === 'GND') ? 'GROUND_ZONE_PLAN_READY_NEEDS_REVIEW' : 'GROUND_ZONE_NEEDS_GND_NET',
    stitch_ground_vias: 'GROUND_STITCHING_PLAN_READY_NEEDS_REVIEW',
    route_diff_pair: 'DIFF_PAIR_ROUTE_PLAN_READY_NEEDS_REVIEW',
    route_power_nets: 'POWER_ROUTE_PLAN_READY_NEEDS_REVIEW',
    route_signal_net: 'SIGNAL_ROUTE_PLAN_READY_NEEDS_REVIEW',
    route_critical_nets: 'CRITICAL_ROUTE_PLAN_READY_NEEDS_REVIEW',
    validate_routes: 'ROUTE_RULES_VALIDATED_NEEDS_REVIEW',
  }
  const status = statusByType[job.type] || plan.status
  return result(job, status, plan.warnings, [], { routingPlan: plan, copperPours: plan.designIntent.copperPours, viaRules: plan.designIntent.viaRules, keepouts: plan.designIntent.zones, humanReviewRequired: true })
}

async function applyRoutingPlanJob(job, workspace, profile) {
  const context = await getKiCadContext(job, workspace, 'pcb')
  if (context.blocked) return context.blocked
  const state = await readProjectState(context.files.projectDir)
  const board = job.input?.board || state?.board || boardFromJob(job)
  const components = job.input?.components || state?.components || []
  const nets = assignNetsToClasses(job.input?.nets || state?.requirements?.nets || [])
  const routingPlan = job.input?.routingPlan || generateRoutingPlan(nets, { layerCount: board.layerCount, board, components, profile })
  if (!routingPlan.routes?.some((route) => route.start && route.end) && !routingPlan.designIntent?.copperPours?.length) {
    return result(job, 'ROUTING_PLAN_HAS_NO_WRITABLE_GEOMETRY', routingPlan.warnings || [], [{ severity: 'ERROR', code: 'NO_WRITABLE_ROUTE_GEOMETRY', message: 'Provide nets with start/end points or a routingPlan with writable routes/zones.' }], { routingPlan, generatedFiles: [], humanReviewRequired: true })
  }
  const output = await applyRoutingPlanToPcb({ pcbFile: context.files.pcbFile, board, routingPlan, components })
  await updateProjectState(context.files.projectDir, async (current) => ({
    ...current,
    status: output.status,
    routing: {
      status: output.status,
      routes: output.routes,
      vias: output.vias,
      zones: output.zones,
      generatedObjects: output.generatedObjects,
      drcRequired: true,
    },
    generatedFiles: [...new Set([...(current.generatedFiles || []), context.files.pcbFile])],
    lastJobType: job.type,
    lastHistoryMessage: `Applied ${output.generatedObjects.segments} segments, ${output.generatedObjects.vias} vias, and ${output.generatedObjects.zones} zones to PCB. DRC required.`,
  }))
  return result(job, output.status, [{ severity: 'WARNING', code: 'DRC_REQUIRED', message: 'Copper was written to KiCad PCB. Run run_kicad_drc before export or manufacturing.' }], [], { ...output, generatedFiles: [context.files.pcbFile] })
}

function selfReviewJob(job, profile) {
  const review = runFullSelfReview({ board: boardFromJob(job), components: job.input?.components || [], nets: assignNetsToClasses(job.input?.nets || []), routes: job.input?.routes || [], profile, kicad: { cliAvailable: Boolean(job.input?.kicadCliAvailable) } })
  return result(job, review.status, review.issues.filter((item) => item.severity === 'WARNING'), review.issues.filter((item) => ['BLOCKER', 'ERROR'].includes(item.severity)), { review, humanReviewRequired: true })
}

async function scanProjectJob(job, workspace) {
  const target = job.input?.projectPath ? resolveInsideWorkspace(workspace, job.input.projectPath) : workspace
  const scan = await scanKiCadProject(target)
  const projectDir = scan.pcbFile ? path.dirname(scan.pcbFile) : target
  const state = await readProjectState(projectDir)
  return result(job, scan.errors.length ? 'SCAN_FAILED' : 'SCAN_COMPLETE_NEEDS_REVIEW', scan.warnings, scan.errors, { scan, projectState: summarizeProjectState(state), humanReviewRequired: true })
}

async function getKiCadContext(job, workspace, requiredKind) {
  const detected = await detectKiCadCli({ kicadCliPath: job.input?.kicadCliPath })
  if (!detected.available) {
    return { blocked: result(job, 'BLOCKED_MISSING_ADAPTER', [detected.reason], [], { generatedFiles: [], humanReviewRequired: true }) }
  }
  const target = job.input?.projectPath ? resolveInsideWorkspace(workspace, job.input.projectPath) : workspace
  const files = await findKiCadProjectFiles(target)
  if (requiredKind === 'pcb' && !files.pcbFile) {
    return { blocked: result(job, 'NEEDS_FIX', [], [{ severity: 'ERROR', code: 'PCB_FILE_MISSING', message: 'No .kicad_pcb file found for this command.' }], { generatedFiles: [], humanReviewRequired: true }) }
  }
  if (requiredKind === 'sch' && !files.schFile) {
    return { blocked: result(job, 'NEEDS_FIX', [], [{ severity: 'ERROR', code: 'SCHEMATIC_FILE_MISSING', message: 'No .kicad_sch file found for this command.' }], { generatedFiles: [], humanReviewRequired: true }) }
  }
  return { detected, files }
}

async function runDrcJob(job, workspace) {
  const context = await getKiCadContext(job, workspace, 'pcb')
  if (context.blocked) return context.blocked
  const reportFile = path.join(context.files.projectDir, 'reports', 'drc.json')
  const output = await runDrc({ pcbFile: context.files.pcbFile, outputFile: reportFile, kicadCliPath: context.detected.path })
  await updateValidationState(context.files.projectDir, job.type, 'drc', output)
  return result(job, output.status, output.issueCounts.warnings ? [{ severity: 'WARNING', code: 'DRC_WARNINGS', message: `${output.issueCounts.warnings} DRC warnings found.` }] : [], output.issueCounts.errors ? [{ severity: 'ERROR', code: 'DRC_ERRORS', message: `${output.issueCounts.errors} DRC errors found.` }] : [], { kicad: context.detected, report: output, generatedFiles: [reportFile].filter((file) => file), humanReviewRequired: true })
}

async function runErcJob(job, workspace) {
  const context = await getKiCadContext(job, workspace, 'sch')
  if (context.blocked) return context.blocked
  const reportFile = path.join(context.files.projectDir, 'reports', 'erc.json')
  const output = await runErc({ schFile: context.files.schFile, outputFile: reportFile, kicadCliPath: context.detected.path })
  await updateValidationState(context.files.projectDir, job.type, 'erc', output)
  return result(job, output.status, output.issueCounts.warnings ? [{ severity: 'WARNING', code: 'ERC_WARNINGS', message: `${output.issueCounts.warnings} ERC warnings found.` }] : [], output.issueCounts.errors ? [{ severity: 'ERROR', code: 'ERC_ERRORS', message: `${output.issueCounts.errors} ERC errors found.` }] : [], { kicad: context.detected, report: output, generatedFiles: [reportFile], humanReviewRequired: true })
}

async function exportGerbersJob(job, workspace) {
  const context = await getKiCadContext(job, workspace, 'pcb')
  if (context.blocked) return context.blocked
  const output = await exportGerbers({ pcbFile: context.files.pcbFile, outputDir: path.join(context.files.projectDir, 'fab', 'gerbers'), kicadCliPath: context.detected.path })
  await updateExportState(context.files.projectDir, job.type, 'gerbers', output)
  return result(job, output.status, output.status.endsWith('FAILED') ? [{ severity: 'WARNING', code: 'GERBER_EXPORT_FAILED', message: output.stderr || 'Gerber export failed.' }] : [], [], { kicad: context.detected, export: output, generatedFiles: output.files, humanReviewRequired: true })
}

async function exportDrillJob(job, workspace) {
  const context = await getKiCadContext(job, workspace, 'pcb')
  if (context.blocked) return context.blocked
  const output = await exportDrill({ pcbFile: context.files.pcbFile, outputDir: path.join(context.files.projectDir, 'fab', 'drill'), kicadCliPath: context.detected.path })
  await updateExportState(context.files.projectDir, job.type, 'drill', output)
  return result(job, output.status, output.status.endsWith('FAILED') ? [{ severity: 'WARNING', code: 'DRILL_EXPORT_FAILED', message: output.stderr || 'Drill export failed.' }] : [], [], { kicad: context.detected, export: output, generatedFiles: output.files, humanReviewRequired: true })
}

async function exportBomJob(job, workspace) {
  const context = await getKiCadContext(job, workspace, 'sch')
  if (context.blocked) return context.blocked
  const outputFile = path.join(context.files.projectDir, 'fab', 'bom.csv')
  const output = await exportBom({ schFile: context.files.schFile, outputFile, kicadCliPath: context.detected.path })
  const hasRows = await csvHasBomRows(outputFile)
  if (output.status === 'BOM_EXPORTED' && !hasRows) {
    const fallback = await writePlacementBom(context.files.projectDir, outputFile)
    if (fallback.generated) {
      await updateExportState(context.files.projectDir, job.type, 'bom', { ...output, status: 'BOM_EXPORTED_FROM_PLACEMENT_NEEDS_REVIEW', placementFallback: fallback, files: [outputFile] })
      return result(job, 'BOM_EXPORTED_FROM_PLACEMENT_NEEDS_REVIEW', [{ severity: 'WARNING', code: 'BOM_FROM_PLACEMENT', message: 'KiCad schematic BOM was empty, so BoardForge generated a review-required BOM from placed PCB components.' }], [], { kicad: context.detected, export: { ...output, placementFallback: fallback }, generatedFiles: [outputFile], humanReviewRequired: true })
    }
  }
  await updateExportState(context.files.projectDir, job.type, 'bom', output)
  return result(job, output.status, output.status.endsWith('FAILED') ? [{ severity: 'WARNING', code: 'BOM_EXPORT_FAILED', message: output.stderr || 'BOM export failed.' }] : [], [], { kicad: context.detected, export: output, generatedFiles: output.files, humanReviewRequired: true })
}

async function exportCplJob(job, workspace) {
  const context = await getKiCadContext(job, workspace, 'pcb')
  if (context.blocked) return context.blocked
  const output = await exportCpl({ pcbFile: context.files.pcbFile, outputFile: path.join(context.files.projectDir, 'fab', 'cpl.csv'), kicadCliPath: context.detected.path })
  await updateExportState(context.files.projectDir, job.type, 'cpl', output)
  return result(job, output.status, output.status.endsWith('FAILED') ? [{ severity: 'WARNING', code: 'CPL_EXPORT_FAILED', message: output.stderr || 'CPL export failed.' }] : [], [], { kicad: context.detected, export: output, generatedFiles: output.files, humanReviewRequired: true })
}

async function packageJlcpcbJob(job, workspace) {
  const context = await getKiCadContext(job, workspace, 'pcb')
  if (context.blocked) return context.blocked
  const gerberDir = path.join(context.files.projectDir, 'fab', 'gerbers')
  const drillDir = path.join(context.files.projectDir, 'fab', 'drill')
  const gerbers = await collectExistingFiles(gerberDir)
  const drillFiles = await collectExistingFiles(drillDir)
  const requiredFiles = [
    ...(gerbers.length ? gerbers : [path.join(gerberDir, '__missing_gerbers__')]),
    ...(drillFiles.length ? drillFiles : [path.join(drillDir, '__missing_drill_files__')]),
    path.join(context.files.projectDir, 'fab', 'bom.csv'),
    path.join(context.files.projectDir, 'fab', 'cpl.csv'),
    path.join(context.files.projectDir, 'reports', 'drc.json'),
    path.join(context.files.projectDir, 'reports', 'erc.json'),
  ]
  const output = await packageJlcpcb({ projectDir: context.files.projectDir, outputFile: path.join(context.files.projectDir, 'fab', `${path.basename(context.files.projectDir)}-jlcpcb.zip`), requiredFiles })
  await updateExportState(context.files.projectDir, job.type, 'jlcpcb', output)
  return result(job, output.status, output.missingFiles?.length ? [{ severity: 'WARNING', code: 'PACKAGE_MISSING_FILES', message: `${output.missingFiles.length} required package files are missing.` }] : [], [], { package: output, generatedFiles: output.outputFile && output.status === 'MANUFACTURING_PACKAGE_GENERATED_NEEDS_REVIEW' ? [output.outputFile] : [], humanReviewRequired: true })
}

async function updateStateForProjectInput(job, workspace, updater) {
  if (!job.input?.projectPath) return null
  const projectDir = resolveInsideWorkspace(workspace, job.input.projectPath)
  return updateProjectState(projectDir, updater)
}

async function updateValidationState(projectDir, jobType, key, output) {
  return updateProjectState(projectDir, async (state) => ({
    ...state,
    status: output.status,
    validation: { ...state.validation, [key]: { status: output.status, reportFile: output.reportFile, issueCounts: output.issueCounts, exitCode: output.exitCode } },
    lastJobType: jobType,
    lastHistoryMessage: `${key.toUpperCase()} completed with status ${output.status}.`,
  }))
}

async function updateExportState(projectDir, jobType, key, output) {
  return updateProjectState(projectDir, async (state) => ({
    ...state,
    status: output.status,
    exports: { ...state.exports, [key]: { status: output.status, files: output.files || [], target: output.target || output.outputFile || null, missingFiles: output.missingFiles || [] } },
    generatedFiles: [...new Set([...(state.generatedFiles || []), ...(output.files || []), output.outputFile].filter(Boolean))],
    lastJobType: jobType,
    lastHistoryMessage: `${key} export/package completed with status ${output.status}.`,
  }))
}

async function collectExistingFiles(directory) {
  try {
    const entries = await readdir(directory, { withFileTypes: true })
    const files = []
    for (const entry of entries) {
      const full = path.join(directory, entry.name)
      if (entry.isDirectory()) files.push(...await collectExistingFiles(full))
      else files.push(full)
    }
    return files
  } catch {
    return []
  }
}

async function csvHasBomRows(file) {
  try {
    const csv = await readFile(file, 'utf8')
    return csv.trim().split(/\r?\n/).length > 1
  } catch {
    return false
  }
}

async function writePlacementBom(projectDir, outputFile) {
  try {
    const raw = await readFile(path.join(projectDir, 'boardforge-components.json'), 'utf8')
    const components = JSON.parse(raw)
    const groups = new Map()
    for (const component of components) {
      const key = `${component.value}|${component.footprint}`
      const existing = groups.get(key) || { refs: [], value: component.value, footprint: component.footprint, qty: 0, dnp: '' }
      existing.refs.push(component.ref)
      existing.qty += 1
      groups.set(key, existing)
    }
    const lines = ['"Refs","Value","Footprint","Qty","DNP","Source"']
    for (const group of groups.values()) {
      lines.push([group.refs.join(' '), group.value, group.footprint, String(group.qty), group.dnp, 'BoardForge placed components'].map((value) => `"${String(value).replace(/"/g, '""')}"`).join(','))
    }
    await mkdir(path.dirname(outputFile), { recursive: true })
    await writeFile(outputFile, `${lines.join('\n')}\n`, 'utf8')
    return { generated: true, rows: groups.size }
  } catch (error) {
    return { generated: false, error: error.message }
  }
}
