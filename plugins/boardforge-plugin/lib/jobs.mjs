import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { createNetClasses, assignNetsToClasses, validateNetClasses } from './net-classes.mjs'
import { getManufacturerProfile } from './manufacturers.mjs'
import { pointInPolygon, rectCorners, rectsOverlap } from './geometry.mjs'
import { createBoardShape, createTemplateBoard, boardTemplates } from './templates.mjs'
import { generatePlacementPlan, optimizePlacementPlan } from './placement.mjs'
import { generateRoutingPlan } from './routing.mjs'
import { autorouteBoard } from './autorouter.mjs'
import { kicadPcbFile, kicadProjectFile, kicadSchematicFile, projectReadmeFile, readmeFile, scanKiCadProject } from './kicad.mjs'
import { runFullSelfReview, validateBoardOutline, validatePlacement } from './validation.mjs'
import { detectKiCadCli, exportBom, exportCpl, exportDrill, exportGerbers, findKiCadProjectFiles, packageJlcpcb, runDrc, runErc } from './kicad-cli.mjs'
import { generateTemplateComponents, renderPlacedFootprints } from './components.mjs'
import { findMissingFootprints, link3dModels, resolveComponentAssets, searchLibraryAssets, syncKiCadLibraries } from './library-adapter.mjs'
import { createProjectState, normalizeComponents, readProjectState, stateFileName, summarizeProjectState, updateProjectState } from './project-state.mjs'
import { createDesignIntent, validateZones } from './design-rules.mjs'
import { applyNetlistSyncToPcb, applyRoutingPlanToPcb } from './copper-writer.mjs'
import { applyPlacementPlanToPcb } from './placement-writer.mjs'
import { buildDesignConstraints } from './design-constraints.mjs'
import { buildWorkflowPreset } from './workflow-presets.mjs'
import { buildKiCadRules, writeKiCadRules } from './kicad-rules-writer.mjs'
import { buildComponentDatabase, enrichComponents } from './component-database.mjs'
import { boardforgeNetlistFromComponents, generateSchematicModel, kicadSchematicFromModel } from './schematic-generator.mjs'
import { synthesizeSchematicDesign } from './schematic-synthesizer.mjs'
import { applySafeDrcRepairs, planDrcRepairs } from './drc-repair.mjs'
import { applySafeErcRepairs, planErcRepairs } from './erc-repair.mjs'
import { applyInteractiveEdits } from './interactive-edits.mjs'
import { validateComponentBindings } from './component-compatibility.mjs'
import { validateExportGate, validateManufacturingReadiness } from './manufacturing-readiness.mjs'
import { buildManufacturingManifest } from './manufacturing-manifest.mjs'
import { validateJlcpcbPackage } from './jlcpcb-package-validator.mjs'
import { validateSchematicPcbSync } from './schematic-pcb-sync.mjs'
import { validate3dModelCoverage } from './model-coverage.mjs'
import { auditBomSourcing } from './bom-sourcing-audit.mjs'
import { applySafePinMapRepairs, planPinMapRepairs } from './pin-map-repair.mjs'
import { planCopperPours } from './copper-pour-planner.mjs'
import { validateRoutingGeometry } from './routing-validation.mjs'
import { scoreRoutingPlan } from './routing-quality.mjs'
import { runDesignAudit } from './design-audit.mjs'
import { createProjectSnapshot, diffProjectSnapshot, listProjectSnapshots, restoreProjectSnapshot } from './project-snapshots.mjs'
import { auditComponentLibraryCoverage } from './component-audit.mjs'
import { buildProjectPreflight } from './project-preflight.mjs'
import { planRequirements } from './requirements-planner.mjs'
import { planMissionRequirements } from './mission-planner.mjs'
import { auditUserBom, intakeUserBom } from './user-bom.mjs'
import { compareManufacturerCapabilities, planStackup, scoreBoardComplexity } from './stackup-planner.mjs'
import { planAssemblyAndMechanical } from './assembly-planner.mjs'
import { planPowerTree } from './power-tree-planner.mjs'
import { planFanout } from './fanout-planner.mjs'
import { runDfmChecks } from './dfm-checker.mjs'
import { planSignalIntegrity } from './signal-integrity-planner.mjs'
import { planPinAssignments } from './pin-assignment-planner.mjs'
import { planTestStrategy } from './test-strategy-planner.mjs'
import { buildCategoryPlan, listBoardCategories } from './board-categories.mjs'
import { buildRoutingReport } from './routing-report.mjs'
import { validateSchematicGraph } from './schematic-validator.mjs'
import { checkRoutingReadiness } from './routing-readiness.mjs'
import { calculatePowerRouting } from './power-routing-calculator.mjs'
import { selectViaStrategy } from './via-strategy-engine.mjs'
import { buildNoiseMap } from './noise-map.mjs'
import { summarizeManufacturerRules } from './manufacturer-rules-summary.mjs'
import { generateProjectReviewReport } from './project-review-report.mjs'
import {
  analyzeRoutingCongestion,
  analyzeThermalBottlenecks,
  buildReleaseGateReport,
  estimateBoardCost,
  generateEngineeringQuestions,
  planDifferentialPairTuning,
  planEscapeRouting,
  scoreProductionReadiness,
  validateAssemblyOrientation,
  validatePowerIntegrity,
} from './engineering-intelligence.mjs'
import {
  buildVerifiedDemoRecipe,
  ingestReferenceDesign,
  planAutorouteRepairLoop,
  planProductionPipeline,
  solvePlacement,
  synthesizeCircuitBlocks,
} from './production-workflows.mjs'
import { productionReadinessJobTypes, runProductionReadinessJob } from './production-readiness-suite.mjs'
import { advancedBoardJobTypes, runAdvancedBoardJob } from './advanced-board-suite.mjs'

export const allowedJobTypes = new Set(['create_outline_board', 'create_kicad_project', 'apply_edge_cuts', 'add_mounting_holes', 'round_board_corners', 'add_usb_c_edge_cutout', 'add_rj45_edge_clearance', 'validate_board_outline', 'scan_kicad_project', 'snapshot_project', 'list_project_snapshots', 'diff_project_snapshot', 'restore_project_snapshot', 'run_project_preflight', 'list_board_categories', 'plan_board_category', 'validate_schematic_graph', 'synthesize_schematic_design', 'validate_schematic_pcb_sync', 'apply_schematic_pcb_sync', 'check_routing_readiness', 'calculate_power_routing', 'select_via_strategy', 'build_noise_map', 'summarize_manufacturer_rules', 'generate_project_review_report', 'build_workflow_preset', 'run_boardforge_workflow', 'plan_mission_requirements', 'intake_user_bom', 'audit_user_bom', 'ingest_reference_design', 'synthesize_circuit_blocks', 'plan_production_pipeline', 'build_verified_demo_recipe', 'plan_requirements', 'plan_pin_assignments', 'plan_power_tree', 'plan_stackup', 'plan_fanout', 'plan_signal_integrity', 'plan_test_strategy', 'run_dfm_checks', 'compare_manufacturers', 'plan_complex_board', 'generate_design_constraints', 'generate_kicad_rules', 'sync_kicad_libraries', 'search_library_assets', 'resolve_component_assets', 'sync_component_database', 'resolve_bom_parts', 'audit_component_library', 'validate_component_bindings', 'plan_pin_map_repairs', 'apply_pin_map_repairs', 'validate_3d_model_coverage', 'audit_bom_sourcing', 'validate_manufacturing_readiness', 'validate_jlcpcb_package', 'generate_manufacturing_manifest', 'generate_netlist', 'run_design_audit', 'generate_schematic', 'plan_erc_repairs', 'apply_safe_erc_repairs', 'plan_drc_repairs', 'apply_safe_drc_repairs', 'interactive_edit', 'find_missing_footprints', 'link_3d_models', 'create_net_classes', 'classify_nets', 'assign_net_classes', 'assign_net_to_class', 'validate_net_classes', 'report_unclassified_nets', 'generate_placement_plan', 'optimize_placement', 'solve_placement', 'apply_placement_plan', 'validate_placement', 'move_component', 'fix_component_off_board', 'fix_component_overlap', 'fix_mounting_hole_conflicts', 'analyze_routing_congestion', 'plan_escape_routing', 'plan_diff_pair_tuning', 'validate_power_integrity', 'analyze_thermal_bottlenecks', 'validate_assembly_orientation', 'estimate_board_cost', 'generate_engineering_questions', 'score_production_readiness', 'build_release_gate_report', 'generate_routing_plan', 'generate_routing_report', 'plan_copper_pours', 'autoroute_board', 'autoroute_and_apply', 'autoroute_drc_iteration', 'plan_autoroute_repair_loop', 'score_routing_quality', 'apply_routing_plan', 'validate_routing_geometry', 'route_critical_nets', 'route_power_nets', 'route_diff_pair', 'route_signal_net', 'add_ground_zone', 'stitch_ground_vias', 'validate_routes', 'report_unrouted_nets', 'fix_route_clearance_violations', 'run_full_self_review', 'run_kicad_drc', 'run_kicad_erc', 'export_gerbers', 'export_drill_files', 'export_bom', 'export_cpl', 'package_jlcpcb', 'summarize_project'])
for (const type of productionReadinessJobTypes) allowedJobTypes.add(type)
for (const type of advancedBoardJobTypes) allowedJobTypes.add(type)
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
  if (job.type === 'snapshot_project') return snapshotProjectJob(job, workspace)
  if (job.type === 'list_project_snapshots') return listProjectSnapshotsJob(job, workspace)
  if (job.type === 'diff_project_snapshot') return diffProjectSnapshotJob(job, workspace)
  if (job.type === 'restore_project_snapshot') return restoreProjectSnapshotJob(job, workspace)
  if (job.type === 'run_project_preflight') return projectPreflightJob(job, workspace)
  if (job.type === 'list_board_categories') return result(job, 'BOARD_CATEGORIES_LISTED', [], [], { categories: listBoardCategories(), humanReviewRequired: false })
  if (job.type === 'plan_board_category') return boardCategoryPlanJob(job, workspace)
  if (job.type === 'validate_schematic_graph') return schematicGraphJob(job, workspace)
  if (job.type === 'synthesize_schematic_design') return schematicSynthesisJob(job, workspace)
  if (job.type === 'validate_schematic_pcb_sync') return schematicPcbSyncJob(job, workspace)
  if (job.type === 'apply_schematic_pcb_sync') return applySchematicPcbSyncJob(job, workspace)
  if (job.type === 'check_routing_readiness') return routingReadinessJob(job, workspace, profile)
  if (job.type === 'calculate_power_routing') return powerRoutingJob(job, workspace, profile)
  if (job.type === 'select_via_strategy') return viaStrategyJob(job, workspace, profile)
  if (job.type === 'build_noise_map') return noiseMapJob(job, workspace)
  if (job.type === 'summarize_manufacturer_rules') return manufacturerRulesJob(job, profile)
  if (job.type === 'generate_project_review_report') return projectReviewReportJob(job, workspace, profile)
  if (job.type === 'build_workflow_preset') return workflowPresetJob(job, workspace)
  if (job.type === 'run_boardforge_workflow') return runBoardForgeWorkflowJob(job, workspace)
  if (job.type === 'plan_mission_requirements') return missionRequirementsJob(job, workspace)
  if (job.type === 'intake_user_bom') return userBomIntakeJob(job, workspace)
  if (job.type === 'audit_user_bom') return userBomAuditJob(job, workspace)
  if (['ingest_reference_design', 'synthesize_circuit_blocks', 'solve_placement', 'plan_autoroute_repair_loop', 'build_verified_demo_recipe', 'plan_production_pipeline'].includes(job.type)) return productionWorkflowJob(job, workspace)
  if (productionReadinessJobTypes.includes(job.type)) return productionReadinessSuiteJob(job, workspace, profile)
  if (advancedBoardJobTypes.includes(job.type)) return advancedBoardSuiteJob(job, workspace, profile)
  if (job.type === 'plan_requirements') return planRequirementsJob(job, workspace)
  if (job.type === 'plan_pin_assignments') return pinAssignmentsJob(job, workspace)
  if (job.type === 'plan_power_tree') return powerTreePlanJob(job, workspace)
  if (job.type === 'plan_stackup') return stackupPlanJob(job, workspace, profile)
  if (job.type === 'plan_fanout') return fanoutPlanJob(job, workspace)
  if (job.type === 'plan_signal_integrity') return signalIntegrityPlanJob(job, workspace, profile)
  if (job.type === 'plan_test_strategy') return testStrategyPlanJob(job, workspace)
  if (job.type === 'run_dfm_checks') return dfmChecksJob(job, workspace, profile)
  if (job.type === 'compare_manufacturers') return manufacturerCompareJob(job)
  if (job.type === 'plan_complex_board') return complexBoardPlanJob(job, workspace, profile)
  if (job.type === 'generate_design_constraints') return designConstraintsJob(job, workspace, profile)
  if (job.type === 'generate_kicad_rules') return kicadRulesJob(job, workspace, profile)
  if (job.type === 'sync_kicad_libraries') return librarySyncJob(job, workspace)
  if (job.type === 'search_library_assets') return librarySearchJob(job, workspace)
  if (job.type === 'resolve_component_assets') return resolveAssetsJob(job, workspace)
  if (job.type === 'sync_component_database' || job.type === 'resolve_bom_parts') return componentDatabaseJob(job, workspace)
  if (job.type === 'audit_component_library') return componentLibraryAuditJob(job, workspace)
  if (job.type === 'validate_component_bindings') return validateComponentBindingsJob(job, workspace)
  if (job.type === 'plan_pin_map_repairs') return pinMapRepairJob(job, workspace, false)
  if (job.type === 'apply_pin_map_repairs') return pinMapRepairJob(job, workspace, true)
  if (job.type === 'validate_3d_model_coverage') return modelCoverageJob(job, workspace)
  if (job.type === 'audit_bom_sourcing') return bomSourcingAuditJob(job, workspace)
  if (job.type === 'validate_manufacturing_readiness') return manufacturingReadinessJob(job, workspace)
  if (job.type === 'validate_jlcpcb_package') return jlcpcbPackageValidationJob(job, workspace)
  if (job.type === 'generate_manufacturing_manifest') return manufacturingManifestJob(job, workspace)
  if (job.type === 'generate_netlist') return generateNetlistJob(job, workspace)
  if (job.type === 'run_design_audit') return designAuditJob(job, workspace, profile)
  if (job.type === 'generate_schematic') return generateSchematicJob(job, workspace)
  if (job.type === 'plan_erc_repairs') return planErcRepairsJob(job, workspace)
  if (job.type === 'apply_safe_erc_repairs') return applySafeErcRepairsJob(job, workspace)
  if (job.type === 'plan_drc_repairs') return planDrcRepairsJob(job, workspace)
  if (job.type === 'apply_safe_drc_repairs') return applySafeDrcRepairsJob(job, workspace)
  if (job.type === 'interactive_edit') return interactiveEditJob(job, workspace, profile)
  if (job.type === 'find_missing_footprints') return missingFootprintsJob(job, workspace)
  if (job.type === 'link_3d_models') return link3dModelsJob(job, workspace)
  if (job.type === 'create_net_classes') return result(job, 'NET_CLASSES_CREATED', [], [], { netClasses: createNetClasses(profile), humanReviewRequired: true })
  if (['classify_nets', 'assign_net_classes', 'assign_net_to_class', 'validate_net_classes', 'report_unclassified_nets'].includes(job.type)) return validateNetClassesJob(job)
  if (job.type === 'generate_placement_plan' || job.type === 'optimize_placement') return placementPlanJob(job, profile)
  if (job.type === 'apply_placement_plan' || job.type === 'move_component' || job.type === 'fix_component_overlap' || job.type === 'fix_component_off_board') return applyPlacementJob(job, workspace, profile)
  if (['analyze_routing_congestion', 'plan_escape_routing', 'plan_diff_pair_tuning', 'validate_power_integrity', 'analyze_thermal_bottlenecks', 'validate_assembly_orientation', 'estimate_board_cost', 'generate_engineering_questions', 'score_production_readiness', 'build_release_gate_report'].includes(job.type)) return engineeringIntelligenceJob(job, workspace, profile)
  if (job.type === 'autoroute_board') return autorouteBoardJob(job, workspace, profile)
  if (job.type === 'autoroute_and_apply') return autorouteAndApplyJob(job, workspace, profile)
  if (job.type === 'autoroute_drc_iteration') return autorouteDrcIterationJob(job, workspace, profile)
  if (job.type === 'apply_routing_plan') return applyRoutingPlanJob(job, workspace, profile)
  if (job.type === 'validate_routing_geometry') return routingGeometryJob(job, profile)
  if (job.type === 'score_routing_quality') return routingQualityJob(job, profile)
  if (job.type === 'generate_routing_report') return routingReportJob(job, profile)
  if (job.type === 'plan_copper_pours') return copperPourPlanJob(job, workspace, profile)
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
  const requirementsPlan = (job.input?.prompt || job.input?.notes || job.input?.components?.length || job.input?.interfaces?.length)
    ? planRequirements({ ...job.input, templateId: job.input?.templateId || board.id })
    : null
  const plannedComponents = requirementsPlan?.components?.length ? applyPlannedPlacement(board, requirementsPlan.components) : null
  const components = plannedComponents || generateTemplateComponents(board, job.input?.templateId)
  const designIntent = createDesignIntent(board, components, assignNetsToClasses(requirementsPlan?.nets || job.input?.nets || []), profile)
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
  const bindingReport = await validateComponentBindings(resolvedComponents)
  const plannedNets = assignNetsToClasses(requirementsPlan?.nets || job.input?.nets || [])
  const pinAssignments = planPinAssignments({ components: resolvedComponents, nets: plannedNets, interfaces: job.input?.interfaces || [], input: job.input || {} })
  const netlist = boardforgeNetlistFromComponents(resolvedComponents, plannedNets)
  const schematicModel = generateSchematicModel(board, resolvedComponents, { ...job.input, nets: plannedNets })
  const powerTree = planPowerTree({ ...job.input, board, components: resolvedComponents, nets: plannedNets })
  const stackup = planStackup({ ...job.input, board, components: resolvedComponents, nets: plannedNets, manufacturerProfile: profile.id })
  const fanoutPlan = planFanout({ ...job.input, board, components: resolvedComponents, nets: plannedNets, stackup, layerCount: stackup.layerCount })
  const assemblyPlan = planAssemblyAndMechanical(board, resolvedComponents, job.input || {})
  const designConstraints = buildDesignConstraints(board, resolvedComponents, plannedNets, profile, { requirementsPlan, stackup, assemblyPlan, designIntent, powerTree, fanoutPlan })
  const kicadRules = buildKiCadRules(board, plannedNets, profile, designConstraints)
  const signalIntegrity = planSignalIntegrity({ board, components: resolvedComponents, nets: plannedNets, stackup, routingPlan: null, profile, input: job.input || {} })
  const testStrategy = planTestStrategy({ board, components: resolvedComponents, nets: plannedNets, powerTree, pinAssignments, input: job.input || {} })
  const dfmReport = runDfmChecks({ board, components: resolvedComponents, routes: [], profile, stackup, powerTree, fanoutPlan, options: job.input || {} })
  const state = {
    ...createProjectState({ job: { ...job, input: { ...job.input, designIntent, requirementsPlan, nets: plannedNets } }, board, mode: 'full_project_scaffold', profile, components: resolvedComponents, library, componentBindings: bindingReport, review: { ...review, placementIssues, zoneIssues, bindingIssues: [...bindingReport.warnings, ...bindingReport.errors] }, generatedFiles: [] }),
    requirementsPlan,
    pinAssignments,
    powerTree,
    stackup,
    fanoutPlan,
    dfmReport,
    assemblyPlan,
    designConstraints,
    signalIntegrity,
    testStrategy,
    kicadRules: { status: kicadRules.status, fileName: kicadRules.fileName },
  }
  const files = [
    { path: `${safeName}.kicad_pro`, content: kicadProjectFile(board, netClasses) },
    { path: `${safeName}.kicad_sch`, content: kicadSchematicFile(board, { components: resolvedComponents }) },
    { path: `${safeName}.kicad_pcb`, content: kicadPcbFile(board, { netClasses, footprints }) },
    { path: 'boardforge-components.json', content: JSON.stringify(resolvedComponents, null, 2) },
    { path: 'boardforge-pin-assignments.json', content: JSON.stringify(pinAssignments, null, 2) },
    { path: 'boardforge-netlist.json', content: JSON.stringify(netlist, null, 2) },
    { path: 'boardforge-schematic-model.json', content: JSON.stringify(schematicModel, null, 2) },
    { path: 'boardforge-power-tree.json', content: JSON.stringify(powerTree, null, 2) },
    { path: 'boardforge-stackup-plan.json', content: JSON.stringify(stackup, null, 2) },
    { path: 'boardforge-fanout-plan.json', content: JSON.stringify(fanoutPlan, null, 2) },
    { path: 'boardforge-dfm-report.json', content: JSON.stringify(dfmReport, null, 2) },
    { path: 'boardforge-signal-integrity.json', content: JSON.stringify(signalIntegrity, null, 2) },
    { path: 'boardforge-test-strategy.json', content: JSON.stringify(testStrategy, null, 2) },
    { path: 'boardforge-assembly-plan.json', content: JSON.stringify(assemblyPlan, null, 2) },
    { path: 'boardforge-constraints.json', content: JSON.stringify(designConstraints, null, 2) },
    { path: kicadRules.fileName, content: kicadRules.rulesText },
    { path: 'boardforge-library.json', content: JSON.stringify(library, null, 2) },
    ...(requirementsPlan ? [{ path: 'boardforge-requirements-plan.json', content: JSON.stringify(requirementsPlan, null, 2) }] : []),
    { path: 'boardforge-bindings.json', content: JSON.stringify(bindingReport, null, 2) },
    { path: 'boardforge-review.json', content: JSON.stringify({ ...review, components }, null, 2) },
    { path: stateFileName, content: JSON.stringify({ ...state, generatedFiles: [] }, null, 2) },
    { path: 'README.md', content: projectReadmeFile(job, board, review) },
  ]
  const generatedFiles = files.map((file) => path.join(projectDir, file.path))
  const stateIndex = files.findIndex((file) => file.path === stateFileName)
  files[stateIndex] = { path: stateFileName, content: JSON.stringify({ ...state, generatedFiles }, null, 2) }
  if (!job.dryRun) {
    await mkdir(projectDir, { recursive: true })
    for (const file of files) await writeFile(resolveInsideWorkspace(projectDir, file.path), file.content, 'utf8')
  }
  return result(job, 'KICAD_PROJECT_CREATED_NEEDS_REVIEW', review.issues.filter((item) => item.severity === 'WARNING'), review.issues.filter((item) => ['BLOCKER', 'ERROR'].includes(item.severity)), { projectPath: projectDir, generatedFiles, requirementsPlan, projectState: summarizeProjectState({ ...state, generatedFiles }), qualityGates: review.qualityGates, summary: review.summary, humanReviewRequired: true })
}

function applyPlannedPlacement(board, components) {
  const bounds = {
    minX: Math.min(...board.outline.map((point) => point.x)),
    maxX: Math.max(...board.outline.map((point) => point.x)),
    minY: Math.min(...board.outline.map((point) => point.y)),
    maxY: Math.max(...board.outline.map((point) => point.y)),
  }
  const placed = []
  const ordered = [...components].sort((a, b) => placementPriority(b) - placementPriority(a))
  const generic = plannedPositions(bounds, components.length + 18)
  for (const component of ordered) {
    const dims = componentDimensions(component.group)
    const base = { ...component, ...dims }
    const candidates = [...rolePositions(component, bounds), ...nearParentPositions(component, bounds, placed), ...generic]
    const selected = candidates.find((candidate) => canPlace(board, { ...base, ...candidate }, placed)) || firstInside(board, base, candidates) || { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2, rotation: 0 }
    placed.push({ ...base, ...selected, rotation: component.rotation ?? selected.rotation ?? 0 })
  }
  const byRef = new Map(placed.map((component) => [component.ref, component]))
  return components.map((component) => byRef.get(component.ref))
}

function plannedPositions(bounds, count) {
  const cols = Math.max(5, Math.ceil(Math.sqrt(count * 1.7)))
  const rows = Math.max(4, Math.ceil(count / cols) + 1)
  const marginX = Math.min(12, Math.max(7, (bounds.maxX - bounds.minX) * 0.14))
  const marginY = Math.min(10, Math.max(7, (bounds.maxY - bounds.minY) * 0.18))
  const usableW = Math.max(1, bounds.maxX - bounds.minX - marginX * 2)
  const usableH = Math.max(1, bounds.maxY - bounds.minY - marginY * 2)
  const positions = []
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      positions.push({
        x: bounds.minX + marginX + (usableW * (col + 0.5)) / cols,
        y: bounds.minY + marginY + (usableH * (row + 0.5)) / rows,
        rotation: 0,
      })
    }
  }
  return positions
}

function rolePositions(component, bounds) {
  const cx = (bounds.minX + bounds.maxX) / 2
  const cy = (bounds.minY + bounds.maxY) / 2
  const role = component.role || ''
  const w = bounds.maxX - bounds.minX
  const h = bounds.maxY - bounds.minY
  if (/edge_usb/.test(role) || component.group === 'USB') return edgeFan(bounds, 'left', cy, 90)
  if (/edge_ethernet/.test(role) || component.group === 'RJ45') return edgeFan(bounds, 'right', cy, 270)
  if (/edge_sensor/.test(role) || component.group === 'SENSOR_CONNECTOR') return edgeFan(bounds, 'top', bounds.minX + w * 0.72, 0)
  if (/debug_header/.test(role) || component.group === 'SWD') return edgeFan(bounds, 'bottom', bounds.minX + w * 0.72, 180)
  if (/edge_esc/.test(role) || component.group === 'ESC_CONNECTOR') return edgeFan(bounds, 'bottom', cx, 0)
  if (/mcu_rf_module/.test(role) || component.group === 'ESP32_S3') return [
    { x: bounds.minX + w * 0.42, y: cy, rotation: 0 },
    { x: cx, y: cy, rotation: 0 },
    { x: bounds.minX + w * 0.38, y: bounds.minY + h * 0.62, rotation: 0 },
  ]
  if (/ethernet_phy/.test(role) || component.group === 'ETHERNET_PHY') return [
    { x: bounds.minX + w * 0.63, y: bounds.minY + h * 0.35, rotation: 0 },
    { x: bounds.minX + w * 0.58, y: bounds.minY + h * 0.58, rotation: 0 },
  ]
  if (/poe_front_end/.test(role) || component.group === 'POE_FRONT_END') return [
    { x: bounds.minX + w * 0.62, y: bounds.minY + h * 0.66, rotation: 0 },
    { x: bounds.minX + w * 0.52, y: bounds.minY + h * 0.72, rotation: 0 },
  ]
  if (/power_regulator/.test(role) || component.group === 'REGULATOR') return [
    { x: bounds.minX + w * 0.28, y: bounds.minY + h * 0.66, rotation: 0 },
    { x: bounds.minX + w * 0.28, y: bounds.minY + h * 0.34, rotation: 0 },
  ]
  return []
}

function edgeFan(bounds, edge, along, rotation) {
  const offsets = [-8, 0, 8, -14, 14]
  return offsets.map((offset) => {
    if (edge === 'left') return { x: bounds.minX + 7, y: along + offset, rotation }
    if (edge === 'right') return { x: bounds.maxX - 9, y: along + offset, rotation }
    if (edge === 'top') return { x: along + offset, y: bounds.minY + 7, rotation }
    return { x: along + offset, y: bounds.maxY - 7, rotation }
  })
}

function nearParentPositions(component, bounds, placed) {
  const parent = parentRef(component)
  const anchor = placed.find((item) => item.ref === parent) || placed.find((item) => item.group === parentGroup(component))
  if (!anchor) return []
  const radius = ['CAP', 'RES'].includes(component.group) ? 6 : 9
  return [
    { x: anchor.x - radius, y: anchor.y - radius, rotation: 0 },
    { x: anchor.x + radius, y: anchor.y - radius, rotation: 0 },
    { x: anchor.x - radius, y: anchor.y + radius, rotation: 0 },
    { x: anchor.x + radius, y: anchor.y + radius, rotation: 0 },
    { x: anchor.x, y: anchor.y - radius, rotation: 0 },
    { x: anchor.x, y: anchor.y + radius, rotation: 0 },
  ].filter((point) => point.x > bounds.minX && point.x < bounds.maxX && point.y > bounds.minY && point.y < bounds.maxY)
}

function parentRef(component) {
  if (/^C10|^L10/.test(component.ref)) return 'U10'
  if (/^C4/.test(component.ref)) return component.ref === 'C40' ? 'U40' : 'U41'
  if (/^C10[12]|^R10[12]|^SW[12]/.test(component.ref)) return 'U1'
  if (/^R20|^R21/.test(component.ref)) return 'J20'
  if (/USB/.test(component.ref)) return 'J1'
  return null
}

function parentGroup(component) {
  if (component.netA === '3V3' || component.netB === '3V3') return 'REGULATOR'
  if (/USB/.test(component.value || '')) return 'USB'
  return null
}

function canPlace(board, candidate, placed) {
  return isInsideBoard(board, candidate, 0.6)
    && !conflictsWithHoles(board, candidate, 1.2)
    && !placed.some((other) => rectsOverlap(candidate, other, componentClearance(candidate, other)))
}

function firstInside(board, component, candidates) {
  return candidates.find((candidate) => isInsideBoard(board, { ...component, ...candidate }, 1.2) && !conflictsWithHoles(board, { ...component, ...candidate }, 1.2))
}

function isInsideBoard(board, component, clearance = 0) {
  return rectCorners(component, clearance).every((corner) => pointInPolygon(corner, board.outline))
}

function conflictsWithHoles(board, component, clearance = 1) {
  return (board.mountingHoles || []).some((hole) => rectsOverlap(component, { x: hole.x, y: hole.y, width: hole.diameterMm + clearance * 2, height: hole.diameterMm + clearance * 2 }))
}

function componentClearance(a, b) {
  if (['CAP', 'RES'].includes(a.group) && ['CAP', 'RES'].includes(b.group)) return 0.55
  if (['CAP', 'RES'].includes(a.group) || ['CAP', 'RES'].includes(b.group)) return 0.8
  return 1.4
}

function placementPriority(component) {
  return {
    RJ45: 100,
    USB: 95,
    ESP32_S3: 90,
    MCU: 88,
    ETHERNET_PHY: 82,
    POE_FRONT_END: 80,
    REGULATOR: 75,
    SENSOR_CONNECTOR: 70,
    SWD: 68,
    ESC_CONNECTOR: 65,
    SWITCH: 35,
    INDUCTOR: 30,
    TVS: 28,
    CAP: 10,
    RES: 10,
  }[component.group] || 20
}

function componentDimensions(group) {
  return {
    MCU: { width: 10, height: 10 },
    ESP32_S3: { width: 18, height: 14 },
    IMU: { width: 3, height: 3 },
    USB: { width: 9, height: 6 },
    RJ45: { width: 13, height: 11 },
    REGULATOR: { width: 4.5, height: 4.5 },
    ETHERNET_PHY: { width: 6, height: 6 },
    POE_FRONT_END: { width: 7, height: 6 },
    BLACKBOX: { width: 6, height: 5 },
    SENSOR_CONNECTOR: { width: 8, height: 3.5 },
    ESC_CONNECTOR: { width: 10, height: 4 },
    CAP: { width: 1.6, height: 0.8 },
    RES: { width: 1.6, height: 0.8 },
    INDUCTOR: { width: 3, height: 2.2 },
    SWD: { width: 8, height: 3.5 },
    TVS: { width: 3, height: 2 },
    SWITCH: { width: 4.5, height: 4.5 },
  }[group] || { width: 4, height: 3 }
}

async function librarySyncJob(job, workspace) {
  const output = await syncKiCadLibraries({ workspace, input: job.input || {} })
  return result(job, output.status, output.warnings || [], [], output)
}

async function snapshotProjectJob(job, workspace) {
  const projectDir = job.input?.projectPath ? resolveInsideWorkspace(workspace, job.input.projectPath) : workspace
  const output = await createProjectSnapshot(projectDir, job.input || {})
  await updateProjectState(projectDir, async (state) => ({
    ...state,
    status: output.status,
    snapshots: [...(state.snapshots || []), output.snapshot],
    lastJobType: job.type,
    lastHistoryMessage: `Snapshot ${output.snapshot.id} created with ${output.snapshot.fileCount} files.`,
  }))
  const currentStateFile = path.join(projectDir, stateFileName)
  if (existsSync(currentStateFile)) {
    await writeFile(path.join(output.snapshotPath, stateFileName), await readFile(currentStateFile, 'utf8'), 'utf8')
  }
  return result(job, output.status, [], [], { ...output, humanReviewRequired: false })
}

async function listProjectSnapshotsJob(job, workspace) {
  const projectDir = job.input?.projectPath ? resolveInsideWorkspace(workspace, job.input.projectPath) : workspace
  const snapshots = await listProjectSnapshots(projectDir)
  return result(job, 'PROJECT_SNAPSHOTS_LISTED', [], [], { snapshots, count: snapshots.length, humanReviewRequired: false })
}

async function diffProjectSnapshotJob(job, workspace) {
  const projectDir = job.input?.projectPath ? resolveInsideWorkspace(workspace, job.input.projectPath) : workspace
  const output = await diffProjectSnapshot(projectDir, job.input?.snapshotId, job.input || {})
  await updateProjectState(projectDir, async (state) => ({
    ...state,
    status: output.status,
    lastSnapshotDiff: {
      snapshotId: output.snapshot.id,
      status: output.status,
      changedFiles: output.changedFiles,
      totals: output.totals,
      at: new Date().toISOString(),
    },
    lastJobType: job.type,
    lastHistoryMessage: `Compared current project to snapshot ${output.snapshot.id}: ${output.changedFiles} changed files.`,
  }))
  return result(job, output.status, output.changedFiles ? [{ severity: 'WARNING', code: 'SNAPSHOT_DIFF_HAS_CHANGES', message: `${output.changedFiles} project files differ from snapshot ${output.snapshot.id}. Review before restore or export.` }] : [], [], output)
}

async function restoreProjectSnapshotJob(job, workspace) {
  const projectDir = job.input?.projectPath ? resolveInsideWorkspace(workspace, job.input.projectPath) : workspace
  const output = await restoreProjectSnapshot(projectDir, job.input?.snapshotId)
  await updateProjectState(projectDir, async (state) => ({
    ...state,
    status: output.status,
    restoredSnapshot: output.snapshot,
    lastJobType: job.type,
    lastHistoryMessage: `Restored snapshot ${output.snapshot.id}; KiCad review required.`,
  }))
  return result(job, output.status, [{ severity: 'WARNING', code: 'REVIEW_AFTER_RESTORE', message: 'Project files were restored from a snapshot. Re-run scan, ERC, and DRC before export.' }], [], output)
}

async function projectPreflightJob(job, workspace) {
  const projectDir = job.input?.projectPath ? resolveInsideWorkspace(workspace, job.input.projectPath) : workspace
  const scan = await scanKiCadProject(projectDir)
  const state = await readProjectState(projectDir)
  const rawComponents = job.input?.components || await readRichComponents(projectDir) || state?.components || []
  const components = rawComponents.some((component) => component.assetStatus || component.symbol || component.footprint || Object.keys(component.pinMap || {}).length)
    ? rawComponents
    : await enrichComponents({ workspace, components: rawComponents, input: job.input || {} })
  const componentAudit = auditComponentLibraryCoverage(components)
  const bindingReport = await validateComponentBindings(components)
  const netlist = boardforgeNetlistFromComponents(components)
  const readiness = await validateManufacturingReadiness(projectDir, job.input || {})
  const dfm = runDfmChecks({
    board: state?.board || {},
    components,
    routes: state?.routing?.plan?.routes || [],
    profile: getManufacturerProfile(state?.manufacturer?.id || job.input?.manufacturerProfile || 'JLCPCB_STANDARD'),
    stackup: state?.stackup || null,
    powerTree: state?.powerTree || null,
    fanoutPlan: state?.fanoutPlan || null,
    options: job.input || {},
  })
  const snapshotDiff = job.input?.snapshotId ? await diffProjectSnapshot(projectDir, job.input.snapshotId, job.input || {}) : null
  const preflight = buildProjectPreflight({ scan, componentAudit, bindingReport, netlist, readiness, dfm, snapshotDiff })
  const outputFile = path.join(projectDir, 'boardforge-preflight.json')
  const dfmFile = path.join(projectDir, 'boardforge-dfm-report.json')
  await writeFile(dfmFile, JSON.stringify(dfm, null, 2), 'utf8')
  await writeFile(outputFile, JSON.stringify({ ...preflight, scan, componentAudit, bindingReport, netlist, readiness, dfm, snapshotDiff }, null, 2), 'utf8')
  await updateProjectState(projectDir, async (current) => ({
    ...current,
    status: preflight.status,
    preflight,
    componentAudit,
    componentBindings: bindingReport,
    netlist,
    manufacturingReadiness: readiness,
    dfmReport: dfm,
    generatedFiles: [...new Set([...(current.generatedFiles || []), outputFile, dfmFile])],
    lastJobType: job.type,
    lastHistoryMessage: `Project preflight scored ${preflight.readinessScore}/100 with ${preflight.blockers.length} blockers and ${preflight.warnings.length} warnings.`,
  }))
  return result(job, preflight.status, preflight.warnings, preflight.blockers, { ...preflight, scan, componentAudit, bindingReport, netlist, readiness, dfm, snapshotDiff, generatedFiles: [outputFile, dfmFile] })
}

async function workflowPresetJob(job, workspace) {
  const preset = buildWorkflowPreset(job.input || {})
  const projectDir = job.input?.projectPath ? resolveInsideWorkspace(workspace, job.input.projectPath) : null
  const outputFile = projectDir ? path.join(projectDir, 'boardforge-workflow-preset.json') : null
  if (projectDir && !job.dryRun) {
    await writeFile(outputFile, JSON.stringify(preset, null, 2), 'utf8')
    await updateProjectState(projectDir, async (current) => ({
      ...current,
      status: preset.status,
      workflowPreset: preset,
      generatedFiles: [...new Set([...(current.generatedFiles || []), outputFile])],
      lastJobType: job.type,
      lastHistoryMessage: `Generated ${preset.preset} workflow preset with ${preset.steps.length} controlled steps.`,
    }))
  }
  return result(job, preset.status, [], [], { workflowPreset: preset, generatedFiles: outputFile ? [outputFile] : [], humanReviewRequired: true })
}

async function runBoardForgeWorkflowJob(job, workspace) {
  const preset = buildWorkflowPreset(job.input || {})
  const steps = job.input?.includeExports ? [...preset.steps, ...preset.exportStepsAfterValidation] : preset.steps
  const executed = []
  const generatedFiles = []
  let stoppedAt = null
  let projectPath = preset.projectPath
  for (const [index, step] of steps.entries()) {
    const stepJob = {
      id: `${job.id || 'workflow'}_${index + 1}_${step.type}`,
      type: step.type,
      input: {
        ...step.input,
        ...(step.type === 'create_kicad_project' ? { allowUnvalidatedExport: false } : {}),
      },
      allowOverwrite: step.type === 'create_kicad_project' ? Boolean(job.allowOverwrite || job.input?.allowOverwrite) : undefined,
      dryRun: Boolean(job.input?.dryRunSteps?.includes(step.type)),
    }
    const output = await executeJob(stepJob, workspace)
    const summary = summarizeStepResult(step, output)
    executed.push(summary)
    if (output.projectPath) projectPath = path.basename(output.projectPath)
    if (Array.isArray(output.generatedFiles)) generatedFiles.push(...output.generatedFiles)
    const blocked = output.errors?.length || /BLOCKED|FAILED|NEEDS_FIX|PLACEMENT_NEEDS_FIX/.test(output.status || '')
    if (blocked && !job.input?.continueOnBlocked) {
      stoppedAt = { step: step.type, index: index + 1, status: output.status }
      break
    }
  }
  const status = stoppedAt ? 'BOARDFORGE_WORKFLOW_BLOCKED' : 'BOARDFORGE_WORKFLOW_COMPLETE_NEEDS_REVIEW'
  const report = {
    schemaVersion: 1,
    status,
    preset: preset.preset,
    projectPath,
    stepsExecuted: executed.length,
    stepsPlanned: steps.length,
    stoppedAt,
    results: executed,
    blockers: executed.flatMap((item) => item.errors),
    warnings: executed.flatMap((item) => item.warnings),
    nextActions: workflowNextActions(executed, stoppedAt, job.input || {}),
    generatedFiles: [...new Set(generatedFiles)],
    humanReviewRequired: true,
  }
  const projectDir = projectPath ? resolveInsideWorkspace(workspace, projectPath) : null
  const outputFile = projectDir && existsSync(projectDir) ? path.join(projectDir, 'boardforge-workflow-run.json') : null
  if (outputFile && !job.dryRun) {
    await writeFile(outputFile, JSON.stringify(report, null, 2), 'utf8')
    await updateProjectState(projectDir, async (current) => ({
      ...current,
      status,
      workflowRun: report,
      generatedFiles: [...new Set([...(current.generatedFiles || []), outputFile, ...report.generatedFiles])],
      lastJobType: job.type,
      lastHistoryMessage: `Workflow ran ${report.stepsExecuted}/${report.stepsPlanned} steps with ${report.blockers.length} blockers.`,
    }))
  }
  const finalFiles = outputFile ? [...new Set([...report.generatedFiles, outputFile])] : report.generatedFiles
  return result(job, status, report.warnings, report.blockers, { workflowRun: { ...report, generatedFiles: finalFiles }, generatedFiles: finalFiles, humanReviewRequired: true })
}

async function boardCategoryPlanJob(job, workspace) {
  const output = buildCategoryPlan(job.input || {})
  const projectDir = job.input?.projectPath ? resolveInsideWorkspace(workspace, job.input.projectPath) : null
  const outputFile = projectDir ? path.join(projectDir, 'boardforge-category-plan.json') : null
  if (projectDir && !job.dryRun) {
    await writeFile(outputFile, JSON.stringify(output, null, 2), 'utf8')
    await updateProjectState(projectDir, async (current) => ({
      ...current,
      status: output.status,
      categoryPlan: output,
      generatedFiles: [...new Set([...(current.generatedFiles || []), outputFile])],
      lastJobType: job.type,
      lastHistoryMessage: `Planned board category ${output.category.id} with ${output.decisions.required.length} required decisions.`,
    }))
  }
  const warnings = output.manufacturingWarnings.map((message) => ({ severity: 'WARNING', code: 'CATEGORY_REVIEW_WARNING', message }))
  const errors = output.decisions.required.map((item) => ({ severity: 'ERROR', code: 'CATEGORY_DECISION_REQUIRED', message: item.prompt, details: item }))
  return result(job, output.status, warnings, errors, { categoryPlan: output, generatedFiles: outputFile ? [outputFile] : [], humanReviewRequired: true })
}

async function schematicGraphJob(job, workspace) {
  const projectDir = job.input?.projectPath ? resolveInsideWorkspace(workspace, job.input.projectPath) : null
  const state = projectDir ? await readProjectState(projectDir) : null
  const components = job.input?.components || await readRichComponents(projectDir) || state?.components || []
  const nets = job.input?.nets || state?.netlist?.nets || state?.requirementsPlan?.nets || state?.requirements?.nets || []
  const output = validateSchematicGraph({ ...job.input, components, nets, netlist: job.input?.netlist || state?.netlist })
  const outputFile = projectDir ? path.join(projectDir, 'boardforge-schematic-graph.json') : null
  if (projectDir && !job.dryRun) {
    await writeFile(outputFile, JSON.stringify(output, null, 2), 'utf8')
    await updateProjectState(projectDir, async (current) => ({
      ...current,
      status: output.status,
      schematicGraph: output,
      generatedFiles: [...new Set([...(current.generatedFiles || []), outputFile])],
      lastJobType: job.type,
      lastHistoryMessage: `Validated schematic graph with ${output.errors.length} errors and ${output.warnings.length} warnings.`,
    }))
  }
  return result(job, output.status, output.warnings, output.errors, { schematicGraph: output, generatedFiles: outputFile ? [outputFile] : [], humanReviewRequired: true })
}

async function routingReadinessJob(job, workspace, profile) {
  const projectDir = job.input?.projectPath ? resolveInsideWorkspace(workspace, job.input.projectPath) : null
  const state = projectDir ? await readProjectState(projectDir) : null
  const board = job.input?.board || state?.board || boardFromJob(job)
  const components = job.input?.components || await readRichComponents(projectDir) || state?.components || []
  const nets = job.input?.nets || state?.netlist?.nets || state?.requirementsPlan?.nets || []
  const output = checkRoutingReadiness({ ...job.input, board, components, nets, routingPlan: job.input?.routingPlan || state?.routing?.plan, profile, stackup: job.input?.stackup || state?.stackup, schematicGraph: job.input?.schematicGraph || state?.schematicGraph })
  const outputFile = projectDir ? path.join(projectDir, 'boardforge-routing-readiness.json') : null
  if (projectDir && !job.dryRun) {
    await writeFile(outputFile, JSON.stringify(output, null, 2), 'utf8')
    await updateProjectState(projectDir, async (current) => ({
      ...current,
      status: output.status,
      routingReadiness: output,
      generatedFiles: [...new Set([...(current.generatedFiles || []), outputFile])],
      lastJobType: job.type,
      lastHistoryMessage: `Routing readiness ${output.status} with ${output.errors.length} blockers.`,
    }))
  }
  return result(job, output.status, output.warnings, output.errors, { routingReadiness: output, generatedFiles: outputFile ? [outputFile] : [], humanReviewRequired: true })
}

async function powerRoutingJob(job, workspace, profile) {
  const projectDir = job.input?.projectPath ? resolveInsideWorkspace(workspace, job.input.projectPath) : null
  const state = projectDir ? await readProjectState(projectDir) : null
  const nets = job.input?.nets || state?.netlist?.nets || state?.requirementsPlan?.nets || []
  const output = calculatePowerRouting({ ...job.input, nets, powerTree: job.input?.powerTree || state?.powerTree, profile })
  const outputFile = projectDir ? path.join(projectDir, 'boardforge-power-routing.json') : null
  if (projectDir && !job.dryRun) {
    await writeFile(outputFile, JSON.stringify(output, null, 2), 'utf8')
    await updateProjectState(projectDir, async (current) => ({
      ...current,
      status: output.status,
      powerRouting: output,
      generatedFiles: [...new Set([...(current.generatedFiles || []), outputFile])],
      lastJobType: job.type,
      lastHistoryMessage: `Calculated power routing for ${output.calculations.length} power nets.`,
    }))
  }
  return result(job, output.status, output.warnings, output.errors, { powerRouting: output, generatedFiles: outputFile ? [outputFile] : [], humanReviewRequired: true })
}

async function viaStrategyJob(job, workspace, profile) {
  const projectDir = job.input?.projectPath ? resolveInsideWorkspace(workspace, job.input.projectPath) : null
  const state = projectDir ? await readProjectState(projectDir) : null
  const nets = job.input?.nets || state?.netlist?.nets || state?.requirementsPlan?.nets || []
  const output = selectViaStrategy({ ...job.input, nets, board: job.input?.board || state?.board, stackup: job.input?.stackup || state?.stackup, profile })
  const outputFile = projectDir ? path.join(projectDir, 'boardforge-via-strategy.json') : null
  if (projectDir && !job.dryRun) {
    await writeFile(outputFile, JSON.stringify(output, null, 2), 'utf8')
    await updateProjectState(projectDir, async (current) => ({
      ...current,
      status: output.status,
      viaStrategy: output,
      generatedFiles: [...new Set([...(current.generatedFiles || []), outputFile])],
      lastJobType: job.type,
      lastHistoryMessage: `Selected via strategy for ${output.strategies.length} nets.`,
    }))
  }
  return result(job, output.status, output.warnings, output.errors, { viaStrategy: output, generatedFiles: outputFile ? [outputFile] : [], humanReviewRequired: true })
}

async function noiseMapJob(job, workspace) {
  const projectDir = job.input?.projectPath ? resolveInsideWorkspace(workspace, job.input.projectPath) : null
  const state = projectDir ? await readProjectState(projectDir) : null
  const components = job.input?.components || await readRichComponents(projectDir) || state?.components || []
  const nets = job.input?.nets || state?.netlist?.nets || state?.requirementsPlan?.nets || []
  const output = buildNoiseMap({ ...job.input, components, nets })
  const outputFile = projectDir ? path.join(projectDir, 'boardforge-noise-map.json') : null
  if (projectDir && !job.dryRun) {
    await writeFile(outputFile, JSON.stringify(output, null, 2), 'utf8')
    await updateProjectState(projectDir, async (current) => ({
      ...current,
      status: output.status,
      noiseMap: output,
      generatedFiles: [...new Set([...(current.generatedFiles || []), outputFile])],
      lastJobType: job.type,
      lastHistoryMessage: `Built noise map with ${output.noisyRegions.length} noisy regions and ${output.sensitiveRegions.length} sensitive regions.`,
    }))
  }
  return result(job, output.status, output.warnings, output.errors, { noiseMap: output, generatedFiles: outputFile ? [outputFile] : [], humanReviewRequired: true })
}

function manufacturerRulesJob(job, profile) {
  const output = summarizeManufacturerRules({ ...job.input, profile })
  return result(job, output.status, output.warnings, output.errors, { manufacturerRules: output, humanReviewRequired: true })
}

async function projectReviewReportJob(job, workspace, profile) {
  const projectDir = job.input?.projectPath ? resolveInsideWorkspace(workspace, job.input.projectPath) : null
  const state = projectDir ? await readProjectState(projectDir) : {}
  const output = generateProjectReviewReport({
    ...job.input,
    categoryPlan: job.input?.categoryPlan || state?.categoryPlan,
    schematicGraph: job.input?.schematicGraph || state?.schematicGraph,
    placementPlan: job.input?.placementPlan || state?.placement,
    routingReadiness: job.input?.routingReadiness || state?.routingReadiness,
    routingReport: job.input?.routingReport || state?.routingReport,
    routingPlan: job.input?.routingPlan || state?.routing,
    powerRouting: job.input?.powerRouting || state?.powerRouting,
    powerTree: job.input?.powerTree || state?.powerTree,
    viaStrategy: job.input?.viaStrategy || state?.viaStrategy,
    fanoutPlan: job.input?.fanoutPlan || state?.fanoutPlan,
    noiseMap: job.input?.noiseMap || state?.noiseMap,
    manufacturerRules: job.input?.manufacturerRules || summarizeManufacturerRules({ ...job.input, profile }),
    dfmReport: job.input?.dfmReport || state?.dfmReport,
    manufacturingManifest: job.input?.manufacturingManifest || state?.manufacturingManifest,
    manufacturingReadiness: job.input?.manufacturingReadiness || state?.manufacturingReadiness,
  })
  const outputFile = projectDir ? path.join(projectDir, 'boardforge-project-review.json') : null
  if (projectDir && !job.dryRun) {
    await writeFile(outputFile, JSON.stringify(output, null, 2), 'utf8')
    await updateProjectState(projectDir, async (current) => ({
      ...current,
      status: output.status,
      projectReview: output,
      generatedFiles: [...new Set([...(current.generatedFiles || []), outputFile])],
      lastJobType: job.type,
      lastHistoryMessage: `Project review scored ${output.readinessScore}/100 with ${output.blockers.length} blockers.`,
    }))
  }
  return result(job, output.status, output.warnings, output.blockers, { projectReview: output, generatedFiles: outputFile ? [outputFile] : [], humanReviewRequired: true })
}

function summarizeStepResult(step, output) {
  return {
    step: step.type,
    why: step.why,
    status: output.status,
    warnings: output.warnings || [],
    errors: output.errors || [],
    generatedFiles: output.generatedFiles || [],
    projectPath: output.projectPath || null,
    humanReviewRequired: output.humanReviewRequired !== false,
  }
}

function workflowNextActions(results, stoppedAt, input) {
  if (stoppedAt) {
    const current = results[results.length - 1]
    return [
      `Fix blockers from ${stoppedAt.step}.`,
      ...(current?.errors || []).map((issue) => issue.message).filter(Boolean).slice(0, 4),
      'Rerun run_boardforge_workflow with continueOnBlocked only for diagnostic reports, not manufacturing export.',
    ]
  }
  return [
    'Review boardforge-workflow-run.json, boardforge-preflight.json, boardforge-dfm-report.json, ERC, and DRC reports.',
    ...(input.includeExports ? ['Inspect generated Gerbers, drill, BOM, CPL, and JLCPCB ZIP before ordering.'] : ['Run export jobs only after ERC/DRC and human review are acceptable.']),
  ]
}

async function missionRequirementsJob(job, workspace) {
  const output = planMissionRequirements(job.input || {})
  const projectDir = job.input?.projectPath ? resolveInsideWorkspace(workspace, job.input.projectPath) : null
  const outputFile = projectDir ? path.join(projectDir, 'boardforge-mission-plan.json') : null
  if (projectDir && !job.dryRun) {
    await writeFile(outputFile, JSON.stringify(output, null, 2), 'utf8')
    await updateProjectState(projectDir, async (current) => ({
      ...current,
      status: output.status,
      missionPlan: output,
      requirementsPlan: output.requirementsPlan || current.requirementsPlan,
      generatedFiles: [...new Set([...(current.generatedFiles || []), outputFile])],
      lastJobType: job.type,
      lastHistoryMessage: `Planned ${output.mission.vehicle} mission with ${output.decisions.required.length} required user decisions.`,
    }))
  }
  return result(job, output.status, output.feasibility.warnings.map((message) => ({ severity: 'WARNING', code: 'MISSION_FEASIBILITY_REVIEW', message })), output.decisions.required.map((item) => ({ severity: 'ERROR', code: 'MISSION_DECISION_REQUIRED', message: item.prompt, details: item })), { missionPlan: output, generatedFiles: outputFile ? [outputFile] : [], humanReviewRequired: true })
}

async function userBomIntakeJob(job, workspace) {
  const output = intakeUserBom(job.input || {})
  const projectDir = job.input?.projectPath ? resolveInsideWorkspace(workspace, job.input.projectPath) : null
  const outputFile = projectDir ? path.join(projectDir, 'boardforge-user-bom.json') : null
  if (projectDir && !job.dryRun) {
    await writeFile(outputFile, JSON.stringify(output, null, 2), 'utf8')
    await writeFile(path.join(projectDir, 'boardforge-components.json'), JSON.stringify(output.components, null, 2), 'utf8')
    await updateProjectState(projectDir, async (current) => ({
      ...current,
      status: output.status,
      userBom: output,
      components: normalizeComponents(output.components),
      generatedFiles: [...new Set([...(current.generatedFiles || []), outputFile, path.join(projectDir, 'boardforge-components.json')])],
      lastJobType: job.type,
      lastHistoryMessage: `Parsed user BOM with ${output.components.length} components.`,
    }))
  }
  return result(job, output.status, output.warnings, output.errors, { userBom: output, components: output.components, nets: output.nets, generatedFiles: outputFile ? [outputFile] : [], humanReviewRequired: true })
}

async function userBomAuditJob(job, workspace) {
  const projectDir = job.input?.projectPath ? resolveInsideWorkspace(workspace, job.input.projectPath) : null
  const existing = projectDir ? await readUserBom(projectDir) : null
  const output = auditUserBom({ ...job.input, intake: job.input?.intake || existing })
  const outputFile = projectDir ? path.join(projectDir, 'boardforge-user-bom-audit.json') : null
  if (projectDir && !job.dryRun) {
    await writeFile(outputFile, JSON.stringify(output, null, 2), 'utf8')
    await writeFile(path.join(projectDir, 'boardforge-components.json'), JSON.stringify(output.components, null, 2), 'utf8')
    await updateProjectState(projectDir, async (current) => ({
      ...current,
      status: output.status,
      userBom: output.intake,
      userBomAudit: output,
      missionPlan: output.missionPlan || current.missionPlan,
      requirementsPlan: output.requirementsPlan || current.requirementsPlan,
      components: normalizeComponents(output.components),
      generatedFiles: [...new Set([...(current.generatedFiles || []), outputFile, path.join(projectDir, 'boardforge-components.json')])],
      lastJobType: job.type,
      lastHistoryMessage: `Audited user BOM with ${output.missingFunctions.length} mission gaps and ${output.questions.length} clarification questions.`,
    }))
  }
  return result(job, output.status, output.warnings, output.errors, { userBomAudit: output, components: output.components, missingFunctions: output.missingFunctions, questions: output.questions, substitutions: output.substitutions, powerBudget: output.powerBudget, workflow: output.workflow, generatedFiles: outputFile ? [outputFile] : [], humanReviewRequired: true })
}

async function planRequirementsJob(job, workspace) {
  const output = planRequirements(job.input || {})
  const projectDir = job.input?.projectPath ? resolveInsideWorkspace(workspace, job.input.projectPath) : null
  const outputFile = projectDir ? path.join(projectDir, 'boardforge-requirements-plan.json') : null
  if (projectDir) {
    await writeFile(outputFile, JSON.stringify(output, null, 2), 'utf8')
    await updateProjectState(projectDir, async (current) => ({
      ...current,
      status: output.status,
      requirementsPlan: output,
      generatedFiles: [...new Set([...(current.generatedFiles || []), outputFile])],
      lastJobType: job.type,
      lastHistoryMessage: `Requirements planner selected ${output.selectedCircuits.length} circuits and ${output.components.length} components.`,
    }))
  }
  return result(job, output.status, [], [], { ...output, generatedFiles: outputFile ? [outputFile] : [] })
}

async function pinAssignmentsJob(job, workspace) {
  const projectDir = job.input?.projectPath ? resolveInsideWorkspace(workspace, job.input.projectPath) : null
  const state = projectDir ? await readProjectState(projectDir) : null
  const components = job.input?.components || await readRichComponents(projectDir) || state?.components || []
  const nets = job.input?.nets || state?.requirements?.nets || state?.requirementsPlan?.nets || []
  const output = planPinAssignments({ components, nets, interfaces: job.input?.interfaces || state?.requirementsPlan?.interfaces || [], input: job.input || {} })
  const outputFile = projectDir ? path.join(projectDir, 'boardforge-pin-assignments.json') : null
  if (projectDir && !job.dryRun) {
    await writeFile(outputFile, JSON.stringify(output, null, 2), 'utf8')
    await updateProjectState(projectDir, async (current) => ({
      ...current,
      status: output.status,
      pinAssignments: output,
      generatedFiles: [...new Set([...(current.generatedFiles || []), outputFile])],
      lastJobType: job.type,
      lastHistoryMessage: `Planned pin assignments for ${output.assignments.length} components and ${output.interfaces.length} inferred interfaces.`,
    }))
  }
  return result(job, output.status, output.warnings, output.errors, { pinAssignments: output, generatedFiles: outputFile ? [outputFile] : [], humanReviewRequired: true })
}

async function powerTreePlanJob(job, workspace) {
  const projectDir = job.input?.projectPath ? resolveInsideWorkspace(workspace, job.input.projectPath) : null
  const state = projectDir ? await readProjectState(projectDir) : null
  const board = job.input?.board || state?.board || boardFromJob(job)
  const components = job.input?.components || await readRichComponents(projectDir) || state?.components || []
  const nets = job.input?.nets || state?.requirements?.nets || []
  const output = planPowerTree({ ...job.input, board, components, nets })
  const outputFile = projectDir ? path.join(projectDir, 'boardforge-power-tree.json') : null
  if (projectDir && !job.dryRun) {
    await writeFile(outputFile, JSON.stringify(output, null, 2), 'utf8')
    await updateProjectState(projectDir, async (current) => ({
      ...current,
      status: output.status,
      powerTree: output,
      generatedFiles: [...new Set([...(current.generatedFiles || []), outputFile])],
      lastJobType: job.type,
      lastHistoryMessage: `Planned ${output.rails.length} power rails with ${output.regulators.length} regulator paths.`,
    }))
  }
  return result(job, output.status, output.warnings, output.errors, { powerTree: output, generatedFiles: outputFile ? [outputFile] : [], humanReviewRequired: true })
}

async function stackupPlanJob(job, workspace, profile) {
  const projectDir = job.input?.projectPath ? resolveInsideWorkspace(workspace, job.input.projectPath) : null
  const state = projectDir ? await readProjectState(projectDir) : null
  const board = job.input?.board || state?.board || boardFromJob(job)
  const components = job.input?.components || state?.components || []
  const nets = assignNetsToClasses(job.input?.nets || state?.requirements?.nets || [])
  const output = planStackup({ ...job.input, board, components, nets, manufacturerProfile: profile.id })
  const outputFile = projectDir ? path.join(projectDir, 'boardforge-stackup-plan.json') : null
  if (projectDir && !job.dryRun) {
    await writeFile(outputFile, JSON.stringify(output, null, 2), 'utf8')
    await updateProjectState(projectDir, async (current) => ({
      ...current,
      status: output.status,
      stackup: output,
      generatedFiles: [...new Set([...(current.generatedFiles || []), outputFile])],
      lastJobType: job.type,
      lastHistoryMessage: `Planned ${output.layerCount}-layer stackup with ${output.hdi.requiresAdvancedReview ? 'advanced-via review' : 'standard via policy'}.`,
    }))
  }
  return result(job, output.status, output.warnings, output.errors, { stackup: output, generatedFiles: outputFile ? [outputFile] : [], humanReviewRequired: true })
}

async function fanoutPlanJob(job, workspace) {
  const projectDir = job.input?.projectPath ? resolveInsideWorkspace(workspace, job.input.projectPath) : null
  const state = projectDir ? await readProjectState(projectDir) : null
  const board = job.input?.board || state?.board || boardFromJob(job)
  const components = job.input?.components || await readRichComponents(projectDir) || state?.components || []
  const nets = job.input?.nets || state?.requirements?.nets || []
  const stackup = job.input?.stackup || state?.stackup || null
  const output = planFanout({ ...job.input, board, components, nets, stackup })
  const outputFile = projectDir ? path.join(projectDir, 'boardforge-fanout-plan.json') : null
  if (projectDir && !job.dryRun) {
    await writeFile(outputFile, JSON.stringify(output, null, 2), 'utf8')
    await updateProjectState(projectDir, async (current) => ({
      ...current,
      status: output.status,
      fanoutPlan: output,
      generatedFiles: [...new Set([...(current.generatedFiles || []), outputFile])],
      lastJobType: job.type,
      lastHistoryMessage: `Planned fanout for ${output.denseComponents.length} dense components and ${output.edgeConnectors.length} edge connectors.`,
    }))
  }
  return result(job, output.status, output.warnings, output.errors, { fanoutPlan: output, generatedFiles: outputFile ? [outputFile] : [], humanReviewRequired: true })
}

async function signalIntegrityPlanJob(job, workspace, profile) {
  const projectDir = job.input?.projectPath ? resolveInsideWorkspace(workspace, job.input.projectPath) : null
  const state = projectDir ? await readProjectState(projectDir) : null
  const board = job.input?.board || state?.board || boardFromJob(job)
  const components = job.input?.components || await readRichComponents(projectDir) || state?.components || []
  const nets = job.input?.nets || state?.requirements?.nets || []
  const stackup = job.input?.stackup || state?.stackup || null
  const routingPlan = job.input?.routingPlan || state?.routing?.plan || null
  const output = planSignalIntegrity({ board, components, nets, stackup, routingPlan, profile, input: job.input || {} })
  const outputFile = projectDir ? path.join(projectDir, 'boardforge-signal-integrity.json') : null
  if (projectDir && !job.dryRun) {
    await writeFile(outputFile, JSON.stringify(output, null, 2), 'utf8')
    await updateProjectState(projectDir, async (current) => ({
      ...current,
      status: output.status,
      signalIntegrity: output,
      generatedFiles: [...new Set([...(current.generatedFiles || []), outputFile])],
      lastJobType: job.type,
      lastHistoryMessage: `Planned signal integrity for ${output.highSpeedNetCount} high-speed nets with ${output.errors.length} blockers and ${output.warnings.length} warnings.`,
    }))
  }
  return result(job, output.status, output.warnings, output.errors, { signalIntegrity: output, generatedFiles: outputFile ? [outputFile] : [], humanReviewRequired: true })
}

async function testStrategyPlanJob(job, workspace) {
  const projectDir = job.input?.projectPath ? resolveInsideWorkspace(workspace, job.input.projectPath) : null
  const state = projectDir ? await readProjectState(projectDir) : null
  const board = job.input?.board || state?.board || boardFromJob(job)
  const components = job.input?.components || await readRichComponents(projectDir) || state?.components || []
  const nets = job.input?.nets || state?.requirements?.nets || state?.requirementsPlan?.nets || []
  const output = planTestStrategy({ board, components, nets, powerTree: job.input?.powerTree || state?.powerTree || null, pinAssignments: job.input?.pinAssignments || state?.pinAssignments || null, input: job.input || {} })
  const outputFile = projectDir ? path.join(projectDir, 'boardforge-test-strategy.json') : null
  if (projectDir && !job.dryRun) {
    await writeFile(outputFile, JSON.stringify(output, null, 2), 'utf8')
    await updateProjectState(projectDir, async (current) => ({
      ...current,
      status: output.status,
      testStrategy: output,
      generatedFiles: [...new Set([...(current.generatedFiles || []), outputFile])],
      lastJobType: job.type,
      lastHistoryMessage: `Planned ${output.requiredTestPoints.length} test points with ${output.programming.method} programming strategy.`,
    }))
  }
  return result(job, output.status, output.warnings, output.errors, { testStrategy: output, generatedFiles: outputFile ? [outputFile] : [], humanReviewRequired: true })
}

async function dfmChecksJob(job, workspace, profile) {
  const projectDir = job.input?.projectPath ? resolveInsideWorkspace(workspace, job.input.projectPath) : null
  const state = projectDir ? await readProjectState(projectDir) : null
  const board = job.input?.board || state?.board || boardFromJob(job)
  const components = job.input?.components || await readRichComponents(projectDir) || state?.components || []
  const routes = job.input?.routes || state?.routing?.plan?.routes || []
  const output = runDfmChecks({
    board,
    components,
    routes,
    profile,
    stackup: job.input?.stackup || state?.stackup || null,
    powerTree: job.input?.powerTree || state?.powerTree || null,
    fanoutPlan: job.input?.fanoutPlan || state?.fanoutPlan || null,
    options: job.input || {},
  })
  const outputFile = projectDir ? path.join(projectDir, 'boardforge-dfm-report.json') : null
  if (projectDir && !job.dryRun) {
    await writeFile(outputFile, JSON.stringify(output, null, 2), 'utf8')
    await updateProjectState(projectDir, async (current) => ({
      ...current,
      status: output.status,
      dfmReport: output,
      generatedFiles: [...new Set([...(current.generatedFiles || []), outputFile])],
      lastJobType: job.type,
      lastHistoryMessage: `Ran DFM checks with ${output.errors.length} blockers and ${output.warnings.length} warnings.`,
    }))
  }
  return result(job, output.status, output.warnings, output.errors, { dfm: output, generatedFiles: outputFile ? [outputFile] : [], humanReviewRequired: true })
}

function manufacturerCompareJob(job) {
  const output = compareManufacturerCapabilities(job.input || {})
  return result(job, output.status, [], [], { comparison: output, humanReviewRequired: true })
}

async function complexBoardPlanJob(job, workspace, profile) {
  const projectDir = job.input?.projectPath ? resolveInsideWorkspace(workspace, job.input.projectPath) : null
  const state = projectDir ? await readProjectState(projectDir) : null
  const board = job.input?.board || state?.board || boardFromJob(job)
  const requirementsPlan = planRequirements({ ...job.input, templateId: job.input?.templateId || board.id })
  const components = job.input?.components?.length ? job.input.components : applyPlannedPlacement(board, requirementsPlan.components || [])
  const nets = assignNetsToClasses(requirementsPlan.nets || job.input?.nets || [])
  const pinAssignments = planPinAssignments({ components, nets, interfaces: job.input?.interfaces || [], input: job.input || {} })
  const powerTree = planPowerTree({ ...job.input, board, components, nets })
  const stackup = planStackup({ ...job.input, board, components, nets, manufacturerProfile: profile.id })
  const fanoutPlan = planFanout({ ...job.input, board, components, nets, stackup })
  const designIntent = createDesignIntent(board, components, nets, profile)
  const routingPlan = generateRoutingPlan(nets, { ...job.input, board, components, layerCount: stackup.layerCount, profile })
  const signalIntegrity = planSignalIntegrity({ board, components, nets, stackup, routingPlan, profile, input: job.input || {} })
  const testStrategy = planTestStrategy({ board, components, nets, powerTree, pinAssignments, input: job.input || {} })
  const complexity = scoreBoardComplexity({ ...job.input, board, components, nets })
  const assemblyPlan = planAssemblyAndMechanical(board, components, job.input || {})
  const blockers = [
    ...stackup.errors,
    ...pinAssignments.errors,
    ...fanoutPlan.errors,
    ...signalIntegrity.errors,
    ...testStrategy.errors,
    ...validateZones(board, designIntent.zones).filter((item) => ['ERROR', 'BLOCKER'].includes(item.severity)),
  ]
  const warnings = [
    ...stackup.warnings,
    ...pinAssignments.warnings,
    ...fanoutPlan.warnings,
    ...signalIntegrity.warnings,
    ...testStrategy.warnings,
    ...assemblyPlan.warnings,
    ...routingPlan.warnings.map((message) => ({ severity: 'WARNING', code: 'ROUTING_PLAN_REVIEW', message })),
    ...requirementsPlan.assumptions.map((message) => ({ severity: 'WARNING', code: 'REQUIREMENT_ASSUMPTION', message })),
  ]
  const output = {
    status: blockers.length ? 'COMPLEX_BOARD_PLAN_BLOCKED' : 'COMPLEX_BOARD_PLAN_READY_NEEDS_REVIEW',
    requirementsPlan,
    powerTree,
    pinAssignments,
    complexity,
    stackup,
    fanoutPlan,
    signalIntegrity,
    testStrategy,
    components,
    nets,
    designIntent,
    assemblyPlan,
    routingPlan,
    manufacturingGates: {
      advancedViasRequireQuote: stackup.hdi.requiresAdvancedReview,
      requireDrcBeforeExport: true,
      requireErcBeforeBomPackage: true,
      requireHumanStackupApproval: stackup.hdi.requiresAdvancedReview || complexity.level !== 'low',
      requirePowerRailReview: true,
      requirePinAssignmentReview: true,
      requireTestStrategyReview: true,
      requireFanoutReview: fanoutPlan.denseComponents.length > 0,
      requireSignalIntegrityReview: signalIntegrity.highSpeedNetCount > 0,
    },
    warnings,
    errors: blockers,
    humanReviewRequired: true,
  }
  const outputFile = projectDir ? path.join(projectDir, 'boardforge-complex-board-plan.json') : null
  if (projectDir && !job.dryRun) {
    await writeFile(outputFile, JSON.stringify(output, null, 2), 'utf8')
    await updateProjectState(projectDir, async (current) => ({
      ...current,
      status: output.status,
      requirementsPlan,
      pinAssignments,
      stackup,
      powerTree,
      fanoutPlan,
      signalIntegrity,
      testStrategy,
      assemblyPlan,
      designIntent,
      routing: { ...(current.routing || {}), plan: routingPlan, status: routingPlan.status },
      generatedFiles: [...new Set([...(current.generatedFiles || []), outputFile])],
      lastJobType: job.type,
      lastHistoryMessage: `Complex board plan generated with ${complexity.level} complexity, ${stackup.layerCount} layers, ${powerTree.rails.length} power rails, and ${fanoutPlan.denseComponents.length} fanout targets.`,
    }))
  }
  return result(job, output.status, warnings, blockers, { ...output, generatedFiles: outputFile ? [outputFile] : [] })
}

async function designConstraintsJob(job, workspace, profile) {
  const projectDir = job.input?.projectPath ? resolveInsideWorkspace(workspace, job.input.projectPath) : null
  const state = projectDir ? await readProjectState(projectDir) : null
  const board = job.input?.board || state?.board || boardFromJob(job)
  const components = job.input?.components || await readRichComponents(projectDir) || state?.components || []
  const nets = job.input?.nets || state?.requirements?.nets || []
  const constraints = buildDesignConstraints(board, components, nets, profile, {
    requirementsPlan: state?.requirementsPlan || null,
    stackup: state?.stackup || null,
    powerTree: state?.powerTree || null,
    fanoutPlan: state?.fanoutPlan || null,
    assemblyPlan: state?.assemblyPlan || null,
    designIntent: state?.designIntent || null,
    routingPlan: state?.routing?.plan || null,
  })
  const outputFile = projectDir ? path.join(projectDir, 'boardforge-constraints.json') : null
  if (projectDir && !job.dryRun) {
    await writeFile(outputFile, JSON.stringify(constraints, null, 2), 'utf8')
    await updateProjectState(projectDir, async (current) => ({
      ...current,
      status: constraints.status,
      designConstraints: constraints,
      generatedFiles: [...new Set([...(current.generatedFiles || []), outputFile])],
      lastJobType: job.type,
      lastHistoryMessage: 'Generated reusable BoardForge design constraints.',
    }))
  }
  return result(job, constraints.status, [], [], { constraints, generatedFiles: outputFile ? [outputFile] : [], humanReviewRequired: true })
}

async function kicadRulesJob(job, workspace, profile) {
  const projectDir = job.input?.projectPath ? resolveInsideWorkspace(workspace, job.input.projectPath) : null
  const state = projectDir ? await readProjectState(projectDir) : null
  const board = job.input?.board || state?.board || boardFromJob(job)
  const components = job.input?.components || await readRichComponents(projectDir) || state?.components || []
  const nets = job.input?.nets || state?.requirements?.nets || []
  const constraints = job.input?.constraints || state?.designConstraints || buildDesignConstraints(board, components, nets, profile, {
    requirementsPlan: state?.requirementsPlan || null,
    stackup: state?.stackup || null,
    powerTree: state?.powerTree || null,
    fanoutPlan: state?.fanoutPlan || null,
    assemblyPlan: state?.assemblyPlan || null,
    designIntent: state?.designIntent || null,
    routingPlan: state?.routing?.plan || null,
  })
  const output = projectDir && !job.dryRun
    ? await writeKiCadRules(projectDir, board, nets, profile, constraints)
    : buildKiCadRules(board, nets, profile, constraints)
  const generatedFiles = output.outputFile ? [output.outputFile] : []
  if (projectDir && !job.dryRun) {
    await updateProjectState(projectDir, async (current) => ({
      ...current,
      status: output.status,
      kicadRules: { status: output.status, outputFile: output.outputFile, differentialPairs: output.differentialPairs.length },
      generatedFiles: [...new Set([...(current.generatedFiles || []), ...generatedFiles])],
      lastJobType: job.type,
      lastHistoryMessage: `Generated KiCad custom rules with ${output.netClasses.length} net classes and ${output.differentialPairs.length} differential pairs.`,
    }))
  }
  return result(job, output.status, [], [], { rules: { ...output, rulesText: undefined }, rulesText: job.input?.includeText ? output.rulesText : undefined, generatedFiles, humanReviewRequired: true })
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

async function componentLibraryAuditJob(job, workspace) {
  const projectDir = job.input?.projectPath ? resolveInsideWorkspace(workspace, job.input.projectPath) : null
  const state = projectDir ? await readProjectState(projectDir) : null
  const rawComponents = job.input?.components || await readRichComponents(projectDir) || state?.components || []
  const components = rawComponents.some((component) => component.assetStatus || component.symbol || component.footprint)
    ? rawComponents
    : await enrichComponents({ workspace, components: rawComponents, input: job.input || {} })
  const output = auditComponentLibraryCoverage(components)
  const outputFile = projectDir ? path.join(projectDir, 'boardforge-component-audit.json') : null
  if (projectDir) {
    await writeFile(outputFile, JSON.stringify(output, null, 2), 'utf8')
    await updateProjectState(projectDir, async (current) => ({
      ...current,
      status: output.status,
      componentAudit: output,
      components: normalizeComponents(components),
      generatedFiles: [...new Set([...(current.generatedFiles || []), outputFile])],
      lastJobType: job.type,
      lastHistoryMessage: `Component library audit scored ${output.coverageScore}/100 with ${output.errors.length} blockers and ${output.warnings.length} warnings.`,
    }))
  }
  return result(job, output.status, output.warnings, output.errors, { ...output, generatedFiles: outputFile ? [outputFile] : [] })
}

async function validateComponentBindingsJob(job, workspace) {
  const projectDir = job.input?.projectPath ? resolveInsideWorkspace(workspace, job.input.projectPath) : null
  const state = projectDir ? await readProjectState(projectDir) : null
  const rawComponents = job.input?.components || await readRichComponents(projectDir) || state?.components || []
  const components = rawComponents.some((component) => Object.keys(component.pinMap || {}).length) ? rawComponents : await enrichComponents({ workspace, components: rawComponents, input: job.input || {} })
  const output = await validateComponentBindings(components)
  if (projectDir) {
    const outputFile = path.join(projectDir, 'boardforge-bindings.json')
    await writeFile(outputFile, JSON.stringify(output, null, 2), 'utf8')
    await updateProjectState(projectDir, async (current) => ({
      ...current,
      status: output.status,
      componentBindings: output,
      generatedFiles: [...new Set([...(current.generatedFiles || []), outputFile])],
      lastJobType: job.type,
      lastHistoryMessage: `Validated ${output.checked} symbol/footprint/pin-map bindings.`,
    }))
    return result(job, output.status, output.warnings, output.errors, { ...output, generatedFiles: [outputFile] })
  }
  return result(job, output.status, output.warnings, output.errors, output)
}

async function schematicPcbSyncJob(job, workspace) {
  const context = await getKiCadContext(job, workspace, 'pcb')
  if (context.blocked) return context.blocked
  const sync = await validateSchematicPcbSync(context.files.projectDir, job.input || {})
  await updateProjectState(context.files.projectDir, async (current) => ({
    ...current,
    status: sync.status,
    schematicPcbSync: { status: sync.status, outputFile: sync.outputFile, errors: sync.errors.length, warnings: sync.warnings.length },
    generatedFiles: [...new Set([...(current.generatedFiles || []), sync.outputFile].filter(Boolean))],
    lastJobType: job.type,
    lastHistoryMessage: `Validated schematic/PCB sync with ${sync.errors.length} errors and ${sync.warnings.length} warnings.`,
  }))
  return result(job, sync.status, sync.warnings, sync.errors, { sync, generatedFiles: [sync.outputFile].filter(Boolean), humanReviewRequired: true })
}

async function applySchematicPcbSyncJob(job, workspace) {
  const context = await getKiCadContext(job, workspace, 'pcb')
  if (context.blocked) return context.blocked
  const state = await readProjectState(context.files.projectDir)
  const components = job.input?.components || await readRichComponents(context.files.projectDir) || state?.components || []
  const netlist = job.input?.netlist || state?.netlist || await readJsonIfExists(path.join(context.files.projectDir, 'boardforge-netlist.json'))
  const output = await applyNetlistSyncToPcb({ pcbFile: context.files.pcbFile, components, netlist })
  await updateProjectState(context.files.projectDir, async (current) => ({
    ...current,
    status: output.status,
    schematicPcbSyncApply: output,
    lastJobType: job.type,
    lastHistoryMessage: `Applied PCB net sync for ${output.netCount} nets and ${output.componentCount} components.`,
  }))
  return result(job, output.status, [{ severity: 'WARNING', code: 'PCB_NET_SYNC_REQUIRES_DRC', message: 'PCB nets/pad assignments changed or were checked; run KiCad DRC before routing/export.' }], [], { syncApply: output, generatedFiles: output.changed ? [context.files.pcbFile] : [], humanReviewRequired: true })
}

async function readJsonIfExists(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'))
  } catch {
    return null
  }
}

async function modelCoverageJob(job, workspace) {
  const projectDir = job.input?.projectPath ? resolveInsideWorkspace(workspace, job.input.projectPath) : workspace
  const state = await readProjectState(projectDir)
  const components = job.input?.components || await readRichComponents(projectDir) || state?.components || []
  const coverage = await validate3dModelCoverage(projectDir, components, job.input || {})
  await updateProjectState(projectDir, async (current) => ({
    ...current,
    status: coverage.status,
    model3dCoverage: { status: coverage.status, outputFile: coverage.outputFile, checked: coverage.checked, missing: coverage.missing, unverified: coverage.unverified },
    generatedFiles: [...new Set([...(current.generatedFiles || []), coverage.outputFile].filter(Boolean))],
    lastJobType: job.type,
    lastHistoryMessage: `Validated 3D model coverage for ${coverage.checked} components.`,
  }))
  return result(job, coverage.status, coverage.warnings, coverage.errors, { coverage, generatedFiles: [coverage.outputFile].filter(Boolean), humanReviewRequired: true })
}

async function pinMapRepairJob(job, workspace, applySafe) {
  const projectDir = job.input?.projectPath ? resolveInsideWorkspace(workspace, job.input.projectPath) : workspace
  const state = await readProjectState(projectDir)
  const components = job.input?.components || await readRichComponents(projectDir) || state?.components || []
  const repairPlan = applySafe && (job.input?.repairPlan || state?.pinMapRepairPlan)
    ? applySafePinMapRepairs(components, job.input?.repairPlan || state.pinMapRepairPlan)
    : await planPinMapRepairs(components, { ...(job.input || {}), applySafe })
  const outputFile = path.join(projectDir, applySafe ? 'boardforge-pin-map-repairs-applied.json' : 'boardforge-pin-map-repair-plan.json')
  await writeFile(outputFile, JSON.stringify(repairPlan, null, 2), 'utf8')
  if (applySafe && repairPlan.components) await writeFile(path.join(projectDir, 'boardforge-components.json'), JSON.stringify(repairPlan.components, null, 2), 'utf8')
  await updateProjectState(projectDir, async (current) => ({
    ...current,
    status: repairPlan.status,
    pinMapRepairPlan: repairPlan,
    components: applySafe && repairPlan.components ? normalizeComponents(repairPlan.components) : current.components,
    generatedFiles: [...new Set([...(current.generatedFiles || []), outputFile, applySafe ? path.join(projectDir, 'boardforge-components.json') : null].filter(Boolean))],
    lastJobType: job.type,
    lastHistoryMessage: `${applySafe ? 'Applied' : 'Planned'} ${repairPlan.repairs?.length || 0} pin-map repair actions.`,
  }))
  return result(job, repairPlan.status, repairPlan.warnings || [], repairPlan.errors || [], { repairPlan, generatedFiles: [outputFile], humanReviewRequired: true })
}

async function bomSourcingAuditJob(job, workspace) {
  const projectDir = job.input?.projectPath ? resolveInsideWorkspace(workspace, job.input.projectPath) : workspace
  const state = await readProjectState(projectDir)
  const components = job.input?.components || await readRichComponents(projectDir) || state?.components || []
  const sourcing = await auditBomSourcing(projectDir, components, job.input || {})
  await updateProjectState(projectDir, async (current) => ({
    ...current,
    status: sourcing.status,
    bomSourcing: { status: sourcing.status, outputFile: sourcing.outputFile, checked: sourcing.checked, sourced: sourcing.sourced, jlcpcbReady: sourcing.jlcpcbReady },
    generatedFiles: [...new Set([...(current.generatedFiles || []), sourcing.outputFile].filter(Boolean))],
    lastJobType: job.type,
    lastHistoryMessage: `Audited BOM sourcing for ${sourcing.checked} components.`,
  }))
  return result(job, sourcing.status, sourcing.warnings, sourcing.errors, { sourcing, generatedFiles: [sourcing.outputFile].filter(Boolean), humanReviewRequired: true })
}

async function manufacturingReadinessJob(job, workspace) {
  const context = await getKiCadContext(job, workspace, 'pcb')
  if (context.blocked) return context.blocked
  const readiness = await validateManufacturingReadiness(context.files.projectDir, job.input || {})
  await updateProjectState(context.files.projectDir, async (current) => ({
    ...current,
    status: readiness.status,
    manufacturingReadiness: readiness,
    lastJobType: job.type,
    lastHistoryMessage: `Manufacturing readiness checked with ${readiness.errors.length} blockers and ${readiness.warnings.length} warnings.`,
  }))
  return result(job, readiness.status, readiness.warnings, readiness.errors, { readiness, humanReviewRequired: true })
}

async function jlcpcbPackageValidationJob(job, workspace) {
  const context = await getKiCadContext(job, workspace, 'pcb')
  if (context.blocked) return context.blocked
  const packageValidation = await validateJlcpcbPackage(context.files.projectDir, job.input || {})
  await updateProjectState(context.files.projectDir, async (current) => ({
    ...current,
    status: packageValidation.status,
    jlcpcbPackageValidation: {
      status: packageValidation.status,
      outputFile: packageValidation.outputFile,
      errors: packageValidation.errors.length,
      warnings: packageValidation.warnings.length,
    },
    generatedFiles: [...new Set([...(current.generatedFiles || []), packageValidation.outputFile].filter(Boolean))],
    lastJobType: job.type,
    lastHistoryMessage: `Validated JLCPCB package with ${packageValidation.errors.length} errors and ${packageValidation.warnings.length} warnings.`,
  }))
  return result(job, packageValidation.status, packageValidation.warnings, packageValidation.errors, { packageValidation, generatedFiles: [packageValidation.outputFile].filter(Boolean), humanReviewRequired: true })
}

async function manufacturingManifestJob(job, workspace) {
  const projectDir = job.input?.projectPath ? resolveInsideWorkspace(workspace, job.input.projectPath) : workspace
  const manifest = await buildManufacturingManifest(projectDir, job.input || {})
  await updateProjectState(projectDir, async (current) => ({
    ...current,
    status: manifest.status,
    manufacturingManifest: { status: manifest.status, outputFile: manifest.outputFile, blockers: manifest.blockers.length, warnings: manifest.warnings.length },
    generatedFiles: [...new Set([...(current.generatedFiles || []), manifest.outputFile].filter(Boolean))],
    lastJobType: job.type,
    lastHistoryMessage: `Manufacturing manifest generated with ${manifest.blockers.length} blockers and ${manifest.warnings.length} warnings.`,
  }))
  return result(job, manifest.status, manifest.warnings, manifest.blockers, { manifest, generatedFiles: [manifest.outputFile].filter(Boolean), humanReviewRequired: true })
}

async function schematicSynthesisJob(job, workspace) {
  const projectDir = job.input?.projectPath ? resolveInsideWorkspace(workspace, job.input.projectPath) : null
  const state = projectDir ? await readProjectState(projectDir) : null
  const board = job.input?.board || state?.board || boardFromJob(job)
  const rawComponents = job.input?.components || await readRichComponents(projectDir) || state?.components || []
  const components = rawComponents.some((component) => Object.keys(component.pinMap || {}).length)
    ? rawComponents
    : await enrichComponents({ workspace, components: rawComponents, input: job.input || state?.requirements || {} })
  const nets = job.input?.nets || state?.requirementsPlan?.nets || state?.requirements?.nets || state?.netlist?.nets || []
  const synthesis = synthesizeSchematicDesign({
    board,
    components,
    nets,
    interfaces: job.input?.interfaces || state?.requirementsPlan?.interfaces || state?.requirements?.interfaces || [],
    input: { ...(state?.requirements || {}), ...(job.input || {}) },
  })
  const generatedFiles = []
  if (projectDir && !job.dryRun) {
    const synthesisFile = path.join(projectDir, 'boardforge-schematic-synthesis.json')
    const componentsFile = path.join(projectDir, 'boardforge-components.json')
    const netlistFile = path.join(projectDir, 'boardforge-netlist.json')
    const netlist = boardforgeNetlistFromComponents(synthesis.components, synthesis.nets)
    await writeFile(synthesisFile, JSON.stringify(synthesis, null, 2), 'utf8')
    await writeFile(componentsFile, JSON.stringify(synthesis.components, null, 2), 'utf8')
    await writeFile(netlistFile, JSON.stringify(netlist, null, 2), 'utf8')
    generatedFiles.push(synthesisFile, componentsFile, netlistFile)
    await updateProjectState(projectDir, async (current) => ({
      ...current,
      status: synthesis.status,
      schematicSynthesis: synthesis,
      components: normalizeComponents(synthesis.components),
      netlist,
      generatedFiles: [...new Set([...(current.generatedFiles || []), ...generatedFiles])],
      lastJobType: job.type,
      lastHistoryMessage: `Synthesized schematic graph with ${synthesis.components.length} components and ${synthesis.nets.length} nets.`,
    }))
  }
  return result(job, synthesis.status, synthesis.warnings, synthesis.errors, { synthesis, generatedFiles, humanReviewRequired: true })
}

async function generateNetlistJob(job, workspace) {
  const projectDir = job.input?.projectPath ? resolveInsideWorkspace(workspace, job.input.projectPath) : null
  const state = projectDir ? await readProjectState(projectDir) : null
  const rawComponents = job.input?.components || state?.schematicSynthesis?.components || await readRichComponents(projectDir) || state?.components || []
  const components = rawComponents.some((component) => Object.keys(component.pinMap || {}).length) ? rawComponents : await enrichComponents({ workspace, components: rawComponents, input: job.input || {} })
  const nets = assignNetsToClasses(job.input?.nets || state?.schematicSynthesis?.nets || state?.requirements?.nets || [])
  const netlist = boardforgeNetlistFromComponents(components, nets)
  const status = netlist.warnings.length ? 'NETLIST_GENERATED_NEEDS_REVIEW' : 'NETLIST_GENERATED_NEEDS_ERC'
  if (projectDir && !job.dryRun) {
    const outputFile = path.join(projectDir, 'boardforge-netlist.json')
    await writeFile(outputFile, JSON.stringify(netlist, null, 2), 'utf8')
    await updateProjectState(projectDir, async (current) => ({
      ...current,
      status,
      netlist,
      generatedFiles: [...new Set([...(current.generatedFiles || []), outputFile])],
      lastJobType: job.type,
      lastHistoryMessage: `Generated BoardForge netlist with ${netlist.nets.length} nets.`,
    }))
    return result(job, status, netlist.warnings, [], { netlist, generatedFiles: [outputFile], humanReviewRequired: true })
  }
  return result(job, status, netlist.warnings, [], { netlist, generatedFiles: [], humanReviewRequired: true })
}

async function designAuditJob(job, workspace, profile) {
  const projectDir = job.input?.projectPath ? resolveInsideWorkspace(workspace, job.input.projectPath) : null
  const state = projectDir ? await readProjectState(projectDir) : null
  const board = job.input?.board || state?.board || boardFromJob(job)
  const rawComponents = job.input?.components || await readRichComponents(projectDir) || state?.components || []
  const components = rawComponents.some((component) => Object.keys(component.pinMap || {}).length) ? rawComponents : await enrichComponents({ workspace, components: rawComponents, input: job.input || {} })
  const nets = job.input?.nets || state?.requirements?.nets || []
  const bindings = job.input?.bindings || state?.componentBindings || null
  const audit = await runDesignAudit({ projectDir, board, components, nets, profile, routingPlan: job.input?.routingPlan || state?.routing?.plan || null, bindings })
  if (projectDir && !job.dryRun) {
    const outputFile = path.join(projectDir, 'boardforge-design-report.json')
    await writeFile(outputFile, JSON.stringify(audit, null, 2), 'utf8')
    await updateProjectState(projectDir, async (current) => ({
      ...current,
      status: audit.status,
      designAudit: audit,
      generatedFiles: [...new Set([...(current.generatedFiles || []), outputFile])],
      lastJobType: job.type,
      lastHistoryMessage: `Ran design audit with ${audit.issueCounts.errors} errors and ${audit.issueCounts.warnings} warnings.`,
    }))
    return result(job, audit.status, audit.issues.filter((issue) => issue.severity === 'WARNING'), audit.issues.filter((issue) => issue.severity === 'ERROR'), { audit, generatedFiles: [outputFile], humanReviewRequired: true })
  }
  return result(job, audit.status, audit.issues.filter((issue) => issue.severity === 'WARNING'), audit.issues.filter((issue) => issue.severity === 'ERROR'), { audit, generatedFiles: [], humanReviewRequired: true })
}

async function readRichComponents(projectDir) {
  if (!projectDir) return null
  try {
    return JSON.parse(await readFile(path.join(projectDir, 'boardforge-components.json'), 'utf8'))
  } catch {
    return null
  }
}

async function readUserBom(projectDir) {
  if (!projectDir) return null
  try {
    return JSON.parse(await readFile(path.join(projectDir, 'boardforge-user-bom.json'), 'utf8'))
  } catch {
    return null
  }
}

async function generateSchematicJob(job, workspace) {
  const projectDir = job.input?.projectPath ? resolveInsideWorkspace(workspace, job.input.projectPath) : null
  const state = projectDir ? await readProjectState(projectDir) : null
  const board = job.input?.board || state?.board || boardFromJob(job)
  const rawComponents = job.input?.components || state?.schematicSynthesis?.components || state?.components || []
  const components = rawComponents.some((component) => Object.keys(component.pinMap || {}).length) ? rawComponents : await enrichComponents({ workspace, components: rawComponents, input: job.input || {} })
  const schematicModel = generateSchematicModel(board, components, { ...(state?.requirements || {}), ...(job.input || {}), nets: job.input?.nets || state?.schematicSynthesis?.nets || state?.requirements?.nets || [] })
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

async function planErcRepairsJob(job, workspace) {
  const context = await getKiCadContext(job, workspace, 'sch')
  if (context.blocked) return context.blocked
  const reportFile = job.input?.reportFile ? resolveInsideWorkspace(workspace, job.input.reportFile) : path.join(context.files.projectDir, 'reports', 'erc.json')
  const state = await readProjectState(context.files.projectDir)
  const repairPlan = await planErcRepairs({ reportFile, schFile: context.files.schFile, state })
  await updateProjectState(context.files.projectDir, async (current) => ({
    ...current,
    status: repairPlan.status,
    ercRepair: repairPlan,
    lastJobType: job.type,
    lastHistoryMessage: `Planned ${repairPlan.repairs.length} ERC repair actions.`,
  }))
  return result(job, repairPlan.status, repairPlan.repairs.length ? [{ severity: 'WARNING', code: 'ERC_REPAIR_REVIEW_REQUIRED', message: 'ERC repair plan requires electrical review before schematic changes.' }] : [], [], { repairPlan, humanReviewRequired: true })
}

async function applySafeErcRepairsJob(job, workspace) {
  const context = await getKiCadContext(job, workspace, 'sch')
  if (context.blocked) return context.blocked
  const state = await readProjectState(context.files.projectDir)
  const repairPlan = job.input?.repairPlan || state?.ercRepair
  if (!repairPlan) return result(job, 'NEEDS_FIX', [], [{ severity: 'ERROR', code: 'MISSING_ERC_REPAIR_PLAN', message: 'Run plan_erc_repairs before apply_safe_erc_repairs.' }], { generatedFiles: [], humanReviewRequired: true })
  const output = await applySafeErcRepairs({ schFile: context.files.schFile, repairPlan })
  await updateProjectState(context.files.projectDir, async (current) => ({
    ...current,
    status: output.status,
    ercRepair: { ...(current.ercRepair || repairPlan), applied: output },
    lastJobType: job.type,
    lastHistoryMessage: `Applied ${output.applied} safe ERC repair actions. Rerun ERC.`,
  }))
  return result(job, output.status, [{ severity: 'WARNING', code: 'RERUN_ERC_REQUIRED', message: 'Safe ERC repairs were attempted. Run run_kicad_erc again.' }], [], { ...output, generatedFiles: [context.files.schFile], humanReviewRequired: true })
}

async function planDrcRepairsJob(job, workspace) {
  const context = await getKiCadContext(job, workspace, 'pcb')
  if (context.blocked) return context.blocked
  const reportFile = job.input?.reportFile ? resolveInsideWorkspace(workspace, job.input.reportFile) : path.join(context.files.projectDir, 'reports', 'drc.json')
  const state = await readProjectState(context.files.projectDir)
  const repairPlan = await planDrcRepairs({ reportFile, pcbFile: context.files.pcbFile, profile: getManufacturerProfile(state?.manufacturer?.id || job.input?.manufacturerProfile || 'JLCPCB_STANDARD'), state })
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
  const board = boardFromJob(job)
  const options = { components: job.input?.components || [], nets: job.input?.nets || [], gridMm: job.input?.gridMm }
  const plan = job.type === 'optimize_placement'
    ? optimizePlacementPlan(board, boardTemplates[job.input?.templateId], profile, options)
    : generatePlacementPlan(board, boardTemplates[job.input?.templateId], profile, options)
  return result(job, plan.status, plan.issues.filter((item) => item.severity === 'WARNING'), plan.issues.filter((item) => ['BLOCKER', 'ERROR'].includes(item.severity)), { placementPlan: plan, constraints: plan.constraints, humanReviewRequired: true })
}

async function applyPlacementJob(job, workspace, profile) {
  const projectDir = job.input?.projectPath ? resolveInsideWorkspace(workspace, job.input.projectPath) : null
  if (!projectDir) return result(job, 'PLACEMENT_APPLY_BLOCKED', [], [{ severity: 'ERROR', code: 'PROJECT_PATH_REQUIRED', message: 'apply_placement_plan requires input.projectPath.' }], { generatedFiles: [] })
  const state = await readProjectState(projectDir)
  const board = job.input?.board || state?.board || boardFromJob(job)
  const rawComponents = job.input?.components || job.input?.placementPlan?.components || await readRichComponents(projectDir) || state?.components || []
  const components = job.type === 'move_component'
    ? rawComponents.map((component) => component.ref === job.input?.ref ? { ...component, x: job.input.x, y: job.input.y, rotation: job.input.rotation ?? component.rotation } : component)
    : rawComponents
  const plan = job.input?.placementPlan || (job.input?.optimize !== false ? optimizePlacementPlan(board, null, profile, { components, nets: job.input?.nets || state?.requirements?.nets || [] }) : generatePlacementPlan(board, null, profile, { components, nets: job.input?.nets || state?.requirements?.nets || [] }))
  const componentsToApply = plan.components || components
  const applyResult = await applyPlacementPlanToPcb(projectDir, componentsToApply, { dryRun: job.dryRun })
  if (!job.dryRun && applyResult.updatedRefs?.length) {
    const componentsFile = path.join(projectDir, 'boardforge-components.json')
    await writeFile(componentsFile, JSON.stringify(componentsToApply, null, 2), 'utf8')
    await updateProjectState(projectDir, async (current) => ({
      ...current,
      status: applyResult.status,
      components: normalizeComponents(componentsToApply),
      placement: { status: applyResult.status, plan, updatedRefs: applyResult.updatedRefs, missingRefs: applyResult.missingRefs },
      generatedFiles: [...new Set([...(current.generatedFiles || []), ...(applyResult.generatedFiles || []), componentsFile])],
      lastJobType: job.type,
      lastHistoryMessage: `Applied placement updates to ${applyResult.updatedRefs.length} PCB footprints.`,
    }))
    applyResult.generatedFiles = [...new Set([...(applyResult.generatedFiles || []), componentsFile])]
  }
  return result(job, applyResult.status, applyResult.warnings, applyResult.errors, { ...applyResult, placementPlan: plan, humanReviewRequired: true })
}

function routingPlanJob(job) {
  const board = boardFromJob(job)
  const profile = getManufacturerProfile(job.input?.manufacturerProfile || job.input?.manufacturer || 'JLCPCB_STANDARD')
  const components = job.input?.components || []
  const plan = generateRoutingPlan(assignNetsToClasses(job.input?.nets || []), { ...job.input, layerCount: job.input?.layerCount || board.layerCount, board, components, profile })
  const routeValidation = validateRoutingGeometry({ board, components, routingPlan: plan, profile })
  const routeQuality = scoreRoutingPlan({ routingPlan: plan, profile, powerTree: job.input?.powerTree || null })
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
  return result(job, status, [...plan.warnings, ...routeValidation.warnings, ...routeQuality.warnings], [...routeValidation.errors, ...routeQuality.errors], { routingPlan: plan, routeValidation, routeQuality, copperPours: plan.designIntent.copperPours, viaRules: plan.designIntent.viaRules, keepouts: plan.designIntent.zones, humanReviewRequired: true })
}

function routingGeometryJob(job, profile) {
  const board = boardFromJob(job)
  const routingPlan = job.input?.routingPlan || generateRoutingPlan(assignNetsToClasses(job.input?.nets || []), { ...job.input, layerCount: job.input?.layerCount || board.layerCount, board, components: job.input?.components || [], profile })
  const routeValidation = validateRoutingGeometry({ board, components: job.input?.components || [], routingPlan, profile })
  const routeQuality = scoreRoutingPlan({ routingPlan, profile, powerTree: job.input?.powerTree || null })
  return result(job, routeValidation.errors.length ? routeValidation.status : routeQuality.status, [...routeValidation.warnings, ...routeQuality.warnings], [...routeValidation.errors, ...routeQuality.errors], { routingPlan, routeValidation, routeQuality, humanReviewRequired: true })
}

function routingQualityJob(job, profile) {
  const board = boardFromJob(job)
  const routingPlan = job.input?.routingPlan || generateRoutingPlan(assignNetsToClasses(job.input?.nets || []), { ...job.input, layerCount: job.input?.layerCount || board.layerCount, board, components: job.input?.components || [], profile })
  const routeQuality = scoreRoutingPlan({ routingPlan, profile, powerTree: job.input?.powerTree || null })
  return result(job, routeQuality.status, routeQuality.warnings, routeQuality.errors, { routingPlan, routeQuality, humanReviewRequired: true })
}

function routingReportJob(job, profile) {
  const board = boardFromJob(job)
  const components = job.input?.components || []
  const nets = assignNetsToClasses(job.input?.nets || [])
  const routingPlan = job.input?.routingPlan || generateRoutingPlan(nets, { ...job.input, layerCount: job.input?.layerCount || board.layerCount, board, components, profile })
  const report = buildRoutingReport({ ...job.input, board, components, nets, routingPlan, profile })
  return result(job, report.status, report.warnings, report.blockers, { routingReport: report, routingPlan, humanReviewRequired: true })
}

async function copperPourPlanJob(job, workspace, profile) {
  const projectDir = job.input?.projectPath ? resolveInsideWorkspace(workspace, job.input.projectPath) : null
  const state = projectDir ? await readProjectState(projectDir) : null
  const board = job.input?.board || state?.board || boardFromJob(job)
  const components = job.input?.components || await readRichComponents(projectDir) || state?.components || []
  const nets = assignNetsToClasses(job.input?.nets || state?.netlist?.nets || state?.requirements?.nets || [])
  const copperPourPlan = planCopperPours({ board, components, nets, profile, options: job.input || {} })
  if (projectDir && !job.dryRun) {
    const outputFile = path.join(projectDir, 'boardforge-copper-pour-plan.json')
    await writeFile(outputFile, JSON.stringify(copperPourPlan, null, 2), 'utf8')
    await updateProjectState(projectDir, async (current) => ({
      ...current,
      status: copperPourPlan.status,
      copperPourPlan,
      designIntent: { ...(current.designIntent || {}), copperPours: copperPourPlan.pours, stitchingVias: copperPourPlan.stitchingVias },
      generatedFiles: [...new Set([...(current.generatedFiles || []), outputFile])],
      lastJobType: job.type,
      lastHistoryMessage: `Planned ${copperPourPlan.pours.length} copper pours and ${copperPourPlan.stitchingVias.length} stitching vias.`,
    }))
    return result(job, copperPourPlan.status, copperPourPlan.warnings, copperPourPlan.errors, { copperPourPlan, generatedFiles: [outputFile], humanReviewRequired: true })
  }
  return result(job, copperPourPlan.status, copperPourPlan.warnings, copperPourPlan.errors, { copperPourPlan, generatedFiles: [], humanReviewRequired: true })
}

async function engineeringIntelligenceJob(job, workspace, profile) {
  const projectDir = job.input?.projectPath ? resolveInsideWorkspace(workspace, job.input.projectPath) : null
  const state = projectDir ? await readProjectState(projectDir) : null
  const board = job.input?.board || state?.board || boardFromJob(job)
  const components = job.input?.components || await readRichComponents(projectDir) || state?.components || []
  const nets = assignNetsToClasses(job.input?.nets || state?.netlist?.nets || state?.requirements?.nets || [])
  const routingPlan = job.input?.routingPlan || state?.routing?.plan || state?.routing?.autoroute || null
  const reports = {
    componentAudit: state?.componentAudit,
    componentBindings: state?.componentBindings,
    schematicGraph: state?.schematicGraph,
    schematicPcbSync: state?.schematicPcbSync,
    placement: state?.placement,
    routingQuality: state?.routing?.quality,
    routingCongestion: state?.routingCongestion,
    powerIntegrity: state?.powerIntegrity,
    thermal: state?.thermalBottlenecks,
    dfm: state?.dfm,
    manufacturing: state?.manufacturing,
    jlcpcb: state?.jlcpcbPackageValidation,
    outline: state?.review,
  }
  const context = {
    prompt: job.input?.prompt || state?.requirements?.prompt || state?.prompt || '',
    board,
    components,
    nets,
    routingPlan,
    stackup: job.input?.stackup || state?.stackup,
    powerTree: job.input?.powerTree || state?.powerTree,
    copperPourPlan: job.input?.copperPourPlan || state?.copperPourPlan,
    categoryPlan: job.input?.categoryPlan || state?.categoryPlan,
    reports: job.input?.reports || reports,
    project: state || {},
    profile,
    options: job.input || {},
  }
  const output = runEngineeringAnalysis(job.type, context)
  const key = engineeringStateKey(job.type)
  const outputFile = projectDir ? path.join(projectDir, `${keyToFileName(key)}.json`) : null
  if (outputFile && !job.dryRun) {
    await writeFile(outputFile, JSON.stringify(output, null, 2), 'utf8')
    await updateProjectState(projectDir, async (current) => ({
      ...current,
      status: output.status,
      [key]: output,
      generatedFiles: [...new Set([...(current.generatedFiles || []), outputFile])],
      lastJobType: job.type,
      lastHistoryMessage: `${job.type} completed with status ${output.status}.`,
    }))
  }
  return result(job, output.status, output.warnings || [], output.errors || [], { [key]: output, generatedFiles: outputFile && !job.dryRun ? [outputFile] : [], humanReviewRequired: output.humanReviewRequired !== false })
}

async function productionWorkflowJob(job, workspace) {
  const projectDir = job.input?.projectPath ? resolveInsideWorkspace(workspace, job.input.projectPath) : null
  const state = projectDir ? await readProjectState(projectDir) : null
  const components = job.input?.components || await readRichComponents(projectDir) || state?.components || []
  const input = {
    ...(state || {}),
    ...(job.input || {}),
    components,
    referenceDesign: job.input?.referenceDesign || state?.referenceDesign,
    board: job.input?.board || state?.board,
    routingPlan: job.input?.routingPlan || state?.routing?.plan || state?.routing?.autoroute,
    routeQuality: job.input?.routeQuality || state?.routing?.quality,
    routeValidation: job.input?.routeValidation || state?.routing?.precheck,
    drcReport: job.input?.drcReport || state?.validation?.drc || state?.validation?.autorouteDrc,
  }
  const output = runProductionWorkflow(job.type, input)
  const key = productionStateKey(job.type)
  const outputFile = projectDir ? path.join(projectDir, `${keyToFileName(key)}.json`) : null
  if (outputFile && !job.dryRun) {
    await writeFile(outputFile, JSON.stringify(output, null, 2), 'utf8')
    await updateProjectState(projectDir, async (current) => ({
      ...current,
      status: output.status,
      [key]: output,
      components: job.type === 'solve_placement' && output.components ? normalizeComponents(output.components) : current.components,
      generatedFiles: [...new Set([...(current.generatedFiles || []), outputFile])],
      lastJobType: job.type,
      lastHistoryMessage: `${job.type} completed with status ${output.status}.`,
    }))
  }
  return result(job, output.status, output.warnings || [], output.errors || [], { [key]: output, generatedFiles: outputFile && !job.dryRun ? [outputFile] : [], humanReviewRequired: output.humanReviewRequired !== false })
}

async function productionReadinessSuiteJob(job, workspace, profile) {
  const projectDir = job.input?.projectPath ? resolveInsideWorkspace(workspace, job.input.projectPath) : null
  const state = projectDir ? await readProjectState(projectDir) : null
  const components = job.input?.components || await readRichComponents(projectDir) || state?.components || []
  const scan = projectDir && existsSync(projectDir) ? await safeScanProject(projectDir) : null
  const context = {
    ...(state || {}),
    ...(job.input || {}),
    board: job.input?.board || state?.board || boardFromJob(job),
    components,
    nets: job.input?.nets || state?.netlist?.nets || state?.requirements?.nets || state?.circuitBlocks?.netIntent || [],
    profile,
    pcbScan: job.input?.pcbScan || scan,
    scan,
    reports: {
      ...(state?.validation || {}),
      ...(job.input?.reports || {}),
    },
  }
  const output = runProductionReadinessJob(job.type, context)
  const key = productionReadinessStateKey(job.type)
  const outputFile = projectDir ? path.join(projectDir, `${keyToFileName(key)}.json`) : null
  if (outputFile && !job.dryRun) {
    await writeFile(outputFile, JSON.stringify(output, null, 2), 'utf8')
    await updateProjectState(projectDir, async (current) => ({
      ...current,
      status: output.status,
      [key]: output,
      canonicalNetModel: output.canonicalNetModel || current.canonicalNetModel,
      generatedFiles: [...new Set([...(current.generatedFiles || []), outputFile])],
      lastJobType: job.type,
      lastHistoryMessage: `${job.type} completed with status ${output.status}.`,
    }))
  }
  return result(job, output.status, output.warnings || [], output.errors || [], { [key]: output, generatedFiles: outputFile && !job.dryRun ? [outputFile] : [], humanReviewRequired: output.humanReviewRequired !== false })
}

async function advancedBoardSuiteJob(job, workspace, profile) {
  const projectDir = job.input?.projectPath ? resolveInsideWorkspace(workspace, job.input.projectPath) : null
  const state = projectDir ? await readProjectState(projectDir) : null
  const components = job.input?.components || await readRichComponents(projectDir) || state?.components || []
  const context = {
    ...(state || {}),
    ...(job.input || {}),
    board: job.input?.board || state?.board || boardFromJob(job),
    components,
    nets: job.input?.nets || state?.canonicalNetModelReport?.canonicalNetModel?.nets || state?.netlist?.nets || state?.requirements?.nets || [],
    profile,
  }
  const output = runAdvancedBoardJob(job.type, context)
  const key = advancedBoardStateKey(job.type)
  const outputFile = projectDir ? path.join(projectDir, `${keyToFileName(key)}.json`) : null
  if (outputFile && !job.dryRun) {
    await writeFile(outputFile, JSON.stringify(output, null, 2), 'utf8')
    await updateProjectState(projectDir, async (current) => ({
      ...current,
      status: output.status,
      [key]: output,
      generatedFiles: [...new Set([...(current.generatedFiles || []), outputFile])],
      lastJobType: job.type,
      lastHistoryMessage: `${job.type} completed with status ${output.status}.`,
    }))
  }
  return result(job, output.status, output.warnings || [], output.errors || [], { [key]: output, generatedFiles: outputFile && !job.dryRun ? [outputFile] : [], humanReviewRequired: output.humanReviewRequired !== false })
}

async function safeScanProject(projectDir) {
  try {
    return await scanKiCadProject(projectDir)
  } catch {
    return null
  }
}

function advancedBoardStateKey(type) {
  return {
    classify_board_architecture: 'boardArchitectureReport',
    plan_hdi_manufacturing_strategy: 'hdiManufacturingStrategyReport',
    audit_return_path_integrity: 'returnPathIntegrityReport',
    audit_creepage_clearance: 'creepageClearanceReport',
    plan_bringup_reliability_matrix: 'bringupReliabilityMatrixReport',
    run_advanced_board_suite: 'advancedBoardSuite',
  }[type] || 'advancedBoardSuite'
}

function productionReadinessStateKey(type) {
  return {
    build_canonical_net_model: 'canonicalNetModelReport',
    audit_asset_resolution: 'assetResolutionReport',
    audit_placement_legality: 'placementLegalityReport',
    compile_routing_execution_strategy: 'routingExecutionStrategyReport',
    audit_release_export_gates: 'releaseExportGateAudit',
    run_production_readiness_suite: 'productionReadinessSuite',
  }[type] || 'productionReadinessSuite'
}

function runProductionWorkflow(type, input) {
  if (type === 'ingest_reference_design') return ingestReferenceDesign(input)
  if (type === 'synthesize_circuit_blocks') return synthesizeCircuitBlocks(input)
  if (type === 'solve_placement') return solvePlacement(input)
  if (type === 'plan_autoroute_repair_loop') return planAutorouteRepairLoop(input)
  if (type === 'build_verified_demo_recipe') return buildVerifiedDemoRecipe(input)
  if (type === 'plan_production_pipeline') return planProductionPipeline(input)
  return { status: 'FAILED', warnings: [], errors: [{ severity: 'ERROR', code: 'UNKNOWN_PRODUCTION_WORKFLOW', message: type }], humanReviewRequired: true }
}

function productionStateKey(type) {
  return {
    ingest_reference_design: 'referenceDesign',
    synthesize_circuit_blocks: 'circuitBlocks',
    solve_placement: 'placementSolver',
    plan_autoroute_repair_loop: 'autorouteRepairLoop',
    build_verified_demo_recipe: 'verifiedDemoRecipe',
    plan_production_pipeline: 'productionPipeline',
  }[type] || 'productionWorkflow'
}

function runEngineeringAnalysis(type, context) {
  if (type === 'analyze_routing_congestion') return analyzeRoutingCongestion(context)
  if (type === 'plan_escape_routing') return planEscapeRouting(context)
  if (type === 'plan_diff_pair_tuning') return planDifferentialPairTuning(context)
  if (type === 'validate_power_integrity') return validatePowerIntegrity(context)
  if (type === 'analyze_thermal_bottlenecks') return analyzeThermalBottlenecks(context)
  if (type === 'validate_assembly_orientation') return validateAssemblyOrientation(context)
  if (type === 'estimate_board_cost') return estimateBoardCost(context)
  if (type === 'generate_engineering_questions') return generateEngineeringQuestions(context)
  if (type === 'score_production_readiness') return scoreProductionReadiness(context)
  if (type === 'build_release_gate_report') return buildReleaseGateReport(context)
  return { status: 'FAILED', warnings: [], errors: [{ severity: 'ERROR', code: 'UNKNOWN_ENGINEERING_ANALYSIS', message: type }], humanReviewRequired: true }
}

function engineeringStateKey(type) {
  return {
    analyze_routing_congestion: 'routingCongestion',
    plan_escape_routing: 'escapeRouting',
    plan_diff_pair_tuning: 'diffPairTuning',
    validate_power_integrity: 'powerIntegrity',
    analyze_thermal_bottlenecks: 'thermalBottlenecks',
    validate_assembly_orientation: 'assemblyOrientation',
    estimate_board_cost: 'boardCost',
    generate_engineering_questions: 'engineeringQuestions',
    score_production_readiness: 'productionReadiness',
    build_release_gate_report: 'releaseGateReport',
  }[type] || 'engineeringAnalysis'
}

function keyToFileName(key) {
  return `boardforge-${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`
}

async function autorouteBoardJob(job, workspace, profile) {
  const projectDir = job.input?.projectPath ? resolveInsideWorkspace(workspace, job.input.projectPath) : null
  const state = projectDir ? await readProjectState(projectDir) : null
  const board = job.input?.board || state?.board || boardFromJob(job)
  const components = job.input?.components || await readRichComponents(projectDir) || state?.components || []
  const nets = assignNetsToClasses(job.input?.nets || state?.requirements?.nets || state?.netlist?.nets || [])
  const routingPlan = autorouteBoard({ board, components, nets, profile, options: { ...job.input, layerCount: board.layerCount } })
  const routeValidation = validateRoutingGeometry({ board, components, routingPlan, profile })
  const routeQuality = scoreRoutingPlan({ routingPlan, profile, powerTree: job.input?.powerTree || state?.powerTree || null })
  const generatedFiles = []

  if (projectDir && !job.dryRun) {
    const outputFile = path.join(projectDir, 'boardforge-autoroute-plan.json')
    await writeFile(outputFile, JSON.stringify({ routingPlan, routeValidation, routeQuality }, null, 2), 'utf8')
    generatedFiles.push(outputFile)
    await updateProjectState(projectDir, async (current) => ({
      ...current,
      status: routingPlan.status,
      routing: {
        ...current.routing,
        status: routingPlan.status,
        plan: routingPlan,
        autoroute: routingPlan,
        precheck: routeValidation,
        quality: routeQuality,
        drcRequired: false,
      },
      generatedFiles: [...new Set([...(current.generatedFiles || []), outputFile])],
      lastJobType: job.type,
      lastHistoryMessage: `Autorouted ${routingPlan.routedNets.length} nets; ${routingPlan.unroutedNets.length} nets remain unrouted.`,
    }))
  }

  return result(job, routingPlan.status, [...routingPlan.warnings, ...routeValidation.warnings, ...routeQuality.warnings], [...routingPlan.errors, ...routeValidation.errors, ...routeQuality.errors], { routingPlan, routeValidation, routeQuality, generatedFiles, humanReviewRequired: true })
}

async function autorouteAndApplyJob(job, workspace, profile) {
  const context = await getKiCadContext(job, workspace, 'pcb')
  if (context.blocked) return context.blocked
  const state = await readProjectState(context.files.projectDir)
  const board = job.input?.board || state?.board || boardFromJob(job)
  const components = job.input?.components || await readRichComponents(context.files.projectDir) || state?.components || []
  const nets = assignNetsToClasses(job.input?.nets || state?.requirements?.nets || state?.netlist?.nets || [])
  const routingPlan = job.input?.routingPlan || autorouteBoard({ board, components, nets, profile, options: { ...job.input, layerCount: board.layerCount } })
  const routeValidation = validateRoutingGeometry({ board, components, routingPlan, profile })
  const routeQuality = scoreRoutingPlan({ routingPlan, profile, powerTree: job.input?.powerTree || state?.powerTree || null })
  const warnings = [...(routingPlan.warnings || []), ...routeValidation.warnings, ...routeQuality.warnings]
  const errors = [...(routingPlan.errors || []), ...routeValidation.errors, ...routeQuality.errors]

  if (routingPlan.unroutedNets?.length && !job.input?.allowPartialAutorouteWrite) {
    return result(job, 'AUTOROUTE_WRITE_BLOCKED_UNROUTED_NETS', warnings, [...errors, { severity: 'ERROR', code: 'UNROUTED_NETS_REMAIN', message: `Autoroute left ${routingPlan.unroutedNets.length} net(s) unrouted. Set allowPartialAutorouteWrite only for explicit review/debug output.`, details: { unroutedNets: routingPlan.unroutedNets } }], { routingPlan, routeValidation, routeQuality, generatedFiles: [], humanReviewRequired: true })
  }
  if ((routeValidation.errors.length || routeQuality.errors.length) && !job.input?.allowUnsafeRoutingWrite) {
    return result(job, 'AUTOROUTE_WRITE_BLOCKED_PRECHECK_FAILED', warnings, errors, { routingPlan, routeValidation, routeQuality, generatedFiles: [], humanReviewRequired: true })
  }
  if (!routingPlan.routes?.some((route) => route.status === 'routed' && route.start && route.end)) {
    return result(job, 'AUTOROUTE_WRITE_BLOCKED_NO_GEOMETRY', warnings, [{ severity: 'ERROR', code: 'NO_AUTOROUTED_GEOMETRY', message: 'Autorouter produced no writable routed nets.' }, ...errors], { routingPlan, routeValidation, routeQuality, generatedFiles: [], humanReviewRequired: true })
  }

  const output = await applyRoutingPlanToPcb({ pcbFile: context.files.pcbFile, board, routingPlan, components })
  const { status: _writerStatus, ...autorouteOutput } = output
  await updateProjectState(context.files.projectDir, async (current) => ({
    ...current,
    status: 'AUTOROUTE_COPPER_APPLIED_NEEDS_DRC',
    routing: {
      status: 'AUTOROUTE_COPPER_APPLIED_NEEDS_DRC',
      plan: routingPlan,
      autoroute: routingPlan,
      routes: output.routes,
      vias: output.vias,
      zones: output.zones,
      generatedObjects: output.generatedObjects,
      precheck: routeValidation,
      quality: routeQuality,
      drcRequired: true,
    },
    generatedFiles: [...new Set([...(current.generatedFiles || []), context.files.pcbFile])],
    lastJobType: job.type,
    lastHistoryMessage: `Autoroute applied ${output.generatedObjects.segments} segments, ${output.generatedObjects.vias} vias, and ${output.generatedObjects.zones} zones. DRC required.`,
  }))
  return result(job, 'AUTOROUTE_COPPER_APPLIED_NEEDS_DRC', [{ severity: 'WARNING', code: 'DRC_REQUIRED', message: 'Autorouted copper was written to KiCad PCB. Run autoroute_drc_iteration or run_kicad_drc before export/manufacturing.' }, ...warnings], [], { ...autorouteOutput, routingPlan, routeValidation, routeQuality, generatedFiles: [context.files.pcbFile], humanReviewRequired: true })
}

async function autorouteDrcIterationJob(job, workspace, profile) {
  const applied = await autorouteAndApplyJob(job, workspace, profile)
  if (applied.status !== 'AUTOROUTE_COPPER_APPLIED_NEEDS_DRC') return applied
  const context = await getKiCadContext(job, workspace, 'pcb')
  if (context.blocked) return context.blocked
  const reportFile = path.join(context.files.projectDir, 'reports', 'autoroute-drc.json')
  const drc = await runDrc({ pcbFile: context.files.pcbFile, outputFile: reportFile, kicadCliPath: context.detected.path })
  await updateValidationState(context.files.projectDir, job.type, 'autorouteDrc', drc)
  const status = drc.issueCounts.errors ? 'AUTOROUTE_DRC_ITERATION_NEEDS_FIX' : 'AUTOROUTE_DRC_ITERATION_COMPLETE_NEEDS_REVIEW'
  return result(job, status, [...applied.warnings, ...(drc.issueCounts.warnings ? [{ severity: 'WARNING', code: 'DRC_WARNINGS', message: `${drc.issueCounts.warnings} DRC warnings found after autoroute.` }] : [])], drc.issueCounts.errors ? [{ severity: 'ERROR', code: 'DRC_ERRORS', message: `${drc.issueCounts.errors} DRC errors found after autoroute.` }] : [], { applied, kicad: context.detected, report: drc, generatedFiles: [...(applied.generatedFiles || []), reportFile], humanReviewRequired: true })
}

async function applyRoutingPlanJob(job, workspace, profile) {
  const context = await getKiCadContext(job, workspace, 'pcb')
  if (context.blocked) return context.blocked
  const state = await readProjectState(context.files.projectDir)
  const board = job.input?.board || state?.board || boardFromJob(job)
  const components = job.input?.components || state?.components || []
  const nets = assignNetsToClasses(job.input?.nets || state?.requirements?.nets || [])
  const routingPlan = job.input?.routingPlan || generateRoutingPlan(nets, { ...job.input, layerCount: board.layerCount, board, components, profile })
  const routeValidation = validateRoutingGeometry({ board, components, routingPlan, profile })
  const routeQuality = scoreRoutingPlan({ routingPlan, profile, powerTree: job.input?.powerTree || state?.powerTree || null })
  if (routeValidation.errors.length && !job.input?.allowUnsafeRoutingWrite) {
    return result(job, 'ROUTING_WRITE_BLOCKED_PRECHECK_FAILED', [...routeValidation.warnings, ...routeQuality.warnings], [...routeValidation.errors, ...routeQuality.errors], { routingPlan, routeValidation, routeQuality, generatedFiles: [], humanReviewRequired: true })
  }
  if (routeQuality.errors.length && !job.input?.allowUnsafeRoutingWrite) {
    return result(job, 'ROUTING_WRITE_BLOCKED_QUALITY_FAILED', [...routeValidation.warnings, ...routeQuality.warnings], [...routeValidation.errors, ...routeQuality.errors], { routingPlan, routeValidation, routeQuality, generatedFiles: [], humanReviewRequired: true })
  }
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
      precheck: routeValidation,
      quality: routeQuality,
      drcRequired: true,
    },
    generatedFiles: [...new Set([...(current.generatedFiles || []), context.files.pcbFile])],
    lastJobType: job.type,
    lastHistoryMessage: `Applied ${output.generatedObjects.segments} segments, ${output.generatedObjects.vias} vias, and ${output.generatedObjects.zones} zones to PCB. DRC required.`,
  }))
  return result(job, output.status, [{ severity: 'WARNING', code: 'DRC_REQUIRED', message: 'Copper was written to KiCad PCB. Run run_kicad_drc before export or manufacturing.' }, ...routeValidation.warnings, ...routeQuality.warnings], [], { ...output, routeValidation, routeQuality, generatedFiles: [context.files.pcbFile] })
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
  const gate = await validateExportGate(context.files.projectDir, 'gerbers', job.input || {})
  if (!gate.allowed) return result(job, 'GERBERS_BLOCKED_VALIDATION_REQUIRED', gate.warnings || [], gate.errors || [], { readiness: gate.readiness, generatedFiles: [], humanReviewRequired: true })
  const output = await exportGerbers({ pcbFile: context.files.pcbFile, outputDir: path.join(context.files.projectDir, 'fab', 'gerbers'), kicadCliPath: context.detected.path })
  await updateExportState(context.files.projectDir, job.type, 'gerbers', output)
  return result(job, output.status, output.status.endsWith('FAILED') ? [{ severity: 'WARNING', code: 'GERBER_EXPORT_FAILED', message: output.stderr || 'Gerber export failed.' }] : [], [], { kicad: context.detected, export: output, generatedFiles: output.files, humanReviewRequired: true })
}

async function exportDrillJob(job, workspace) {
  const context = await getKiCadContext(job, workspace, 'pcb')
  if (context.blocked) return context.blocked
  const gate = await validateExportGate(context.files.projectDir, 'drill', job.input || {})
  if (!gate.allowed) return result(job, 'DRILL_BLOCKED_VALIDATION_REQUIRED', gate.warnings || [], gate.errors || [], { readiness: gate.readiness, generatedFiles: [], humanReviewRequired: true })
  const output = await exportDrill({ pcbFile: context.files.pcbFile, outputDir: path.join(context.files.projectDir, 'fab', 'drill'), kicadCliPath: context.detected.path })
  await updateExportState(context.files.projectDir, job.type, 'drill', output)
  return result(job, output.status, output.status.endsWith('FAILED') ? [{ severity: 'WARNING', code: 'DRILL_EXPORT_FAILED', message: output.stderr || 'Drill export failed.' }] : [], [], { kicad: context.detected, export: output, generatedFiles: output.files, humanReviewRequired: true })
}

async function exportBomJob(job, workspace) {
  const context = await getKiCadContext(job, workspace, 'sch')
  if (context.blocked) return context.blocked
  const gate = await validateExportGate(context.files.projectDir, 'bom', job.input || {})
  if (!gate.allowed) return result(job, 'BOM_BLOCKED_VALIDATION_REQUIRED', gate.warnings || [], gate.errors || [], { readiness: gate.readiness, generatedFiles: [], humanReviewRequired: true })
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
  const gate = await validateExportGate(context.files.projectDir, 'cpl', job.input || {})
  if (!gate.allowed) return result(job, 'CPL_BLOCKED_VALIDATION_REQUIRED', gate.warnings || [], gate.errors || [], { readiness: gate.readiness, generatedFiles: [], humanReviewRequired: true })
  const output = await exportCpl({ pcbFile: context.files.pcbFile, outputFile: path.join(context.files.projectDir, 'fab', 'cpl.csv'), kicadCliPath: context.detected.path })
  await updateExportState(context.files.projectDir, job.type, 'cpl', output)
  return result(job, output.status, output.status.endsWith('FAILED') ? [{ severity: 'WARNING', code: 'CPL_EXPORT_FAILED', message: output.stderr || 'CPL export failed.' }] : [], [], { kicad: context.detected, export: output, generatedFiles: output.files, humanReviewRequired: true })
}

async function packageJlcpcbJob(job, workspace) {
  const context = await getKiCadContext(job, workspace, 'pcb')
  if (context.blocked) return context.blocked
  const packageValidation = await validateJlcpcbPackage(context.files.projectDir, job.input || {})
  if (packageValidation.status === 'JLCPCB_PACKAGE_BLOCKED' && !job.input?.allowPackageWithValidationErrors) {
    await updateExportState(context.files.projectDir, 'validate_jlcpcb_package', 'jlcpcbValidation', { status: packageValidation.status, outputFile: packageValidation.outputFile, files: [packageValidation.outputFile].filter(Boolean) })
    await updateExportState(context.files.projectDir, job.type, 'jlcpcb', { status: 'PACKAGE_BLOCKED_JLCPCB_VALIDATION', outputFile: null, files: [], missingFiles: [] })
    return result(job, 'PACKAGE_BLOCKED_JLCPCB_VALIDATION', packageValidation.warnings, packageValidation.errors, { packageValidation, generatedFiles: [packageValidation.outputFile].filter(Boolean), humanReviewRequired: true })
  }
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
