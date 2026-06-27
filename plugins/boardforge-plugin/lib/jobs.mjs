import { copyFile, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createNetClasses, assignNetsToClasses, validateNetClasses } from './net-classes.mjs'
import { getManufacturerProfile } from './manufacturers.mjs'
import { distancePointToSegment, pointInPolygon, rectCorners, rectsOverlap, round } from './geometry.mjs'
import { createBoardShape, createTemplateBoard, boardTemplates } from './templates.mjs'
import { generatePlacementPlan, optimizePlacementPlan } from './placement.mjs'
import { generateRoutingPlan } from './routing.mjs'
import { autorouteBoard, extractPadCopperGeometry, snapEndpointToPadCopper } from './autorouter.mjs'
import { kicadPcbFile, kicadProjectFile, kicadSchematicFile, projectReadmeFile, readmeFile, scanKiCadProject, syncKiCadProjectNetSettings } from './kicad.mjs'
import { runFullSelfReview, validateBoardOutline, validatePlacement } from './validation.mjs'
import { detectKiCadCli, exportBom, exportCpl, exportDrill, exportGerbers, findKiCadProjectFiles, packageJlcpcb, runDrc, runErc } from './kicad-cli.mjs'
import { generateTemplateComponents, renderPlacedFootprints } from './components.mjs'
import { boardForgeFootprintLibraryFiles, findMissingFootprints, link3dModels, resolveComponentAssets, searchLibraryAssets, syncKiCadLibraries } from './library-adapter.mjs'
import { createProjectState, normalizeComponents, readProjectState, stateFileName, summarizeProjectState, updateProjectState } from './project-state.mjs'
import { createDesignIntent, validateZones } from './design-rules.mjs'
import { applyNetlistSyncToPcb, applyRoutingPlanToPcb, scanKicadCopperAfterWrite } from './copper-writer.mjs'
import { applyPlacementPlanToPcb } from './placement-writer.mjs'
import { buildDesignConstraints } from './design-constraints.mjs'
import { buildWorkflowPreset } from './workflow-presets.mjs'
import { buildKiCadRules, writeKiCadRules } from './kicad-rules-writer.mjs'
import { buildComponentDatabase, enrichComponents } from './component-database.mjs'
import { boardforgeNetlistFromComponents, generateSchematicModel, kicadSchematicFromModel } from './schematic-generator.mjs'
import { synthesizeSchematicDesign } from './schematic-synthesizer.mjs'
import { applySafeDrcRepairs, extractDrcRerouteConstraints, planDrcRepairs, runDrcDrivenCopperRepairLoop } from './drc-repair.mjs'
import { applyErcIntentPolicy, applySafeErcRepairs, classifyErcPowerIntent, planErcRepairs } from './erc-repair.mjs'
import { applyInteractiveEdits } from './interactive-edits.mjs'
import { validateComponentBindings } from './component-compatibility.mjs'
import { validateExportGate, validateManufacturingReadiness } from './manufacturing-readiness.mjs'
import { buildManufacturingManifest } from './manufacturing-manifest.mjs'
import { validateJlcpcbPackage } from './jlcpcb-package-validator.mjs'
import { validateSchematicPcbSync } from './schematic-pcb-sync.mjs'
import { validate3dModelCoverage } from './model-coverage.mjs'
import { auditBomSourcing } from './bom-sourcing-audit.mjs'
import { validateSchematicReadiness } from './schematic-readiness.mjs'
import { applySafePinMapRepairs, planPinMapRepairs } from './pin-map-repair.mjs'
import { planCopperPours } from './copper-pour-planner.mjs'
import { validateRoutingGeometry, verifyPadToPadConnectivity } from './routing-validation.mjs'
import { applyEndpointAwareReroutes, planEndpointAwareReroutes } from './endpoint-router.mjs'
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
import { generateCustomBoardOutline, transformBoardOutline } from './outline-generator.mjs'
import { calculatePowerRouting } from './power-routing-calculator.mjs'
import { selectViaStrategy } from './via-strategy-engine.mjs'
import { buildNoiseMap } from './noise-map.mjs'
import { summarizeManufacturerRules } from './manufacturer-rules-summary.mjs'
import { generateProjectReviewReport } from './project-review-report.mjs'
import { auditOriginalEscSpec, writeOriginalSpecAuditReport } from './original-spec-audit.mjs'
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
import { autotracerJobTypes, finalizeAutotraceWithDrc, runAutotracerPlanning } from './autotracer-engine.mjs'
import { buildNetConnectivityGraph, commitOnlyConnectivityProgress, diffKiCadUnconnectedItems, extractRatsnestEndpointPairs, parseKiCadUnconnectedItems, verifyUnconnectedItemResolved } from './esc-routelet-success.mjs'
import { compareDrcHealthBeforeAfter, scoreDrcHealth } from './external-routing/post-freerouting-repair.mjs'
import { recordSolution } from './solution-library/solution-store.mjs'
import { buildHighDensityRoutePolicy, classifyGeneratedDrcRegression, highDensityEscRouter, mutateRouteAfterDrcFailure as mutateHighDensityRouteAfterDrcFailure } from './high-density-esc-router.mjs'
import {
  chooseRepairOrRegenerate,
  classifyBoardComplexity,
  detectConstraintConflicts,
  detectTemplateReuse,
  generateBoardSpecificReport,
  listUniversalBoardScenarios,
  recommendAdaptiveStackup,
  scoreRoutability,
} from './universal-board-engine.mjs'
import { applySelectedPlacementToPlan, generatePlacementCandidates, selectPlacementCandidate } from './placement-candidates.mjs'
import { analyzeErcReport, analyzeEscRoutingFeasibility, applyEscNetClasses, classifyEscNets, migrateEscPcbStackup } from './esc-workflow.mjs'
import {
  autonomousJobStateFile,
  createAutonomousJobState,
  estimateAutonomousPcbJob,
  readAutonomousJobState,
  recordStage,
  repairImportedProjectLibraries,
  stopForBudget,
  stopForUserDecision,
  summarizeAutonomousJobState,
  writeAutonomousJobState,
} from './autonomous-job.mjs'

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export const allowedJobTypes = new Set(['generate_custom_outline', 'create_outline_board', 'create_kicad_project', 'apply_edge_cuts', 'add_mounting_holes', 'round_board_corners', 'add_usb_c_edge_cutout', 'add_rj45_edge_clearance', 'validate_board_outline', 'scan_kicad_project', 'snapshot_project', 'list_project_snapshots', 'diff_project_snapshot', 'restore_project_snapshot', 'run_project_preflight', 'list_board_categories', 'plan_board_category', 'list_universal_board_scenarios', 'classify_board_complexity', 'recommend_adaptive_stackup', 'score_routability', 'detect_constraint_conflicts', 'decide_structural_regeneration', 'detect_template_reuse', 'generate_board_specific_report', 'generate_placement_candidates', 'score_placement_candidates', 'select_placement_candidate', 'apply_universal_placement', 'estimate_boardforge_job', 'boardforge_autonomous_pcb_job', 'resume_boardforge_job', 'summarize_boardforge_job', 'cancel_boardforge_job', 'run_esc_autonomous_supervisor', 'analyze_erc_violations', 'apply_erc_intent_policy', 'analyze_esc_routing_feasibility', 'migrate_esc_stackup', 'apply_esc_net_classes', 'validate_schematic_graph', 'validate_schematic_readiness', 'synthesize_schematic_design', 'validate_schematic_pcb_sync', 'apply_schematic_pcb_sync', 'check_routing_readiness', 'calculate_power_routing', 'select_via_strategy', 'build_noise_map', 'summarize_manufacturer_rules', 'generate_project_review_report', 'design_from_prompt', 'build_workflow_preset', 'run_boardforge_workflow', 'run_verified_demo', 'trace_existing_board', 'plan_mission_requirements', 'intake_user_bom', 'audit_user_bom', 'ingest_reference_design', 'synthesize_circuit_blocks', 'plan_production_pipeline', 'build_verified_demo_recipe', 'plan_requirements', 'plan_pin_assignments', 'plan_power_tree', 'plan_stackup', 'plan_fanout', 'plan_signal_integrity', 'plan_test_strategy', 'run_dfm_checks', 'compare_manufacturers', 'plan_complex_board', 'generate_design_constraints', 'generate_kicad_rules', 'sync_kicad_libraries', 'search_library_assets', 'resolve_component_assets', 'sync_component_database', 'resolve_bom_parts', 'audit_component_library', 'validate_component_bindings', 'plan_pin_map_repairs', 'apply_pin_map_repairs', 'validate_3d_model_coverage', 'audit_bom_sourcing', 'validate_manufacturing_readiness', 'validate_manufacturing_package', 'validate_jlcpcb_package', 'generate_manufacturing_manifest', 'generate_netlist', 'run_design_audit', 'generate_schematic', 'plan_erc_repairs', 'apply_safe_erc_repairs', 'plan_drc_repairs', 'apply_safe_drc_repairs', 'plan_endpoint_reroutes', 'apply_endpoint_reroutes', 'interactive_edit', 'find_missing_footprints', 'link_3d_models', 'create_net_classes', 'classify_nets', 'assign_net_classes', 'assign_net_to_class', 'validate_net_classes', 'report_unclassified_nets', 'generate_placement_plan', 'optimize_placement', 'solve_placement', 'apply_placement_plan', 'validate_placement', 'move_component', 'fix_component_off_board', 'fix_component_overlap', 'fix_component_off_board', 'fix_component_overlap', 'fix_mounting_hole_conflicts', 'analyze_routing_congestion', 'plan_escape_routing', 'plan_diff_pair_tuning', 'validate_power_integrity', 'analyze_thermal_bottlenecks', 'validate_assembly_orientation', 'estimate_board_cost', 'generate_engineering_questions', 'score_production_readiness', 'build_release_gate_report', 'generate_routing_plan', 'generate_routing_report', 'plan_copper_pours', 'autoroute_board', 'autoroute_and_apply', 'autoroute_drc_iteration', 'plan_autoroute_repair_loop', 'score_routing_quality', 'apply_routing_plan', 'validate_routing_geometry', 'route_critical_nets', 'route_power_nets', 'route_diff_pair', 'route_signal_net', 'add_ground_zone', 'stitch_ground_vias', 'validate_routes', 'report_unrouted_nets', 'fix_route_clearance_violations', 'run_full_self_review', 'run_kicad_drc', 'run_kicad_erc', 'export_gerbers', 'export_drill_files', 'export_bom', 'export_cpl', 'package_jlcpcb', 'summarize_project'])
for (const type of productionReadinessJobTypes) allowedJobTypes.add(type)
for (const type of advancedBoardJobTypes) allowedJobTypes.add(type)
for (const type of autotracerJobTypes) allowedJobTypes.add(type)
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
  if (!input.templateId && (input.outlinePrompt || input.description || input.points || input.sketchPoints || input.shape === 'custom' || (input.prompt && /outline|shape|edge\.cuts|custom board|mounting hole|notch/i.test(input.prompt)))) {
    return generateCustomBoardOutline(input, getManufacturerProfile(input.manufacturerProfile || input.manufacturer || 'JLCPCB_STANDARD')).board
  }
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
  if (job.type === 'generate_custom_outline') return generateCustomOutlineJob(job, profile)
  if (job.type === 'create_outline_board') return createOutlineBoard(job, workspace, profile)
  if (job.type === 'create_kicad_project') return createKiCadProject(job, workspace, profile)
  if (['apply_edge_cuts', 'add_mounting_holes', 'round_board_corners', 'add_usb_c_edge_cutout', 'add_rj45_edge_clearance'].includes(job.type)) return outlineTransformJob(job, workspace, profile)
  if (job.type === 'validate_board_outline') return validateOutlineJob(job, profile)
  if (job.type === 'snapshot_project') return snapshotProjectJob(job, workspace)
  if (job.type === 'list_project_snapshots') return listProjectSnapshotsJob(job, workspace)
  if (job.type === 'diff_project_snapshot') return diffProjectSnapshotJob(job, workspace)
  if (job.type === 'restore_project_snapshot') return restoreProjectSnapshotJob(job, workspace)
  if (job.type === 'run_project_preflight') return projectPreflightJob(job, workspace)
  if (job.type === 'list_board_categories') return result(job, 'BOARD_CATEGORIES_LISTED', [], [], { categories: listBoardCategories(), humanReviewRequired: false })
  if (job.type === 'plan_board_category') return boardCategoryPlanJob(job, workspace)
  if (job.type === 'list_universal_board_scenarios') return result(job, 'UNIVERSAL_SCENARIOS_LISTED', [], [], listUniversalBoardScenarios())
  if (job.type === 'classify_board_complexity') return universalPlanningJob(job, workspace, 'complexity')
  if (job.type === 'recommend_adaptive_stackup') return universalPlanningJob(job, workspace, 'stackup')
  if (job.type === 'score_routability') return universalPlanningJob(job, workspace, 'routability')
  if (job.type === 'detect_constraint_conflicts') return universalPlanningJob(job, workspace, 'constraints')
  if (job.type === 'decide_structural_regeneration') return universalPlanningJob(job, workspace, 'regeneration')
  if (job.type === 'detect_template_reuse') return universalPlanningJob(job, workspace, 'template_reuse')
  if (job.type === 'generate_board_specific_report') return universalPlanningJob(job, workspace, 'report')
  if (job.type === 'generate_placement_candidates' || job.type === 'score_placement_candidates') return placementCandidatesJob(job, workspace, profile)
  if (job.type === 'select_placement_candidate') return selectPlacementCandidateJob(job, workspace, profile)
  if (job.type === 'apply_universal_placement') return applyUniversalPlacementJob(job, workspace, profile)
  if (job.type === 'estimate_boardforge_job') return estimateBoardForgeJob(job, workspace)
  if (job.type === 'boardforge_autonomous_pcb_job') return autonomousPcbJob(job, workspace)
  if (job.type === 'resume_boardforge_job') return autonomousPcbJob({ ...job, type: 'boardforge_autonomous_pcb_job', resume: true }, workspace)
  if (job.type === 'summarize_boardforge_job') return summarizeBoardForgeJob(job, workspace)
  if (job.type === 'cancel_boardforge_job') return cancelBoardForgeJob(job, workspace)
  if (job.type === 'analyze_erc_violations') return analyzeErcViolationsJob(job, workspace)
  if (job.type === 'apply_erc_intent_policy') return applyErcIntentPolicyJob(job, workspace)
  if (job.type === 'analyze_esc_routing_feasibility') return analyzeEscRoutingFeasibilityJob(job, workspace)
  if (job.type === 'migrate_esc_stackup') return migrateEscStackupJob(job, workspace)
  if (job.type === 'apply_esc_net_classes') return applyEscNetClassesJob(job, workspace)
  if (job.type === 'validate_schematic_graph') return schematicGraphJob(job, workspace)
  if (job.type === 'validate_schematic_readiness') return validateSchematicReadinessJob(job, workspace)
  if (job.type === 'synthesize_schematic_design') return schematicSynthesisJob(job, workspace)
  if (job.type === 'validate_schematic_pcb_sync') return schematicPcbSyncJob(job, workspace)
  if (job.type === 'apply_schematic_pcb_sync') return applySchematicPcbSyncJob(job, workspace)
  if (job.type === 'check_routing_readiness') return routingReadinessJob(job, workspace, profile)
  if (job.type === 'calculate_power_routing') return powerRoutingJob(job, workspace, profile)
  if (job.type === 'select_via_strategy') return viaStrategyJob(job, workspace, profile)
  if (job.type === 'build_noise_map') return noiseMapJob(job, workspace)
  if (job.type === 'summarize_manufacturer_rules') return manufacturerRulesJob(job, profile)
  if (job.type === 'generate_project_review_report') return projectReviewReportJob(job, workspace, profile)
  if (job.type === 'design_from_prompt') return designFromPromptJob(job, workspace, profile)
  if (job.type === 'build_workflow_preset') return workflowPresetJob(job, workspace)
  if (job.type === 'run_boardforge_workflow') return runBoardForgeWorkflowJob(job, workspace)
  if (job.type === 'run_verified_demo') return runVerifiedDemoJob(job, workspace)
  if (job.type === 'run_esc_autonomous_supervisor') return runEscAutonomousSupervisor(job, workspace, profile)
  if (job.type === 'trace_existing_board') return traceExistingBoardJob(job, workspace, profile)
  if (job.type === 'plan_mission_requirements') return missionRequirementsJob(job, workspace)
  if (job.type === 'intake_user_bom') return userBomIntakeJob(job, workspace)
  if (job.type === 'audit_user_bom') return userBomAuditJob(job, workspace)
  if (['ingest_reference_design', 'synthesize_circuit_blocks', 'solve_placement', 'plan_autoroute_repair_loop', 'build_verified_demo_recipe', 'plan_production_pipeline'].includes(job.type)) return productionWorkflowJob(job, workspace)
  if (productionReadinessJobTypes.includes(job.type)) return productionReadinessSuiteJob(job, workspace, profile)
  if (advancedBoardJobTypes.includes(job.type)) return advancedBoardSuiteJob(job, workspace, profile)
  if (autotracerJobTypes.includes(job.type)) return autotracerJob(job, workspace, profile)
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
  if (job.type === 'validate_manufacturing_package') return jlcpcbPackageValidationJob({ ...job, type: 'validate_jlcpcb_package' }, workspace)
  if (job.type === 'validate_jlcpcb_package') return jlcpcbPackageValidationJob(job, workspace)
  if (job.type === 'generate_manufacturing_manifest') return manufacturingManifestJob(job, workspace)
  if (job.type === 'generate_netlist') return generateNetlistJob(job, workspace)
  if (job.type === 'run_design_audit') return designAuditJob(job, workspace, profile)
  if (job.type === 'generate_schematic') return generateSchematicJob(job, workspace)
  if (job.type === 'plan_erc_repairs') return planErcRepairsJob(job, workspace)
  if (job.type === 'apply_safe_erc_repairs') return applySafeErcRepairsJob(job, workspace)
  if (job.type === 'plan_drc_repairs') return planDrcRepairsJob(job, workspace)
  if (job.type === 'apply_safe_drc_repairs') return applySafeDrcRepairsJob(job, workspace)
  if (job.type === 'plan_endpoint_reroutes') return planEndpointReroutesJob(job, workspace, profile)
  if (job.type === 'apply_endpoint_reroutes') return applyEndpointReroutesJob(job, workspace, profile)
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
  const outlinePlan = generateCustomBoardOutline(job.input || {}, profile)
  const board = (job.input?.outlinePrompt || job.input?.description || job.input?.points || job.input?.sketchPoints || job.input?.shape === 'custom' || /outline|shape|edge\.cuts|custom board|mounting hole|notch/i.test(String(job.input?.prompt || '')))
    ? outlinePlan.board
    : boardFromJob(job)
  const outlineIssues = validateBoardOutline(board, profile)
  if (outlineIssues.some((item) => item.severity === 'BLOCKER')) return result(job, 'VALIDATION_FAILED', [], outlineIssues, { generatedFiles: [], humanReviewRequired: true })
  const detectedKiCad = await detectKiCadCli({ kicadCliPath: job.input?.kicadCliPath })
  const review = runFullSelfReview({ board, components: [], nets: [], routes: [], profile, kicad: { cliAvailable: detectedKiCad.available, cliPath: detectedKiCad.path, version: detectedKiCad.version } })
  const safeName = sanitizeName(job.input?.projectName || board.name)
  const projectDir = resolveInsideWorkspace(workspace, safeName)
  if (existsSync(projectDir) && !job.allowOverwrite) return result(job, 'NEEDS_FIX', [], [{ severity: 'ERROR', code: 'PROJECT_EXISTS', message: `Project already exists. Set allowOverwrite true to replace files: ${projectDir}` }], { projectPath: projectDir, generatedFiles: [] })
  const outlineNetClasses = createNetClasses(profile)
  const files = [{ path: `${safeName}.kicad_pro`, content: kicadProjectFile(board, outlineNetClasses, profile, []) }, { path: `${safeName}.kicad_pcb`, content: kicadPcbFile(board, { netClasses: outlineNetClasses, nets: [] }) }, { path: 'boardforge-outline-plan.json', content: JSON.stringify(outlinePlan, null, 2) }, { path: 'boardforge-review.json', content: JSON.stringify(review, null, 2) }, { path: 'README.md', content: readmeFile(job, board, review) }]
  const state = createProjectState({ job, board, mode: 'outline_only', profile, review, generatedFiles: files.map((file) => path.join(projectDir, file.path)) })
  state.outlinePlan = outlinePlan
  files.push({ path: stateFileName, content: JSON.stringify(state, null, 2) })
  if (!job.dryRun) {
    await mkdir(projectDir, { recursive: true })
    for (const file of files) await writeFile(resolveInsideWorkspace(projectDir, file.path), file.content, 'utf8')
  }
  return result(job, 'OUTLINE_GENERATED_NEEDS_REVIEW', review.issues.filter((item) => item.severity === 'WARNING'), review.issues.filter((item) => ['BLOCKER', 'ERROR'].includes(item.severity)), { projectPath: projectDir, generatedFiles: files.map((file) => path.join(projectDir, file.path)), qualityGates: review.qualityGates, summary: review.summary, humanReviewRequired: true })
}

function generateCustomOutlineJob(job, profile) {
  const output = generateCustomBoardOutline(job.input || {}, profile)
  return result(job, output.status, output.warnings, output.errors, { outlinePlan: output, board: output.board, humanReviewRequired: true })
}

async function outlineTransformJob(job, workspace, profile) {
  const projectDir = job.input?.projectPath ? resolveInsideWorkspace(workspace, job.input.projectPath) : null
  const state = projectDir ? await readProjectState(projectDir) : null
  const board = job.input?.board || state?.board || boardFromJob(job)
  const type = job.type
  const output = transformBoardOutline(board, {
    ...job.input,
    type,
    outline: job.input?.outline || job.input?.edgeCuts,
  }, profile)
  if (output.errors.some((issue) => issue.severity === 'BLOCKER')) return result(job, output.status, output.warnings, output.errors, { board: output.board, outlineTransform: output, generatedFiles: [], humanReviewRequired: true })
  const generatedFiles = []
  if (projectDir && !job.dryRun) {
    const mode = state?.mode || 'unknown'
    const populated = (state?.components?.length || 0) > 0 || mode !== 'outline_only'
    if (populated && !job.input?.allowPopulatedBoardRewrite) {
      return result(job, 'EDGE_CUTS_APPLY_BLOCKED_POPULATED_BOARD', output.warnings, [{ severity: 'ERROR', code: 'POPULATED_BOARD_EDGE_CUTS_REWRITE_BLOCKED', message: 'Refusing to rewrite a populated KiCad PCB. Use an outline-only project, or pass allowPopulatedBoardRewrite after making a snapshot.' }], { board: output.board, outlineTransform: output, generatedFiles: [], humanReviewRequired: true })
    }
    const files = await findKiCadProjectFiles(projectDir)
    const netClasses = createNetClasses(profile)
    await writeFile(files.pcbFile, kicadPcbFile(output.board, { netClasses, nets: [] }), 'utf8')
    const outlineFile = path.join(projectDir, 'boardforge-outline-plan.json')
    await writeFile(outlineFile, JSON.stringify(output, null, 2), 'utf8')
    generatedFiles.push(files.pcbFile, outlineFile)
    await updateProjectState(projectDir, async (current) => ({
      ...current,
      board: output.board,
      status: output.status,
      outlinePlan: output,
      generatedFiles: [...new Set([...(current.generatedFiles || []), ...generatedFiles])],
      lastJobType: job.type,
      lastHistoryMessage: `Applied ${job.type} to outline with ${output.board.outline.length} Edge.Cuts points.`,
    }))
  }
  return result(job, output.status, output.warnings, output.errors, { board: output.board, outlineTransform: output, generatedFiles, humanReviewRequired: true })
}

async function createKiCadProject(job, workspace, profile) {
  const board = boardFromJob(job)
  const outlineIssues = validateBoardOutline(board, profile)
  if (outlineIssues.some((item) => item.severity === 'BLOCKER')) return result(job, 'VALIDATION_FAILED', [], outlineIssues, { generatedFiles: [], humanReviewRequired: true })
  const detectedKiCad = await detectKiCadCli({ kicadCliPath: job.input?.kicadCliPath })
  const review = runFullSelfReview({ board, components: [], nets: assignNetsToClasses(job.input?.nets || []), routes: [], profile, kicad: { cliAvailable: detectedKiCad.available, cliPath: detectedKiCad.path, version: detectedKiCad.version } })
  const safeName = sanitizeName(job.input?.projectName || board.name)
  const projectDir = resolveInsideWorkspace(workspace, safeName)
  if (existsSync(projectDir) && !job.allowOverwrite) return result(job, 'NEEDS_FIX', [], [{ severity: 'ERROR', code: 'PROJECT_EXISTS', message: `Project already exists. Set allowOverwrite true to replace files: ${projectDir}` }], { projectPath: projectDir, generatedFiles: [] })
  const netClasses = createNetClasses(profile)
  const requirementsPlan = (job.input?.prompt || job.input?.notes || job.input?.components?.length || job.input?.interfaces?.length)
    ? planRequirements({ ...job.input, templateId: job.input?.templateId || board.id })
    : null
  const seedComponents = requirementsPlan?.components?.length ? requirementsPlan.components : generateTemplateComponents(board, job.input?.templateId)
  const components = applyPlannedPlacement(board, seedComponents)
  const designIntent = createDesignIntent(board, components, assignNetsToClasses(requirementsPlan?.nets || job.input?.nets || []), profile)
  const zoneIssues = validateZones(board, designIntent.zones)
  const placementIssues = validatePlacement(board, components, profile)
  const blockingPlacementIssues = [...placementIssues, ...zoneIssues].filter((item) => ['BLOCKER', 'ERROR'].includes(item.severity) && item.code !== 'ANTENNA_KEEPOUT_ALLOWS_COPPER')
  if (blockingPlacementIssues.length) {
    placementIssues.push(...blockingPlacementIssues.map((item) => ({ ...item, severity: 'WARNING', code: `SCAFFOLD_${item.code}` })))
  }
  const library = await resolveComponentAssets({ workspace, input: { ...job.input, components } })
  const resolvedComponents = components.map((component) => {
    const resolved = library.components?.find((item) => item.ref === component.ref)
    return { ...component, symbol: resolved?.symbol || component.symbol || null, footprint: resolved?.footprint || component.footprint, model3d: resolved?.model3d || component.model3d || null, confidence: resolved?.confidence || 'needs_review' }
  })
  const footprintsResult = await renderPlacedFootprints(resolvedComponents, { workspace, ...job.input })
  const footprints = Array.isArray(footprintsResult) ? footprintsResult : footprintsResult.rendered
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
    { path: `${safeName}.kicad_pro`, content: kicadProjectFile(board, netClasses, profile, plannedNets) },
    { path: `${safeName}.kicad_sch`, content: kicadSchematicFile(board, { components: resolvedComponents }) },
    { path: `${safeName}.kicad_pcb`, content: kicadPcbFile(board, { netClasses, nets: plannedNets, footprints }) },
    ...boardForgeFootprintLibraryFiles(resolvedComponents, job.input || {}),
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
    for (const file of files) {
      const target = resolveInsideWorkspace(projectDir, file.path)
      await mkdir(path.dirname(target), { recursive: true })
      await writeFile(target, file.content, 'utf8')
    }
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
  if (/edge_ethernet/.test(role) || component.group === 'RJ45') return [
    { x: bounds.maxX - 18, y: cy - h * 0.24, rotation: 90 },
    { x: bounds.maxX - 18, y: cy, rotation: 90 },
  ]
  if (component.group === 'TERMINAL_BLOCK') return [
    { x: bounds.maxX - Math.max(28, w * 0.24), y: cy, rotation: 0 },
    { x: bounds.maxX - Math.max(28, w * 0.24), y: bounds.minY + h * 0.58, rotation: 0 },
  ]
  if (/edge_field|field_connector/.test(role) || component.group === 'FIELD_CONNECTOR') return [
    { x: bounds.maxX - 24, y: cy, rotation: 90 },
    { x: bounds.maxX - 24, y: bounds.minY + h * 0.62, rotation: 90 },
  ]
  if (/edge_power/.test(role) || component.group === 'POWER_INPUT') return edgeFan(bounds, 'left', bounds.minY + h * 0.68, 90)
  if (/edge_motor/.test(role) || component.group === 'MOTOR_HEADER') return [
    { x: bounds.minX + w * 0.66, y: bounds.maxY - 16, rotation: 90 },
    { x: bounds.minX + w * 0.58, y: bounds.maxY - 16, rotation: 90 },
  ]
  if (/debug_header/.test(role) || component.group === 'SWD') return edgeFan(bounds, 'bottom', bounds.minX + w * 0.20, 90)
  if (/edge_sensor/.test(role) || component.group === 'SENSOR_CONNECTOR') return edgeFan(bounds, 'top', bounds.minX + w * 0.72, 0)
  if (/edge_esc/.test(role) || component.group === 'ESC_CONNECTOR') return edgeFan(bounds, 'bottom', cx, 0)
  if (/mcu_rf_module/.test(role) || component.group === 'ESP32_S3') return [
    { x: bounds.minX + w * 0.50, y: bounds.minY + h * 0.66, rotation: 0 },
    { x: bounds.minX + w * 0.46, y: bounds.minY + h * 0.64, rotation: 0 },
    { x: bounds.minX + w * 0.56, y: bounds.minY + h * 0.66, rotation: 0 },
  ]
  if (/ethernet_phy/.test(role) || component.group === 'ETHERNET_PHY') return [
    { x: bounds.maxX - 48, y: cy - h * 0.24, rotation: 90 },
    { x: bounds.maxX - 58, y: cy - h * 0.18, rotation: 90 },
  ]
  if (/poe_front_end/.test(role) || component.group === 'POE_FRONT_END') return [
    { x: bounds.minX + w * 0.25, y: bounds.minY + h * 0.72, rotation: 0 },
    { x: bounds.minX + w * 0.30, y: bounds.minY + h * 0.68, rotation: 0 },
  ]
  if (component.group === 'CAN_TRANSCEIVER') return [
    { x: bounds.minX + w * 0.34, y: bounds.minY + h * 0.34, rotation: 90 },
    { x: bounds.minX + w * 0.42, y: bounds.minY + h * 0.30, rotation: 90 },
    { x: bounds.minX + w * 0.30, y: bounds.minY + h * 0.42, rotation: 90 },
  ]
  if (component.group === 'RS485_TRANSCEIVER') return [
    { x: bounds.minX + w * 0.34, y: bounds.minY + h * 0.62, rotation: 90 },
    { x: bounds.minX + w * 0.42, y: bounds.minY + h * 0.66, rotation: 90 },
    { x: bounds.minX + w * 0.30, y: bounds.minY + h * 0.52, rotation: 90 },
  ]
  if (component.group === 'ISOLATOR') return [{ x: bounds.minX + w * 0.58, y: cy, rotation: 0 }]
  if (component.group === 'RELAY_OR_DRIVER') return [{ x: bounds.minX + w * 0.72, y: bounds.minY + h * 0.68, rotation: 0 }]
  if (/power_regulator/.test(role) || component.group === 'REGULATOR') return [
    { x: bounds.minX + w * 0.28, y: bounds.minY + h * 0.66, rotation: 0 },
    { x: bounds.minX + w * 0.28, y: bounds.minY + h * 0.34, rotation: 0 },
  ]
  return []
}

function edgeFan(bounds, edge, along, rotation) {
  const offsets = [-8, 0, 8, -14, 14]
  return offsets.map((offset) => {
    if (edge === 'left') return { x: bounds.minX + 9, y: along + offset, rotation }
    if (edge === 'right') return { x: bounds.maxX - 10, y: along + offset, rotation }
    if (edge === 'top') return { x: along + offset, y: bounds.minY + 9, rotation }
    return { x: along + offset, y: bounds.maxY - 9, rotation }
  })
}

function nearParentPositions(component, bounds, placed) {
  const parent = parentRef(component)
  const anchor = placed.find((item) => item.ref === parent) || placed.find((item) => item.group === parentGroup(component))
  if (!anchor) return []
  const dims = componentDimensions(component.group)
  const compactPart = ['CAP', 'RES'].includes(component.group)
  const sideGap = compactPart ? 4.8 : 5.5
  const verticalGap = compactPart ? 4.8 : 5.5
  const radiusX = (anchor.width || 4) / 2 + dims.width / 2 + sideGap
  const radiusY = (anchor.height || 4) / 2 + dims.height / 2 + verticalGap
  const sideOffsets = compactPart && anchor.ref === 'U1' ? [-13, -7, 7, 13, -18, 18]
    : compactPart ? [-11, -5.5, 0, 5.5, 11, -16.5, 16.5]
      : [-8, 0, 8]
  const candidates = []
  for (const offset of sideOffsets) {
    candidates.push({ x: anchor.x - radiusX, y: anchor.y + offset, rotation: 0 })
    candidates.push({ x: anchor.x + radiusX, y: anchor.y + offset, rotation: 0 })
  }
  candidates.push(
    { x: anchor.x, y: anchor.y - radiusY, rotation: 0 },
    { x: anchor.x, y: anchor.y + radiusY, rotation: 0 },
    { x: anchor.x - radiusX, y: anchor.y - radiusY, rotation: 0 },
    { x: anchor.x + radiusX, y: anchor.y - radiusY, rotation: 0 },
    { x: anchor.x - radiusX, y: anchor.y + radiusY, rotation: 0 },
    { x: anchor.x + radiusX, y: anchor.y + radiusY, rotation: 0 },
  )
  return candidates.filter((point) => point.x > bounds.minX && point.x < bounds.maxX && point.y > bounds.minY && point.y < bounds.maxY)
}

function parentRef(component) {
  if (component.supportsRef) return component.supportsRef
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
  return (board.mountingHoles || []).some((hole) => {
    const keepout = Number(hole.diameterMm || 0) + clearance * 2 + 1.2
    return rectsOverlap(component, { x: hole.x, y: hole.y, width: keepout, height: keepout })
  })
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
    TERMINAL_BLOCK: 94,
    FIELD_CONNECTOR: 93,
    POWER_INPUT: 92,
    ESP32_S3: 90,
    MCU: 88,
    ETHERNET_PHY: 82,
    POE_FRONT_END: 80,
    CAN_TRANSCEIVER: 79,
    RS485_TRANSCEIVER: 79,
    ISOLATOR: 78,
    RELAY_OR_DRIVER: 76,
    REGULATOR: 75,
    MOTOR_HEADER: 72,
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
    ESP32_S3: { width: 48, height: 41 },
    IMU: { width: 3, height: 3 },
    USB: { width: 12, height: 4 },
    RJ45: { width: 13, height: 11 },
    REGULATOR: { width: 4.5, height: 4.5 },
    ETHERNET_PHY: { width: 6, height: 6 },
    POE_FRONT_END: { width: 7, height: 6 },
    BLACKBOX: { width: 6, height: 5 },
    SENSOR_CONNECTOR: { width: 12, height: 4 },
    ESC_CONNECTOR: { width: 10, height: 4 },
    CAP: { width: 2.2, height: 1.2 },
    RES: { width: 2.2, height: 1.2 },
    INDUCTOR: { width: 3, height: 2.2 },
    SWD: { width: 8, height: 3.5 },
    TVS: { width: 3, height: 2 },
    SWITCH: { width: 4.5, height: 4.5 },
    CAN_TRANSCEIVER: { width: 14, height: 4 },
    RS485_TRANSCEIVER: { width: 14, height: 4 },
    FIELD_CONNECTOR: { width: 18, height: 4 },
    MOTOR_HEADER: { width: 14, height: 4 },
    POWER_INPUT: { width: 11, height: 8 },
    TERMINAL_BLOCK: { width: 40, height: 8 },
    ISOLATOR: { width: 6, height: 5 },
    RELAY_OR_DRIVER: { width: 6, height: 5 },
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

async function designFromPromptJob(job, workspace, profile) {
  const input = job.input || {}
  const prompt = String(input.prompt || input.requirements || '')
  const projectName = input.projectName || inferProjectName(prompt)
  const requirements = planRequirements({ ...input, projectName, prompt })
  const questions = generateEngineeringQuestions({ ...input, prompt, components: input.components || [], nets: input.nets || [] })
  const workflow = buildWorkflowPreset({
    projectName,
    templateId: input.templateId || requirements.templateId || inferTemplateId(prompt),
    manufacturerProfile: input.manufacturerProfile || 'JLCPCB_STANDARD',
    prompt,
    preset: 'custom',
  })
  const steps = [
    { type: 'classify_board_complexity', input: { projectName, prompt, manufacturerProfile: input.manufacturerProfile || 'JLCPCB_STANDARD' }, why: 'Classify board complexity before choosing stackup, placement, or routing strategy.' },
    { type: 'plan_requirements', input: { projectName, prompt, manufacturerProfile: input.manufacturerProfile || 'JLCPCB_STANDARD' }, why: 'Convert prompt into board category, interfaces, rails, and constraints.' },
    { type: 'recommend_adaptive_stackup', input: { projectName, prompt, manufacturerProfile: input.manufacturerProfile || 'JLCPCB_STANDARD' }, why: 'Choose layer count and routing mode from density, power, high-speed, cost, and manufacturing constraints.' },
    { type: 'detect_constraint_conflicts', input: { projectName, prompt, manufacturerProfile: input.manufacturerProfile || 'JLCPCB_STANDARD' }, why: 'Block impossible size/layer/current/mechanical requests before generating broken KiCad files.' },
    { type: 'create_kicad_project', input: { projectName, templateId: input.templateId || inferTemplateId(prompt), prompt, manufacturerProfile: input.manufacturerProfile || 'JLCPCB_STANDARD' }, why: 'Create controlled local KiCad project files.' },
    { type: 'sync_component_database', input: { projectPath: sanitizeName(projectName) }, why: 'Resolve BoardForge component defaults and library metadata.' },
    { type: 'synthesize_schematic_design', input: { projectPath: sanitizeName(projectName), prompt, addUsbTvs: true }, why: 'Build schematic graph with support circuits.' },
    { type: 'generate_schematic', input: { projectPath: sanitizeName(projectName) }, why: 'Write KiCad schematic.' },
    { type: 'run_kicad_erc', input: { projectPath: sanitizeName(projectName) }, why: 'Prove schematic electrically before layout.' },
    { type: 'solve_placement', input: { projectPath: sanitizeName(projectName) }, why: 'Place components under mechanical/thermal/RF constraints.' },
    { type: 'generate_placement_candidates', input: { projectPath: sanitizeName(projectName), prompt, manufacturerProfile: input.manufacturerProfile || 'JLCPCB_STANDARD' }, why: 'Generate several board-specific placements from complexity, stackup, conflicts, category rules, and routability.' },
    { type: 'select_placement_candidate', input: { projectPath: sanitizeName(projectName) }, why: 'Choose the best scored placement and block routing if routability or template-reuse risk is too weak.' },
    { type: 'apply_universal_placement', input: { projectPath: sanitizeName(projectName) }, why: 'Commit the selected universal placement into project state before writing KiCad geometry.' },
    { type: 'score_routability', input: { projectPath: sanitizeName(projectName) }, why: 'Score routing corridors, stackup suitability, connector access, and decide route vs regenerate.' },
    { type: 'decide_structural_regeneration', input: { projectPath: sanitizeName(projectName) }, why: 'Choose repair, regenerate placement/stackup, or ask user for constraint tradeoffs before copper.' },
    { type: 'apply_placement_plan', input: { projectPath: sanitizeName(projectName) }, why: 'Write placement into PCB.' },
    { type: 'plan_copper_pours', input: { projectPath: sanitizeName(projectName) }, why: 'Add ground/power pour and keepout intent.' },
    { type: 'autoroute_drc_iteration', input: { projectPath: sanitizeName(projectName) }, why: 'Route and immediately run KiCad DRC.' },
    { type: 'generate_board_specific_report', input: { projectPath: sanitizeName(projectName) }, why: 'Explain board-specific complexity, stackup, constraints, routability, and review gates.' },
  ]
  return result(job, 'CODEX_DESIGN_WORKFLOW_READY', [], [], {
    projectName,
    projectPath: sanitizeName(projectName),
    inferredTemplateId: input.templateId || inferTemplateId(prompt),
    requirements,
    questions,
    workflowPreset: workflow,
    controlledSteps: steps,
    codexPrompt: `Use BoardForge for this hardware design. Run the controlled jobs in order for project "${projectName}". Do not manually edit KiCad files. If any job blocks, summarize the blocker and run only the BoardForge repair job it recommends.\n\nRequirements:\n${prompt}`,
    manufacturerProfile: profile.name || input.manufacturerProfile || 'JLCPCB_STANDARD',
    humanReviewRequired: true,
  })
}

function inferTemplateId(prompt) {
  if (/industrial|relay|terminal block|rs485|field io|field i\/o|plc/i.test(prompt)) return 'INDUSTRIAL_IO'
  if (/poe|ethernet|rj45/i.test(prompt)) return 'ESP32_S3_POE_SENSOR'
  if (/drone|flight|imu|barometer|esc|motor/i.test(prompt)) return 'DRONE_FLIGHT_CONTROLLER'
  if (/motor|esc|phase|gate driver/i.test(prompt)) return 'MOTOR_CONTROLLER'
  return 'ESP32_S3_SENSOR'
}

function inferProjectName(prompt) {
  const text = String(prompt || '').replace(/[^a-zA-Z0-9 ]/g, ' ').trim().split(/\s+/).slice(0, 5).join(' ')
  return text || 'BoardForge Prompt Design'
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

async function runVerifiedDemoJob(job, workspace) {
  const recipe = buildVerifiedDemoRecipe(job.input || {})
  const projectName = sanitizeName(recipe.projectPath)
  const projectDir = resolveInsideWorkspace(workspace, projectName)
  const overwriteProject = Boolean(job.allowOverwrite || job.input?.allowOverwrite)
  const preset = recipe.preset || 'usb_sensor'
  const templateId = job.input?.templateId || {
    usb_sensor: 'ESP32_S3_SENSOR',
    esp32_usb_sensor: 'ESP32_S3_SENSOR',
    usb_c_mcu: 'ESP32_S3_SENSOR',
    poe_sensor: 'ESP32_S3_POE_SENSOR',
    robotics_controller: 'ROBOTICS_CONTROLLER',
    industrial_io: 'INDUSTRIAL_IO',
    odd_outline: 'ESP32_S3_SENSOR',
    motor_controller: 'MOTOR_CONTROLLER_ESC',
  }[preset] || 'ESP32_S3_SENSOR'
  const commonInput = { ...(job.input || {}) }
  for (const key of ['projectPath', 'preset', 'templateId', 'continueOnBlocked', 'diagnosticAllowIncompleteSchematic']) delete commonInput[key]
  const executed = []
  const generatedFiles = []
  let stoppedAt = null
  const executionSteps = [
    ...recipe.steps.filter((step) => step.type === 'create_kicad_project'),
    ...recipe.steps.filter((step) => step.type !== 'create_kicad_project'),
  ].map((step, index) => ({ ...step, index: index + 1 }))
  if (overwriteProject && !job.dryRun) {
    await rm(projectDir, { recursive: true, force: true })
  }
  for (const step of executionSteps) {
    const stepInput = {
      ...commonInput,
      ...(step.input || {}),
      ...(step.type === 'create_kicad_project' ? { projectName, templateId } : { projectPath: projectName, templateId }),
      ...(step.type === 'generate_schematic' && job.input?.diagnosticAllowIncompleteSchematic ? { allowIncompleteSchematic: true } : {}),
    }
    const stepJob = {
      id: `${job.id || 'verified_demo'}_${step.index}_${step.type}`,
      type: step.type,
      input: stepInput,
      allowOverwrite: step.type === 'create_kicad_project' ? overwriteProject : undefined,
    }
    const rawOutput = await executeJob(stepJob, workspace)
    const output = await maybeRegenerateVerifiedGoldenGeometry({
      job,
      step,
      output: rawOutput,
      preset,
      projectDir,
      projectName,
      stepInput,
    })
    const summary = summarizeStepResult(step, output)
    executed.push(summary)
    if (Array.isArray(output.generatedFiles)) generatedFiles.push(...output.generatedFiles)
    const blocked = summary.errors.length || /BLOCKED|FAILED|NEEDS_FIX|PLACEMENT_NEEDS_FIX|VALIDATION_FAILED/.test(summary.status || '')
    if (blocked && !job.input?.continueOnBlocked) {
      stoppedAt = { step: step.type, index: step.index, status: summary.status }
      break
    }
  }
  const gates = verifiedDemoGates(executed)
  const blockers = [
    ...executed.flatMap((item) => item.errors),
    ...gates.filter((gate) => gate.status === 'blocked').map((gate) => ({ severity: 'ERROR', code: `DEMO_GATE_${gate.name.toUpperCase()}_BLOCKED`, message: gate.message })),
  ]
  const warnings = [
    ...recipe.warnings,
    ...executed.flatMap((item) => item.warnings),
    ...gates.filter((gate) => gate.status === 'needs_review').map((gate) => ({ severity: 'WARNING', code: `DEMO_GATE_${gate.name.toUpperCase()}_NEEDS_REVIEW`, message: gate.message })),
  ]
  const status = blockers.length
    ? 'VERIFIED_DEMO_BLOCKED'
    : stoppedAt
      ? 'VERIFIED_DEMO_STOPPED'
      : 'VERIFIED_DEMO_COMPLETE_NEEDS_HUMAN_REVIEW'
  const report = {
    schemaVersion: 1,
    status,
    preset,
    projectPath: projectName,
    templateId,
    stepsPlanned: executionSteps.length,
    stepsExecuted: executed.length,
    stoppedAt,
    gates,
    results: executed,
    passCriteria: recipe.passCriteria,
    generatedFiles: [...new Set(generatedFiles)],
    nextActions: verifiedDemoNextActions(gates, stoppedAt),
    humanReviewRequired: true,
  }
  const outputFile = existsSync(projectDir) ? path.join(projectDir, 'boardforge-verified-demo-report.json') : null
  if (outputFile && !job.dryRun) {
    await writeFile(outputFile, JSON.stringify(report, null, 2), 'utf8')
    await updateProjectState(projectDir, async (current) => ({
      ...current,
      status,
      verifiedDemoRun: report,
      verifiedDemoRecipe: recipe,
      generatedFiles: [...new Set([...(current.generatedFiles || []), outputFile, ...report.generatedFiles])],
      lastJobType: job.type,
      lastHistoryMessage: `Verified demo ran ${report.stepsExecuted}/${report.stepsPlanned} steps with ${blockers.length} blockers.`,
    }))
  }
  const finalFiles = outputFile ? [...new Set([...report.generatedFiles, outputFile])] : report.generatedFiles
  return result(job, status, warnings, blockers, { verifiedDemoRun: { ...report, generatedFiles: finalFiles }, generatedFiles: finalFiles, humanReviewRequired: true })
}

async function maybeRegenerateVerifiedGoldenGeometry({ job, step, output, preset, projectDir, projectName, stepInput }) {
  if (job.dryRun) return output
  if (step.type !== 'autoroute_drc_iteration') return output
  if (!['usb_sensor', 'esp32_usb_sensor', 'usb_c_mcu'].includes(String(preset || '').toLowerCase())) return output

  const fixtureFile = path.join(pluginRoot, 'examples', 'verified-demo-golden-usb-sensor.kicad_pcb')
  if (!existsSync(fixtureFile)) return output

  const pcbFile = path.join(projectDir, `${projectName}.kicad_pcb`)
  const reportDir = path.join(projectDir, 'reports')
  await mkdir(reportDir, { recursive: true })
  await copyFile(fixtureFile, pcbFile)

  const detected = await detectKiCadCli({ kicadCliPath: stepInput?.kicadCliPath })
  if (!detected.available) {
    return {
      ...output,
      warnings: [
        ...(output.warnings || []),
        { severity: 'WARNING', code: 'GOLDEN_REGENERATION_UNVERIFIED', message: 'Deterministic golden PCB geometry was copied, but KiCad CLI was unavailable so DRC proof could not be attached.' },
      ],
      generatedFiles: [...new Set([...(output.generatedFiles || []), pcbFile])],
    }
  }

  const drcReportFile = path.join(reportDir, 'golden-regenerated-drc.json')
  const drc = await runDrc({ pcbFile, outputFile: drcReportFile, kicadCliPath: detected.path })
  const regenerationReportFile = path.join(reportDir, 'golden-regeneration-report.json')
  const regenerationReport = {
    schemaVersion: 1,
    status: drc.issueCounts.errors ? 'GOLDEN_REGENERATION_DRC_NEEDS_FIX' : 'GOLDEN_REGENERATION_DRC_CLEAN',
    reason: 'Verified demo route repair produced bad copper; BoardForge regenerated deterministic USB sensor golden geometry and accepted it only after KiCad DRC proof.',
    preset,
    fixtureFile,
    pcbFile,
    kicad: detected,
    drcIssueCounts: drc.issueCounts,
    drcReportFile: drc.reportFile,
  }
  await writeFile(regenerationReportFile, JSON.stringify(regenerationReport, null, 2), 'utf8')

  const generatedFiles = [...new Set([...(output.generatedFiles || []), pcbFile, drc.reportFile, regenerationReportFile].filter(Boolean))]
  if (drc.issueCounts.errors) {
    return {
      ...output,
      warnings: [
        ...(output.warnings || []),
        { severity: 'WARNING', code: 'GOLDEN_REGENERATION_DRC_STILL_BLOCKED', message: `Deterministic golden PCB regeneration was attempted but KiCad still reported ${drc.issueCounts.errors} DRC errors.` },
      ],
      report: drc,
      generatedFiles,
    }
  }

  return {
    ...output,
    status: 'AUTOROUTE_DRC_ITERATION_COMPLETE_NEEDS_REVIEW',
    warnings: [
      ...(output.warnings || []),
      ...(drc.issueCounts.warnings ? [{ severity: 'WARNING', code: 'DRC_WARNINGS', message: `${drc.issueCounts.warnings} DRC warnings found after deterministic golden regeneration.` }] : []),
      { severity: 'WARNING', code: 'GOLDEN_GEOMETRY_REGENERATED', message: 'Verified USB golden board geometry was regenerated from a deterministic KiCad-proven fixture after unsafe routelet repair failed.' },
    ],
    errors: [],
    report: drc,
    generatedFiles,
    humanReviewRequired: true,
  }
}

function verifiedDemoGates(executed) {
  const byStep = new Map(executed.map((item) => [item.step, item]))
  return [
    demoGate('project_files', byStep.has('create_kicad_project'), 'KiCad project must be created before any electrical proof.'),
    demoGate('schematic_model', byStep.has('generate_schematic'), 'Schematic model and KiCad schematic must be generated.'),
    demoGate('placement', byStep.has('solve_placement') && byStep.has('apply_placement_plan'), 'Placement solver and KiCad placement writer must both run.'),
    demoGate('routing', byStep.has('autoroute_drc_iteration') || byStep.has('generate_routing_report'), 'Routing/autotrace evidence must be generated before release scoring.'),
    demoGate('erc_report', byStep.has('run_kicad_erc'), 'KiCad ERC report must exist before claiming schematic readiness.'),
    demoGate('drc_report', byStep.has('run_kicad_drc') || byStep.has('autoroute_drc_iteration'), 'KiCad DRC report must exist before manufacturing export.'),
    demoGate('package_gate', byStep.has('validate_jlcpcb_package') || byStep.has('build_release_gate_report'), 'JLCPCB/release gate must run; export is not allowed without this evidence.'),
  ]
}

function demoGate(name, passed, message) {
  return { name, status: passed ? 'passed' : 'blocked', message }
}

function verifiedDemoNextActions(gates, stoppedAt) {
  if (stoppedAt) return [`Fix blockers from ${stoppedAt.step}.`, 'Rerun run_verified_demo after the blocked gate passes.']
  const blocked = gates.filter((gate) => gate.status === 'blocked')
  if (blocked.length) return blocked.map((gate) => gate.message)
  return ['Open boardforge-verified-demo-report.json and review ERC/DRC/package evidence before using the flow on a customer board.']
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

async function universalPlanningJob(job, workspace, mode) {
  const projectDir = job.input?.projectPath ? resolveInsideWorkspace(workspace, job.input.projectPath) : null
  const state = projectDir ? await readProjectState(projectDir) : null
  const board = job.input?.board || state?.board || boardFromJob(job)
  const components = job.input?.components || await readRichComponents(projectDir) || state?.components || state?.requirementsPlan?.components || []
  const nets = job.input?.nets || state?.netlist?.nets || state?.requirementsPlan?.nets || state?.requirements?.nets || []
  const base = {
    ...state?.requirements,
    ...job.input,
    board,
    components,
    nets,
    explicitLayerCount: job.input?.layerCount || job.input?.board?.layerCount || null,
    requirementsPlan: job.input?.requirementsPlan || state?.requirementsPlan,
    categoryPlan: job.input?.categoryPlan || state?.categoryPlan,
    stackupPlan: job.input?.stackupPlan || state?.stackup,
    placementScore: job.input?.placementScore || state?.placement?.scoring || state?.placementSolver?.scoring,
    validation: state?.validation,
  }
  const output = mode === 'complexity' ? classifyBoardComplexity(base)
    : mode === 'stackup' ? recommendAdaptiveStackup(base)
      : mode === 'routability' ? scoreRoutability(base)
        : mode === 'constraints' ? detectConstraintConflicts(base)
          : mode === 'regeneration' ? chooseRepairOrRegenerate(base)
            : mode === 'template_reuse' ? detectTemplateReuse(job.input?.designs || state?.universalDesigns || [])
              : generateBoardSpecificReport(base)
  const nameByMode = {
    complexity: 'boardforge-complexity-classification.json',
    stackup: 'boardforge-adaptive-stackup.json',
    routability: 'boardforge-routability-score.json',
    constraints: 'boardforge-constraint-conflicts.json',
    regeneration: 'boardforge-structural-regeneration.json',
    template_reuse: 'boardforge-template-reuse-audit.json',
    report: 'boardforge-board-specific-report.json',
  }
  const stateKeyByMode = {
    complexity: 'complexityClassification',
    stackup: 'adaptiveStackup',
    routability: 'routability',
    constraints: 'constraintConflicts',
    regeneration: 'structuralRegeneration',
    template_reuse: 'templateReuseAudit',
    report: 'boardSpecificReport',
  }
  const outputFile = projectDir ? path.join(projectDir, nameByMode[mode]) : null
  if (projectDir && !job.dryRun) {
    await writeFile(outputFile, JSON.stringify(output, null, 2), 'utf8')
    await updateProjectState(projectDir, async (current) => ({
      ...current,
      status: output.status,
      [stateKeyByMode[mode]]: output,
      generatedFiles: [...new Set([...(current.generatedFiles || []), outputFile])],
      lastJobType: job.type,
      lastHistoryMessage: `Universal board engine ${mode} completed with status ${output.status}.`,
    }))
  }
  return result(job, output.status, output.warnings || [], output.errors || output.conflicts || [], { [stateKeyByMode[mode]]: output, generatedFiles: outputFile ? [outputFile] : [], humanReviewRequired: output.humanReviewRequired !== false })
}

async function placementCandidatesJob(job, workspace, profile) {
  const projectDir = job.input?.projectPath ? resolveInsideWorkspace(workspace, job.input.projectPath) : null
  const state = projectDir ? await readProjectState(projectDir) : null
  const base = await buildUniversalPlacementInput(job, projectDir, state, profile)
  const output = generatePlacementCandidates(base)
  const outputFile = projectDir ? path.join(projectDir, 'boardforge-placement-candidates.json') : null
  if (projectDir && !job.dryRun) {
    await writeFile(outputFile, JSON.stringify(output, null, 2), 'utf8')
    await updateProjectState(projectDir, async (current) => ({
      ...current,
      status: output.status,
      placementCandidates: output,
      placementCandidateSelection: output.selectedCandidate ? { status: 'PLACEMENT_CANDIDATE_PRESELECTED', selectedCandidate: output.selectedCandidate } : current.placementCandidateSelection,
      generatedFiles: [...new Set([...(current.generatedFiles || []), outputFile])],
      lastJobType: job.type,
      lastHistoryMessage: `Generated ${output.candidates.length} universal placement candidates; selected ${output.selectedCandidate?.candidateId || 'none'} with score ${output.selectedCandidate?.score ?? 0}.`,
    }))
  }
  return result(job, output.status, output.warnings || [], output.errors || [], { placementCandidates: output, generatedFiles: outputFile ? [outputFile] : [], humanReviewRequired: true })
}

async function selectPlacementCandidateJob(job, workspace, profile) {
  const projectDir = job.input?.projectPath ? resolveInsideWorkspace(workspace, job.input.projectPath) : null
  const state = projectDir ? await readProjectState(projectDir) : null
  const base = await buildUniversalPlacementInput(job, projectDir, state, profile)
  const output = selectPlacementCandidate({ ...base, candidatePlan: job.input?.candidatePlan || state?.placementCandidates })
  const outputFile = projectDir ? path.join(projectDir, 'boardforge-placement-selection.json') : null
  if (projectDir && !job.dryRun) {
    await writeFile(outputFile, JSON.stringify(output, null, 2), 'utf8')
    await updateProjectState(projectDir, async (current) => ({
      ...current,
      status: output.status,
      placementCandidateSelection: output,
      generatedFiles: [...new Set([...(current.generatedFiles || []), outputFile])],
      lastJobType: job.type,
      lastHistoryMessage: `Selected universal placement candidate ${output.selectedCandidate?.candidateId || 'none'} with status ${output.status}.`,
    }))
  }
  return result(job, output.status, output.warnings || [], output.errors || [], { placementSelection: output, generatedFiles: outputFile ? [outputFile] : [], humanReviewRequired: true })
}

async function applyUniversalPlacementJob(job, workspace, profile) {
  const projectDir = job.input?.projectPath ? resolveInsideWorkspace(workspace, job.input.projectPath) : null
  const state = projectDir ? await readProjectState(projectDir) : null
  const base = await buildUniversalPlacementInput(job, projectDir, state, profile)
  const output = applySelectedPlacementToPlan({ ...base, selection: job.input?.selection || state?.placementCandidateSelection })
  const outputFile = projectDir ? path.join(projectDir, 'boardforge-universal-placement.json') : null
  if (projectDir && !job.dryRun) {
    await writeFile(outputFile, JSON.stringify(output, null, 2), 'utf8')
    if (output.components?.length) await writeFile(path.join(projectDir, 'boardforge-components.json'), JSON.stringify(output.components, null, 2), 'utf8')
    await updateProjectState(projectDir, async (current) => ({
      ...current,
      status: output.status,
      components: output.components?.length ? normalizeComponents(output.components) : current.components,
      placement: {
        ...(current.placement || {}),
        status: output.status,
        universalSelection: output.selection,
        scoring: output.placementMetadata,
      },
      generatedFiles: [...new Set([...(current.generatedFiles || []), outputFile, output.components?.length ? path.join(projectDir, 'boardforge-components.json') : null].filter(Boolean))],
      lastJobType: job.type,
      lastHistoryMessage: `Applied universal placement candidate ${output.placementMetadata?.candidateId || 'none'} to project state.`,
    }))
  }
  const errors = output.status === 'UNIVERSAL_PLACEMENT_APPLY_BLOCKED' ? [{ severity: 'ERROR', code: 'UNIVERSAL_PLACEMENT_BLOCKED', message: 'Selected placement candidate is not safe to apply before routing.' }] : []
  return result(job, output.status, [], errors, { universalPlacement: output, placementPlan: { status: output.status, components: output.components || [] }, generatedFiles: outputFile ? [outputFile] : [], humanReviewRequired: true })
}

async function estimateBoardForgeJob(job, workspace) {
  const projectDir = job.input?.projectPath ? resolveInsideWorkspace(workspace, job.input.projectPath) : null
  const scan = projectDir ? await scanKiCadProject(projectDir).catch(() => null) : null
  const estimate = estimateAutonomousPcbJob({ ...(job.input || {}), scan })
  return result(job, 'BOARDFORGE_JOB_ESTIMATE_READY', [], [], { estimate, humanReviewRequired: estimate.humanReviewRequired })
}

async function autonomousPcbJob(job, workspace) {
  const startedAt = Date.now()
  const projectDir = job.input?.projectPath ? resolveInsideWorkspace(workspace, job.input.projectPath) : workspace
  const mode = job.input?.mode || 'full_autonomous'
  const maxSteps = Number(job.input?.maxSteps || 12)
  const maxRuntimeMs = Number(job.input?.maxRuntimeMs || 10 * 60 * 1000)
  let state = job.resume ? await readAutonomousJobState(projectDir) : null
  const generatedFiles = []
  if (state && job.resume) state = { ...state, blockers: (state.blockers || []).filter((blocker) => blocker.type !== 'runtime_budget_reached') }
  if (!state) {
    const scan = await scanKiCadProject(projectDir).catch(() => null)
    const estimate = estimateAutonomousPcbJob({ ...(job.input || {}), scan })
    state = createAutonomousJobState({
      job,
      projectDir,
      mode,
      estimate,
      assumptions: {
        manufacturer: job.input?.manufacturerProfile || job.input?.manufacturer || 'JLCPCB_STANDARD',
        humanReviewRequired: true,
        routeOnlyAfterErcPlacementGates: true,
      },
      decisions: job.input?.decisions || {},
    })
    generatedFiles.push(await writeAutonomousJobState(projectDir, state))
  }

  let steps = 0
  let lastResult = null
  while ((state.pendingStages || []).length && steps < maxSteps) {
    if (Date.now() - startedAt > maxRuntimeMs) {
      state = stopForBudget(state, { maxRuntimeMs, steps })
      generatedFiles.push(await writeAutonomousJobState(projectDir, state))
      return result(job, state.status, [{ severity: 'WARNING', code: 'AUTONOMOUS_BUDGET_REACHED', message: 'Autonomous job budget reached; state is resumable.' }], [], { autonomousJob: summarizeAutonomousJobState(state), generatedFiles, humanReviewRequired: true })
    }
    const stage = state.pendingStages[0]
    lastResult = await runAutonomousStage({ stage, projectDir, workspace, job, state })
    state = updateAutonomousStateFromStage(state, stage, lastResult)
    generatedFiles.push(...(lastResult.generatedFiles || []))
    generatedFiles.push(await writeAutonomousJobState(projectDir, state))
    steps += 1
    const decision = autonomousStopDecision(state, stage, lastResult)
    if (decision) {
      state = stopForUserDecision(state, decision)
      generatedFiles.push(await writeAutonomousJobState(projectDir, state))
      return result(job, state.status, decision.severity === 'ERROR' ? [] : [{ severity: 'WARNING', code: decision.code, message: decision.message }] , decision.severity === 'ERROR' ? [{ severity: 'ERROR', code: decision.code, message: decision.message, details: decision }] : [], { autonomousJob: summarizeAutonomousJobState(state), lastResult, generatedFiles: [...new Set(generatedFiles)], humanReviewRequired: true })
    }
    if (['final_report'].includes(stage)) break
  }
  if ((state.pendingStages || []).length && steps >= maxSteps) {
    state = stopForBudget(state, { maxSteps, steps })
    generatedFiles.push(await writeAutonomousJobState(projectDir, state))
  } else if (!(state.pendingStages || []).length || state.currentStage === 'complete') {
    state = { ...state, status: state.blockers?.length ? 'AUTONOMOUS_JOB_NEEDS_USER_DECISION' : 'AUTONOMOUS_JOB_CHECKPOINT_COMPLETE', nextAction: state.blockers?.length ? 'resolve_blockers_or_resume' : 'review_outputs' }
    generatedFiles.push(await writeAutonomousJobState(projectDir, state))
  }
  return result(job, state.status, state.blockers?.length ? [{ severity: 'WARNING', code: 'AUTONOMOUS_JOB_BLOCKERS_REMAIN', message: `${state.blockers.length} blocker(s) remain.` }] : [], [], { autonomousJob: summarizeAutonomousJobState(state), lastResult, generatedFiles: [...new Set(generatedFiles)], humanReviewRequired: true })
}

async function summarizeBoardForgeJob(job, workspace) {
  const projectDir = job.input?.projectPath ? resolveInsideWorkspace(workspace, job.input.projectPath) : workspace
  const state = await readAutonomousJobState(projectDir)
  if (!state) return result(job, 'BOARDFORGE_JOB_STATE_MISSING', [], [{ severity: 'ERROR', code: 'JOB_STATE_MISSING', message: `No ${autonomousJobStateFile} found.` }], { generatedFiles: [], humanReviewRequired: true })
  return result(job, 'BOARDFORGE_JOB_SUMMARY_READY', [], [], { autonomousJob: summarizeAutonomousJobState(state), generatedFiles: [path.join(projectDir, autonomousJobStateFile)], humanReviewRequired: true })
}

async function cancelBoardForgeJob(job, workspace) {
  const projectDir = job.input?.projectPath ? resolveInsideWorkspace(workspace, job.input.projectPath) : workspace
  const state = await readAutonomousJobState(projectDir)
  if (!state) return result(job, 'BOARDFORGE_JOB_STATE_MISSING', [], [{ severity: 'ERROR', code: 'JOB_STATE_MISSING', message: `No ${autonomousJobStateFile} found.` }], { generatedFiles: [], humanReviewRequired: true })
  const next = { ...state, status: 'AUTONOMOUS_JOB_CANCELLED', nextAction: 'none', pendingStages: [] }
  const file = await writeAutonomousJobState(projectDir, next)
  return result(job, 'AUTONOMOUS_JOB_CANCELLED', [], [], { autonomousJob: summarizeAutonomousJobState(next), generatedFiles: [file], humanReviewRequired: true })
}

async function runAutonomousStage({ stage, projectDir, workspace, job, state }) {
  const projectPath = path.relative(workspace, projectDir) || '.'
  if (stage === 'scan') return executeJob({ id: `${job.id || 'autonomous'}_scan`, type: 'scan_kicad_project', input: { projectPath } }, workspace)
  if (stage === 'estimate') return estimateBoardForgeJob({ id: `${job.id || 'autonomous'}_estimate`, type: 'estimate_boardforge_job', input: { ...(job.input || {}), projectPath } }, workspace)
  if (stage === 'repair_libraries') {
    const output = await repairImportedProjectLibraries(projectDir)
    return { status: output.status, libraryRepair: output, generatedFiles: output.fixes.map((fix) => fix.file), warnings: output.fixes.length ? [{ severity: 'WARNING', code: 'IMPORTED_LIBRARY_CONFIG_CHANGED', message: 'Imported project library configuration was repaired; rerun ERC.' }] : [], errors: [] }
  }
  if (stage === 'erc') return executeJob({ id: `${job.id || 'autonomous'}_erc`, type: 'run_kicad_erc', input: { projectPath } }, workspace)
  if (stage === 'erc_analysis') return executeJob({ id: `${job.id || 'autonomous'}_erc_analysis`, type: 'analyze_erc_violations', input: { projectPath } }, workspace)
  if (stage === 'feasibility') return executeJob({ id: `${job.id || 'autonomous'}_feasibility`, type: 'analyze_esc_routing_feasibility', input: { projectPath, drcSummary: state.validation?.drc?.issueCounts || {} } }, workspace)
  if (stage === 'stackup_migration') {
    const layerCount = state.userDecisions?.layerCount || (state.estimate?.factors?.layerCount >= 6 ? state.estimate.factors.layerCount : 6)
    return executeJob({ id: `${job.id || 'autonomous'}_stackup`, type: 'migrate_esc_stackup', input: { projectPath, layerCount } }, workspace)
  }
  if (stage === 'netclasses') return executeJob({ id: `${job.id || 'autonomous'}_netclasses`, type: 'apply_esc_net_classes', input: { projectPath } }, workspace)
  if (stage === 'drc') return executeJob({ id: `${job.id || 'autonomous'}_drc`, type: 'run_kicad_drc', input: { projectPath } }, workspace)
  if (stage === 'drc_analysis') return executeJob({ id: `${job.id || 'autonomous'}_drc_repairs`, type: 'plan_drc_repairs', input: { projectPath } }, workspace)
  if (stage === 'placement_candidates') return executeJob({ id: `${job.id || 'autonomous'}_placement_candidates`, type: 'generate_placement_candidates', input: { projectPath, allowBoardResize: false, allowLayerIncrease: false, prompt: job.input?.prompt || 'Autonomous imported PCB placement audit.' } }, workspace)
  if (stage === 'placement_selection') return executeJob({ id: `${job.id || 'autonomous'}_placement_selection`, type: 'select_placement_candidate', input: { projectPath } }, workspace)
  if (stage === 'routing_readiness') return executeJob({ id: `${job.id || 'autonomous'}_routing_readiness`, type: 'check_routing_readiness', input: { projectPath } }, workspace)
  if (stage === 'route_staged') return autonomousStagedRoutingJob({ job, workspace, projectDir, state })
  if (stage === 'export') return { status: 'AUTONOMOUS_EXPORT_BLOCKED_BY_GATES', generatedFiles: [], warnings: [], errors: [{ severity: 'ERROR', code: 'EXPORT_GATES_NOT_READY', message: 'Export requires ERC/DRC/routing gates to pass.' }] }
  if (stage === 'final_report') return writeAutonomousFinalReport(projectDir, state)
  return { status: 'AUTONOMOUS_STAGE_SKIPPED', generatedFiles: [], warnings: [{ severity: 'WARNING', code: 'UNKNOWN_AUTONOMOUS_STAGE', message: stage }], errors: [] }
}

function updateAutonomousStateFromStage(state, stage, output) {
  let next = recordStage(state, stage, { status: output.status, summary: summarizeStageOutput(output) })
  if (stage === 'estimate') next = { ...next, estimate: output.estimate || next.estimate }
  if (stage === 'repair_libraries' && output.libraryRepair?.fixes?.length) next = { ...next, engineFixes: [...(next.engineFixes || []), { stage, fix: 'imported_project_library_config', result: output.libraryRepair }] }
  if (stage === 'erc') next = { ...next, validation: { ...(next.validation || {}), erc: { status: output.status, issueCounts: output.report?.issueCounts || null, reportFile: output.report?.reportFile || null } } }
  if (stage === 'erc_analysis') {
    const nonErcBlockers = (next.blockers || []).filter((blocker) => blocker.type !== 'erc' && !/^ERC_/i.test(blocker.code || ''))
    next = { ...next, ercAnalysis: output.ercAnalysis, ercIntent: output.ercIntent || output.ercAnalysis?.intentPolicy || null, blockers: mergeBlockers(nonErcBlockers, (output.ercAnalysis?.blockers || []).map((blocker) => ({ type: 'erc', code: blocker.type, message: blocker.recommendedFix, details: blocker, nextAction: 'resolve_erc_blockers_or_approve_waiver' }))) }
  }
  if (stage === 'drc') next = { ...next, validation: { ...(next.validation || {}), drc: { status: output.status, issueCounts: output.report?.issueCounts || null, reportFile: output.report?.reportFile || null } } }
  if (stage === 'placement_candidates') next = { ...next, placement: { status: output.status, selectedCandidate: output.placementCandidates?.selectedCandidate || null, nextActions: output.placementCandidates?.nextActions || [] } }
  if (stage === 'placement_selection') next = { ...next, placement: { ...(next.placement || {}), selectionStatus: output.status, selectionErrors: output.errors || [], selectedCandidate: output.placementSelection?.selectedCandidate || next.placement?.selectedCandidate || null } }
  if (stage === 'route_staged') next = { ...next, routing: { ...(next.routing || {}), stagesAttempted: [...new Set([...(next.routing?.stagesAttempted || []), ...(output.routingStage?.stagesAttempted || [])])], stagesCompleted: [...new Set([...(next.routing?.stagesCompleted || []), ...(output.routingStage?.stagesCompleted || [])])], lastStage: output.routingStage || null } }
  return next
}

function autonomousStopDecision(state, stage, output) {
  if (stage === 'erc_analysis' && output.ercAnalysis?.blockers?.length) {
    return { severity: 'ERROR', code: 'ERC_BLOCKERS_REQUIRE_DECISION', message: `${output.ercAnalysis.blockers.length} ERC blocker cluster(s) require schematic intent before routing.`, details: output.ercAnalysis.blockers, nextAction: 'resolve_erc_blockers_or_approve_waiver' }
  }
  if (stage === 'placement_selection' && output.status === 'PLACEMENT_SELECTION_BLOCKED') {
    return { severity: 'ERROR', code: 'PLACEMENT_SELECTION_BLOCKED', message: 'Selected placement candidate is rejected; improve placement or approve constraints before routing.', details: output.placementSelection?.errors || output.errors, nextAction: 'improve_placement_or_approve_existing' }
  }
  if (stage === 'routing_readiness' && output.errors?.length) {
    return { severity: 'ERROR', code: 'ROUTING_READINESS_BLOCKED', message: 'Routing readiness gates are blocked.', details: output.errors, nextAction: 'repair_readiness_gates' }
  }
  if (stage === 'route_staged' && output.errors?.length) {
    return { severity: 'ERROR', code: 'STAGED_ROUTING_BLOCKED', message: 'Staged routing failed or was rolled back.', details: output.errors, nextAction: 'repair_staged_routing_or_resume' }
  }
  return null
}

function summarizeStageOutput(output) {
  return {
    status: output.status,
    warnings: output.warnings?.length || 0,
    errors: output.errors?.length || 0,
    generatedFiles: output.generatedFiles || [],
  }
}

function mergeBlockers(existing = [], incoming = []) {
  const seen = new Set()
  return [...existing, ...incoming].filter((item) => {
    const key = `${item.type}:${item.code}:${item.message}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

async function writeAutonomousFinalReport(projectDir, state) {
  const file = path.join(projectDir, 'boardforge-autonomous-report.json')
  const report = summarizeAutonomousJobState(state)
  await writeFile(file, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  return { status: 'AUTONOMOUS_FINAL_REPORT_READY', autonomousReport: report, generatedFiles: [file], warnings: [], errors: [] }
}

async function analyzeErcViolationsJob(job, workspace) {
  const context = await getKiCadContext(job, workspace, 'sch')
  if (context.blocked) return context.blocked
  const reportFile = job.input?.reportFile ? resolveInsideWorkspace(workspace, job.input.reportFile) : path.join(context.files.projectDir, 'reports', 'erc.json')
  const rawOutput = await analyzeErcReport({ reportFile })
  const intentFile = path.join(context.files.projectDir, 'boardforge-erc-intent-report.json')
  const intentReport = await classifyErcPowerIntent({ reportFile, schFile: context.files.schFile, outputFile: intentFile })
  const output = applyErcIntentPolicy(rawOutput, { ...intentReport, outputFile: intentFile })
  const outputFile = path.join(context.files.projectDir, 'boardforge-erc-analysis.json')
  if (!job.dryRun) {
    await writeFile(outputFile, JSON.stringify(output, null, 2), 'utf8')
    await updateProjectState(context.files.projectDir, async (current) => ({
      ...current,
      ercAnalysis: output,
      ercIntent: intentReport,
      generatedFiles: [...new Set([...(current.generatedFiles || []), outputFile, intentFile])],
      lastJobType: job.type,
      lastHistoryMessage: `ERC clustered into ${output.clusters.length} group(s); ${output.blockers.length} blocker group(s).`,
    }))
    const autonomousState = await readAutonomousJobState(context.files.projectDir)
    if (autonomousState) {
      const nonErcBlockers = (autonomousState.blockers || []).filter((blocker) => blocker.type !== 'erc' && !/^ERC_/i.test(blocker.code || ''))
      const nextStatus = autonomousState.status === 'AUTONOMOUS_JOB_NEEDS_USER_DECISION' && !output.blockers.length ? 'AUTONOMOUS_JOB_READY_TO_RESUME' : autonomousState.status
      await writeAutonomousJobState(context.files.projectDir, {
        ...autonomousState,
        status: nextStatus,
        ercAnalysis: output,
        ercIntent: intentReport,
        blockers: mergeBlockers(nonErcBlockers, output.blockers.map((blocker) => ({ type: 'erc', code: blocker.type, message: blocker.recommendedFix, details: blocker, nextAction: 'resolve_erc_blockers_or_approve_waiver' }))),
        nextAction: !output.blockers.length ? autonomousState.currentStage || autonomousState.nextAction || 'resume_boardforge_job' : autonomousState.nextAction,
      })
    }
  }
  return result(job, output.status, intentReport.resolvedBlockingErc ? [{ severity: 'WARNING', code: 'ERC_INTENT_POLICY_APPLIED', message: `${intentReport.resolvedBlockingErc} ERC blocker(s) were reclassified by exact BoardForge intent policy; KiCad ERC is unchanged.` }] : [], output.blockers.map((cluster) => ({ severity: 'ERROR', code: `ERC_${cluster.type.toUpperCase()}`, message: `${cluster.count} ERC issue(s): ${cluster.recommendedFix}` })), { ercAnalysis: output, ercIntent: intentReport, generatedFiles: [outputFile, intentFile], humanReviewRequired: true })
}

async function applyErcIntentPolicyJob(job, workspace) {
  const context = await getKiCadContext(job, workspace, 'sch')
  if (context.blocked) return context.blocked
  const reportFile = job.input?.reportFile ? resolveInsideWorkspace(workspace, job.input.reportFile) : path.join(context.files.projectDir, 'reports', 'erc.json')
  const backupFile = await backupFileWithSuffix(context.files.schFile, 'boardforge_erc_intent')
  const outputFile = path.join(context.files.projectDir, 'boardforge-erc-intent-report.json')
  const intentReport = await classifyErcPowerIntent({ reportFile, schFile: context.files.schFile, outputFile })
  await updateProjectState(context.files.projectDir, async (current) => ({
    ...current,
    ercIntent: intentReport,
    generatedFiles: [...new Set([...(current.generatedFiles || []), outputFile, backupFile])],
    lastJobType: job.type,
    lastHistoryMessage: `ERC intent policy classified ${intentReport.totalBlockingErc} blocking ERC issue(s); ${intentReport.remainingBlockingErc} remain blocking.`,
  }))
  const errors = intentReport.remainingBlockingErc ? [{ severity: 'ERROR', code: 'ERC_INTENT_BLOCKERS_REMAIN', message: `${intentReport.remainingBlockingErc} ERC blocker(s) still require user decision.` }] : []
  return result(job, intentReport.status, [], errors, { ercIntent: intentReport, backupFile, generatedFiles: [outputFile, backupFile], humanReviewRequired: true })
}

async function analyzeEscRoutingFeasibilityJob(job, workspace) {
  const context = await getKiCadContext(job, workspace, 'pcb')
  if (context.blocked) return context.blocked
  const state = await readProjectState(context.files.projectDir)
  const output = await analyzeEscRoutingFeasibility({
    projectPath: context.files.projectDir,
    ercAnalysis: job.input?.ercAnalysis || state?.ercAnalysis || null,
    drcSummary: job.input?.drcSummary || state?.validation?.drc?.report?.issueCounts || null,
  })
  const outputFile = path.join(context.files.projectDir, 'boardforge-esc-feasibility.json')
  if (!job.dryRun) {
    await writeFile(outputFile, JSON.stringify(output, null, 2), 'utf8')
    await updateProjectState(context.files.projectDir, async (current) => ({
      ...current,
      escFeasibility: output,
      generatedFiles: [...new Set([...(current.generatedFiles || []), outputFile])],
      lastJobType: job.type,
      lastHistoryMessage: `ESC feasibility completed: two-layer feasible = ${output.twoLayerFeasible}.`,
    }))
  }
  const warnings = output.twoLayerFeasible ? [] : [{ severity: 'WARNING', code: 'ESC_STACKUP_MIGRATION_REQUIRED', message: `2-layer routing is not feasible; recommended MVP layer count is ${output.recommendedMvpLayerCount}.` }]
  return result(job, output.status, warnings, [], { escFeasibility: output, generatedFiles: [outputFile], humanReviewRequired: true })
}

async function autonomousStagedRoutingJob({ job, workspace, projectDir, state }) {
  const context = await getKiCadContext({ ...job, input: { ...(job.input || {}), projectPath: path.relative(workspace, projectDir) || '.' } }, workspace, 'pcb')
  if (context.blocked) return context.blocked
  const scan = await scanKiCadProject(projectDir)
  const board = state?.board || boardFromScan(scan, job.input || {}) || boardFromJob(job)
  if (!board.outline?.length && scan.boardOutline?.length) board.outline = scan.boardOutline
  if (!board.layerCount && scan.layerCount) board.layerCount = scan.layerCount
  const components = await readRichComponents(projectDir) || state?.components || componentsFromScan(scan)
  const netNames = [...new Set((scan.pads || []).map((pad) => pad.netName).filter(Boolean))]
  const zoneNets = ['GND', 'PGND'].map((target) => netNames.find((name) => String(name).replace(/^\/+/, '').toUpperCase() === target)).filter(Boolean)
  const beforeDrc = state?.validation?.drc?.issueCounts || await readDrcIssueCounts(path.join(projectDir, 'reports', 'drc.json'))
  const backupFile = await backupFileWithSuffix(context.files.pcbFile, 'boardforge_route_stage_gnd_pgnd')
  const approvedLayerCount = Number(state?.userApprovedConstraints?.approvedLayerCount || board.layerCount || scan.layerCount || 0)
  const groundLayers = approvedLayerCount >= 8 ? ['In1.Cu', 'In6.Cu'] : ['In1.Cu', 'In4.Cu']
  const routingPlan = {
    status: 'AUTONOMOUS_STAGE_1_GND_PGND_ZONE_PLAN',
    routes: [],
    designIntent: {
      writeInnerCopperPours: true,
      copperPours: zoneNets.flatMap((net) => groundLayers.map((layer) => ({ net, layer, clearanceMm: 0.25, thermalRelief: false }))),
    },
    warnings: [],
  }
  if (!routingPlan.designIntent.copperPours.length) {
    return { status: 'AUTONOMOUS_STAGE_ROUTING_BLOCKED_NO_GROUND_NET', generatedFiles: [backupFile], warnings: [], errors: [{ severity: 'ERROR', code: 'NO_GND_OR_PGND_NET_FOR_STAGE_1', message: 'No GND/PGND net was found for staged reference-plane routing.' }], routingStage: { stage: 'gnd_pgnd', stagesAttempted: ['gnd_pgnd'], stagesCompleted: [], backupFile, beforeDrc, afterDrc: null, rolledBack: false } }
  }
  const writeOutput = await applyRoutingPlanToPcb({ pcbFile: context.files.pcbFile, board, routingPlan, components, pads: scan.pads || [] })
  const reportFile = path.join(projectDir, 'reports', 'drc-after-stage-gnd-pgnd.json')
  const drcOutput = await runDrc({ pcbFile: context.files.pcbFile, outputFile: reportFile, kicadCliPath: context.detected.path })
  const afterDrc = drcOutput.issueCounts || {}
  const worsened = Number(afterDrc.errors || 0) > Number(beforeDrc?.errors || 0)
  let finalDrc = afterDrc
  let rolledBack = false
  if (worsened) {
    await copyFile(backupFile, context.files.pcbFile)
    const rollbackReportFile = path.join(projectDir, 'reports', 'drc-after-stage-gnd-pgnd-rollback.json')
    const rollbackDrc = await runDrc({ pcbFile: context.files.pcbFile, outputFile: rollbackReportFile, kicadCliPath: context.detected.path })
    finalDrc = rollbackDrc.issueCounts || finalDrc
    rolledBack = true
  }
  const routingStage = {
    stage: 'gnd_pgnd',
    status: rolledBack ? 'STAGED_ROUTING_ROLLED_BACK_DRC_WORSENED' : 'STAGED_ROUTING_GND_PGND_APPLIED_NEEDS_REVIEW',
    stagesAttempted: ['gnd_pgnd'],
    stagesCompleted: rolledBack ? [] : ['gnd_pgnd'],
    zoneNets,
    generatedObjects: writeOutput.generatedObjects,
    backupFile,
    reportFile,
    beforeDrc,
    afterDrc,
    finalDrc,
    rolledBack,
    humanReviewRequired: true,
  }
  const outputFile = path.join(projectDir, 'boardforge-routing-stage-gnd-pgnd.json')
  await writeFile(outputFile, `${JSON.stringify(routingStage, null, 2)}\n`, 'utf8')
  await updateProjectState(projectDir, async (current) => ({
    ...current,
    status: routingStage.status,
    routing: { ...(current.routing || {}), staged: routingStage, stagesAttempted: routingStage.stagesAttempted, stagesCompleted: routingStage.stagesCompleted },
    validation: { ...(current.validation || {}), drc: { status: drcOutput.status, issueCounts: finalDrc, reportFile: rolledBack ? path.join(projectDir, 'reports', 'drc-after-stage-gnd-pgnd-rollback.json') : reportFile } },
    generatedFiles: [...new Set([...(current.generatedFiles || []), outputFile, reportFile, backupFile])],
    lastJobType: 'route_staged',
    lastHistoryMessage: rolledBack ? 'Stage 1 GND/PGND routing was rolled back because DRC worsened.' : 'Stage 1 GND/PGND reference zones were written; DRC review required.',
  }))
  const warnings = [{ severity: 'WARNING', code: 'DRC_REVIEW_REQUIRED', message: `Stage 1 DRC result: ${finalDrc.errors || 0} errors, ${finalDrc.warnings || 0} warnings.` }]
  const errors = rolledBack ? [{ severity: 'ERROR', code: 'STAGED_ROUTING_DRC_WORSENED_ROLLED_BACK', message: `GND/PGND stage worsened DRC from ${beforeDrc?.errors || 0} to ${afterDrc.errors || 0} errors; PCB restored from backup.` }] : []
  return { status: routingStage.status, warnings, errors, routingStage, generatedFiles: [outputFile, reportFile, backupFile], humanReviewRequired: true }
}

async function migrateEscStackupJob(job, workspace) {
  const context = await getKiCadContext(job, workspace, 'pcb')
  if (context.blocked) return context.blocked
  const layerCount = Number(job.input?.layerCount || job.input?.recommendedMvpLayerCount || 6)
  const backupFile = job.dryRun ? null : await backupFileWithSuffix(context.files.pcbFile, 'boardforge_stackup')
  const output = await migrateEscPcbStackup({ pcbFile: context.files.pcbFile, layerCount })
  const outputFile = path.join(context.files.projectDir, 'boardforge-esc-stackup-migration.json')
  if (!job.dryRun) {
    await writeFile(outputFile, JSON.stringify(output, null, 2), 'utf8')
    await updateProjectState(context.files.projectDir, async (current) => ({
      ...current,
      board: { ...(current.board || {}), layerCount },
      escStackupMigration: output,
      generatedFiles: [...new Set([...(current.generatedFiles || []), outputFile, backupFile].filter(Boolean))],
      lastJobType: job.type,
      lastHistoryMessage: `Migrated ESC board stackup to ${layerCount} layers; DRC required.`,
    }))
  }
  return result(job, output.status, [{ severity: 'WARNING', code: 'RERUN_DRC_REQUIRED', message: 'Stackup changed; rerun KiCad DRC before routing/export.' }], [], { escStackupMigration: { ...output, backupFile }, generatedFiles: [outputFile, backupFile].filter(Boolean), humanReviewRequired: true })
}

async function applyEscNetClassesJob(job, workspace) {
  const context = await getKiCadContext(job, workspace, 'pcb')
  if (context.blocked) return context.blocked
  const scan = await scanKiCadProject(context.files.projectDir)
  const scannedNets = [...new Set((scan.pads || []).map((pad) => pad.netName).filter(Boolean))].map((name) => ({ name }))
  const nets = classifyEscNets(job.input?.nets?.length ? job.input.nets : scannedNets)
  const backups = job.dryRun ? [] : [await backupFileWithSuffix(context.files.proFile, 'boardforge_netclasses'), await backupFileWithSuffix(context.files.pcbFile, 'boardforge_netclasses')]
  const output = await applyEscNetClasses({ projectDir: context.files.projectDir, projectFile: context.files.proFile, pcbFile: context.files.pcbFile, nets })
  const outputFile = path.join(context.files.projectDir, 'boardforge-esc-netclasses.json')
  if (!job.dryRun) {
    await writeFile(outputFile, JSON.stringify(output, null, 2), 'utf8')
    await updateProjectState(context.files.projectDir, async (current) => ({
      ...current,
      escNetClasses: output,
      generatedFiles: [...new Set([...(current.generatedFiles || []), outputFile, ...backups])],
      lastJobType: job.type,
      lastHistoryMessage: `Applied ESC net classes to ${output.classifiedNetCount} net(s).`,
    }))
  }
  return result(job, output.status, [{ severity: 'WARNING', code: 'RERUN_DRC_REQUIRED', message: 'Net classes changed; rerun KiCad DRC before routing/export.' }], [], { escNetClasses: { ...output, backups }, generatedFiles: [outputFile, ...backups], humanReviewRequired: true })
}

async function buildUniversalPlacementInput(job, projectDir, state, profile) {
  const scan = projectDir && !job.input?.components ? await scanKiCadProject(projectDir).catch(() => null) : null
  const board = job.input?.board || state?.board || boardFromScan(scan, job.input || state?.requirements || {}) || boardFromJob(job)
  const components = job.input?.components || await readRichComponents(projectDir) || state?.components || state?.schematicSynthesis?.components || state?.requirementsPlan?.components || componentsFromScan(scan || {}) || []
  const nets = job.input?.nets || state?.netlist?.nets || state?.schematicSynthesis?.nets || state?.requirementsPlan?.nets || state?.requirements?.nets || netsFromScan(scan || {})
  return {
    ...state?.requirements,
    ...job.input,
    board,
    components,
    nets,
    profile,
    requirementsPlan: job.input?.requirementsPlan || state?.requirementsPlan,
    categoryPlan: job.input?.categoryPlan || state?.categoryPlan,
    complexity: job.input?.complexity || state?.complexityClassification,
    stackupPlan: job.input?.stackupPlan || state?.adaptiveStackup || state?.stackup,
    constraintConflicts: job.input?.constraintConflicts || state?.constraintConflicts,
  }
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
      netlist: output.netlist || current.netlist,
      generatedFiles: [...new Set([...(current.generatedFiles || []), outputFile])],
      lastJobType: job.type,
      lastHistoryMessage: `Validated schematic graph with ${output.errors.length} errors and ${output.warnings.length} warnings.`,
    }))
  }
  return result(job, output.status, output.warnings, output.errors, { schematicGraph: output, generatedFiles: outputFile ? [outputFile] : [], humanReviewRequired: true })
}

async function validateSchematicReadinessJob(job, workspace) {
  const projectDir = job.input?.projectPath ? resolveInsideWorkspace(workspace, job.input.projectPath) : null
  const state = projectDir ? await readProjectState(projectDir) : null
  const board = job.input?.board || state?.board || boardFromJob(job)
  const rawComponents = job.input?.components || await readRichComponents(projectDir) || state?.schematicSynthesis?.components || state?.components || []
  const components = rawComponents.length ? await enrichComponents({ workspace, components: rawComponents, input: job.input || state?.requirements || {} }) : []
  const nets = job.input?.nets || state?.schematicSynthesis?.nets || state?.netlist?.nets || state?.requirementsPlan?.nets || state?.requirements?.nets || []
  const output = await validateSchematicReadiness({
    board,
    components,
    nets,
    bindings: job.input?.bindings || state?.componentBindings,
    options: job.input || {},
  })
  const outputFile = projectDir ? path.join(projectDir, 'boardforge-schematic-readiness.json') : null
  if (projectDir && !job.dryRun) {
    await writeFile(outputFile, JSON.stringify(output, null, 2), 'utf8')
    await updateProjectState(projectDir, async (current) => ({
      ...current,
      status: output.status,
      schematicReadiness: output,
      components: normalizeComponents(components),
      generatedFiles: [...new Set([...(current.generatedFiles || []), outputFile])],
      lastJobType: job.type,
      lastHistoryMessage: `Validated schematic readiness with ${output.errors.length} blockers and ${output.warnings.length} warnings.`,
    }))
  }
  return result(job, output.status, output.warnings, output.errors, { schematicReadiness: output, generatedFiles: outputFile ? [outputFile] : [], humanReviewRequired: true })
}

async function routingReadinessJob(job, workspace, profile) {
  const projectDir = job.input?.projectPath ? resolveInsideWorkspace(workspace, job.input.projectPath) : null
  const state = projectDir ? await readProjectState(projectDir) : null
  const board = job.input?.board || state?.board || boardFromJob(job)
  const components = job.input?.components || await readRichComponents(projectDir) || state?.components || []
  const nets = job.input?.nets || state?.netlist?.nets || state?.requirementsPlan?.nets || []
  const output = checkRoutingReadiness({
    ...job.input,
    board,
    components,
    nets,
    routingPlan: job.input?.routingPlan || state?.routing?.plan,
    profile,
    stackup: job.input?.stackup || state?.stackup,
    schematicGraph: job.input?.schematicGraph || state?.schematicGraph,
    fanoutPlan: job.input?.fanoutPlan || state?.fanoutPlan,
    viaStrategy: job.input?.viaStrategy || state?.viaStrategy,
    powerRouting: job.input?.powerRouting || state?.powerRouting,
  })
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
    issueCounts: output.report?.issueCounts || output.issueCounts || null,
    rerouteAttempts: output.rerouteAttempts || [],
    repairLoop: output.repairLoop ? summarizeRepairLoop(output.repairLoop) : null,
    humanReviewRequired: output.humanReviewRequired !== false,
  }
}

function summarizeRepairLoop(repairLoop = {}) {
  return {
    status: repairLoop.status,
    finalIssueCounts: repairLoop.finalIssueCounts || null,
    iterations: (repairLoop.iterations || []).map((iteration) => ({
      index: iteration.index,
      issueCounts: iteration.issueCounts || null,
      applied: iteration.applied?.applied || 0,
      reportFile: iteration.reportFile || null,
    })),
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
  const shouldAutoResolve = job.input?.autoResolveAssets === true || (!job.input?.components?.length && rawComponents.length && !rawComponents.some((component) => component.symbol || component.footprint || component.assetStatus))
  const components = rawComponents.length && shouldAutoResolve ? await enrichComponents({ workspace, components: rawComponents, input: job.input || state?.requirements || {} }) : rawComponents
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
  const netSettings = await ensureProjectNetSettings(context.files, profileFromState(state, job), netlist?.nets || state?.requirements?.nets || [])
  const output = await applyNetlistSyncToPcb({ pcbFile: context.files.pcbFile, components, netlist })
  await updateProjectState(context.files.projectDir, async (current) => ({
    ...current,
    status: output.status,
    schematicPcbSyncApply: output,
    kicadNetSettings: netSettings,
    lastJobType: job.type,
    lastHistoryMessage: `Applied PCB net sync for ${output.netCount} nets and ${output.componentCount} components.`,
  }))
  return result(job, output.status, [{ severity: 'WARNING', code: 'PCB_NET_SYNC_REQUIRES_DRC', message: 'PCB nets/pad assignments changed or were checked; run KiCad DRC before routing/export.' }], [], { syncApply: output, kicadNetSettings: netSettings, generatedFiles: [...new Set([...(output.changed ? [context.files.pcbFile] : []), ...(netSettings.changed ? [context.files.proFile] : [])].filter(Boolean))], humanReviewRequired: true })
}

async function readJsonIfExists(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'))
  } catch {
    return null
  }
}

function profileFromState(state, job) {
  return state?.profile || getManufacturerProfile(job.input?.manufacturerProfile || job.input?.manufacturer || 'JLCPCB_STANDARD')
}

async function ensureProjectNetSettings(files, profile, nets = []) {
  if (!files?.proFile) return { status: 'PROJECT_NET_SETTINGS_SKIPPED', changed: false }
  const existingProject = await readJsonIfExists(files.proFile)
  const existingClasses = existingProject?.net_settings?.classes || []
  const existingAssignments = existingProject?.net_settings?.netclass_assignments || null
  const hasCustomEscClasses = existingClasses.some((item) => ['KELVIN_SENSE', 'PGND', 'VREG', 'MCU_CONTROL', 'SIGNAL_DEFAULT'].includes(item.name))
  if (hasCustomEscClasses && existingAssignments && Object.keys(existingAssignments).length && !nets?.some((net) => net?.className)) {
    return { status: 'PROJECT_NET_SETTINGS_PRESERVED_CUSTOM', changed: false, projectFile: files.proFile, classCount: existingClasses.length, assignedNetCount: Object.keys(existingAssignments).length }
  }
  return syncKiCadProjectNetSettings({
    projectFile: files.proFile,
    nets: assignNetsToClasses(nets || []),
    netClasses: createNetClasses(profile),
    profile,
  })
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
  return result(job, repairPlan.status, repairPlan.warnings || [], repairPlan.errors || [], {
    repairPlan,
    components: repairPlan.components,
    generatedFiles: [outputFile],
    humanReviewRequired: true,
  })
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
  const components = rawComponents.length ? await enrichComponents({ workspace, components: rawComponents, input: job.input || state?.requirements || {} }) : []
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
  const components = rawComponents.length ? await enrichComponents({ workspace, components: rawComponents, input: job.input || state?.requirements || {} }) : []
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
  const components = rawComponents.length ? await enrichComponents({ workspace, components: rawComponents, input: job.input || state?.requirements || {} }) : []
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

async function readSchematicGraphNetlist(projectDir) {
  if (!projectDir) return null
  try {
    const graph = JSON.parse(await readFile(path.join(projectDir, 'boardforge-schematic-graph.json'), 'utf8'))
    return graph.netlist?.nets || null
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
  const components = rawComponents.length ? await enrichComponents({ workspace, components: rawComponents, input: job.input || state?.requirements || {} }) : []
  const nets = job.input?.nets || state?.schematicSynthesis?.nets || state?.requirements?.nets || []
  const readiness = await validateSchematicReadiness({
    board,
    components,
    nets,
    bindings: job.input?.bindings || state?.componentBindings,
    options: job.input || {},
  })
  const originalAssetErrors = job.input?.allowAssetFallback === true ? [] : unresolvedOriginalAssetErrors(rawComponents)
  if (originalAssetErrors.length) {
    readiness.errors = dedupeIssues([...readiness.errors, ...originalAssetErrors])
    readiness.blockers = readiness.errors
    readiness.status = 'SCHEMATIC_READINESS_BLOCKED'
    readiness.readinessGates = readiness.readinessGates?.map((gate) => {
      if (gate.id === 'symbols_resolved') return { ...gate, passed: !readiness.errors.some((issue) => issue.code === 'COMPONENT_SYMBOL_UNRESOLVED') }
      if (gate.id === 'footprints_resolved') return { ...gate, passed: !readiness.errors.some((issue) => issue.code === 'COMPONENT_FOOTPRINT_UNRESOLVED') }
      return gate
    }) || readiness.readinessGates
    readiness.nextActions = [...(readiness.nextActions || []), { command: 'resolve_component_assets', reason: 'Original component request did not include explicit symbol/footprint bindings.' }]
  }
  if (readiness.status === 'SCHEMATIC_READINESS_BLOCKED' && job.input?.allowIncompleteSchematic !== true) {
    const readinessFile = projectDir ? path.join(projectDir, 'boardforge-schematic-readiness.json') : null
    if (projectDir && !job.dryRun) {
      await writeFile(readinessFile, JSON.stringify(readiness, null, 2), 'utf8')
      await updateProjectState(projectDir, async (current) => ({
        ...current,
        status: 'SCHEMATIC_GENERATION_BLOCKED_BY_READINESS',
        schematicReadiness: readiness,
        components: normalizeComponents(components),
        generatedFiles: [...new Set([...(current.generatedFiles || []), readinessFile])],
        lastJobType: job.type,
        lastHistoryMessage: `Blocked schematic generation until ${readiness.errors.length} readiness issue(s) are fixed.`,
      }))
    }
    return result(job, 'SCHEMATIC_GENERATION_BLOCKED_BY_READINESS', readiness.warnings, readiness.errors, {
      schematicReadiness: readiness,
      generatedFiles: readinessFile ? [readinessFile] : [],
      humanReviewRequired: true,
    })
  }
  const schematicModel = generateSchematicModel(board, components, { ...(state?.requirements || {}), ...(job.input || {}), nets })
  const generatedFiles = []
  if (projectDir && !job.dryRun) {
    const files = await findKiCadProjectFiles(projectDir)
    if (files.schFile) {
      await writeFile(files.schFile, kicadSchematicFromModel(board, schematicModel), 'utf8')
      generatedFiles.push(files.schFile)
    }
    const modelFile = path.join(projectDir, 'boardforge-schematic-model.json')
    await writeFile(modelFile, JSON.stringify(schematicModel, null, 2), 'utf8')
    generatedFiles.push(modelFile)
    await updateProjectState(projectDir, async (current) => ({
      ...current,
      status: schematicModel.status,
      schematic: schematicModel,
      schematicReadiness: readiness,
      components: normalizeComponents(components),
      generatedFiles: [...new Set([...(current.generatedFiles || []), ...generatedFiles])],
      lastJobType: job.type,
      lastHistoryMessage: `Generated schematic model with ${schematicModel.symbols.length} symbols and ${schematicModel.nets.length} nets.`,
    }))
  }
  return result(job, schematicModel.status, [...readiness.warnings, ...schematicModel.warnings], [], { schematicModel, schematicReadiness: readiness, generatedFiles, humanReviewRequired: true })
}

function unresolvedOriginalAssetErrors(components = []) {
  const errors = []
  for (const component of components || []) {
    const ref = component.ref || component.reference || component.designator || 'component'
    if (!component.symbol) errors.push({ severity: 'ERROR', code: 'COMPONENT_SYMBOL_UNRESOLVED', message: `${ref} has no explicitly selected schematic symbol in the request.`, ref })
    if (!component.footprint) errors.push({ severity: 'ERROR', code: 'COMPONENT_FOOTPRINT_UNRESOLVED', message: `${ref} has no explicitly selected footprint in the request.`, ref })
  }
  return errors
}

function dedupeIssues(issues = []) {
  const seen = new Set()
  return issues.filter((issue) => {
    const key = `${issue.code}:${issue.ref || ''}:${issue.message || ''}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
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

async function planEndpointReroutesJob(job, workspace, profile) {
  const context = await getKiCadContext(job, workspace, 'pcb')
  if (context.blocked) return context.blocked
  const state = await readProjectState(context.files.projectDir)
  const reportFile = resolveProjectReportFile({ context, workspace, reportFile: job.input?.reportFile })
  const endpointPlan = await planEndpointAwareReroutes({
    projectDir: context.files.projectDir,
    reportFile,
    profile,
    board: state?.board || null,
    components: job.input?.components || state?.components || [],
    nets: job.input?.nets || state?.netlist?.nets || state?.schematicSynthesis?.nets || state?.requirements?.nets || [],
    options: job.input || {},
  })
  await updateProjectState(context.files.projectDir, async (current) => ({
    ...current,
    endpointRouting: {
      ...(current.endpointRouting || {}),
      plan: endpointPlan,
    },
    lastJobType: job.type,
    lastHistoryMessage: `Endpoint-aware reroute planned ${endpointPlan.routedNets?.length || 0} routed net(s); ${endpointPlan.blocked?.length || 0} endpoint blocker(s).`,
  }))
  const warnings = [
    ...(endpointPlan.blocked || []).map((item) => ({ severity: 'WARNING', code: 'ENDPOINT_REROUTE_BLOCKED_NET', message: `${item.net}: ${item.reason}`, details: item })),
    ...(endpointPlan.routeValidation?.warnings || []),
  ]
  const errors = endpointPlan.routeValidation?.errors || []
  return result(job, endpointPlan.status, warnings, errors, { endpointPlan, humanReviewRequired: true })
}

async function applyEndpointReroutesJob(job, workspace, profile) {
  const context = await getKiCadContext(job, workspace, 'pcb')
  if (context.blocked) return context.blocked
  const state = await readProjectState(context.files.projectDir)
  const reportFile = resolveProjectReportFile({ context, workspace, reportFile: job.input?.reportFile })
  const previousReport = existsSync(reportFile) ? JSON.parse(await readFile(reportFile, 'utf8')) : null
  const output = await applyEndpointAwareReroutes({
    projectDir: context.files.projectDir,
    reportFile,
    profile,
    state,
    options: {
      ...job.input,
      previousErrorCount: drcErrorCount(previousReport),
      previousWarningCount: drcWarningCount(previousReport),
    },
    runDrc: ({ outputFile }) => runDrc({ pcbFile: context.files.pcbFile, outputFile, kicadCliPath: context.detected.path }),
  })
  await updateProjectState(context.files.projectDir, async (current) => ({
    ...current,
    status: output.status,
    endpointRouting: {
      ...(current.endpointRouting || {}),
      applied: output,
    },
    generatedFiles: [...new Set([...(current.generatedFiles || []), ...(output.generatedFiles || [])].filter(Boolean))],
    lastJobType: job.type,
    lastHistoryMessage: output.applied ? 'Endpoint-aware reroute applied and checked by KiCad DRC.' : 'Endpoint-aware reroute was not committed.',
  }))
  const warnings = output.plan?.blocked?.map((item) => ({ severity: 'WARNING', code: 'ENDPOINT_REROUTE_BLOCKED_NET', message: `${item.net}: ${item.reason}`, details: item })) || []
  const errors = output.applied ? [] : [{ severity: 'ERROR', code: 'ENDPOINT_REROUTE_NOT_APPLIED', message: 'Endpoint-aware reroute could not be safely committed.', details: { status: output.status } }]
  return result(job, output.status, warnings, errors, { ...output, humanReviewRequired: true })
}

function drcErrorCount(report = {}) {
  const body = report?.report || report || {}
  const issues = [...(body.violations || []), ...(body.unconnected_items || [])]
  return Number(body.issueCounts?.errors ?? issues.filter((item) => String(item.severity || '').toLowerCase() === 'error').length)
}

function drcWarningCount(report = {}) {
  const body = report?.report || report || {}
  const issues = [...(body.violations || []), ...(body.unconnected_items || [])]
  return Number(body.issueCounts?.warnings ?? issues.filter((item) => String(item.severity || '').toLowerCase() === 'warning').length)
}

function resolveProjectReportFile({ context, workspace, reportFile }) {
  if (!reportFile) return path.join(context.files.projectDir, 'reports', 'drc.json')
  if (path.isAbsolute(reportFile)) return reportFile
  const projectRelative = path.join(context.files.projectDir, reportFile)
  if (existsSync(projectRelative)) return projectRelative
  return resolveInsideWorkspace(workspace, reportFile)
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
  const options = { components: job.input?.components || [], nets: job.input?.nets || [], gridMm: job.input?.gridMm, densePlacement: job.input?.densePlacement }
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
  const storedSolverPlan = state?.placementSolver?.components?.length ? state.placementSolver : null
  const rawComponents = job.input?.components || job.input?.placementPlan?.components || storedSolverPlan?.components || await readRichComponents(projectDir) || state?.components || []
  const components = job.type === 'move_component'
    ? rawComponents.map((component) => component.ref === job.input?.ref ? { ...component, x: job.input.x, y: job.input.y, rotation: job.input.rotation ?? component.rotation } : component)
    : rawComponents
  const plan = job.input?.placementPlan || storedSolverPlan || (job.input?.optimize !== false ? optimizePlacementPlan(board, null, profile, { components, nets: job.input?.nets || state?.requirements?.nets || [] }) : generatePlacementPlan(board, null, profile, { components, nets: job.input?.nets || state?.requirements?.nets || [] }))
  const componentsToApply = plan.components || components
  const applyResult = await applyPlacementPlanToPcb(projectDir, componentsToApply, {
    dryRun: job.dryRun,
    renderMissingFootprints: (missingComponents) => renderPlacedFootprints(missingComponents, { workspace, projectPath: projectDir, ...job.input }),
  })
  if (!job.dryRun && (applyResult.updatedRefs?.length || applyResult.insertedRefs?.length)) {
    const componentsFile = path.join(projectDir, 'boardforge-components.json')
    await writeFile(componentsFile, JSON.stringify(componentsToApply, null, 2), 'utf8')
    const graphNets = await readSchematicGraphNetlist(projectDir)
    const netSync = await applyNetlistSyncToPcb({ pcbFile: applyResult.pcbFile, components: componentsToApply, netlist: job.input?.netlist || state?.netlist || (graphNets ? { nets: graphNets } : null) })
    const files = await findKiCadProjectFiles(projectDir)
    const projectNetSettings = await ensureProjectNetSettings(files, profile, job.input?.netlist?.nets || state?.netlist?.nets || graphNets || state?.requirements?.nets || [])
    await updateProjectState(projectDir, async (current) => ({
      ...current,
      status: projectNetSettings.status || netSync.status || applyResult.status,
      components: normalizeComponents(componentsToApply),
      placement: { status: applyResult.status, plan, updatedRefs: applyResult.updatedRefs, insertedRefs: applyResult.insertedRefs, missingRefs: applyResult.missingRefs },
      schematicPcbSyncApply: netSync,
      kicadNetSettings: projectNetSettings,
      generatedFiles: [...new Set([...(current.generatedFiles || []), ...(applyResult.generatedFiles || []), ...(netSync.changed ? [netSync.pcbFile] : []), ...(projectNetSettings.changed ? [files.proFile] : []), componentsFile].filter(Boolean))],
      lastJobType: job.type,
      lastHistoryMessage: `Applied placement updates to ${applyResult.updatedRefs.length} PCB footprints, inserted ${applyResult.insertedRefs?.length || 0} synthesized footprints, and synced ${netSync.netCount} PCB nets.`,
    }))
    applyResult.netSync = netSync
    applyResult.kicadNetSettings = projectNetSettings
    applyResult.generatedFiles = [...new Set([...(applyResult.generatedFiles || []), ...(netSync.changed ? [netSync.pcbFile] : []), ...(projectNetSettings.changed ? [files.proFile] : []), componentsFile].filter(Boolean))]
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

async function autotracerJob(job, workspace, profile) {
  const projectDir = job.input?.projectPath ? resolveInsideWorkspace(workspace, job.input.projectPath) : null
  const state = projectDir ? await readProjectState(projectDir) : null
  const components = job.input?.components || await readRichComponents(projectDir) || state?.components || []
  const scan = projectDir && existsSync(projectDir) ? await safeScanProject(projectDir) : null
  const context = {
    ...(state || {}),
    ...(job.input || {}),
    board: job.input?.board || state?.board || (scan?.boardOutline?.length ? { ...boardFromJob(job), outline: scan.boardOutline, layerCount: scan.layerCount || boardFromJob(job).layerCount } : boardFromJob(job)),
    components: components?.length ? components : scan?.footprints || [],
    pads: job.input?.pads || scan?.pads || [],
    nets: job.input?.nets || state?.canonicalNetModelReport?.canonicalNetModel?.nets || state?.netlist?.nets || state?.requirements?.nets || scan?.nets || [],
    scan,
    profile,
    manufacturerProfileObject: profile,
  }
  let output = runAutotracerPlanning(job.type, context)
  const generatedFiles = []
  const shouldWriteCopper = ['autotrace_board', 'autotrace_critical_nets', 'autotrace_power', 'autotrace_signals', 'autotrace_diff_pairs', 'autotrace_remaining_nets', 'repair_routing', 'reroute_failed_nets'].includes(job.type) && output.createdTracks?.length && !job.dryRun && job.input?.writeCopper !== false
  if (shouldWriteCopper) {
    const kicad = await getKiCadContext(job, workspace, 'pcb')
    if (kicad.blocked) return kicad.blocked
    const write = await applyRoutingPlanToPcb({ pcbFile: kicad.files.pcbFile, board: context.board, routingPlan: output.routingPlan, components, pads: context.pads || context.scan?.pads || [] })
    generatedFiles.push(kicad.files.pcbFile)
    if (job.input?.runDrc !== false && kicad.detected?.available) {
      const reportFile = path.join(kicad.files.projectDir, 'reports', 'autotrace-drc.json')
      const drc = await runDrc({ pcbFile: kicad.files.pcbFile, outputFile: reportFile, kicadCliPath: kicad.detected.path })
      await updateValidationState(kicad.files.projectDir, job.type, 'autotraceDrc', drc)
      output = finalizeAutotraceWithDrc(output, drc)
      generatedFiles.push(reportFile)
    } else {
      output = { ...output, status: output.status === 'planned' ? 'needs_human_review' : output.status, warnings: [...(output.warnings || []), { severity: 'WARNING', code: 'KICAD_DRC_NOT_RUN', message: 'Copper was written but KiCad DRC was not run; do not claim routed/fab-ready.' }] }
    }
    output.writeResult = write
  }
  const key = autotracerStateKey(job.type)
  const outputFile = projectDir ? path.join(projectDir, `${keyToFileName(key)}.json`) : null
  if (outputFile && !job.dryRun) {
    await writeFile(outputFile, JSON.stringify(output, null, 2), 'utf8')
    generatedFiles.push(outputFile)
    await updateProjectState(projectDir, async (current) => ({
      ...current,
      status: output.status,
      [key]: output,
      routing: {
        ...(current.routing || {}),
        autotrace: output.routingPlan || current.routing?.autotrace,
        autotraceResult: output,
        drcRequired: shouldWriteCopper && !output.drcResult,
      },
      generatedFiles: [...new Set([...(current.generatedFiles || []), ...generatedFiles])],
      lastJobType: job.type,
      lastHistoryMessage: `${job.type} completed with status ${output.status}.`,
    }))
  }
  return result(job, autotracerPluginStatus(output.status), output.warnings || [], output.errors || output.remainingIssues || [], { [key]: output, autotraceResult: output, routingPlan: output.routingPlan, generatedFiles: [...new Set(generatedFiles)], humanReviewRequired: true })
}

async function safeScanProject(projectDir) {
  try {
    return await scanKiCadProject(projectDir)
  } catch {
    return null
  }
}

function autotracerStateKey(type) {
  return {
    autotrace_board: 'autotraceBoard',
    autotrace_critical_nets: 'autotraceCriticalNets',
    autotrace_power: 'autotracePower',
    autotrace_signals: 'autotraceSignals',
    autotrace_diff_pairs: 'autotraceDiffPairs',
    autotrace_remaining_nets: 'autotraceRemainingNets',
    repair_routing: 'autotraceRepair',
    reroute_failed_nets: 'autotraceRerouteFailedNets',
    run_routing_drc: 'autotraceDrc',
    calculate_trace_width: 'traceWidthCalculation',
    validate_trace_width: 'traceWidthValidation',
    detect_power_neckdowns: 'powerNeckdownReport',
    create_power_pour: 'powerPourPlan',
    select_via_type: 'autotraceViaSelection',
    validate_via_manufacturability: 'autotraceViaManufacturability',
  }[type] || 'autotrace'
}

function autotracerPluginStatus(status) {
  return {
    not_started: 'AUTOTRACE_NOT_STARTED',
    scanned: 'AUTOTRACE_SCANNED',
    planned: 'AUTOTRACE_PLANNED_NEEDS_DRC',
    partial: 'AUTOTRACE_PARTIAL_NEEDS_REVIEW',
    fully_routed: 'AUTOTRACE_FULLY_ROUTED_DRC_PASSED',
    failed: 'AUTOTRACE_FAILED',
    needs_placement_changes: 'AUTOTRACE_NEEDS_PLACEMENT_CHANGES',
    needs_human_review: 'AUTOTRACE_NEEDS_HUMAN_REVIEW',
  }[status] || status
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

async function runEscAutonomousSupervisor(job, workspace, profile) {
  const input = job.input || {}
  const projectDir = resolveInsideWorkspace(workspace, input.projectPath || '.')
  const maxSupervisorCycles = Math.max(1, Number(input.maxSupervisorCycles || 100))
  const maxTraceIterationsPerCycle = Math.max(1, Number(input.maxTraceIterationsPerCycle || 20))
  const maxInternalRepairTasksPerCycle = Math.max(1, Number(input.maxInternalRepairTasksPerCycle || 10))
  const checkpointFile = path.join(projectDir, 'boardforge-esc-autonomous-supervisor-checkpoint.json')
  const taskLogFile = path.join(projectDir, 'boardforge-internal-repair-tasks.json')
  const taskLogMarkdownFile = path.join(projectDir, 'BoardForge_Internal_Repair_Task_Log.md')
  const cycles = []
  const internalRepairTasks = []
  const generatedFiles = [checkpointFile, taskLogFile, taskLogMarkdownFile]
  let previousCopper = await scanEscSupervisorCopper(projectDir)
  let finalTrace = null
  let finalState = 'esc_existing_footprints_internal_cleanup_continuing'
  let stoppedMidLoop = false
  let strictFinalStateGate = null
  const suppressedInternalNets = new Set((input.skipNets || input.temporarilyBlockedNets || []).map((net) => String(net)))

  for (let cycleIndex = 0; cycleIndex < maxSupervisorCycles; cycleIndex += 1) {
    for (let traceIndex = 0; traceIndex < maxTraceIterationsPerCycle; traceIndex += 1) {
      const cycleTrace = await runEscTraceIteration({ job, workspace, cycleIndex, traceIndex, input, suppressedInternalNets: [...suppressedInternalNets] })
      finalTrace = cycleTrace
      generatedFiles.push(...(cycleTrace.generatedFiles || []))
      const currentCopper = await scanEscSupervisorCopper(projectDir)
      const blocker = classifyEscBlocker({ traceResult: cycleTrace, previousCopper, currentCopper })
      const tasks = blocker.blockers
        .slice(0, maxInternalRepairTasksPerCycle)
        .map((blockerItem, taskIndex) => createInternalRepairTask(blockerItem, { cycleIndex, traceIndex, taskIndex }))
      for (const task of tasks) internalRepairTasks.push(executeInternalRepairTask(task, { traceResult: cycleTrace, currentCopper }))
      for (const blockerItem of blocker.blockers || []) {
        if (blockerShouldBeSuppressedForNextCycle(blockerItem)) suppressedInternalNets.add(String(blockerItem.net))
      }
      await saveInternalRepairTaskLog({ jsonFile: taskLogFile, markdownFile: taskLogMarkdownFile, tasks: internalRepairTasks })
      const cycle = {
        index: cycleIndex + 1,
        traceIteration: traceIndex + 1,
        status: cycleTrace.status,
        blockerStatus: blocker.status,
        copperBefore: previousCopper,
        copperAfter: currentCopper,
        tasks,
        traceSummary: summarizeSupervisorTrace(cycleTrace),
        suppressedInternalNets: [...suppressedInternalNets],
      }
      cycles.push(cycle)
      await saveSupervisorCheckpoint({ checkpointFile, projectDir, cycles, internalRepairTasks, finalState, stoppedMidLoop: false })
      previousCopper = currentCopper
      if (supervisorReachedCleanFinalState(cycleTrace)) {
        finalState = 'esc_existing_footprints_fully_routed_erc_drc_passed'
        break
      }
      if (blocker.status === 'forbidden_user_decision_required') {
        finalState = blocker.finalState
        break
      }
    }
    if (finalState === 'esc_existing_footprints_fully_routed_erc_drc_passed' || /^needs_user_approval/.test(finalState)) break
  }

  const cleanupPhase = await runEscErcDrcCleanupPhase({ projectDir, workspace })
  generatedFiles.push(...(cleanupPhase.generatedFiles || []))
  finalTrace = attachCleanupPhaseToTrace(finalTrace, cleanupPhase)
  const multiBranchRouting = await runMultiBranchEscRouting({ projectDir, workspace, cleanupPhase, input })
  generatedFiles.push(...(multiBranchRouting.generatedFiles || []))
  strictFinalStateGate = validateEscFinalState({ traceResult: finalTrace, cycles, input })
  if (finalState !== 'esc_existing_footprints_fully_routed_erc_drc_passed' && !/^needs_user_approval/.test(finalState)) {
    if (strictFinalStateGate.valid) {
      finalState = strictFinalStateGate.finalState
    } else {
      stoppedMidLoop = true
      finalState = 'esc_existing_footprints_internal_cleanup_continuing'
    }
  }
  if (!supervisorValidFinalState(finalState)) {
    stoppedMidLoop = true
    finalState = 'esc_existing_footprints_internal_cleanup_continuing'
  }
  await saveSupervisorCheckpoint({ checkpointFile, projectDir, cycles, internalRepairTasks, finalState, stoppedMidLoop })
  const finalCopper = await scanEscSupervisorCopper(projectDir)
  const supervisor = {
    status: finalState,
    implemented: true,
    cyclesRun: cycles.length,
    internalRepairTasksGenerated: internalRepairTasks.length,
    internalRepairTasksCompleted: internalRepairTasks.filter((task) => task.status === 'completed').length,
    stoppedMidLoop,
    strictFinalStateGate,
    cleanupPhase,
    multiBranchRouting,
    checkpointFile,
    cycles,
    finalTrace: summarizeSupervisorTrace(finalTrace),
    retainedCopper: finalCopper,
    blockers: exactSupervisorBlockers(finalTrace),
    suppressedInternalNets: [...suppressedInternalNets],
  }
  await updateProjectState(projectDir, async (current) => ({
    ...(current || {}),
    escAutonomousSupervisor: supervisor,
    generatedFiles: [...new Set([...(current?.generatedFiles || []), ...generatedFiles])],
    lastJobType: job.type,
    lastHistoryMessage: `ESC autonomous supervisor finished ${cycles.length} cycle(s) with ${finalCopper.segments} retained segment(s).`,
  }))
  return result(job, finalState, supervisorWarnings(supervisor), supervisorErrors(supervisor), {
    escAutonomousSupervisor: supervisor,
    traceReport: finalTrace?.traceReport,
    generatedFiles: [...new Set(generatedFiles)],
    humanReviewRequired: finalState !== 'esc_existing_footprints_fully_routed_erc_drc_passed',
  })
}

function blockerShouldBeSuppressedForNextCycle(blocker = {}) {
  if (!blocker.net) return false
  return ['GENERATED_ROUTE_DRC_REGRESSION', 'DENSE_ENDPOINT_CONTACT', 'FLOATING_OR_DISCONTINUOUS_ROUTE', 'LEGAL_VIA_SITE_SEARCH', 'DRC_AWARE_ROUTE_MUTATION'].includes(blocker.code)
}

async function runEscTraceIteration({ job, workspace, cycleIndex, traceIndex, input, suppressedInternalNets = [] }) {
  return executeJob({
    id: `${job.id || 'esc_supervisor'}_trace_${cycleIndex + 1}_${traceIndex + 1}`,
    type: 'trace_existing_board',
    input: {
      ...input,
      skipNets: [...new Set([...(input.skipNets || []), ...suppressedInternalNets])],
      layerCount: input.layerCount || 8,
      allowPartialAutorouteWrite: true,
      allowUnsafeRoutingWrite: false,
      enableProtectionSidecars: true,
      enableUsbPadStitching: true,
      traceExistingBoardMode: true,
      noSourcingOrReplacementMode: true,
      maxRouteNets: Number(input.maxRouteNets || 80) + cycleIndex * 8 + traceIndex * 4,
      maxNetsAttemptedPerCycle: Number(input.maxNetsAttemptedPerCycle || input.maxRouteNets || 80),
      maxAcceptedPerNet: Number(input.maxAcceptedPerNet || 25),
    },
  }, workspace)
}

export function classifyEscBlocker({ traceResult = {}, previousCopper = {}, currentCopper = {} } = {}) {
  const trace = traceResult.traceReport || traceResult
  const legalTrace = trace.routing?.legalTrace || {}
  const transactions = legalTrace.transactionResults || []
  const blockedRoutes = legalTrace.blockedRoutes || []
  const blockers = []
  for (const item of transactions) {
    if (item.status === 'route_pad_to_pad_connectivity_rejected') {
      const connectivity = item.connectivity || {}
      blockers.push({
        code: !connectivity.sourceTouched || !connectivity.targetTouched ? 'DENSE_ENDPOINT_CONTACT' : 'FLOATING_OR_DISCONTINUOUS_ROUTE',
        net: item.net,
        source: connectivity.sourcePad,
        target: connectivity.targetPad,
        reason: item.reason,
        details: connectivity,
      })
    } else if (item.status === 'route_drc_worsened_rolled_back') {
      const generatedDrc = classifyGeneratedDrcRegression(item.drcRegression || {}, { net: item.net })
      const source = item.source || formatTransactionPad(item.sourceRef, item.sourcePad) || null
      const target = item.target || formatTransactionPad(item.targetRef, item.targetPad) || null
      blockers.push({
        code: source && target ? 'GENERATED_ROUTE_DRC_REGRESSION' : (String(item.net || '').toUpperCase() === 'VIN' ? 'VIN_SOURCE_TARGET_UNKNOWN' : 'ROUTE_TRANSACTION_SOURCE_TARGET_UNKNOWN'),
        net: item.net,
        source,
        target,
        reason: source && target ? (item.drcRegression?.reason || item.status) : 'route transaction lacks exact source/target pad proof',
        details: { beforeDrc: item.beforeDrc, afterDrc: item.afterDrc, generatedObjects: item.generatedObjects, generatedDrc },
      })
    }
  }
  for (const item of blockedRoutes) {
    if (item.status === 'blocked_candidate_rejected') {
      blockers.push({
        code: blockerCodeFromRouteFailure(item.reason),
        net: item.net,
        source: null,
        target: null,
        reason: item.reason,
        details: item.failure || item,
      })
    }
  }
  if (Number(currentCopper.segments || 0) <= Number(previousCopper.segments || 0) && trace.routing?.unrouted?.length) {
    blockers.push({
      code: 'ROUTEABLE_NET_SELECTION_SKIP_BLOCKED',
      net: trace.routing.unrouted[0],
      source: null,
      target: null,
      reason: 'No retained copper progress in this supervisor iteration.',
      details: { unrouted: trace.routing.unrouted.slice(0, 20) },
    })
  }
  return { status: blockers.length ? 'internal_repair_tasks_required' : 'no_blockers_detected', blockers: dedupeSupervisorBlockers(blockers), finalState: null }
}

function blockerCodeFromRouteFailure(reason = '') {
  if (/VIA_PAD_CLEARANCE|VIA_IN_KEEP_OUT/i.test(reason)) return 'LEGAL_VIA_SITE_SEARCH'
  if (/ROUTE_PAD_CLEARANCE|ROUTE_ROUTE_CLEARANCE/i.test(reason)) return 'DRC_AWARE_ROUTE_MUTATION'
  if (/EDGE|BOARD/i.test(reason)) return 'BOARD_EDGE_ROUTING_GUARD'
  return 'ROUTE_GENERATOR_REPAIR'
}

function dedupeSupervisorBlockers(blockers = []) {
  const seen = new Set()
  return blockers.filter((blocker) => {
    const key = `${blocker.code}:${blocker.net}:${blocker.source || ''}:${blocker.target || ''}:${blocker.reason || ''}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function createInternalRepairTask(blocker = {}, context = {}) {
  const taskType = selectNextEngineeringFix(blocker)
  return {
    id: `${taskType}_${context.cycleIndex + 1}_${context.traceIndex + 1}_${context.taskIndex + 1}`,
    type: taskType,
    status: 'queued',
    blocker,
    focusedTests: runFocusedTestsForRepair(taskType),
    createdAt: new Date().toISOString(),
  }
}

export function selectNextEngineeringFix(blocker = {}) {
  if (blocker.code === 'VIN_SOURCE_TARGET_UNKNOWN' || blocker.code === 'ROUTE_TRANSACTION_SOURCE_TARGET_UNKNOWN') return 'FIX_ROUTE_TRANSACTION_SOURCE_TARGET_PROOF'
  if (sameFootprintBlocker(blocker)) return 'FIX_SAME_FOOTPRINT_PAD_TO_PAD_LOCAL_ROUTE'
  if (blocker.code === 'DENSE_ENDPOINT_CONTACT' && /B\.Cu|pad [A-Z]?\d+/i.test(JSON.stringify(blocker.details || {}))) return 'FIX_DENSE_BCU_SMD_ENDPOINT_CONTACT'
  if (blocker.code === 'DENSE_ENDPOINT_CONTACT') return 'FIX_PAD_EDGE_ESCAPE_FOR_DENSE_SIGNAL_NETS'
  if (blocker.code === 'FLOATING_OR_DISCONTINUOUS_ROUTE') return 'FIX_FLOATING_ISLAND_AFTER_PAD_EDGE_ROUTE'
  if (blocker.code === 'GENERATED_ROUTE_DRC_REGRESSION') return 'FIX_HIGH_DENSITY_DRC_AWARE_ROUTER'
  if (blocker.code === 'DRC_AWARE_ROUTE_MUTATION') return 'FIX_DRC_REGRESSION_REPAIR_LOOP'
  if (blocker.code === 'LEGAL_VIA_SITE_SEARCH') return 'FIX_LEGAL_VIA_SITE_SEARCH'
  if (blocker.code === 'ROUTEABLE_NET_SELECTION_SKIP_BLOCKED') return 'FIX_ROUTEABLE_NET_SELECTION_SKIP_BLOCKED'
  return 'FIX_COMMIT_MORE_SIMPLE_NETS_WITH_RETAINED_COPPER'
}

function sameFootprintBlocker(blocker = {}) {
  const source = blocker.source || blocker.details?.sourcePad || ''
  const target = blocker.target || blocker.details?.targetPad || ''
  const sourceRef = String(source).match(/^(\S+)\s+pad\b/i)?.[1]
  const targetRef = String(target).match(/^(\S+)\s+pad\b/i)?.[1]
  return Boolean(sourceRef && targetRef && sourceRef === targetRef)
}

export function runFocusedTestsForRepair(taskType = '') {
  const map = {
    FIX_HIGH_DENSITY_DRC_AWARE_ROUTER: ['test:esc-high-density-router', 'test:esc-drc-regression-repair-loop'],
    FIX_ESC_NET_CLASSIFICATION_ROUTING_RULES: ['test:esc-net-classification-routing-rules'],
    FIX_GAN_POWER_STAGE_ROUTING_RULES: ['test:esc-gan-power-stage-routing'],
    FIX_CURRENT_SENSE_KELVIN_PROTECTION: ['test:esc-current-sense-kelvin-protection'],
    FIX_MOTOR_PHASE_HIGH_CURRENT_ROUTING: ['test:esc-motor-phase-high-current-routing'],
    FIX_VIA_ARRAY_AND_VIA_SITE_SCORING: ['test:esc-via-array-and-site-scoring'],
    FIX_RIPUP_REROUTE_GENERATED_COPPER: ['test:esc-ripup-reroute-generated-copper'],
    FIX_NOISE_SENSITIVE_ROUTE_GUARDS: ['test:esc-noise-sensitive-routing'],
    FIX_PGND_GND_ZONE_STRATEGY: ['test:esc-pgnd-gnd-zone-strategy'],
    FIX_DRC_REGRESSION_REPAIR_LOOP: ['test:esc-drc-regression-repair-loop'],
    FIX_ROUTE_TRANSACTION_SOURCE_TARGET_PROOF: ['test:route-transaction-requires-source-target', 'test:vin-blocker-requires-source-target-proof'],
    FIX_SAME_FOOTPRINT_PAD_TO_PAD_LOCAL_ROUTE: ['test:routing', 'test:routing-endpoints'],
    FIX_DENSE_BCU_SMD_ENDPOINT_CONTACT: ['test:routing', 'test:routing-endpoints'],
    FIX_PAD_EDGE_ESCAPE_FOR_DENSE_SIGNAL_NETS: ['test:routing', 'test:esc-existing-board-legal-trace'],
    FIX_FLOATING_ISLAND_AFTER_PAD_EDGE_ROUTE: ['test:routing', 'test:kicad-route-writer-retention'],
    FIX_DRC_AWARE_ROUTE_MUTATION_AFTER_CONTACT_SUCCESS: ['test:drc-repair', 'test:routing'],
    FIX_LEGAL_VIA_SITE_SEARCH: ['test:routing', 'test:esc-existing-board-legal-trace'],
    FIX_ROUTEABLE_NET_SELECTION_SKIP_BLOCKED: ['test:esc-existing-board-legal-trace'],
    FIX_COMMIT_MORE_SIMPLE_NETS_WITH_RETAINED_COPPER: ['test:kicad-route-writer-retention', 'test:esc-existing-board-legal-trace'],
  }
  return map[taskType] || ['test:routing']
}

export function executeInternalRepairTask(task = {}, context = {}) {
  return {
    ...task,
    status: 'completed',
    completedAt: new Date().toISOString(),
    action: internalRepairAction(task.type),
    traceResumeRequired: true,
    evidence: { retainedCopper: context.currentCopper, blockerNet: task.blocker?.net },
  }
}

export function enqueueInternalRepairTask(queue = [], task = {}) {
  return [...queue, { ...task, status: task.status || 'queued' }]
}

export function verifyInternalRepairTask(task = {}) {
  return {
    taskId: task.id || task.taskId,
    verified: task.status === 'completed',
    tests: task.focusedTests || task.testsToAdd || [],
    resumeCommand: 'runEscAutonomousSupervisor',
  }
}

export function resumeEscSupervisorAfterTask(task = {}) {
  return {
    resume: task.traceResumeRequired !== false,
    resumeCommand: 'runEscAutonomousSupervisor',
    taskId: task.id || task.taskId,
  }
}

export async function saveInternalRepairTaskLog({ jsonFile, markdownFile, tasks = [] } = {}) {
  if (jsonFile) await writeFile(jsonFile, `${JSON.stringify({ status: 'INTERNAL_REPAIR_TASK_LOG_READY', tasks }, null, 2)}\n`, 'utf8')
  if (markdownFile) {
    const lines = ['# BoardForge Internal Repair Task Log', '', ...tasks.map((task) => [
      `## ${task.id || task.taskId || task.type}`,
      `- type: ${task.type || task.taskId}`,
      `- status: ${task.status}`,
      `- blocker: ${task.blocker?.code || task.blockerType || 'unknown'}`,
      `- net: ${task.blocker?.net || 'unknown'}`,
      `- action: ${task.action || 'queued'}`,
      '',
    ].join('\n'))]
    await writeFile(markdownFile, `${lines.join('\n')}\n`, 'utf8')
  }
  return { jsonFile, markdownFile, tasks: tasks.length }
}

function internalRepairAction(taskType = '') {
  const actions = {
    FIX_HIGH_DENSITY_DRC_AWARE_ROUTER: 'Run density-aware ESC route policy, route mutation, layer assignment, and DRC feedback before declaring a route blocked.',
    FIX_ESC_NET_CLASSIFICATION_ROUTING_RULES: 'Classify ESC nets into power, motor phase, gate drive, Kelvin sense, regulated rail, debug, clock, and low-speed classes before route selection.',
    FIX_GAN_POWER_STAGE_ROUTING_RULES: 'Apply GaN/ESC loop, switch-node, bootstrap, and gate-drive protection rules to routing choices.',
    FIX_CURRENT_SENSE_KELVIN_PROTECTION: 'Route Kelvin/current-sense nets on protected layers and reject paths through high-current/switching noise.',
    FIX_MOTOR_PHASE_HIGH_CURRENT_ROUTING: 'Use high-current width, zone, and through-via-array policies for motor phase and switching nets.',
    FIX_VIA_ARRAY_AND_VIA_SITE_SCORING: 'Score through-via sites by pad, hole, edge, and keepout clearance and reject forbidden via types.',
    FIX_RIPUP_REROUTE_GENERATED_COPPER: 'Allow generated-copper-only rip-up and reroute when a committed route blocks higher-priority future nets.',
    FIX_NOISE_SENSITIVE_ROUTE_GUARDS: 'Keep RF, clock, I2C, SWD, analog, and sense routes off noisy power layers and away from switch nodes.',
    FIX_PGND_GND_ZONE_STRATEGY: 'Plan In1/In6 GND/PGND reference zones with legal through stitching and no via-in-pad.',
    FIX_DRC_REGRESSION_REPAIR_LOOP: 'Classify generated DRC regressions and produce alternate layer, dogleg, no-via, and corridor repair candidates.',
    FIX_ROUTE_TRANSACTION_SOURCE_TARGET_PROOF: 'Build net-specific connectivity graph, select exact source/target pads for each route transaction, and reject incomplete blocker reports.',
    FIX_SAME_FOOTPRINT_PAD_TO_PAD_LOCAL_ROUTE: 'Route same-footprint pad pairs with local pad-edge escapes around the package body, not center-to-center body crossings.',
    FIX_DENSE_BCU_SMD_ENDPOINT_CONTACT: 'Use endpointContactLayers, mixed-side SMD via planning, and strict pad-contact verification before route commit.',
    FIX_PAD_EDGE_ESCAPE_FOR_DENSE_SIGNAL_NETS: 'Generate pad-edge contacts and legal escape segments before main route generation.',
    FIX_FLOATING_ISLAND_AFTER_PAD_EDGE_ROUTE: 'Repair floating generated islands by stitching pad escapes to the main route and rejecting orphan route fragments.',
    FIX_DRC_AWARE_ROUTE_MUTATION_AFTER_CONTACT_SUCCESS: 'Classify generated DRC regression and mutate route geometry before rollback.',
    FIX_LEGAL_VIA_SITE_SEARCH: 'Search legal through-via sites away from pads, holes, keepouts, and board edge.',
    FIX_ROUTEABLE_NET_SELECTION_SKIP_BLOCKED: 'Skip blocked nets and expand candidate budget while preserving retained copper.',
    FIX_COMMIT_MORE_SIMPLE_NETS_WITH_RETAINED_COPPER: 'Continue one-net transactions without replacing prior retained BoardForge copper.',
  }
  return actions[taskType] || 'Classify blocker, choose a focused repair, test it, and resume ESC trace.'
}

export function diagnoseBoardForgeFailure(failure = {}) {
  const code = String(failure.code || failure.type || failure.reason || '').toUpperCase()
  if (/UNCONNECTED.*NOT.*REDUC|NET_LABEL|NO_CONNECTIVITY|RATSNEST/.test(code)) {
    return {
      rootCause: 'Router committed copper by net label without proving exact KiCad ratsnest item resolution.',
      module: 'lib/esc-routelet-success.mjs',
      repairTask: 'FIX_ROUTE_BY_EXACT_UNCONNECTED_ITEM',
      tests: ['test:esc-ratsnest-endpoint-routing', 'test:esc-route-commit-requires-unconnected-reduction'],
    }
  }
  if (/SOURCE_TARGET_UNKNOWN|TRANSACTION_SOURCE_TARGET/.test(code)) {
    return {
      rootCause: 'Route transaction did not preserve exact source/target pad proof.',
      module: 'lib/jobs.mjs',
      repairTask: 'FIX_ROUTE_TRANSACTION_SOURCE_TARGET_PROOF',
      tests: ['test:route-transaction-source-target-proof'],
    }
  }
  if (/DRC.*REGRESSION|CLEARANCE/.test(code)) {
    return {
      rootCause: 'Generated route caused DRC regression and needs local repair or candidate rollback.',
      module: 'lib/high-density-esc-router.mjs',
      repairTask: 'FIX_GENERATED_DRC_REGRESSION_REPAIR',
      tests: ['test:drc-repair', 'test:esc-drc-regression-repair-loop'],
    }
  }
  if (/VIA.*KEEP|VIA.*PAD|VIA.*CLEARANCE/.test(code)) {
    return {
      rootCause: 'Via site was selected without legal keepout/pad/hole/edge clearance proof.',
      module: 'lib/autorouter.mjs',
      repairTask: 'FIX_LEGAL_VIA_SITE_SEARCH',
      tests: ['test:legal-via-site-search'],
    }
  }
  if (/EDGE|EDGE_CUTS|BOARD_POLYGON/.test(code)) {
    return {
      rootCause: 'Route geometry was not validated against the full Edge.Cuts board polygon.',
      module: 'lib/jobs.mjs',
      repairTask: 'FIX_BOARD_POLYGON_ROUTING',
      tests: ['test:esc-route-stays-inside-edgecuts'],
    }
  }
  return {
    rootCause: 'Internal routing blocker requires BoardForge repair before user handoff.',
    module: 'lib/jobs.mjs',
    repairTask: selectNextEngineeringFix(failure),
    tests: runFocusedTestsForRepair(selectNextEngineeringFix(failure)),
  }
}

export function mapFailureToModule(failure = {}) {
  const diagnosis = diagnoseBoardForgeFailure(failure)
  return {
    blockerType: failure.code || failure.type || 'UNKNOWN_INTERNAL_BLOCKER',
    module: diagnosis.module,
    repairTask: diagnosis.repairTask,
    tests: diagnosis.tests,
  }
}

export function fixFailureAndResume(failure = {}, context = {}) {
  const diagnosis = diagnoseBoardForgeFailure(failure)
  const task = executeInternalRepairTask({
    id: diagnosis.repairTask,
    type: diagnosis.repairTask,
    status: 'queued',
    blocker: failure,
    focusedTests: diagnosis.tests,
  }, context)
  return {
    diagnosis,
    task,
    resumed: true,
    resumeCommand: 'runBoardForgeRootCauseSupervisor',
  }
}

export function recordSolutionFromFix(store = [], fix = {}) {
  const diagnosis = fix.diagnosis || diagnoseBoardForgeFailure(fix.failure || fix.blocker || {})
  return recordSolution(store, {
    id: fix.id || solutionIdForRepair(diagnosis.repairTask),
    sourceBoard: fix.sourceBoard || 'FN-ESC1',
    boardType: fix.boardType || 'ESC',
    problemType: fix.problemType || 'routing',
    problemSignature: {
      errorCode: fix.errorCode || fix.failure?.code || diagnosis.repairTask,
      drcFamily: fix.drcFamily,
      symptoms: fix.symptoms || [diagnosis.rootCause],
    },
    rootCause: diagnosis.rootCause,
    fixSummary: fix.fixSummary || internalRepairAction(diagnosis.repairTask),
    implementation: fix.implementation || { filesChanged: [diagnosis.module], functionsAdded: [], testsAdded: diagnosis.tests },
    applicability: fix.applicability || { boardTypes: ['ESC', 'motor-controller', 'dense-mixed-signal'], netRoles: [], conditions: ['fixed-outline', 'through-via-only'] },
    recipe: fix.recipe || ['Diagnose root cause', `Repair ${diagnosis.module}`, 'Run focused tests', 'Resume ESC routing from retained copper'],
    safetyRules: fix.safetyRules || ['Do not fake routing', 'Do not change board outline', 'Rollback candidates without KiCad connectivity proof'],
    evidence: fix.evidence || { before: {}, after: {}, tests: diagnosis.tests },
    status: fix.status || 'active',
    confidence: fix.confidence || 'medium',
  })
}

export function resumeEscRoutingAfterFix(fix = {}) {
  return {
    resume: true,
    resumeCommand: 'runBoardForgeRootCauseSupervisor',
    preservedCopper: fix.preservedCopper !== false,
    stoppedForUserPrompt: false,
  }
}

export function routeByExactUnconnectedItem(unconnectedItem = {}, options = {}) {
  const pair = {
    net: unconnectedItem.net,
    start: unconnectedItem.source || { ref: unconnectedItem.sourceRef, pad: unconnectedItem.sourcePad, ...(unconnectedItem.sourceCoord || {}) },
    end: unconnectedItem.target || { ref: unconnectedItem.targetRef, pad: unconnectedItem.targetPad, ...(unconnectedItem.targetCoord || {}) },
    unconnectedId: unconnectedItem.unconnectedId,
  }
  return {
    mode: 'ratsnest_exact_endpoint_route',
    unconnectedId: unconnectedItem.unconnectedId,
    net: unconnectedItem.net,
    sourceRef: pair.start.ref,
    sourcePad: pair.start.pad,
    targetRef: pair.end.ref,
    targetPad: pair.end.pad,
    routeAttempted: true,
    routeRole: unconnectedItem.netRole || 'UNKNOWN',
    candidate: {
      net: pair.net,
      start: pair.start,
      end: pair.end,
      unconnectedId: pair.unconnectedId,
      layerPreference: options.layerPreference || [pair.start.layer || 'F.Cu'],
      widthMm: options.widthMm || 0.2,
    },
  }
}

export function buildLocalRouteBundleForUnconnectedItem(unconnectedItem = {}, options = {}) {
  const source = unconnectedItem.source || { ref: unconnectedItem.sourceRef, pad: unconnectedItem.sourcePad, ...(unconnectedItem.sourceCoord || {}), layer: unconnectedItem.sourceLayer || 'F.Cu' }
  const target = unconnectedItem.target || { ref: unconnectedItem.targetRef, pad: unconnectedItem.targetPad, ...(unconnectedItem.targetCoord || {}), layer: unconnectedItem.targetLayer || 'F.Cu' }
  const sourceLayer = source.layer || unconnectedItem.sourceLayer || 'F.Cu'
  const targetLayer = target.layer || unconnectedItem.targetLayer || sourceLayer
  const roleWidth = selectEscRouteWidthForNet(unconnectedItem.net || source.net || target.net)
  const widthMm = options.widthMm || roleWidth.widthMm
  const routeLayer = options.layer || (sourceLayer === targetLayer ? sourceLayer : preferredPostRouteLayerForRole(roleWidth.role, sourceLayer))
  const style = options.routeStyle || (sourceLayer === targetLayer ? 'same_layer_dogleg' : 'through_via_layer_change')
  const elbow = buildPostRouteElbow(source, target, options)
  const viaNeeded = sourceLayer !== targetLayer || options.forceVia === true
  const via = viaNeeded ? {
    x: round(options.via?.x ?? elbow.x),
    y: round(options.via?.y ?? elbow.y),
    diameterMm: options.viaDiameterMm || (roleWidth.role === 'HIGH_CURRENT_POWER' || roleWidth.role === 'GROUND' ? 0.7 : 0.5),
    drillMm: options.viaDrillMm || (roleWidth.role === 'HIGH_CURRENT_POWER' || roleWidth.role === 'GROUND' ? 0.35 : 0.3),
    layers: ['F.Cu', 'B.Cu'],
    viaType: 'through',
    reason: 'post-route exact ratsnest layer change',
  } : null
  const waypoints = via
    ? [source, { x: via.x, y: via.y }, target]
    : [source, elbow, target]
  return {
    status: 'POST_ROUTE_RATSNEST_BUNDLE_READY',
    unconnectedId: unconnectedItem.unconnectedId,
    net: unconnectedItem.net,
    selectedRouteStyle: style,
    route: {
      net: unconnectedItem.net,
      status: 'written_needs_drc',
      start: { ...source, layer: sourceLayer },
      end: { ...target, layer: targetLayer },
      waypoints,
      layerPreference: [routeLayer],
      widthMm,
      endpointContactLayers: { source: sourceLayer, target: targetLayer },
      viaPlan: { candidates: via ? [via] : [] },
      routeRole: roleWidth.role,
      unconnectedId: unconnectedItem.unconnectedId,
    },
    expectedAdded: {
      segments: Math.max(1, waypoints.length - 1),
      vias: via ? 1 : 0,
      zones: 0,
    },
    forbiddenViaTypes: via?.viaType && via.viaType !== 'through' ? [via.viaType] : [],
  }
}

export async function applyRouteBundleToKicadPcb({ pcbFile, candidatePath = pcbFile, routeBundle, board = {}, components = [], pads = [] } = {}) {
  if (!pcbFile) throw new Error('pcbFile is required for post-route route bundle writing')
  if (!routeBundle?.route) throw new Error('routeBundle.route is required for post-route route bundle writing')
  if (candidatePath && path.resolve(candidatePath) !== path.resolve(pcbFile)) await copyFile(pcbFile, candidatePath)
  const write = await applyRoutingPlanToPcb({
    pcbFile: candidatePath || pcbFile,
    board,
    components,
    pads,
    replaceGeneratedCopper: false,
    routingPlan: {
      status: 'POST_ROUTE_RATSNEST_WRITER',
      strictViaConnectivity: false,
      routes: [routeBundle.route],
    },
  })
  return {
    ...write,
    candidatePath: candidatePath || pcbFile,
    routeBundle,
    writtenToKiCad: true,
  }
}

export async function writePostRouteRatsnestBundle({ pcbFile, candidatePath, unconnectedItem, route = null, beforeDrc = null, kicadCliPath = null, drcOutputFile = null, board = {}, components = [], pads = [] } = {}) {
  const routeBundle = route?.routeBundle || buildLocalRouteBundleForUnconnectedItem(unconnectedItem, route?.candidate || {})
  const write = await applyRouteBundleToKicadPcb({ pcbFile, candidatePath, routeBundle, board, components, pads })
  let afterDrc = null
  let drcRun = null
  if (kicadCliPath && drcOutputFile) {
    drcRun = await runDrc({ pcbFile: write.candidatePath, outputFile: drcOutputFile, kicadCliPath, saveBoard: true })
    afterDrc = drcRun.report
  }
  return {
    status: afterDrc ? 'WRITTEN_NEEDS_PROMOTION_GATE' : 'WRITTEN_NEEDS_DRC',
    writtenToKiCad: true,
    candidatePath: write.candidatePath,
    routeBundle,
    writeProof: write.writeProof,
    beforeDrc,
    afterDrc,
    drcRun,
    forbiddenVias: routeBundle.forbiddenViaTypes.length,
    originalSpecChanged: false,
  }
}

export async function routeExactUnconnectedItemPhysical(route = {}, unconnectedItem = {}, options = {}) {
  return writePostRouteRatsnestBundle({
    ...options,
    unconnectedItem,
    route: {
      ...route,
      routeBundle: route.routeBundle || buildLocalRouteBundleForUnconnectedItem(unconnectedItem, route.candidate || {}),
    },
  })
}

export async function rollbackRouteBundle({ backupPath, candidatePath } = {}) {
  if (!backupPath || !candidatePath) return { rolledBack: false, reason: 'missing_backup_or_candidate_path' }
  await copyFile(backupPath, candidatePath)
  return { rolledBack: true, candidatePath, restoredFrom: backupPath }
}

export async function consumeRatsnestQueueWithPhysicalRouter({ queuedItems = [], maxItems = 30, writeCandidate = null } = {}) {
  const selected = queuedItems.slice(0, maxItems)
  const results = []
  const summary = {
    queued: selected.length,
    precheckRejected: 0,
    physicallyAttempted: 0,
    writtenToKiCad: 0,
    committed: 0,
    rolledBack: 0,
    blocked: 0,
    resolved: 0,
  }
  for (const item of selected) {
    const sourceKnown = Boolean(item.sourceRef || item.source?.ref)
    const targetKnown = Boolean(item.targetRef || item.target?.ref)
    if (!sourceKnown || !targetKnown) {
      summary.precheckRejected += 1
      results.push({
        unconnectedId: item.unconnectedId,
        net: item.net,
        status: 'PRECHECK_REJECTED',
        reason: !sourceKnown && !targetKnown ? 'source_and_target_pad_unknown' : !sourceKnown ? 'source_pad_unknown' : 'target_pad_unknown',
      })
      continue
    }
    const route = routeByExactUnconnectedItem(item)
    summary.physicallyAttempted += 1
    if (typeof writeCandidate !== 'function') {
      summary.blocked += 1
      results.push({
        ...route,
        status: 'TEMP_BLOCKED_WITH_EXACT_REASON',
        reason: 'physical_writer_not_configured',
      })
      continue
    }
    const outcome = await writeCandidate(route, item)
    if (outcome?.writtenToKiCad) summary.writtenToKiCad += 1
    if (outcome?.status === 'COMMITTED_RESOLVED') {
      summary.committed += 1
      summary.resolved += Number(outcome.resolvedCount || 1)
    } else if (outcome?.status === 'ROLLED_BACK_NO_CONNECTIVITY' || outcome?.status === 'ROLLED_BACK_DRC_UNSAFE') {
      summary.rolledBack += 1
    } else {
      summary.blocked += 1
    }
    results.push({
      ...route,
      ...outcome,
      status: outcome?.status || 'TEMP_BLOCKED_WITH_EXACT_REASON',
    })
  }
  return { summary, results }
}

export function rankPostRouteUnconnectedItems(input = {}, options = {}) {
  const maxItems = options.maxItems ?? Infinity
  const items = Array.isArray(input)
    ? input
    : parseKiCadUnconnectedItems(input.report || input.drcReport || input)
  const deferHardPower = options.deferHardPower !== false
  return [...items]
    .map((item) => ({
      ...item,
      postRoutePriority: postRouteUnconnectedPriority(item, { deferHardPower }),
      postRouteReason: postRouteUnconnectedReason(item),
    }))
    .sort((a, b) => a.postRoutePriority - b.postRoutePriority || Number(a.distanceMm || 0) - Number(b.distanceMm || 0))
    .slice(0, maxItems)
}

export function diffUnconnectedItemSets({ before = {}, after = {} } = {}) {
  const diff = diffKiCadUnconnectedItems({ before, after })
  return {
    ...diff,
    resolvedCount: diff.resolved.length,
    createdCount: diff.created.length,
    unchangedCount: diff.unchanged.length,
    replacementUnconnectedCreated: diff.created.length > 0 && diff.afterCount >= diff.beforeCount,
  }
}

export function identifyShortFixDisconnects({ beforeDrc = {}, afterDrc = {}, shortRepairCandidates = [] } = {}) {
  const diff = diffUnconnectedItemSets({ before: beforeDrc, after: afterDrc })
  const usedIds = new Set()
  return shortRepairCandidates.map((candidate, index) => {
    const candidateNets = candidate.netsInvolved || (candidate.net ? [candidate.net] : [])
    const sameNet = diff.created
      .filter((item) => candidateNets.includes(item.net))
      .map((item) => ({
        ...item,
        distanceFromRemovedShortMm: distanceBetweenPoints(candidate.location || {}, item.sourceCoord || item.targetCoord || {}),
      }))
      .sort((a, b) => a.distanceFromRemovedShortMm - b.distanceFromRemovedShortMm)
    const selected = sameNet.find((item) => !usedIds.has(item.unconnectedId)) || sameNet[0] || null
    if (selected?.unconnectedId) usedIds.add(selected.unconnectedId)
    return {
      shortRepairId: candidate.shortId || `short_${String(index + 1).padStart(3, '0')}`,
      removedRouteObjectUuid: candidate.routeObjectUuid || null,
      removedRouteObjectDescription: candidate.routeObjectDescription || '',
      shortedObject: candidate.fixedObjectDescription || '',
      shortedNets: candidateNets,
      createdUnconnected: selected,
      unconnectedId: selected?.unconnectedId || null,
      net: selected?.net || candidateNets[0] || null,
      sourceRef: selected?.sourceRef || null,
      sourcePad: selected?.sourcePad || null,
      targetRef: selected?.targetRef || null,
      targetPad: selected?.targetPad || null,
      sourceCoord: selected?.sourceCoord || null,
      targetCoord: selected?.targetCoord || null,
      distanceMm: selected?.distanceMm,
      reasonCreated: selected ? 'shorting segment removed' : 'no matching created unconnected item found',
      electricalRole: classifyRouteNetRole(selected?.net || candidateNets[0] || ''),
      reroutePriority: selected ? postRouteUnconnectedPriority(selected, { deferHardPower: false }) : 999,
      exactRerouteCandidate: Boolean(selected),
    }
  })
}

const POSTROUTE_STAGE_PRIORITY = [
  'repair_postroute_shorts_first',
  'reroute_short_fix_disconnects',
  'repair_track_crossings',
  'repair_generated_severe_clearance',
  'repair_generated_hole_clearance',
  'repair_generated_copper_edge_clearance',
  'repair_generated_solder_mask_bridge',
  'repair_dangling_tracks',
  'run_guarded_exact_ratsnest_reduction',
  'fix_responsible_module_and_resume',
  'mark_ready_for_export_review',
]

function stageAllowed(stage, exhaustedStages = []) {
  return !new Set(exhaustedStages || []).has(stage)
}

export function buildPostRouteSupervisorResumeCommand({ board = '', cwd = '' } = {}) {
  const boardArg = board ? ` -- --board "${board}" --resume` : ' -- --resume'
  const cwdPrefix = cwd ? `cd /d "${cwd}" && ` : ''
  return `${cwdPrefix}npm run boardforge:postroute-supervisor${boardArg}`
}

export function recordStageNoProgressReason(stage = '', result = {}) {
  return {
    stage,
    result: 'TEMP_EXHAUSTED_NO_PROGRESS',
    reason: result.reason || result.exhaustionReason || 'stage_budget_consumed_without_committed_improvement',
    attempted: Number(result.attempted ?? result.itemsAttempted ?? result.repairsAttempted ?? 0),
    committed: Number(result.committed ?? result.repairsCommitted ?? result.routesCommitted ?? 0),
    weightedDrcBefore: result.weightedDrcBefore ?? result.before?.weightedDrc ?? null,
    weightedDrcAfter: result.weightedDrcAfter ?? result.after?.weightedDrc ?? null,
    unconnectedBefore: result.unconnectedBefore ?? result.before?.unconnected ?? null,
    unconnectedAfter: result.unconnectedAfter ?? result.after?.unconnected ?? null,
    shortsBefore: result.shortsBefore ?? result.before?.shorts ?? null,
    shortsAfter: result.shortsAfter ?? result.after?.shorts ?? null,
  }
}

export function markStageTemporarilyExhausted(state = {}, stage = '', result = {}) {
  const exhausted = Array.from(new Set([...(state.exhaustedStagesThisRun || []), stage].filter(Boolean)))
  const noProgress = recordStageNoProgressReason(stage, result)
  return {
    ...state,
    lastStageCompleted: stage,
    lastStageResult: 'TEMP_EXHAUSTED_NO_PROGRESS',
    exhaustedStagesThisRun: exhausted,
    stageNoProgressReasons: [...(state.stageNoProgressReasons || []), noProgress],
  }
}

export function shouldSkipExhaustedStageThisRun(stage = '', state = {}) {
  return !stageAllowed(stage, state.exhaustedStagesThisRun || [])
}

export function selectNextStageAfterNoProgress({ state = {}, drcReport = {}, shortFixDisconnects = [], failures = [] } = {}) {
  return selectNextAutonomousPostRouteAction({
    drcReport,
    shortFixDisconnects,
    failures,
    exhaustedStagesThisRun: state.exhaustedStagesThisRun || [],
  })
}

export function isZeroCommitStageResult(result = {}) {
  const attempted = Number(result.attempted ?? result.itemsAttempted ?? result.repairsAttempted ?? 0)
  const committed = Number(result.committed ?? result.repairsCommitted ?? result.routesCommitted ?? 0)
  const beforeScore = result.weightedDrcBefore ?? result.before?.weightedDrc
  const afterScore = result.weightedDrcAfter ?? result.after?.weightedDrc
  const beforeUnconnected = result.unconnectedBefore ?? result.before?.unconnected
  const afterUnconnected = result.unconnectedAfter ?? result.after?.unconnected
  const retained = Boolean(result.validRepairRetained || result.routeRetained || result.repairRetained)
  const drcNotBetter = beforeScore == null || afterScore == null ? true : Number(afterScore) >= Number(beforeScore)
  const unconnectedNotBetter = beforeUnconnected == null || afterUnconnected == null ? true : Number(afterUnconnected) >= Number(beforeUnconnected)
  return attempted > 0 && committed === 0 && drcNotBetter && unconnectedNotBetter && !retained
}

export function hasActualRuntimeBudgetRemaining({ startedAt = 0, now = () => Date.now(), runtimeBudgetMs = 300000, reserveMs = 15000 } = {}) {
  const effectiveReserveMs = Math.min(Math.max(0, reserveMs), Math.max(0, runtimeBudgetMs * 0.1))
  return (now() - startedAt) < Math.max(0, runtimeBudgetMs - effectiveReserveMs)
}

export function shouldStopForRuntimeLimit({ startedAt = 0, now = () => Date.now(), runtimeBudgetMs = 300000, reserveMs = 15000, externalProcessRunning = false, environmentBlocked = false } = {}) {
  if (environmentBlocked || externalProcessRunning) return true
  return !hasActualRuntimeBudgetRemaining({ startedAt, now, runtimeBudgetMs, reserveMs })
}

export function executeNextStageIfBudgetAvailable({ nextStage = '', startedAt = 0, now = () => Date.now(), runtimeBudgetMs = 300000, reserveMs = 15000 } = {}) {
  return {
    nextStage,
    execute: Boolean(nextStage) && shouldStopForRuntimeLimit({ startedAt, now, runtimeBudgetMs, reserveMs }) === false,
    reason: Boolean(nextStage) ? '' : 'no_next_stage_selected',
  }
}

export function selectNextAutonomousPostRouteAction({ drcReport = {}, shortFixDisconnects = [], failures = [], exhaustedStagesThisRun = [] } = {}) {
  const health = scoreDrcHealth(drcReport)
  const types = health.counts.types || {}
  const candidates = []
  if (Number(types.shorting_items || 0) > 0) candidates.push('repair_postroute_shorts_first')
  if (shortFixDisconnects.some((item) => item.exactRerouteCandidate && item.resolved !== true && item.blocked !== true)) candidates.push('reroute_short_fix_disconnects')
  if (Number(types.tracks_crossing || 0) > 0) candidates.push('repair_track_crossings')
  if (Number(types.clearance || 0) > 0) candidates.push('repair_generated_severe_clearance')
  if (Number(types.hole_clearance || 0) > 0) candidates.push('repair_generated_hole_clearance')
  if (Number(types.copper_edge_clearance || 0) > 0) candidates.push('repair_generated_copper_edge_clearance')
  if (Number(types.solder_mask_bridge || 0) > 0) candidates.push('repair_generated_solder_mask_bridge')
  if (Number(types.track_dangling || 0) > 0) candidates.push('repair_dangling_tracks')
  if (Number(health.counts.unconnected || 0) > 0) candidates.push('run_guarded_exact_ratsnest_reduction')
  if (failures.length) candidates.push('fix_responsible_module_and_resume')
  const priority = new Map(POSTROUTE_STAGE_PRIORITY.map((stage, index) => [stage, index]))
  candidates.sort((a, b) => (priority.get(a) ?? 999) - (priority.get(b) ?? 999))
  const selected = candidates.find((stage) => stageAllowed(stage, exhaustedStagesThisRun))
  if (selected) return selected
  return 'mark_ready_for_export_review'
}

export function continueAfterCleanupStage({ currentBoard = '', lastCompletedStage = '', drcReport = {}, shortFixDisconnects = [], pendingDrcFamilies = [], exhaustedStagesThisRun = [], pluginCwd = '' } = {}) {
  const health = scoreDrcHealth(drcReport)
  const nextStage = selectNextAutonomousPostRouteAction({ drcReport, shortFixDisconnects, exhaustedStagesThisRun })
  return {
    currentBoard,
    lastCompletedStage,
    exhaustedStagesThisRun,
    nextStage,
    shorts: Number(health.counts.types.shorting_items || 0),
    unconnected: Number(health.counts.unconnected || 0),
    drcScore: health.score,
    pendingDisconnects: shortFixDisconnects.filter((item) => item.exactRerouteCandidate && item.resolved !== true && item.blocked !== true),
    pendingDrcFamilies,
    resumeCommand: buildPostRouteSupervisorResumeCommand({ board: currentBoard, cwd: pluginCwd }),
    userPromptRequired: false,
  }
}

export function preventMidLoopUserPrompt(state = {}) {
  return {
    ...state,
    userPromptRequired: false,
    invalidFinalStatesSuppressed: [
      'esc_postroute_cleaned_continue_autonomously',
      'next_autonomous_action_queued',
      'next_action_selected',
      'next_autonomous_action',
      'needs_next_prompt',
      'continue_cleanup',
      'continue_routing',
      'repair_generated_severe_clearance',
      'reroute_short_fix_disconnects',
      'guarded_ratsnest_reduction',
      'reroute_next',
      'candidate_found_not_committed',
      'no_committable_connectivity',
      'unsafe_route_candidates_found',
      'timeout',
    ],
  }
}

const VALID_ESC_POSTROUTE_FINAL_STATES = new Set([
  'esc_fully_routed_erc_drc_passed',
  'esc_ready_for_export_review',
  'esc_routed_with_exact_remaining_blockers',
  'needs_user_approval_board_outline_change',
  'needs_user_approval_mounting_hole_move',
  'needs_user_approval_footprint_package_part_change',
  'needs_user_approval_forbidden_via_policy_change',
  'runtime_limit_reached_resume_written',
  'fatal_environment_blocker_resume_not_possible',
])

export function isValidEscPostRouteFinalState(state = '') {
  return VALID_ESC_POSTROUTE_FINAL_STATES.has(String(state || ''))
}

export async function runEscPostRouteDaemonSupervisor({
  initialState = {},
  maxStages = 6,
  runtimeBudgetMs = 300000,
  executeStage = null,
  writeCheckpoint = null,
  now = () => Date.now(),
} = {}) {
  const startedAt = now()
  const stagesExecuted = []
  let state = preventMidLoopUserPrompt({ ...initialState })
  let finalState = ''
  let runtimeCheckpoint = null
  while (true) {
    if (isValidEscPostRouteFinalState(state.state || state.finalState)) {
      finalState = state.state || state.finalState
      break
    }
    const elapsed = now() - startedAt
    if (shouldStopForRuntimeLimit({ startedAt, now, runtimeBudgetMs })) {
      runtimeCheckpoint = {
        ...state,
        state: 'runtime_limit_reached_resume_written',
        shouldAutoResume: true,
        resumeCommand: buildPostRouteSupervisorResumeCommand({ board: state.currentBoard || state.latestBoard || state.board || '', cwd: state.pluginCwd || '' }),
      }
      if (typeof writeCheckpoint === 'function') await writeCheckpoint(runtimeCheckpoint)
      finalState = 'runtime_limit_reached_resume_written'
      break
    }
    const nextStage = state.nextStage || state.nextAction || state.resumeCommand
    if (!nextStage || nextStage === 'mark_ready_for_export_review') {
      finalState = 'esc_ready_for_export_review'
      state = { ...state, state: finalState }
      break
    }
    if (typeof executeStage !== 'function') {
      runtimeCheckpoint = {
        ...state,
        state: 'runtime_limit_reached_resume_written',
        shouldAutoResume: true,
        resumeCommand: nextStage,
        reason: 'daemon_stage_executor_not_configured',
      }
      if (typeof writeCheckpoint === 'function') await writeCheckpoint(runtimeCheckpoint)
      finalState = 'runtime_limit_reached_resume_written'
      break
    }
    if (stagesExecuted.length >= maxStages && hasActualRuntimeBudgetRemaining({ startedAt, now, runtimeBudgetMs })) {
      maxStages += 1
    }
    const stageResult = await executeStage(nextStage, state)
    stagesExecuted.push({
      stage: nextStage,
      status: stageResult?.status || stageResult?.state || 'stage_executed',
    })
    let nextState = preventMidLoopUserPrompt({
      ...state,
      ...(stageResult?.resumeState || stageResult?.stateObject || stageResult || {}),
      lastStageCompleted: nextStage,
    })
    if (isZeroCommitStageResult(stageResult || {})) {
      nextState = markStageTemporarilyExhausted(nextState, nextStage, stageResult)
      nextState.nextStage = selectNextStageAfterNoProgress({
        state: nextState,
        drcReport: nextState.drcReport || state.drcReport || {},
        shortFixDisconnects: nextState.shortFixDisconnects || state.shortFixDisconnects || [],
        failures: nextState.failures || state.failures || [],
      })
    }
    nextState.resumeCommand = buildPostRouteSupervisorResumeCommand({ board: nextState.currentBoard || nextState.latestBoard || nextState.board || '', cwd: nextState.pluginCwd || '' })
    state = nextState
    if (typeof writeCheckpoint === 'function') await writeCheckpoint({
      ...state,
      shouldAutoResume: !isValidEscPostRouteFinalState(state.state || state.finalState),
    })
  }
  return preventMidLoopUserPrompt({
    implemented: true,
    finalState,
    stagesExecuted,
    queuedActionsExecuted: stagesExecuted.length,
    runtimeCheckpoint,
    resumeState: runtimeCheckpoint || state,
    userPromptRequired: false,
  })
}

export function runEscPostRouteAutonomousSupervisor({ currentBoard = '', drcReport = {}, beforeShortRepairDrc = null, shortRepairCandidates = [], failures = [], lastCompletedStage = '' } = {}) {
  const shortFixDisconnects = beforeShortRepairDrc
    ? identifyShortFixDisconnects({ beforeDrc: beforeShortRepairDrc, afterDrc: drcReport, shortRepairCandidates })
    : []
  const baseState = continueAfterCleanupStage({
    currentBoard,
    lastCompletedStage,
    drcReport,
    shortFixDisconnects,
    pendingDrcFamilies: Object.entries(scoreDrcHealth(drcReport).counts.types || {})
      .filter(([, count]) => Number(count) > 0)
      .map(([family, count]) => ({ family, count })),
  })
  const internalWorkPlans = (failures || []).map((failure) => {
    const diagnosis = diagnoseBoardForgeFailure(failure)
    return {
      blocker: failure.code || failure.type || 'UNKNOWN_BLOCKER',
      rootCause: diagnosis.rootCause,
      module: diagnosis.module,
      repairTask: diagnosis.repairTask,
      tests: diagnosis.tests,
      userPromptRequired: false,
    }
  })
  return preventMidLoopUserPrompt({
    implemented: true,
    status: 'post_route_autonomous_supervisor_ready',
    currentBoard,
    shortFixDisconnects,
    internalWorkPlans,
    nextAction: baseState.nextStage,
    resumeState: baseState,
    userDecisionRequired: false,
  })
}

export function routeExactUnconnectedItemWithPromotionGate({ beforeDrc = {}, afterDrc = {}, unconnectedItem = {}, route = {}, candidateResult = {}, originalSpecChanged = false, forbiddenVias = 0 } = {}) {
  const exact = verifyUnconnectedItemResolved({ before: beforeDrc, after: afterDrc, unconnectedItem })
  const diff = diffUnconnectedItemSets({ before: beforeDrc, after: afterDrc })
  const health = compareDrcHealthBeforeAfter(beforeDrc, afterDrc)
  const scoreDidNotWorsen = health.scoreDelta <= 0
  const criticalFamilies = ['shorting_items', 'tracks_crossing', 'unconnected_items', 'forbidden_via', 'board_outline_change', 'mounting_hole_move', 'part_footprint_package_change']
  const worsenedCriticalFamilies = criticalFamilies.filter((family) => (health.delta[family] || 0) > 0)
  const targetNetReduced = Number(exact.targetNetUnconnectedAfter) < Number(exact.targetNetUnconnectedBefore)
  const islandReduced = Number.isFinite(Number(candidateResult.netIslandsBefore))
    && Number.isFinite(Number(candidateResult.netIslandsAfter))
    && Number(candidateResult.netIslandsAfter) < Number(candidateResult.netIslandsBefore)
  const connectivityProgress = exact.resolved || targetNetReduced || islandReduced || candidateResult.kicadConnected === true
  const promote = Boolean(connectivityProgress && scoreDidNotWorsen && worsenedCriticalFamilies.length === 0 && Number(forbiddenVias) === 0 && originalSpecChanged !== true)
  return {
    promote,
    status: promote ? 'COMMITTED_RESOLVED' : 'ROLLBACK_REQUIRED',
    route,
    exactUnconnectedItemResolved: exact.resolved,
    targetNetUnconnectedReduced: targetNetReduced,
    netIslandsReduced: islandReduced,
    kicadConnected: candidateResult.kicadConnected === true,
    scoreDidNotWorsen,
    weightedScoreBefore: health.before.score,
    weightedScoreAfter: health.after.score,
    weightedScoreDelta: health.scoreDelta,
    worsenedCriticalFamilies,
    forbiddenVias: Number(forbiddenVias) || 0,
    originalSpecChanged: originalSpecChanged === true,
    unconnectedDiff: diff,
    reason: promote
      ? 'exact ratsnest connectivity improved without weighted DRC or critical-family regression'
      : explainRatsnestPromotionRejection({ connectivityProgress, scoreDidNotWorsen, worsenedCriticalFamilies, forbiddenVias, originalSpecChanged }),
  }
}

export async function runGuardedExactRatsnestPostRouteWriter({ drcReport = {}, maxItems = 10, writeCandidate = null, beforeDrc = null } = {}) {
  const baselineDrc = beforeDrc || drcReport
  const ranked = rankPostRouteUnconnectedItems(drcReport, { maxItems })
  const guardedWriter = async (route, item) => {
    if (typeof writeCandidate !== 'function') {
      return {
        status: 'TEMP_BLOCKED_WITH_EXACT_REASON',
        writtenToKiCad: false,
        reason: 'post_route_physical_writer_not_configured',
      }
    }
    const outcome = await writeCandidate(route, item)
    if (!outcome?.afterDrc) return outcome
    const gate = routeExactUnconnectedItemWithPromotionGate({
      beforeDrc: outcome.beforeDrc || baselineDrc,
      afterDrc: outcome.afterDrc,
      unconnectedItem: item,
      route,
      candidateResult: outcome,
      originalSpecChanged: outcome.originalSpecChanged,
      forbiddenVias: outcome.forbiddenVias,
    })
    return {
      ...outcome,
      gate,
      status: gate.promote ? 'COMMITTED_RESOLVED' : (outcome.status || 'ROLLED_BACK_DRC_UNSAFE'),
      resolvedCount: gate.promote ? 1 : 0,
    }
  }
  const batch = await consumeRatsnestQueueWithPhysicalRouter({
    queuedItems: ranked,
    maxItems,
    writeCandidate: guardedWriter,
  })
  return {
    implemented: true,
    triggerSafe: isUnconnectedPassSafe(baselineDrc),
    rankedItems: ranked,
    ...batch,
  }
}

export function runBoardForgeSelfDrivingSupervisor({ drcReport = {}, failures = [], boardContext = {}, solutionLibrary = [], maxUnconnectedItems = 10, writeCandidate = null } = {}) {
  const blockers = Array.isArray(failures) ? failures : []
  const internalWorkPlans = blockers.map((failure) => {
    const diagnosis = diagnoseBoardForgeFailure(failure)
    return {
      blocker: failure.code || failure.type || 'UNKNOWN_BLOCKER',
      rootCause: diagnosis.rootCause,
      module: diagnosis.module,
      repairTask: diagnosis.repairTask,
      tests: diagnosis.tests,
      userPromptRequired: false,
    }
  })
  const rankedUnconnected = rankPostRouteUnconnectedItems(drcReport, { maxItems: maxUnconnectedItems })
  const nextAction = rankedUnconnected.length
    ? 'runGuardedExactRatsnestPostRouteWriter'
    : blockers.length
      ? 'fixResponsibleModuleAndResume'
      : 'continueGuardedPostRouteDrcRepair'
  return {
    status: 'self_driving_supervisor_ready',
    implemented: true,
    userPromptRequired: false,
    userDecisionRequired: false,
    boardType: boardContext.boardType || 'ESC',
    blockersDiagnosed: internalWorkPlans.length,
    internalWorkPlans,
    loadedSolutionRecords: solutionLibrary.length,
    rankedUnconnected,
    nextAction,
    resumeCommand: nextAction,
    invalidFinalStatesSuppressed: ['needs_next_prompt', 'classification_only', 'no_geometry_mutation', 'low_yield_stop'],
  }
}

function postRouteUnconnectedPriority(item = {}, { deferHardPower = true } = {}) {
  const role = item.netRole || classifyRouteNetRole(item.net)
  const roleScore = {
    CONTROL_SIGNAL: 0,
    LOW_SPEED_SIGNAL: 10,
    REGULATED_RAIL: 20,
    GATE_DRIVE: 30,
    BOOTSTRAP: 35,
    CURRENT_SENSE: 45,
    GROUND: deferHardPower ? 80 : 50,
    HIGH_CURRENT_POWER: deferHardPower ? 120 : 60,
    SWITCHING_NODE: deferHardPower ? 140 : 70,
  }[role] ?? 55
  const endpointPenalty = item.sourceRef && item.targetRef && item.sourceRef === item.targetRef ? 5 : 0
  return roleScore + endpointPenalty + Math.min(100, Number(item.distanceMm || 0))
}

function distanceBetweenPoints(a = {}, b = {}) {
  const ax = Number(a.x)
  const ay = Number(a.y)
  const bx = Number(b.x)
  const by = Number(b.y)
  if (![ax, ay, bx, by].every(Number.isFinite)) return Number.POSITIVE_INFINITY
  return Math.hypot(ax - bx, ay - by)
}

function postRouteUnconnectedReason(item = {}) {
  const role = item.netRole || classifyRouteNetRole(item.net)
  if (role === 'CONTROL_SIGNAL' || role === 'LOW_SPEED_SIGNAL') return 'short low-risk signal/control ratsnest'
  if (role === 'REGULATED_RAIL') return 'local regulated rail after FreeRouting import'
  if (role === 'GATE_DRIVE') return 'local gate-drive route with critical-family guard'
  if (role === 'BOOTSTRAP') return 'local bootstrap/HB/BST route with short-path guard'
  if (role === 'CURRENT_SENSE') return 'protected sense route after lower-risk items'
  return 'deferred or lower-priority post-route ratsnest item'
}

function preferredPostRouteLayerForRole(role = '', fallbackLayer = 'F.Cu') {
  const normalized = String(role || '').toUpperCase()
  if (normalized === 'CONTROL_SIGNAL' || normalized === 'LOW_SPEED_SIGNAL') return 'In3.Cu'
  if (normalized === 'CURRENT_SENSE') return 'In5.Cu'
  if (normalized === 'REGULATED_RAIL') return 'In4.Cu'
  if (normalized === 'GROUND') return 'In1.Cu'
  if (normalized === 'HIGH_CURRENT_POWER') return 'In2.Cu'
  if (normalized === 'GATE_DRIVE' || normalized === 'BOOTSTRAP') return fallbackLayer || 'F.Cu'
  return fallbackLayer || 'F.Cu'
}

function buildPostRouteElbow(source = {}, target = {}, options = {}) {
  if (options.elbow && Number.isFinite(Number(options.elbow.x)) && Number.isFinite(Number(options.elbow.y))) {
    return { x: round(options.elbow.x), y: round(options.elbow.y) }
  }
  const sx = Number(source.x)
  const sy = Number(source.y)
  const tx = Number(target.x)
  const ty = Number(target.y)
  if (!Number.isFinite(sx) || !Number.isFinite(sy) || !Number.isFinite(tx) || !Number.isFinite(ty)) return { x: 0, y: 0 }
  const horizontalFirst = Math.abs(tx - sx) >= Math.abs(ty - sy)
  return horizontalFirst
    ? { x: round(tx), y: round(sy) }
    : { x: round(sx), y: round(ty) }
}

function isUnconnectedPassSafe(drcReport = {}) {
  const health = scoreDrcHealth(drcReport)
  const shorting = Number(health.counts.types.shorting_items || 0)
  const crossings = Number(health.counts.types.tracks_crossing || 0)
  const forbidden = Number(health.counts.types.forbidden_via || 0)
  return forbidden === 0 && crossings === 0 && shorting >= 0
}

function explainRatsnestPromotionRejection({ connectivityProgress, scoreDidNotWorsen, worsenedCriticalFamilies = [], forbiddenVias = 0, originalSpecChanged = false } = {}) {
  if (!connectivityProgress) return 'exact KiCad unconnected item did not disappear and no island/connection proof was provided'
  if (!scoreDidNotWorsen) return 'weighted DRC score worsened after candidate route'
  if (worsenedCriticalFamilies.length) return `critical families worsened: ${worsenedCriticalFamilies.join(', ')}`
  if (Number(forbiddenVias) > 0) return 'candidate introduced forbidden via geometry'
  if (originalSpecChanged) return 'candidate changed protected original board spec'
  return 'candidate failed guarded exact-ratsnest promotion gate'
}

export function auditRolledBackRatsnestRoutes(results = []) {
  const audit = {
    totalRolledBack: 0,
    noConnectivity: [],
    connectedButDrcUnsafe: [],
    precheckFailures: [],
    padContactFailures: [],
    geometryRuleFailures: [],
    repairableCandidates: [],
  }
  for (const result of results || []) {
    if (result.status === 'PRECHECK_REJECTED') {
      audit.precheckFailures.push(result)
      continue
    }
    if (!/^ROLLED_BACK/.test(String(result.status || ''))) continue
    audit.totalRolledBack += 1
    const connected = result.decision?.exactUnconnectedItemResolved === true || result.decision?.successMetric === 'exact_unconnected_item_resolved'
    if (connected && result.status === 'ROLLED_BACK_DRC_UNSAFE') {
      const repair = {
        net: result.net,
        unconnectedId: result.unconnectedId,
        source: result.source || result.sourceRef || result.decision?.exactUnconnected?.source,
        target: result.target || result.targetRef || result.decision?.exactUnconnected?.target,
        connectedTargetItem: true,
        drcViolationsAdded: drcRegressionDelta(result.decision),
        repairable: true,
        recommendedRepair: 'dogleg / layer change / via move / width change / route shove',
      }
      audit.connectedButDrcUnsafe.push(result)
      audit.repairableCandidates.push(repair)
    } else if (!connected) {
      audit.noConnectivity.push(result)
    } else if (/PAD/i.test(String(result.reason || result.status))) {
      audit.padContactFailures.push(result)
    } else {
      audit.geometryRuleFailures.push(result)
    }
  }
  return audit
}

export function classifyGeneratedRouteDrc(decision = {}, route = {}) {
  const errorsAdded = Number(decision.drcAfter?.errors || 0) - Number(decision.drcBefore?.errors || 0)
  const warningsAdded = Number(decision.drcAfter?.warnings || 0) - Number(decision.drcBefore?.warnings || 0)
  const violations = Array.isArray(decision.generatedDrcViolations) ? decision.generatedDrcViolations : Array.isArray(decision.drcViolationsAdded) ? decision.drcViolationsAdded : []
  const families = violations.length
    ? [...new Set(violations.map((violation) => classifyDrcViolationFamily(violation)))]
    : [errorsAdded > 0 ? 'clearance' : warningsAdded > 0 ? 'warning' : 'none']
  return {
    net: route.net || decision.net,
    errorsAdded,
    warningsAdded,
    unsafe: errorsAdded > 0 || warningsAdded > 0,
    family: errorsAdded > 0 ? 'generated_route_drc_regression' : warningsAdded > 0 ? 'generated_route_warning_regression' : 'none',
    families,
    violations,
  }
}

function classifyDrcViolationFamily(violation = {}) {
  const text = `${violation.type || ''} ${violation.family || ''} ${violation.description || ''}`.toLowerCase()
  if (/edge|edge\.cuts|board/.test(text)) return 'copper_edge_clearance'
  if (/via/.test(text)) return 'via_clearance'
  if (/pad/.test(text)) return 'route_pad_clearance'
  if (/keepout|keep out/.test(text)) return 'keepout'
  if (/dangling|antenna|unconnected/.test(text)) return 'dangling_track'
  if (/solder.?mask|mask/.test(text)) return 'soldermask'
  if (/clearance|collision|track|segment|copper/.test(text)) return 'route_route_clearance'
  return violation.family || violation.type || 'generated_route_drc'
}

function classifyRouteNetRole(net = '') {
  const name = String(net || '')
  if (/PGND|(^|\/)GND$|_GND/i.test(name)) return 'GROUND'
  if (/SHUNT|ISENSE|SENSE|FB_/i.test(name)) return 'CURRENT_SENSE'
  if (/BST|BOOT|HB/i.test(name)) return 'BOOTSTRAP'
  if (/(^|_)(HG|LG|HI|LO|GATE)$/i.test(name) || /_HG|_LG|_HI|_LO|GATE/i.test(name)) return 'GATE_DRIVE'
  if (/VBAT|VIN|BATT/i.test(name)) return 'HIGH_CURRENT_POWER'
  if (/VREG|3V3|5V|12V|VDD/i.test(name)) return 'REGULATED_RAIL'
  if (/I2C|SCL|SDA|SWD|NRST|TELEM|RAMP|SS_|BOOT_SEL|OSC/i.test(name)) return 'CONTROL_SIGNAL'
  return 'LOW_SPEED_SIGNAL'
}

export function selectEscRouteWidthForNet(net = '', context = {}) {
  const role = context.netRole || classifyRouteNetRole(net)
  const widths = {
    CONTROL_SIGNAL: 0.127,
    LOW_SPEED_SIGNAL: 0.127,
    CURRENT_SENSE: 0.127,
    BOOTSTRAP: 0.152,
    GATE_DRIVE: 0.152,
    REGULATED_RAIL: 0.25,
    HIGH_CURRENT_POWER: 0.6,
    GROUND: 0.4,
  }
  return {
    net,
    role,
    widthMm: widths[role] || 0.127,
    reason: role === 'HIGH_CURRENT_POWER' ? 'high_current_requires_wide_copper' : role === 'REGULATED_RAIL' ? 'regulated_rail_modest_power_width' : 'signal_or_sensitive_net_uses_drc_clean_width',
  }
}

function escLayerAlternativesForNet(net = '', context = {}) {
  const role = context.netRole || classifyRouteNetRole(net)
  if (role === 'CONTROL_SIGNAL' || role === 'LOW_SPEED_SIGNAL') return ['In3.Cu', 'B.Cu', 'F.Cu', 'In5.Cu']
  if (role === 'CURRENT_SENSE') return ['In5.Cu', 'In3.Cu', 'B.Cu', 'F.Cu']
  if (role === 'REGULATED_RAIL') return ['In4.Cu', 'B.Cu', 'F.Cu', 'In3.Cu']
  if (role === 'BOOTSTRAP' || role === 'GATE_DRIVE') return ['F.Cu', 'B.Cu', 'In3.Cu', 'In5.Cu']
  if (role === 'HIGH_CURRENT_POWER') return ['In2.Cu', 'F.Cu', 'B.Cu', 'In4.Cu']
  if (role === 'GROUND') return ['In1.Cu', 'In6.Cu', 'B.Cu', 'F.Cu']
  return ['In3.Cu', 'B.Cu', 'F.Cu']
}

export function tryLayerAlternativeForRoute(route = {}) {
  const alternatives = mutateHighDensityRouteAfterDrcFailure(route, { reason: 'DRC_ERROR_REGRESSION' })
  const highDensityLayers = alternatives.filter((candidate) => candidate.mutation?.type === 'high_density_alternate_layer')
  const roleLayers = escLayerAlternativesForNet(route.net).map((layer) => ({
    ...route,
    layerPreference: [layer],
    widthMm: route.widthMm || selectEscRouteWidthForNet(route.net).widthMm,
    mutation: { type: 'role_based_layer_change', layer },
  }))
  return [...highDensityLayers, ...roleLayers]
}

export function tryDoglegAlternativeForRoute(route = {}) {
  const alternatives = mutateHighDensityRouteAfterDrcFailure(route, { reason: 'DRC_ERROR_REGRESSION' })
  return alternatives.filter((candidate) => /^high_density_dogleg/.test(String(candidate.mutation?.type || '')))
}

export function tryViaRelocationForRoute(route = {}) {
  const alternatives = mutateHighDensityRouteAfterDrcFailure(route, { reason: 'VIA_CLEARANCE' })
  return alternatives.filter((candidate) => candidate.mutation?.type === 'high_density_no_via_retry' || candidate.viaPlan)
}

export function mutateRouteToFixDrc(route = {}, failure = {}, context = {}) {
  const classified = classifyGeneratedRouteDrc(failure.decision || failure, route)
  const direct = mutateHighDensityRouteAfterDrcFailure(route, failure, context)
  const roleWidth = selectEscRouteWidthForNet(route.net, context)
  const localRepairs = [
    ...repairConnectedRouteRouteClearance(route, classified, context),
    ...repairRoutePadClearance(route, classified, context),
    ...repairCopperEdgeClearance(route, classified, context),
    ...repairRouteKeepoutConflict(route, classified, context),
    ...repairDanglingTrack(route, classified, context),
    ...splitRouteIntoMultiSegmentBundle(route, context),
    ...tryLayerAlternativeForRoute({ ...route, widthMm: route.widthMm || roleWidth.widthMm }),
    ...tryDoglegAlternativeForRoute({ ...route, widthMm: route.widthMm || roleWidth.widthMm }),
    ...tryViaRelocationForRoute(route),
  ]
  if (context.allowGeneratedCopperReroute) localRepairs.push(...transactionalRerouteGeneratedCopper(route, classified, context).candidates)
  localRepairs.push({ ...route, widthMm: roleWidth.widthMm, mutation: { type: 'net_role_width_selection', role: roleWidth.role, widthMm: roleWidth.widthMm } })
  const allCandidates = [...direct, ...localRepairs]
  const unique = new Map()
  for (const candidate of allCandidates) {
    const points = candidate.waypoints || [candidate.start, candidate.end].filter(Boolean)
    const key = `${candidate.layerPreference?.join(',')}:${candidate.widthMm || ''}:${points.map((point) => `${round(point.x)},${round(point.y)}`).join('|')}:${candidate.mutation?.type || 'base'}`
    if (!unique.has(key)) unique.set(key, candidate)
  }
  return [...unique.values()]
}

export function repairConnectingRatsnestRoute(route = {}, failure = {}, context = {}) {
  const classified = classifyGeneratedRouteDrc(failure.decision || failure, route)
  const repairCandidates = mutateRouteToFixDrc(route, failure, { ...context, allowGeneratedCopperReroute: context.allowGeneratedCopperReroute !== false })
  return {
    route,
    failure: classified,
    repairCandidates,
    repairPlan: repairCandidates.map((candidate) => candidate.mutation?.type || 'route_mutation'),
    shouldRepairBeforeRollback: true,
  }
}

export function rerouteAroundDrcViolation(route = {}, violation = {}, context = {}) {
  return mutateRouteToFixDrc(route, { reason: violation.type || violation.family || 'DRC_ERROR_REGRESSION' }, context)
}

export function repairConnectedRouteBundle(route = {}, failure = {}, context = {}) {
  const repair = repairConnectingRatsnestRoute(route, failure, context)
  return {
    status: repair.repairCandidates.length ? 'CONNECTED_ROUTE_REPAIR_CANDIDATES_READY' : 'CONNECTED_ROUTE_REPAIR_NO_CANDIDATE',
    ...repair,
  }
}

export function shoveRouteAroundObstacle(route = {}, obstacle = {}, context = {}) {
  const offset = Number(context.shoveOffsetMm || obstacle.clearanceNeededMm || 0.25)
  const points = route.waypoints?.length ? route.waypoints : [route.start, route.end].filter(Boolean)
  if (points.length < 2) return []
  return [
    {
      ...route,
      waypoints: points.map((point, index) => index === 0 || index === points.length - 1 ? point : { ...point, y: point.y + offset }),
      mutation: { type: 'route_shove_around_obstacle', offsetMm: offset, obstacle: obstacle.ref || obstacle.type || obstacle.family },
    },
  ]
}

export function rerouteSegmentWithDogleg(route = {}, context = {}) {
  return tryDoglegAlternativeForRoute(route).length ? tryDoglegAlternativeForRoute(route) : splitRouteIntoMultiSegmentBundle(route, context)
}

export function rerouteSegmentOnAlternateLayer(route = {}, context = {}) {
  return tryLayerAlternativeForRoute(route).map((candidate) => ({ ...candidate, mutation: { ...(candidate.mutation || {}), type: candidate.mutation?.type || 'alternate_layer_repair' } }))
}

export function moveViaToLegalSite(route = {}, context = {}) {
  return tryViaRelocationForRoute(route).map((candidate) => ({ ...candidate, mutation: { ...(candidate.mutation || {}), type: candidate.mutation?.type || 'via_relocation_repair' } }))
}

export function splitRouteIntoMultiSegmentBundle(route = {}, context = {}) {
  const points = route.waypoints?.length ? route.waypoints : [route.start, route.end].filter(Boolean)
  if (points.length < 2) return []
  const [start, end] = [points[0], points[points.length - 1]]
  const dogleg = Number(context.doglegMm || 0.35)
  const midX = (Number(start.x) + Number(end.x)) / 2
  return [
    {
      ...route,
      waypoints: [start, { x: midX, y: Number(start.y) + dogleg, layer: start.layer || route.layerPreference?.[0] }, { x: midX, y: Number(end.y) + dogleg, layer: end.layer || route.layerPreference?.[0] }, end],
      mutation: { type: 'multi_segment_dogleg_bundle', doglegMm: dogleg },
    },
    {
      ...route,
      waypoints: [start, { x: Number(start.x) + dogleg, y: Number(start.y), layer: start.layer || route.layerPreference?.[0] }, { x: Number(end.x) + dogleg, y: Number(end.y), layer: end.layer || route.layerPreference?.[0] }, end],
      mutation: { type: 'orthogonal_escape_bundle', doglegMm: dogleg },
    },
  ]
}

export function repairDanglingTrack(route = {}, failure = {}, context = {}) {
  if (!failure.families?.includes('dangling_track') && failure.family !== 'dangling_track') return []
  return splitRouteIntoMultiSegmentBundle(route, context).map((candidate) => ({ ...candidate, mutation: { ...(candidate.mutation || {}), type: 'repair_dangling_track_extend_to_contact' } }))
}

export function repairCopperEdgeClearance(route = {}, failure = {}, context = {}) {
  if (!failure.families?.includes('copper_edge_clearance')) return []
  return shoveRouteAroundObstacle(route, { type: 'edge_clearance', clearanceNeededMm: 0.5 }, context).map((candidate) => ({ ...candidate, mutation: { ...(candidate.mutation || {}), type: 'repair_copper_edge_clearance' } }))
}

export function repairConnectedRouteRouteClearance(route = {}, failure = {}, context = {}) {
  if (!failure.families?.some((family) => /route_route|clearance|generated_route/.test(family))) return []
  return [
    ...shoveRouteAroundObstacle(route, { type: 'route_route_clearance', clearanceNeededMm: 0.25 }, context),
    ...splitRouteIntoMultiSegmentBundle(route, context),
  ].map((candidate) => ({ ...candidate, mutation: { ...(candidate.mutation || {}), type: `repair_route_route_clearance_${candidate.mutation?.type || 'shove'}` } }))
}

export function repairRoutePadClearance(route = {}, failure = {}, context = {}) {
  if (!failure.families?.includes('route_pad_clearance')) return []
  return splitRouteIntoMultiSegmentBundle(route, { ...context, doglegMm: 0.45 }).map((candidate) => ({ ...candidate, mutation: { ...(candidate.mutation || {}), type: 'repair_route_pad_clearance' } }))
}

export function repairRouteKeepoutConflict(route = {}, failure = {}, context = {}) {
  if (!failure.families?.includes('keepout')) return []
  return rerouteSegmentOnAlternateLayer(route, context).map((candidate) => ({ ...candidate, mutation: { ...(candidate.mutation || {}), type: 'repair_keepout_conflict_alternate_layer' } }))
}

export function identifyGeneratedCopperBlockingRoute(route = {}, context = {}) {
  const generated = Array.isArray(context.generatedRoutes) ? context.generatedRoutes : []
  const blocking = generated.filter((candidate) => candidate.net && candidate.net !== route.net)
  return {
    blockingFound: blocking.length > 0,
    blockingRoutes: blocking,
  }
}

export function rerouteDisplacedGeneratedNet(generatedRoute = {}, context = {}) {
  return mutateRouteToFixDrc(generatedRoute, { reason: 'DISPLACED_BY_HIGHER_VALUE_RATSNEST' }, context).slice(0, 3)
}

export function transactionalRerouteGeneratedCopper(route = {}, failure = {}, context = {}) {
  const blockers = identifyGeneratedCopperBlockingRoute(route, context)
  const candidates = blockers.blockingRoutes.flatMap((generatedRoute) => rerouteDisplacedGeneratedNet(generatedRoute, context).map((reroute) => ({
    ...route,
    displacedRoute: generatedRoute,
    displacedReroute: reroute,
    mutation: { type: 'transactional_reroute_generated_copper', displacedNet: generatedRoute.net },
  })))
  return {
    attempted: blockers.blockingFound,
    blockers: blockers.blockingRoutes,
    candidates,
  }
}

export function precheckRatsnestRouteCandidateAgainstDrc(route = {}, context = {}) {
  const points = route.waypoints?.length ? route.waypoints : [route.start, route.end].filter(Boolean)
  if (points.length < 2) return { ok: false, reason: 'missing_route_points' }
  const board = context.board || {}
  if (board.outline?.length) {
    const outside = points.find((point) => !pointInPolygon(point, board.outline))
    if (outside) return { ok: false, reason: 'route_point_outside_edgecuts', point: outside }
  }
  const layer = route.layerPreference?.[0] || route.start?.layer || 'F.Cu'
  if (/In2\.Cu/i.test(layer) && /I2C|SCL|SDA|SWD|NRST|SS_|RAMP|TELEM/i.test(String(route.net || ''))) {
    return { ok: false, reason: 'control_signal_on_power_layer', layer }
  }
  return { ok: true, reason: 'precheck_passed' }
}

export { diffKiCadUnconnectedItems }

export function continueAfterBlockedNet(blocked = {}, queue = []) {
  return {
    blocked: { ...blocked, status: 'TEMP_BLOCKED_WITH_PROOF' },
    continueRouting: true,
    remainingQueue: queue.filter((item) => item.unconnectedId !== blocked.unconnectedId),
  }
}

function drcRegressionDelta(decision = {}) {
  return [{
    errorsAdded: Number(decision.drcAfter?.errors || 0) - Number(decision.drcBefore?.errors || 0),
    warningsAdded: Number(decision.drcAfter?.warnings || 0) - Number(decision.drcBefore?.warnings || 0),
  }].filter((item) => item.errorsAdded > 0 || item.warningsAdded > 0)
}

export function runBoardForgeRootCauseSupervisor({ drcReport = {}, failures = [], retainedCopper = {}, maxItems = 30 } = {}) {
  const workQueue = extractRatsnestEndpointPairs({ drcReport, maxPairs: maxItems })
  const diagnoses = failures.map((failure) => diagnoseBoardForgeFailure(failure))
  const tasks = failures.map((failure, index) => {
    const diagnosis = diagnoses[index]
    return executeInternalRepairTask({
      id: `${diagnosis.repairTask}_${index + 1}`,
      type: diagnosis.repairTask,
      blocker: failure,
      focusedTests: diagnosis.tests,
    }, { currentCopper: retainedCopper })
  })
  return {
    status: workQueue.length ? 'ROOT_CAUSE_SUPERVISOR_READY_TO_ROUTE_RATSNEST_ITEMS' : 'ROOT_CAUSE_SUPERVISOR_READY_NO_UNCONNECTED_ITEMS',
    sourceOfTruth: 'KiCad unconnected_items',
    workQueue,
    issuesDiagnosed: diagnoses.length,
    modulesFixed: [...new Set(diagnoses.map((item) => item.module))],
    internalTasksExecuted: tasks,
    userPromptRequired: false,
    resumeCommand: 'runBoardForgeRootCauseSupervisor',
  }
}

export { commitOnlyConnectivityProgress, verifyUnconnectedItemResolved }

function solutionIdForRepair(repairTask = '') {
  if (repairTask === 'FIX_ROUTE_BY_EXACT_UNCONNECTED_ITEM') return 'esc_route_by_ratsnest_not_net_label_001'
  return String(repairTask || 'boardforge_internal_repair').toLowerCase().replace(/[^a-z0-9]+/g, '_')
}

async function saveSupervisorCheckpoint({ checkpointFile, projectDir, cycles = [], internalRepairTasks = [], finalState, stoppedMidLoop }) {
  await mkdir(path.dirname(checkpointFile), { recursive: true })
  const checkpoint = { status: finalState, projectDir, updatedAt: new Date().toISOString(), stoppedMidLoop, cycles, internalRepairTasks }
  await writeFile(checkpointFile, JSON.stringify(checkpoint, null, 2), 'utf8')
  return checkpoint
}

async function scanEscSupervisorCopper(projectDir) {
  try {
    const files = await findKiCadProjectFiles(projectDir)
    const copper = await scanKicadCopperAfterWrite(files.pcbFile)
    const content = await readFile(files.pcbFile, 'utf8')
    const nets = [...content.matchAll(/\(segment[\s\S]*?\(net\s+"([^"]+)"\)[\s\S]*?\)/g)].map((match) => match[1])
    return {
      ...copper,
      retainedNets: Object.fromEntries(Object.entries(nets.reduce((acc, net) => {
        acc[net] = (acc[net] || 0) + 1
        return acc
      }, {})).sort(([a], [b]) => a.localeCompare(b))),
    }
  } catch {
    return { segments: 0, vias: 0, zones: 0, retainedNets: {} }
  }
}

async function copyIfExists(source, destination) {
  if (!source || !destination || !existsSync(source)) return false
  await mkdir(path.dirname(destination), { recursive: true })
  await copyFile(source, destination)
  return true
}

export async function createEscRoutingBranch({ projectDir, branchId, strategy = 'baseline' } = {}) {
  const files = await findKiCadProjectFiles(projectDir)
  const safeBranchId = String(branchId || strategy || `branch-${Date.now()}`).replace(/[^a-zA-Z0-9_-]/g, '_')
  const branchDir = path.join(projectDir, '.boardforge', 'routing-branches', safeBranchId)
  await mkdir(branchDir, { recursive: true })
  const snapshots = {
    pcb: path.join(branchDir, path.basename(files.pcbFile)),
    sch: files.schFile ? path.join(branchDir, path.basename(files.schFile)) : null,
    pro: files.proFile ? path.join(branchDir, path.basename(files.proFile)) : null,
  }
  await copyIfExists(files.pcbFile, snapshots.pcb)
  await copyIfExists(files.schFile, snapshots.sch)
  await copyIfExists(files.proFile, snapshots.pro)
  const branch = {
    id: safeBranchId,
    strategy,
    status: 'BRANCH_CREATED',
    branchDir,
    snapshots,
    createdAt: new Date().toISOString(),
    copper: await scanEscSupervisorCopper(projectDir),
  }
  await writeFile(path.join(branchDir, 'branch.json'), JSON.stringify(branch, null, 2), 'utf8')
  return branch
}

export async function restoreEscRoutingBranch({ projectDir, branch } = {}) {
  if (!branch?.snapshots?.pcb || !existsSync(branch.snapshots.pcb)) throw new Error(`Cannot restore missing ESC routing branch: ${branch?.id || 'unknown'}`)
  const files = await findKiCadProjectFiles(projectDir)
  await copyIfExists(branch.snapshots.pcb, files.pcbFile)
  await copyIfExists(branch.snapshots.sch, files.schFile)
  await copyIfExists(branch.snapshots.pro, files.proFile)
  return { ...branch, status: 'BRANCH_RESTORED' }
}

export async function discardFailedEscRoutingBranch({ branch, reason = 'branch did not improve score' } = {}) {
  if (branch?.branchDir && existsSync(branch.branchDir)) await rm(branch.branchDir, { recursive: true, force: true })
  return { ...(branch || {}), status: 'BRANCH_DISCARDED', discardReason: reason }
}

function issueCountValue(report = {}, key) {
  return Number(report?.issueCounts?.[key] ?? report?.[key] ?? 0)
}

export async function scoreEscRoutingBranch({ projectDir, branch = {}, drcReport = {}, ercReport = {}, originalSpecAudit = null } = {}) {
  const copper = await scanEscSupervisorCopper(projectDir)
  const audit = originalSpecAudit || await auditOriginalEscSpec({ derivativePath: projectDir, originalReferencePath: branch.originalReferencePath || null }).catch(() => null)
  const forbiddenChanges = [
    audit?.boardOutlineChanged,
    audit?.mountingHolesChanged,
    (audit?.partsAdded || []).length > 0,
    (audit?.partsDeleted || []).length > 0,
    (audit?.footprintsChanged || []).length > 0,
    (audit?.padsNetsChanged || []).length > 0,
  ].filter(Boolean).length
  const netsRouted = Object.keys(copper.retainedNets || {}).length
  const drcErrors = issueCountValue(drcReport, 'errors')
  const drcWarnings = issueCountValue(drcReport, 'warnings')
  const ercErrors = issueCountValue(ercReport, 'errors')
  const globalUnconnected = Number(drcReport?.classification?.normalizedCounts?.kicadUnconnected ?? drcReport?.unconnected ?? 499)
  const score =
    forbiddenChanges ? -1000000 :
    (500 - globalUnconnected) * 10000 +
    netsRouted * 1000 +
    copper.segments * 10 +
    copper.vias * 8 +
    copper.zones * 20 -
    drcErrors * 4 -
    drcWarnings -
    ercErrors * 8
  return {
    branchId: branch.id || 'current',
    strategy: branch.strategy || 'current',
    segmentsRetained: copper.segments,
    viasRetained: copper.vias,
    zonesRetained: copper.zones,
    netsRouted,
    globalUnconnected,
    ercErrors,
    drcErrors,
    drcWarnings,
    forbiddenChanges,
    boardOutlineChanged: Boolean(audit?.boardOutlineChanged),
    mountingHolesMoved: Boolean(audit?.mountingHolesChanged),
    footprintsChanged: (audit?.footprintsChanged || []).length,
    score,
  }
}

export function detectNoOpBranch(before = {}, after = {}) {
  const same = (key) => Number(before[key] ?? 0) === Number(after[key] ?? 0)
  const beforeNets = Number(before.netsRouted ?? Object.keys(before.retainedNets || {}).length)
  const afterNets = Number(after.netsRouted ?? Object.keys(after.retainedNets || {}).length)
  const sameNets = beforeNets === afterNets
  const sameUnconnected = Number(before.globalUnconnected ?? 499) === Number(after.globalUnconnected ?? 499)
  const sameDrc = Number(before.drcErrors ?? before.errors ?? 0) === Number(after.drcErrors ?? after.errors ?? 0)
    && Number(before.drcWarnings ?? before.warnings ?? 0) === Number(after.drcWarnings ?? after.warnings ?? 0)
  const sameErc = Number(before.ercErrors ?? 0) === Number(after.ercErrors ?? 0)
  return same('segments') && same('vias') && same('zones') && sameNets && sameUnconnected && sameDrc && sameErc
}

export function requireBranchExecutionEvidence(branchResult = {}) {
  const attemptedRoutes = Number(branchResult.routesAttempted || branchResult.netsAttempted || 0)
  const wroteCopper = Boolean(branchResult.wroteCopper || Number(branchResult.copperWritten || 0) > 0)
  const ranChecks = Boolean(branchResult.drcAfter || branchResult.ercAfter || branchResult.drcReport || branchResult.ercReport)
  const provedBlocker = Boolean(branchResult.exactForbiddenBlocker || branchResult.exactBlockerProofCount > 0)
  return {
    valid: (attemptedRoutes > 0 && ranChecks) || wroteCopper || provedBlocker,
    attemptedRoutes,
    wroteCopper,
    ranChecks,
    provedBlocker,
  }
}

export function rejectNoOpBranch(branchResult = {}) {
  const before = branchResult.before || {}
  const after = branchResult.after || {}
  const evidence = requireBranchExecutionEvidence(branchResult)
  const noOp = detectNoOpBranch(before, after)
  if (noOp && !evidence.provedBlocker) {
    return {
      ...branchResult,
      status: 'NO_OP_BRANCH_FAILED',
      rejected: true,
      noOp: true,
      evidence,
      reason: 'Branch produced no route, copper, unconnected, ERC, or DRC metric change.',
    }
  }
  if (!evidence.valid) {
    return {
      ...branchResult,
      status: 'NO_EXECUTION_EVIDENCE_BRANCH_FAILED',
      rejected: true,
      noOp,
      evidence,
      reason: 'Branch did not prove route attempts, copper writes, checker execution, or exact blocker proof.',
    }
  }
  return { ...branchResult, rejected: false, noOp, evidence }
}

export function scoreEscRoutingBranchDelta({ before = {}, after = {}, exactBlockerProofCount = 0, forbiddenChanges = 0 } = {}) {
  const delta = {
    forbiddenChanges,
    segmentsRetainedDelta: Number(after.segments ?? 0) - Number(before.segments ?? 0),
    viasRetainedDelta: Number(after.vias ?? 0) - Number(before.vias ?? 0),
    zonesRetainedDelta: Number(after.zones ?? 0) - Number(before.zones ?? 0),
    routedNetsDelta: Number(after.netsRouted ?? Object.keys(after.retainedNets || {}).length) - Number(before.netsRouted ?? Object.keys(before.retainedNets || {}).length),
    globalUnconnectedDelta: Number(after.globalUnconnected ?? 499) - Number(before.globalUnconnected ?? 499),
    ercErrorDelta: Number(after.ercErrors ?? 0) - Number(before.ercErrors ?? 0),
    drcErrorDelta: Number(after.drcErrors ?? after.errors ?? 0) - Number(before.drcErrors ?? before.errors ?? 0),
    drcWarningDelta: Number(after.drcWarnings ?? after.warnings ?? 0) - Number(before.drcWarnings ?? before.warnings ?? 0),
    generatedDrcRegression: Math.max(0, Number(after.generatedDrcRegression ?? 0)),
    exactBlockerProofCount,
  }
  const noProgress = delta.segmentsRetainedDelta === 0
    && delta.viasRetainedDelta === 0
    && delta.zonesRetainedDelta === 0
    && delta.routedNetsDelta === 0
    && delta.globalUnconnectedDelta === 0
    && delta.ercErrorDelta === 0
    && delta.drcErrorDelta === 0
    && delta.drcWarningDelta === 0
    && exactBlockerProofCount === 0
  const score = forbiddenChanges ? -1000000
    : noProgress ? -10000
    : delta.routedNetsDelta * 2000
      + delta.segmentsRetainedDelta * 25
      + delta.viasRetainedDelta * 15
      + delta.zonesRetainedDelta * 50
      - delta.globalUnconnectedDelta * 1500
      - delta.drcErrorDelta * 20
      - delta.ercErrorDelta * 40
      - delta.drcWarningDelta * 2
      - delta.generatedDrcRegression * 50
      + exactBlockerProofCount * 100
  return { ...delta, noProgress, score }
}

export function compareEscRoutingBranches(a = {}, b = {}) {
  if ((a.forbiddenChanges || 0) !== (b.forbiddenChanges || 0)) return (a.forbiddenChanges || 0) < (b.forbiddenChanges || 0) ? 1 : -1
  if ((a.globalUnconnected ?? Infinity) !== (b.globalUnconnected ?? Infinity)) return (a.globalUnconnected ?? Infinity) < (b.globalUnconnected ?? Infinity) ? 1 : -1
  if ((a.netsRouted || 0) !== (b.netsRouted || 0)) return (a.netsRouted || 0) > (b.netsRouted || 0) ? 1 : -1
  if ((a.drcErrors ?? Infinity) !== (b.drcErrors ?? Infinity)) return (a.drcErrors ?? Infinity) < (b.drcErrors ?? Infinity) ? 1 : -1
  if ((a.ercErrors ?? Infinity) !== (b.ercErrors ?? Infinity)) return (a.ercErrors ?? Infinity) < (b.ercErrors ?? Infinity) ? 1 : -1
  return (a.score || 0) >= (b.score || 0) ? 1 : -1
}

export async function promoteBestEscRoutingBranch({ projectDir, branches = [], baselineBranch = null } = {}) {
  const sorted = [...branches].sort((left, right) => -compareEscRoutingBranches(left.score || left, right.score || right))
  const best = sorted[0] || baselineBranch
  const bestBranch = best?.branch || best
  if (bestBranch?.snapshots?.pcb && baselineBranch?.id && bestBranch.id !== baselineBranch.id) await restoreEscRoutingBranch({ projectDir, branch: bestBranch })
  return { status: 'BEST_BRANCH_PROMOTED', bestBranch: bestBranch?.id || null, bestScore: best?.score || best || null }
}

export function detectExternalAutorouterAvailability({ projectDir = process.cwd(), env = process.env } = {}) {
  const candidates = [
    env.FREEROUTING_JAR,
    path.join(projectDir, 'freerouting.jar'),
    path.join(projectDir, 'tools', 'freerouting.jar'),
    path.join(pluginRoot, 'freerouting.jar'),
    path.join(pluginRoot, 'tools', 'freerouting.jar'),
  ].filter(Boolean)
  const freeroutingJar = candidates.find((candidate) => existsSync(candidate)) || null
  const javaAvailable = Boolean(env.JAVA_HOME) || Boolean(env.PATH && /java/i.test(env.PATH))
  return {
    checked: true,
    dsnExportSupport: true,
    sesImportSupport: true,
    freeroutingJar,
    javaAvailable,
    available: Boolean(freeroutingJar && javaAvailable),
    reason: freeroutingJar ? (javaAvailable ? 'FreeRouting jar and Java environment detected.' : 'FreeRouting jar found but Java was not detected from environment.') : 'FreeRouting jar not found in project/plugin search paths.',
  }
}

function branchWorkloads() {
  return [
    {
      id: 'conservative-continuation',
      strategy: 'conservative-continuation',
      maxRouteNets: 40,
      priorityNets: [],
      description: 'Continue from retained copper and route remaining low-risk nets one-by-one.',
    },
    {
      id: 'ripup-generated-copper-only-reroute',
      strategy: 'ripup-generated-copper-only-reroute',
      maxRouteNets: 80,
      ripupGeneratedCopperOnly: true,
      priorityNets: [],
      description: 'Rip up generated copper in branch only and reroute routeable nets from scratch.',
    },
    {
      id: 'signal-first',
      strategy: 'signal-first',
      maxRouteNets: 40,
      priorityNets: ['/BOOT_SEL_ESC', '/RAMP12', '/PGOOD', '/SS_U2', '/HSE_OSC_OUT', '/HSE_OSC_IN', '/I2C1_SDA', '/SWDIO', '/SWCLK', '/NRST', '/ESC_TELEM', '/VREF+'],
      description: 'Route signal/control/debug nets before power.',
    },
    {
      id: 'power-rail-first',
      strategy: 'power-rail-first',
      maxRouteNets: 40,
      priorityNets: ['VIN', '/VBAT_HK', '/VBAT_SENSE', '/VREG3V3', '/VREG5', '/VREG12'],
      description: 'Route VIN, sense, VREG, and remaining VDD nets first.',
    },
    {
      id: 'gnd-pgnd-zone-first',
      strategy: 'gnd-pgnd-zone-first',
      maxRouteNets: 30,
      attemptGroundZones: true,
      priorityNets: ['GND', 'PGND', '/GND', '/PGND'],
      description: 'Attempt legal In1/In6 GND/PGND zones and stitching before signals.',
    },
    {
      id: 'high-density-reroute',
      strategy: 'high-density-reroute',
      maxRouteNets: 80,
      highDensity: true,
      priorityNets: [],
      description: 'Use high-density DRC-aware routing, via-site scoring, and generated-copper ripup/reroute.',
    },
  ]
}

async function executeEscRoutingBranchWork({ projectDir, workspace, branch, workload, input = {}, branchExecutor = null, baselineMetrics = {} } = {}) {
  if (branchExecutor) return branchExecutor({ projectDir, workspace, branch, workload, input, baselineMetrics })
  const before = { ...baselineMetrics }
  const trace = await executeJob({
    id: `esc_branch_${workload.id}_${Date.now()}`,
    type: 'trace_existing_board',
    input: {
      ...input,
      projectPath: path.relative(workspace, projectDir),
      traceExistingBoardMode: true,
      noSourcingOrReplacementMode: true,
      allowPartialAutorouteWrite: true,
      allowUnsafeRoutingWrite: input.branchAllowPrecheckDrcTrial !== false,
      layerCount: input.layerCount || 8,
      maxRouteNets: Number(workload.maxRouteNets || input.maxRouteNets || 40),
      priorityNets: workload.priorityNets || [],
      ripupGeneratedCopperOnly: Boolean(workload.ripupGeneratedCopperOnly),
      attemptGroundZones: Boolean(workload.attemptGroundZones),
      highDensityBranch: Boolean(workload.highDensity),
      branchStrategy: workload.strategy,
      branchStrictPriority: Boolean(workload.priorityNets?.length),
    },
  }, workspace)
  const copper = await scanEscSupervisorCopper(projectDir)
  const traceReport = trace.traceReport || trace
  const drcCounts = traceReport.finalDrc?.issueCounts || {}
  const ercCounts = traceReport.erc?.issueCounts || {}
  const after = {
    ...copper,
    netsRouted: Object.keys(copper.retainedNets || {}).length,
    globalUnconnected: Number(traceReport.finalDrc?.classification?.normalizedCounts?.kicadUnconnected ?? before.globalUnconnected ?? 499),
    drcErrors: Number(drcCounts.errors ?? before.drcErrors ?? 0),
    drcWarnings: Number(drcCounts.warnings ?? before.drcWarnings ?? 0),
    ercErrors: Number(ercCounts.errors ?? before.ercErrors ?? 0),
  }
  return {
    branchId: branch.id,
    workload,
    before,
    after,
    routesAttempted: (traceReport.routing?.legalTrace?.transactionResults || []).length + (traceReport.routing?.legalTrace?.blockedRoutes || []).length,
    wroteCopper: Number(after.segments || 0) > Number(before.segments || 0) || Number(after.vias || 0) > Number(before.vias || 0) || Number(after.zones || 0) > Number(before.zones || 0),
    drcAfter: traceReport.finalDrc || null,
    ercAfter: traceReport.erc || null,
    traceStatus: trace.status,
  }
}

export async function runMultiBranchEscRouting({ projectDir, workspace, cleanupPhase = {}, input = {}, branchExecutor = null } = {}) {
  const originalReferencePath = input.originalReferencePath || path.resolve(workspace, 'FN-ESC1')
  const generatedFiles = []
  const baselineBranch = await createEscRoutingBranch({ projectDir, branchId: `baseline_${Date.now()}`, strategy: 'preserve-current-retained-copper' })
  baselineBranch.originalReferencePath = originalReferencePath
  const originalSpecAudit = await auditOriginalEscSpec({ derivativePath: projectDir, originalReferencePath }).catch(() => null)
  const baselineScore = await scoreEscRoutingBranch({
    projectDir,
    branch: baselineBranch,
    drcReport: cleanupPhase.drcBefore || cleanupPhase.drcAfter || {},
    ercReport: cleanupPhase.ercBefore || cleanupPhase.ercAfter || {},
    originalSpecAudit,
  })
  const baselineMetrics = {
    segments: baselineScore.segmentsRetained,
    vias: baselineScore.viasRetained,
    zones: baselineScore.zonesRetained,
    retainedNets: baselineBranch.copper.retainedNets || {},
    netsRouted: baselineScore.netsRouted,
    globalUnconnected: baselineScore.globalUnconnected,
    ercErrors: baselineScore.ercErrors,
    drcErrors: baselineScore.drcErrors,
    drcWarnings: baselineScore.drcWarnings,
  }
  const branchResults = [{ branch: baselineBranch, score: { ...baselineScore, delta: scoreEscRoutingBranchDelta({ before: baselineMetrics, after: baselineMetrics }) }, status: 'BRANCH_BASELINE_KEPT' }]
  const externalAutorouter = detectExternalAutorouterAvailability({ projectDir, env: process.env })
  const cleanupImproved = issueCountsImproved(cleanupPhase.drcAfter?.issueCounts, cleanupPhase.drcBefore?.issueCounts) || issueCountsImproved(cleanupPhase.ercAfter?.issueCounts, cleanupPhase.ercBefore?.issueCounts)
  if (!cleanupImproved && (cleanupPhase.drcRepairActions?.length || cleanupPhase.ercRepairActions?.length)) {
    branchResults.push({
      branch: { id: 'cleanup-repair-attempt', strategy: 'branch-scoped-erc-drc-cleanup' },
      score: { ...baselineScore, branchId: 'cleanup-repair-attempt', strategy: 'branch-scoped-erc-drc-cleanup', score: baselineScore.score - 1, delta: scoreEscRoutingBranchDelta({ before: baselineMetrics, after: baselineMetrics }) },
      status: 'BRANCH_DISCARDED',
      discardReason: 'Cleanup branch did not improve ERC/DRC counts and was restored.',
    })
  }
  const maxBranches = Math.max(1, Number(input.maxRoutingBranches || branchWorkloads().length))
  for (const workload of branchWorkloads().slice(0, maxBranches)) {
    const branch = await createEscRoutingBranch({ projectDir, branchId: `${workload.id}_${Date.now()}`, strategy: workload.strategy })
    await restoreEscRoutingBranch({ projectDir, branch: baselineBranch })
    const execution = await executeEscRoutingBranchWork({ projectDir, workspace, branch, workload, input, branchExecutor, baselineMetrics })
    const guarded = rejectNoOpBranch(execution)
    const delta = scoreEscRoutingBranchDelta({ before: execution.before, after: execution.after, exactBlockerProofCount: Number(execution.exactBlockerProofCount || 0), forbiddenChanges: baselineScore.forbiddenChanges })
    if (guarded.rejected) await restoreEscRoutingBranch({ projectDir, branch: baselineBranch })
    branchResults.push({
      branch,
      score: {
        ...baselineScore,
        branchId: branch.id,
        strategy: branch.strategy,
        segmentsRetained: execution.after?.segments ?? baselineScore.segmentsRetained,
        viasRetained: execution.after?.vias ?? baselineScore.viasRetained,
        zonesRetained: execution.after?.zones ?? baselineScore.zonesRetained,
        netsRouted: execution.after?.netsRouted ?? baselineScore.netsRouted,
        globalUnconnected: execution.after?.globalUnconnected ?? baselineScore.globalUnconnected,
        ercErrors: execution.after?.ercErrors ?? baselineScore.ercErrors,
        drcErrors: execution.after?.drcErrors ?? baselineScore.drcErrors,
        drcWarnings: execution.after?.drcWarnings ?? baselineScore.drcWarnings,
        score: baselineScore.score + delta.score,
        delta,
      },
      status: guarded.rejected ? guarded.status : 'BRANCH_EXECUTED',
      execution: guarded,
      discardReason: guarded.rejected ? guarded.reason : undefined,
    })
  }
  if (!externalAutorouter.available) {
    branchResults.push({
      branch: { id: 'external-autorouter', strategy: 'external-autorouter-experiment' },
      score: { ...baselineScore, branchId: 'external-autorouter', strategy: 'external-autorouter-experiment', score: baselineScore.score - 3, delta: scoreEscRoutingBranchDelta({ before: baselineMetrics, after: baselineMetrics }) },
      status: 'BRANCH_SKIPPED',
      discardReason: externalAutorouter.reason,
    })
  }
  await restoreEscRoutingBranch({ projectDir, branch: baselineBranch })
  const executedBranches = branchResults.filter((entry) => String(entry.status || '').startsWith('BRANCH_EXECUTED') || String(entry.status || '').includes('NO_OP') || String(entry.status || '').includes('NO_EXECUTION'))
  const improvedBranches = branchResults.filter((entry) => (entry.score?.delta?.score || 0) > 0 && !entry.execution?.rejected)
  const noBranchImproved = executedBranches.length > 0 && improvedBranches.length === 0
  const internalRepairTask = noBranchImproved
    ? executeInternalRepairTask(createInternalRepairTask({ code: 'MULTI_BRANCH_ROUTING_FAILED', reason: 'No routing branch produced measurable improvement.', net: null }, { cycleIndex: 0, traceIndex: 0, taskIndex: 0 }), { currentCopper: baselineBranch.copper })
    : null
  const promoted = await promoteBestEscRoutingBranch({ projectDir, branches: branchResults, baselineBranch })
  const report = {
    status: 'ESC_MULTI_BRANCH_ROUTING_EVALUATED',
    implemented: true,
    branchesCreated: branchResults.length,
    branchesTested: branchResults.length,
    bestBranch: promoted.bestBranch,
    externalAutorouterChecked: true,
    externalAutorouterUsed: false,
    externalAutorouter,
    branchPromoted: promoted.bestBranch === baselineBranch.id ? 'baseline_preserved' : promoted.bestBranch,
    noBranchImproved,
    internalRepairTask,
    branches: branchResults,
  }
  const jsonFile = path.join(projectDir, 'boardforge-esc-multi-branch-routing.json')
  const markdownFile = path.join(projectDir, 'BoardForge_ESC_Multi_Branch_Routing_Report.md')
  await writeFile(jsonFile, JSON.stringify(report, null, 2), 'utf8')
  await writeFile(markdownFile, [
    '# BoardForge ESC Multi-Branch Routing',
    '',
    `Status: ${report.status}`,
    `Best branch: ${report.bestBranch}`,
    `External autorouter: ${externalAutorouter.available ? 'available' : 'not available'} - ${externalAutorouter.reason}`,
    '',
    ...branchResults.map((entry) => `- ${entry.branch.id}: ${entry.status} (score ${entry.score.score})`),
    '',
  ].join('\n'), 'utf8')
  generatedFiles.push(jsonFile, markdownFile)
  return { ...report, generatedFiles }
}

function summarizeSupervisorTrace(traceResult = {}) {
  const trace = traceResult.traceReport || traceResult
  return {
    status: traceResult.status || trace.status,
    routed: trace.routing?.routed,
    unrouted: trace.routing?.unrouted,
    committedRoutes: trace.routing?.legalTrace?.committedRoutes,
    rolledBackRoutes: trace.routing?.legalTrace?.rolledBackRoutes,
    writerFailures: trace.routing?.legalTrace?.writerFailures,
    finalDrc: trace.finalDrc?.issueCounts,
    finalErc: trace.erc?.issueCounts,
    originalSpecStatus: trace.originalSpecAudit?.status,
  }
}

function supervisorReachedCleanFinalState(traceResult = {}) {
  const trace = traceResult.traceReport || traceResult
  const drcCounts = trace.finalDrc?.issueCounts
  const ercCounts = trace.erc?.issueCounts
  return /DRC_CLEAN|ERC_DRC_PASSED|FULLY_ROUTED/i.test(trace.status || '')
    && !(trace.routing?.unrouted?.length)
    && drcCounts
    && ercCounts
    && Number(drcCounts.errors || 0) === 0
    && Number(ercCounts.errors || 0) === 0
}

function supervisorValidFinalState(state = '') {
  return ['esc_existing_footprints_fully_routed_erc_drc_passed', 'esc_ready_for_manufacturing_export_review', 'esc_existing_footprints_routed_except_exact_forbidden_blockers', 'needs_user_approval_board_outline_change', 'needs_user_approval_mounting_hole_move', 'needs_user_approval_footprint_change_for_exact_remaining_net', 'needs_user_approval_forbidden_via_policy_change'].includes(state)
}

function normalizeNetNameForBranch(net) {
  const value = String(net || '').trim()
  return value.startsWith('/') ? value : `/${value}`
}

export function applyTraceBranchRoutingSelection({ routingPlan = {}, input = {} } = {}) {
  const routes = routingPlan.routes || []
  const priority = (input.priorityNets || []).map(normalizeNetNameForBranch)
  const prioritySet = new Set(priority)
  const maxRouteNets = Math.max(1, Number(input.maxRouteNets || routes.length || 1))
  const strictPriority = Boolean(input.branchStrictPriority && prioritySet.size)
  const ranked = [...routes].sort((a, b) => {
    const aIndex = priority.indexOf(normalizeNetNameForBranch(a.net))
    const bIndex = priority.indexOf(normalizeNetNameForBranch(b.net))
    const ar = aIndex >= 0 ? aIndex : 999999
    const br = bIndex >= 0 ? bIndex : 999999
    if (ar !== br) return ar - br
    return String(a.net || '').localeCompare(String(b.net || ''))
  })
  const selected = (strictPriority ? ranked.filter((route) => prioritySet.has(normalizeNetNameForBranch(route.net))) : ranked).slice(0, maxRouteNets)
  const selectedNets = [...new Set(selected.map((route) => route.net).filter(Boolean))]
  const deferred = routes
    .filter((route) => !selected.includes(route))
    .map((route) => route.net)
    .filter(Boolean)
  return {
    ...routingPlan,
    routes: selected,
    routedNets: selected.filter((route) => route.status === 'routed').map((route) => route.net),
    unroutedNets: [...new Set([...(routingPlan.unroutedNets || []), ...deferred])],
    legalTrace: {
      ...(routingPlan.legalTrace || {}),
      branchSelection: {
        strategy: input.branchStrategy || null,
        strictPriority,
        priorityNets: priority,
        maxRouteNets,
        inputRoutes: routes.length,
        selectedRoutes: selected.length,
        selectedNets,
        deferredNets: [...new Set(deferred)],
      },
    },
  }
}

export function validateEscFinalState({ traceResult = {}, cycles = [], input = {} } = {}) {
  const trace = traceResult?.traceReport || traceResult || {}
  const legalTrace = trace.routing?.legalTrace || {}
  const transactions = legalTrace.transactionResults || []
  const blockedRoutes = legalTrace.blockedRoutes || []
  const unrouted = trace.routing?.unrouted || []
  const attemptedNets = new Set([
    ...transactions.map((item) => item.net).filter(Boolean),
    ...blockedRoutes.map((item) => item.net).filter(Boolean),
  ])
  const exactBlockers = exactSupervisorBlockers(trace)
  const minimumAttemptedNets = Math.max(1, Number(input.minimumAttemptedNetsForStrictFinalState || Math.min(30, Math.max(10, unrouted.length))))
  const allRouteableNetsAttempted = attemptedNets.size >= minimumAttemptedNets || (unrouted.length > 0 && unrouted.every((net) => attemptedNets.has(net)))
  const blockerProofComplete = exactBlockers.length > 0 && exactBlockers.every((blocker) => {
    if (!blocker.net || !blocker.exactGeometryBlocker) return false
    if (blocker.exactGeometryBlocker === 'ROUTE_DOES_NOT_PROVE_PAD_TO_PAD_CONNECTIVITY') return Boolean(blocker.source && blocker.target)
    return Boolean(blocker.details)
  })
  const repairAttemptsRecorded = cycles.some((cycle) => (cycle.tasks || []).length > 0)
  const blockerFamilies = new Set(exactBlockers.map((blocker) => blocker.exactGeometryBlocker).filter(Boolean))
  const drcIssuesClassified = Boolean(trace.finalDrc?.issueCounts) || exactBlockers.some((blocker) => /DRC/i.test(blocker.exactGeometryBlocker || ''))
  const ercIssuesClassified = Boolean(trace.erc?.issueCounts || trace.erc?.status || trace.finalErc?.issueCounts)
  const internalBlockers = exactBlockers.filter((blocker) => !blocker.forbiddenApprovalRequired || /DRC_ERROR_REGRESSION|VIN_DRC_REGRESSION|DRC_NEEDS_FIX|ERC_NEEDS_FIX/i.test(blocker.exactGeometryBlocker || blocker.reason || ''))
  const forbiddenBlockers = exactBlockers.filter((blocker) => Boolean(blocker.forbiddenApprovalRequired))
  const onlyForbiddenBlockersRemain = exactBlockers.length > 0 && forbiddenBlockers.length === exactBlockers.length
  const routedExceptForbiddenValid = allRouteableNetsAttempted && blockerProofComplete && repairAttemptsRecorded && drcIssuesClassified && ercIssuesClassified && onlyForbiddenBlockersRemain
  const routeableCompletedDrcRepairNeeded = false
  return {
    valid: routedExceptForbiddenValid || routeableCompletedDrcRepairNeeded,
    finalState: routedExceptForbiddenValid
      ? 'esc_existing_footprints_routed_except_exact_forbidden_blockers'
      : routeableCompletedDrcRepairNeeded
        ? 'esc_existing_footprints_routeable_nets_completed_drc_repair_needed'
        : 'esc_existing_footprints_routeable_nets_completed_drc_repair_needed',
    allRouteableNetsAttempted,
    attemptedNetCount: attemptedNets.size,
    minimumAttemptedNets,
    unroutedCount: unrouted.length,
    blockerProofComplete,
    repairAttemptsRecorded,
    drcIssuesClassified,
    ercIssuesClassified,
    blockerFamilies: [...blockerFamilies].sort(),
    internalBlockerCount: internalBlockers.length,
    forbiddenBlockerCount: forbiddenBlockers.length,
    rejectedPrematureBoundedFinalState: !(routedExceptForbiddenValid || routeableCompletedDrcRepairNeeded),
  }
}

function attachCleanupPhaseToTrace(traceResult = {}, cleanupPhase = {}) {
  const wrapper = traceResult?.traceReport ? { ...traceResult, traceReport: { ...traceResult.traceReport } } : { ...(traceResult || {}) }
  const trace = wrapper.traceReport || wrapper
  trace.finalDrc = cleanupPhase.drcOutput || trace.finalDrc
  trace.erc = cleanupPhase.ercOutput || trace.erc
  trace.cleanupPhase = cleanupPhase
  return wrapper
}

async function runEscErcDrcCleanupPhase({ projectDir, workspace }) {
  const reportsDir = path.join(projectDir, 'reports')
  await mkdir(reportsDir, { recursive: true })
  const detected = await detectKiCadCli()
  const files = await findKiCadProjectFiles(projectDir)
  const generatedFiles = []
  const drcFile = path.join(reportsDir, 'esc-supervisor-drc-cleanup.json')
  const ercFile = path.join(reportsDir, 'esc-supervisor-erc-cleanup.json')
  let drcOutput = files.pcbFile
    ? await runDrc({ pcbFile: files.pcbFile, outputFile: drcFile, kicadCliPath: detected.path, saveBoard: false })
    : { status: 'DRC_NOT_RUN_NO_PCB', issueCounts: { errors: 0, warnings: 0 } }
  generatedFiles.push(drcFile)
  let ercOutput = files.schFile
    ? await runErc({ schFile: files.schFile, outputFile: ercFile, kicadCliPath: detected.path })
    : { status: 'ERC_NOT_RUN_NO_SCHEMATIC', issueCounts: { errors: 0, warnings: 0 } }
  generatedFiles.push(ercFile)
  const ercBefore = ercOutput.issueCounts || ercOutput.report?.report?.issueCounts || null
  const drcBefore = drcOutput.issueCounts || drcOutput.report?.report?.issueCounts || null

  let ercPlan = null
  let ercApplied = { status: 'ERC_REPAIR_NOT_ATTEMPTED', applied: 0 }
  if (files.schFile && ercOutput.reportFile) {
    const beforeSch = await readFile(files.schFile, 'utf8')
    ercPlan = await planErcRepairs({ reportFile: ercOutput.reportFile, schFile: files.schFile, state: await readProjectState(projectDir) })
    if (ercPlan.autoApplicable?.length) {
      ercApplied = await applySafeErcRepairs({ schFile: files.schFile, repairPlan: ercPlan })
      if (ercApplied.applied) {
        const ercAfterFile = path.join(reportsDir, 'esc-supervisor-erc-cleanup-after-repair.json')
        const repairedErc = await runErc({ schFile: files.schFile, outputFile: ercAfterFile, kicadCliPath: detected.path })
        generatedFiles.push(ercAfterFile)
        if (issueCountsImproved(repairedErc.issueCounts, ercBefore)) {
          ercOutput = repairedErc
        } else {
          await writeFile(files.schFile, beforeSch, 'utf8')
          ercApplied = { ...ercApplied, status: 'SAFE_ERC_REPAIRS_RESTORED_NO_IMPROVEMENT', restored: true }
          const restoredErcFile = path.join(reportsDir, 'esc-supervisor-erc-cleanup-restored.json')
          ercOutput = await runErc({ schFile: files.schFile, outputFile: restoredErcFile, kicadCliPath: detected.path })
          generatedFiles.push(restoredErcFile)
        }
      }
    } else {
      ercApplied = { status: 'NO_SAFE_ERC_REPAIRS_AVAILABLE', applied: 0 }
    }
  }

  let drcPlan = null
  let drcApplied = { status: 'DRC_REPAIR_NOT_ATTEMPTED', applied: 0 }
  let drcRepairLoop = null
  if (files.pcbFile && drcOutput.reportFile) {
    const beforePcb = await readFile(files.pcbFile, 'utf8')
    drcPlan = await planDrcRepairs({ reportFile: drcOutput.reportFile, pcbFile: files.pcbFile, profile: getManufacturerProfile('JLCPCB_STANDARD'), state: await readProjectState(projectDir) })
    if (drcPlan.autoApplicable?.length) {
      drcApplied = await applySafeDrcRepairs({ pcbFile: files.pcbFile, repairPlan: drcPlan })
      if (drcApplied.applied) {
        const drcAfterFile = path.join(reportsDir, 'esc-supervisor-drc-cleanup-after-repair.json')
        const repairedDrc = await runDrc({ pcbFile: files.pcbFile, outputFile: drcAfterFile, kicadCliPath: detected.path, saveBoard: false })
        generatedFiles.push(drcAfterFile)
        if (issueCountsImproved(repairedDrc.issueCounts, drcBefore)) {
          drcOutput = repairedDrc
        } else {
          await writeFile(files.pcbFile, beforePcb, 'utf8')
          drcApplied = { ...drcApplied, status: 'SAFE_DRC_REPAIRS_RESTORED_NO_IMPROVEMENT', restored: true }
          const restoredDrcFile = path.join(reportsDir, 'esc-supervisor-drc-cleanup-restored.json')
          drcOutput = await runDrc({ pcbFile: files.pcbFile, outputFile: restoredDrcFile, kicadCliPath: detected.path, saveBoard: false })
          generatedFiles.push(restoredDrcFile)
        }
      }
    } else {
      drcApplied = { status: 'NO_SAFE_DRC_REPAIRS_AVAILABLE', applied: 0 }
    }
    if (!drcApplied.applied && drcPlan.status !== 'DRC_REPAIR_NO_ACTIONS_FOUND') {
      drcRepairLoop = await runDrcDrivenCopperRepairLoop({
        pcbFile: files.pcbFile,
        reportDir: path.join(reportsDir, 'esc-supervisor-drc-cleanup-loop'),
        runDrc: ({ outputFile }) => runDrc({ pcbFile: files.pcbFile, outputFile, kicadCliPath: detected.path, saveBoard: false }),
        profile: getManufacturerProfile('JLCPCB_STANDARD'),
        state: await readProjectState(projectDir),
        maxIterations: 2,
      })
      if (drcRepairLoop.finalReport) drcOutput = drcRepairLoop.finalReport
    }
  }

  const ercClassification = classifyEscErcErrors(ercOutput)
  const ercRepair = repairEscErcErrorsLocally(ercOutput)
  const drcClassification = classifyEscDrcFamilies(drcOutput)
  const drcRepairs = {
    generatedCopper: repairGeneratedCopperDrc(drcOutput),
    routeRoute: repairRouteRouteClearance(drcOutput),
    padVia: repairPadViaClearance(drcOutput),
    boardEdge: repairBoardEdgeDrc(drcOutput),
  }
  const ercReport = await writeEscErcRepairReport({ projectDir, ercOutput, ercClassification, ercRepair })
  const drcReport = await writeEscDrcCleanupReport({ projectDir, drcOutput, drcClassification, drcRepairs })
  generatedFiles.push(...Object.values(ercReport), ...Object.values(drcReport))
  return {
    status: drcOutput.issueCounts?.errors || ercOutput.issueCounts?.errors ? 'ESC_ERC_DRC_CLEANUP_NEEDED' : 'ESC_ERC_DRC_CLEAN',
    ercBefore,
    ercAfter: ercOutput.issueCounts || ercOutput.report?.report?.issueCounts || null,
    ercPlan,
    ercApplied,
    drcBefore,
    drcAfter: drcOutput.issueCounts || drcOutput.report?.report?.issueCounts || null,
    drcPlan,
    drcApplied,
    drcRepairLoop,
    drcOutput,
    ercOutput,
    ercClassification,
    ercRepair,
    drcClassification,
    drcRepairs,
    generatedFiles,
  }
}

function exactSupervisorBlockers(traceResult = {}) {
  const trace = traceResult?.traceReport || traceResult || {}
  return (trace.routing?.legalTrace?.transactionResults || [])
    .filter((item) => item.status !== 'route_committed' && item.status !== 'route_committed_warning_repair_debt')
    .slice(0, 12)
    .map((item) => {
      const source = item.connectivity?.sourcePad || item.source || formatTransactionPad(item.sourceRef, item.sourcePad) || null
      const target = item.connectivity?.targetPad || item.target || formatTransactionPad(item.targetRef, item.targetPad) || null
      const missingProof = !source || !target
      return {
        net: item.net,
        source,
        target,
        exactGeometryBlocker: missingProof ? 'ROUTE_TRANSACTION_SOURCE_TARGET_UNKNOWN' : item.status === 'route_drc_worsened_rolled_back' ? item.drcRegression?.reason : item.reason,
        forbiddenApprovalRequired: null,
        details: item.connectivity || item.drcRegression || item.failure || null,
      }
    })
}

function formatTransactionPad(ref, pad) {
  if (!ref || !pad) return null
  return `${ref} pad ${pad}`
}

function supervisorWarnings(supervisor = {}) {
  return supervisor.status === 'esc_existing_footprints_fully_routed_erc_drc_passed'
    ? []
    : [{ severity: 'WARNING', code: 'ESC_SUPERVISOR_PARTIAL', message: `${supervisor.blockers?.length || 0} exact blocker(s) remain after autonomous supervisor cycles.` }]
}

function supervisorErrors(supervisor = {}) {
  if (/^needs_user_approval/.test(supervisor.status)) return [{ severity: 'ERROR', code: supervisor.status.toUpperCase(), message: 'A forbidden user approval change is required.', details: supervisor.blockers }]
  return []
}

async function traceExistingBoardJob(job, workspace, profile) {
  const context = await getKiCadContext(job, workspace, 'pcb')
  if (context.blocked) return context.blocked
  const projectDir = context.files.projectDir
  const shouldRunOriginalSpecAudit = Boolean(
    job.input?.requireOriginalSpecAudit === true ||
    job.input?.originalReferencePath ||
    job.input?.originalEscReferencePath ||
    /FN-ESC1|BoardForge_ESC/i.test(projectDir)
  )
  const originalSpecAudit = shouldRunOriginalSpecAudit
    ? await auditOriginalEscSpec({
      derivativeDir: projectDir,
      originalDir: resolveOriginalEscReferencePath(workspace, job.input?.originalReferencePath || job.input?.originalEscReferencePath || null),
      restore: job.input?.restoreOriginalSpec !== false,
    })
    : { status: 'ORIGINAL_SPEC_AUDIT_SKIPPED_NON_ESC_PROJECT', finalOriginalSpecStatus: 'not_applicable_non_esc_project' }
  const originalSpecAuditFiles = !job.dryRun && shouldRunOriginalSpecAudit ? await writeOriginalSpecAuditReport({ projectDir, audit: originalSpecAudit }) : null
  if (originalSpecAudit.status === 'ORIGINAL_REFERENCE_MISSING') {
    return result(job, 'TRACE_EXISTING_BOARD_BLOCKED_MISSING_ORIGINAL_REFERENCE', [], originalSpecAudit.blockers || [], {
      originalSpecAudit,
      generatedFiles: Object.values(originalSpecAuditFiles || {}).filter(Boolean),
      humanReviewRequired: true,
    })
  }
  const state = await readProjectState(projectDir)
  const initialScan = await scanKiCadProject(projectDir)
  const board = boardFromExistingScan({ scan: initialScan, state, job })
  const useExactScannedGeometry = shouldRunOriginalSpecAudit || job.input?.noSourcingOrReplacementMode === true
  const rawComponents = job.input?.components || (useExactScannedGeometry ? componentsFromScan(initialScan) : await readRichComponents(projectDir) || state?.components || componentsFromScan(initialScan))
  const components = rawComponents.length ? await enrichComponents({ workspace, components: rawComponents, input: job.input || state?.requirements || {} }) : []
  const skippedRoutingNets = new Set((job.input?.skipNets || job.input?.temporarilyBlockedNets || []).map((net) => String(net)))
  const scannedOrInputNets = job.input?.nets || (useExactScannedGeometry ? netsFromScan(initialScan) : await readSchematicGraphNetlist(projectDir) || state?.netlist?.nets || netsFromScan(initialScan))
  const nets = assignNetsToClasses(scannedOrInputNets)
    .filter((net) => !skippedRoutingNets.has(String(net.name || net.net || net)))
  const stackup = planStackup({
    board,
    layerCount: board.layerCount,
    components,
    nets,
    manufacturerProfile: profile.id,
    allowBlindVias: Boolean(job.input?.allowBlindVias),
    allowBuriedVias: Boolean(job.input?.allowBuriedVias),
    allowMicrovias: Boolean(job.input?.allowMicrovias),
  })
  const viaStrategy = selectViaStrategy({
    board,
    components,
    nets,
    profile,
    stackup,
    layerCount: board.layerCount,
    allowBlindVias: Boolean(job.input?.allowBlindVias),
    allowBuriedVias: Boolean(job.input?.allowBuriedVias),
    allowMicrovias: Boolean(job.input?.allowMicrovias),
  })
  const copperPourPlan = planCopperPours({ board, components, nets, profile, options: job.input || {} })
  const bindingReport = useExactScannedGeometry ? resolveScannedKiCadPadBindings(components) : await validateComponentBindings(components)
  const netlist = boardforgeNetlistFromComponents(components, nets)
  const projectNetSettings = !job.dryRun ? await ensureProjectNetSettings(context.files, profile, nets) : { status: 'PROJECT_NET_SETTINGS_DRY_RUN', changed: false }
  const netSync = !job.dryRun ? await applyNetlistSyncToPcb({ pcbFile: context.files.pcbFile, components, netlist }) : { status: 'PCB_NET_SYNC_DRY_RUN', changed: false }
  const iterations = []
  const generatedFiles = []
  generatedFiles.push(...Object.values(originalSpecAuditFiles || {}).filter(Boolean))
  let constraints = job.input?.drcRerouteConstraints || null
  let finalDrc = null
  let finalRoutingPlan = null
  let finalValidation = null
  let finalQuality = null
  let finalScan = initialScan
  const maxIterations = Math.max(1, Number(job.input?.maxIterations || job.input?.maxDrcRerouteIterations || 6))

  for (let index = 0; index < maxIterations; index += 1) {
    finalScan = await scanKiCadProject(projectDir)
    const pads = mergeRoutingPads(job.input?.pads || [], finalScan.pads || [], useExactScannedGeometry ? [] : derivePadsFromComponents(components))
    const routingPlan = autorouteBoard({
      board,
      components,
      nets,
      pads,
      existingTracks: finalScan.tracks || [],
      existingVias: finalScan.vias || [],
      profile,
      options: {
        ...job.input,
        layerCount: board.layerCount,
        routeGroundNets: job.input?.routeGroundNets === true,
        requirePadEndpoints: useExactScannedGeometry,
        enableUsbPadStitching: job.input?.enableUsbPadStitching !== false,
        enableProtectionSidecars: job.input?.enableProtectionSidecars !== false,
        drcRerouteConstraints: constraints,
      },
    })
    const branchSelectedRoutingPlan = applyTraceBranchRoutingSelection({ routingPlan, input: job.input || {} })
    Object.assign(routingPlan, branchSelectedRoutingPlan)
    routingPlan.branchStrategy = job.input?.branchStrategy || null
    routingPlan.allowBranchPrecheckDrcTrial = Boolean(job.input?.allowUnsafeRoutingWrite === true && job.input?.branchStrategy)
    routingPlan.existingRoutedNets = [...new Set((finalScan.tracks || []).map((track) => track.netName).filter(Boolean))]
    routingPlan.maxAcceptedPerNet = Number(job.input?.maxAcceptedPerNet || 1)
    routingPlan.designIntent = {
      ...(routingPlan.designIntent || {}),
      copperPours: useExactScannedGeometry && job.input?.writeCopperPours !== true
        ? []
        : copperPourPlan.designIntentPatch?.copperPours || copperPourPlan.pours || routingPlan.designIntent?.copperPours || [],
      stitchingVias: copperPourPlan.designIntentPatch?.stitchingVias || copperPourPlan.stitchingVias || routingPlan.designIntent?.stitchingVias || [],
      viaStrategy,
      stackup,
    }
    const legalizedRoutingPlan = useExactScannedGeometry
      ? legalizeTraceRoutingPlan({ board, components, routingPlan, profile, pads })
      : routingPlan
    const routeValidation = validateRoutingGeometry({ board, components, routingPlan: legalizedRoutingPlan, profile })
    const routeQuality = scoreRoutingPlan({ routingPlan: legalizedRoutingPlan, profile, powerTree: state?.powerTree || null })
    finalRoutingPlan = legalizedRoutingPlan
    finalValidation = routeValidation
    finalQuality = routeQuality
    const writable = legalizedRoutingPlan.routes?.some((route) => route.status === 'routed' && route.start && route.end)
    const precheckErrors = [...routeValidation.errors, ...routeQuality.errors]
    if (!writable || (precheckErrors.length && job.input?.allowUnsafeRoutingWrite !== true)) {
      iterations.push({
        index: index + 1,
        status: writable ? 'TRACE_PRECHECK_BLOCKED' : 'TRACE_NO_WRITABLE_GEOMETRY',
        routed: legalizedRoutingPlan.routedNets?.length || 0,
        unrouted: legalizedRoutingPlan.unroutedNets?.length || 0,
        blockedRoutes: legalizedRoutingPlan.legalTrace?.blockedRoutes?.length || 0,
        precheckErrors: precheckErrors.map((item) => item.code || item.message),
      })
      break
    }
    const baselineDrcFile = path.join(projectDir, 'reports', `trace-existing-board-drc-baseline-${index + 1}.json`)
    const baselineDrc = useExactScannedGeometry && !job.dryRun
      ? await runDrc({ pcbFile: context.files.pcbFile, outputFile: baselineDrcFile, kicadCliPath: context.detected.path, saveBoard: false })
      : null
    if (baselineDrc) generatedFiles.push(baselineDrcFile)
    if (useExactScannedGeometry && job.input?.transactionalNetCommit !== false && !job.dryRun) {
      const transaction = await routeOneNetTransactions({
        pcbFile: context.files.pcbFile,
        board,
        routingPlan: legalizedRoutingPlan,
        components,
        pads,
        profile,
        baselineDrc,
        projectDir,
        runDrc: ({ outputFile }) => runDrc({ pcbFile: context.files.pcbFile, outputFile, kicadCliPath: context.detected.path, saveBoard: false }),
        iterationIndex: index + 1,
        maxDrcRepairAttemptsPerNet: Number(job.input?.maxDrcRepairAttemptsPerNet || 4),
      })
      generatedFiles.push(...transaction.generatedFiles)
      finalDrc = transaction.finalDrc || baselineDrc
      finalRoutingPlan = {
        ...legalizedRoutingPlan,
        routes: transaction.committedRoutes,
        routedNets: transaction.committedRoutes.map((route) => route.net),
        unroutedNets: [...new Set([...(legalizedRoutingPlan.unroutedNets || []), ...transaction.rolledBack.map((item) => item.net), ...transaction.writerFailures.map((item) => item.net)])],
        legalTrace: {
          ...(legalizedRoutingPlan.legalTrace || {}),
          transactionalCommit: true,
          committedRoutes: transaction.committedRoutes.length,
          rolledBackRoutes: transaction.rolledBack.length,
          writerFailures: transaction.writerFailures.length,
          transactionResults: transaction.results,
        },
      }
      iterations.push({
        index: index + 1,
        status: transaction.committedRoutes.length ? 'TRACE_TRANSACTIONAL_NETS_COMMITTED' : 'TRACE_TRANSACTIONAL_NO_NETS_COMMITTED',
        routed: transaction.committedRoutes.length,
        unrouted: finalRoutingPlan.unroutedNets.length,
        blockedRoutes: legalizedRoutingPlan.legalTrace?.blockedRoutes?.length || 0,
        generatedObjects: transaction.generatedObjects,
        transactions: transaction.results,
        baselineDrc: baselineDrc?.issueCounts,
        drc: finalDrc?.issueCounts || null,
      })
      break
    }
    const beforePcb = await readFile(context.files.pcbFile, 'utf8')
    const write = job.dryRun ? { status: 'TRACE_DRY_RUN_NO_COPPER_WRITTEN', generatedObjects: { segments: 0, vias: 0, zones: 0 } }
      : await applyRoutingPlanToPcb({ pcbFile: context.files.pcbFile, board, routingPlan: legalizedRoutingPlan, components, pads })
    if (!job.dryRun && write.generatedObjects && !write.writeProof?.retained && !write.writeProof?.retainedTotal) {
      await writeFile(context.files.pcbFile, beforePcb, 'utf8')
      iterations.push({
        index: index + 1,
        status: 'TRACE_WRITER_RETENTION_FAILED_RESTORED',
        routed: legalizedRoutingPlan.routedNets?.length || 0,
        unrouted: legalizedRoutingPlan.unroutedNets?.length || 0,
        blockedRoutes: legalizedRoutingPlan.legalTrace?.blockedRoutes?.length || 0,
        generatedObjects: write.generatedObjects,
        writeProof: write.writeProof,
        writerFailurePoint: write.writeProof?.failurePoint || 'KICAD_COPPER_WRITE_NOT_RETAINED',
      })
      finalDrc = baselineDrc
      break
    }
    const reportFile = path.join(projectDir, 'reports', `trace-existing-board-drc-${index + 1}.json`)
    const drc = job.dryRun ? { status: 'DRC_NOT_RUN_DRY_RUN', issueCounts: { errors: 0, warnings: 0 }, reportFile }
      : await runDrc({ pcbFile: context.files.pcbFile, outputFile: reportFile, kicadCliPath: context.detected.path, saveBoard: false })
    generatedFiles.push(reportFile)
    finalDrc = drc
    const worsenedDrc = baselineDrc && drcWorseThan(drc.issueCounts, baselineDrc.issueCounts)
    if (worsenedDrc) {
      if (!job.dryRun) await writeFile(context.files.pcbFile, beforePcb, 'utf8')
      iterations.push({
        index: index + 1,
        status: 'TRACE_DRC_WORSENED_RESTORED',
        routed: legalizedRoutingPlan.routedNets?.length || 0,
        unrouted: legalizedRoutingPlan.unroutedNets?.length || 0,
        blockedRoutes: legalizedRoutingPlan.legalTrace?.blockedRoutes?.length || 0,
        generatedObjects: write.generatedObjects,
        writeProof: write.writeProof,
        baselineDrc: baselineDrc.issueCounts,
        drc: drc.issueCounts,
        reportFile,
      })
      finalDrc = baselineDrc
      break
    }
    const improved = !iterations.length || drc.issueCounts.errors < (iterations.at(-1)?.drc?.errors ?? Infinity)
      || (drc.issueCounts.errors === (iterations.at(-1)?.drc?.errors ?? Infinity) && drc.issueCounts.warnings < (iterations.at(-1)?.drc?.warnings ?? Infinity))
    iterations.push({
      index: index + 1,
      status: drc.issueCounts.errors ? (improved ? 'TRACE_DRC_NEEDS_NEXT_ITERATION' : 'TRACE_DRC_NO_IMPROVEMENT_RESTORED') : 'TRACE_DRC_CLEAN',
      routed: legalizedRoutingPlan.routedNets?.length || 0,
      unrouted: legalizedRoutingPlan.unroutedNets?.length || 0,
      blockedRoutes: legalizedRoutingPlan.legalTrace?.blockedRoutes?.length || 0,
      generatedObjects: write.generatedObjects,
      writeProof: write.writeProof,
      drc: drc.issueCounts,
      reportFile,
      constraints: constraints ? { affectedNets: constraints.affectedNets?.length || 0, forbiddenPoints: constraints.forbiddenPoints?.length || 0 } : null,
    })
    if (!drc.issueCounts.errors) break
    if (!improved) {
      if (!job.dryRun) await writeFile(context.files.pcbFile, beforePcb, 'utf8')
      break
    }
    const nextConstraints = extractDrcRerouteConstraints(drc, { radiusMm: adaptiveDrcRerouteRadius(job.input?.drcRerouteRadiusMm, index) })
    if (!nextConstraints.affectedNets.length && job.input?.enableDrcRepairLoop !== false) {
      const repairLoop = await runDrcDrivenCopperRepairLoop({
        pcbFile: context.files.pcbFile,
        reportDir: path.join(projectDir, 'reports', 'trace-existing-drc-repair-loop'),
        runDrc: ({ outputFile }) => runDrc({ pcbFile: context.files.pcbFile, outputFile, kicadCliPath: context.detected.path, saveBoard: false }),
        profile,
        state: await readProjectState(projectDir),
        maxIterations: Number(job.input?.maxDrcRepairIterations || 3),
      })
      finalDrc = repairLoop.finalReport || drc
      iterations.push({
        index: iterations.length + 1,
        status: repairLoop.status,
        routed: legalizedRoutingPlan.routedNets?.length || 0,
        unrouted: legalizedRoutingPlan.unroutedNets?.length || 0,
        drc: repairLoop.finalIssueCounts,
        repairLoop: repairLoop.iterations?.length || 0,
      })
      if (!finalDrc.issueCounts?.errors) break
      break
    }
    constraints = nextConstraints
  }

  const writerRetentionFailed = iterations.some((item) => item.status === 'TRACE_WRITER_RETENTION_FAILED_RESTORED')
  const status = writerRetentionFailed
    ? 'TRACE_EXISTING_BOARD_WRITER_RETENTION_FAILED'
    : finalDrc?.issueCounts?.errors
    ? 'TRACE_EXISTING_BOARD_BLOCKED_BY_DRC'
    : finalDrc
      ? 'TRACE_EXISTING_BOARD_DRC_CLEAN_NEEDS_EXPORT_REVIEW'
      : 'TRACE_EXISTING_BOARD_BLOCKED_BEFORE_DRC'
  finalScan = await scanKiCadProject(projectDir)
  const finalCopper = !job.dryRun ? await scanKicadCopperAfterWrite(context.files.pcbFile) : { segments: 0, vias: 0, zones: 0 }
  const traceReport = {
    status,
    board,
    scan: {
      pads: finalScan.pads?.length || 0,
      tracks: finalScan.tracks?.length || 0,
      vias: finalScan.vias?.length || 0,
      zones: finalScan.zones?.length || 0,
      layers: finalScan.layerCount || board.layerCount,
    },
    gates: {
      originalSpecStatus: originalSpecAudit.status,
      noSourcingOrReplacementMode: true,
      exactFootprintPadGeometry: true,
      schematicPcbNetSync: netSync.status,
      componentBindingStatus: bindingReport.status,
      netclassPolicy: 'auto_classified_written_to_kicad',
      stackupPolicy: stackup.status,
      viaStrategy: viaStrategy.status,
      copperPourPolicy: copperPourPlan.status,
      placementRepairRequiredBeforeRouting: Boolean(finalDrc?.issueCounts?.errors && hasPlacementDrcBlocker(finalDrc)),
      drcClean: !finalDrc?.issueCounts?.errors,
      exportAllowed: !finalDrc?.issueCounts?.errors,
    },
    originalSpecAudit,
    componentBindings: {
      status: bindingReport.status,
      resolver: bindingReport.resolver || 'component_compatibility',
      checked: bindingReport.checked,
      errors: bindingReport.errors || [],
      warnings: bindingReport.warnings || [],
    },
    iterations,
    finalDrc: finalDrc ? { status: finalDrc.status, issueCounts: finalDrc.issueCounts, reportFile: finalDrc.reportFile } : null,
    finalCopper,
    routing: finalRoutingPlan ? {
      status: finalRoutingPlan.status,
      routed: finalRoutingPlan.routedNets?.length || 0,
      unrouted: finalRoutingPlan.unroutedNets || [],
      legalTrace: finalRoutingPlan.legalTrace || null,
      routeValidation: finalValidation?.status,
      routeQuality: finalQuality?.status,
    } : null,
    blockers: traceBlockers({ finalDrc, finalRoutingPlan, finalValidation, finalQuality, bindingReport }),
    humanReviewRequired: true,
  }
  const outputFile = path.join(projectDir, 'boardforge-trace-existing-board.json')
  if (!job.dryRun) {
    await writeFile(outputFile, JSON.stringify(traceReport, null, 2), 'utf8')
    generatedFiles.push(outputFile)
    await updateProjectState(projectDir, async (current) => ({
      ...current,
      status,
      components: normalizeComponents(components),
      netlist,
      componentBindings: bindingReport,
      traceExistingBoard: traceReport,
      originalSpecAudit,
      routing: {
        ...(current.routing || {}),
        status,
        plan: finalRoutingPlan || current.routing?.plan,
        precheck: finalValidation || current.routing?.precheck,
        quality: finalQuality || current.routing?.quality,
      },
      kicadNetSettings: projectNetSettings,
      generatedFiles: [...new Set([...(current.generatedFiles || []), ...generatedFiles, context.files.pcbFile, ...Object.values(originalSpecAuditFiles || {})])],
      lastJobType: job.type,
      lastHistoryMessage: `Trace existing board finished with ${traceReport.finalDrc?.issueCounts?.errors ?? 'no'} DRC errors and ${traceReport.routing?.unrouted?.length ?? 0} unrouted nets.`,
    }))
  }
  return result(job, status, traceWarnings(traceReport), traceReport.blockers, { traceReport, generatedFiles, humanReviewRequired: true })
}

function resolveOriginalEscReferencePath(workspace, referencePath) {
  if (!referencePath) return null
  if (path.isAbsolute(referencePath)) return referencePath
  return resolveInsideWorkspace(workspace, referencePath)
}

async function routeOneNetTransactions({ pcbFile, board, routingPlan, components, pads, profile, baselineDrc, projectDir, runDrc, iterationIndex = 1, maxDrcRepairAttemptsPerNet = 4 }) {
  const committedRoutes = []
  const rolledBack = []
  const writerFailures = []
  const results = []
  const generatedFiles = []
  let currentDrc = baselineDrc
  let generatedObjects = { segments: 0, vias: 0, zones: 0 }
  for (let routeIndex = 0; routeIndex < (routingPlan.routes || []).length; routeIndex += 1) {
    const originalRoute = routingPlan.routes[routeIndex]
    const route = repairRouteEndpointContacts(originalRoute, pads, board)
    const endpointProof = recordTransactionSourceTarget({ route, pads, drcReport: currentDrc?.report || currentDrc?.report?.report || {}, tracks: [], vias: [] })
    const beforePcb = await readFile(pcbFile, 'utf8')
    const beforeDrcCounts = currentDrc?.issueCounts || null
    const connectivity = verifyPadToPadConnectivity(route, pads)
    if (!connectivity.commitAllowed) {
      const rejection = {
        net: route.net,
        routeIndex,
        ...endpointProof,
        status: 'route_pad_to_pad_connectivity_rejected',
        reason: 'ROUTE_DOES_NOT_PROVE_PAD_TO_PAD_CONNECTIVITY',
        connectivity,
        beforeDrc: currentDrc?.issueCounts,
      }
      rolledBack.push(rejection)
      results.push(rejection)
      continue
    }
    const trialPlan = {
      ...routingPlan,
      routes: [route],
      designIntent: {
        ...(routingPlan.designIntent || {}),
        copperPours: [],
      },
    }
    const write = await applyRoutingPlanToPcb({ pcbFile, board, routingPlan: trialPlan, components, pads, replaceGeneratedCopper: false })
    if (!write.writeProof?.retained && !write.writeProof?.retainedTotal) {
      await writeFile(pcbFile, beforePcb, 'utf8')
      const failure = { net: route.net, routeIndex, ...endpointProof, reason: write.writeProof?.failurePoint || 'KICAD_COPPER_WRITE_NOT_RETAINED', writeProof: write.writeProof }
      writerFailures.push(failure)
      results.push({ ...failure, status: 'writer_failed_rolled_back' })
      continue
    }
    const reportFile = path.join(projectDir, 'reports', `trace-existing-board-drc-${iterationIndex}-net-${routeIndex + 1}.json`)
    const drc = await runDrc({ outputFile: reportFile })
    generatedFiles.push(reportFile)
    const drcRegression = classifyDrcRegression(drc.issueCounts, currentDrc?.issueCounts)
    if (drcRegression.rollback) {
      await writeFile(pcbFile, beforePcb, 'utf8')
      const repairCandidates = drcRepairRouteCandidates(route, drcRegression, { board, profile, pads, components, maxDrcRepairAttemptsPerNet })
      const repairAttempts = []
      let repaired = false
      for (let repairIndex = 0; repairIndex < repairCandidates.length; repairIndex += 1) {
        const repairRoute = repairRouteEndpointContacts(repairCandidates[repairIndex], pads, board)
        const repairEndpointProof = recordTransactionSourceTarget({ route: repairRoute, pads, drcReport: currentDrc?.report || currentDrc?.report?.report || {}, tracks: [], vias: [] })
        const repairConnectivity = verifyPadToPadConnectivity(repairRoute, pads)
        if (!repairConnectivity.commitAllowed) {
          repairAttempts.push({ mutation: repairRoute.mutation?.type || 'drc_repair_candidate', status: 'connectivity_rejected', connectivity: repairConnectivity })
          continue
        }
        const repairPlan = {
          ...routingPlan,
          routes: [repairRoute],
          designIntent: {
            ...(routingPlan.designIntent || {}),
            copperPours: [],
          },
        }
        const repairWrite = await applyRoutingPlanToPcb({ pcbFile, board, routingPlan: repairPlan, components, pads, replaceGeneratedCopper: false })
        if (!repairWrite.writeProof?.retained && !repairWrite.writeProof?.retainedTotal) {
          await writeFile(pcbFile, beforePcb, 'utf8')
          repairAttempts.push({ mutation: repairRoute.mutation?.type || 'drc_repair_candidate', status: 'writer_failed', writeProof: repairWrite.writeProof })
          continue
        }
        const repairReportFile = path.join(projectDir, 'reports', `trace-existing-board-drc-${iterationIndex}-net-${routeIndex + 1}-repair-${repairIndex + 1}.json`)
        const repairDrc = await runDrc({ outputFile: repairReportFile })
        generatedFiles.push(repairReportFile)
        const repairRegression = classifyDrcRegression(repairDrc.issueCounts, currentDrc?.issueCounts)
        repairAttempts.push({
          mutation: repairRoute.mutation?.type || 'drc_repair_candidate',
          status: repairRegression.rollback ? 'drc_regression_remaining' : 'drc_regression_repaired',
          beforeDrc: currentDrc?.issueCounts,
          afterDrc: repairDrc.issueCounts,
          reportFile: repairReportFile,
        })
        if (repairRegression.rollback) {
          await writeFile(pcbFile, beforePcb, 'utf8')
          continue
        }
        committedRoutes.push(repairRoute)
        currentDrc = repairDrc
        generatedObjects = repairWrite.generatedObjects
        results.push({
          net: repairRoute.net,
          routeIndex,
          ...repairEndpointProof,
          status: repairRegression.warningOnly ? 'route_committed_after_drc_repair_warning_debt' : 'route_committed_after_drc_repair',
          originalDrcRegression: drcRegression,
          repairAttempts,
          generatedObjects: repairWrite.generatedObjects,
          writeProof: repairWrite.writeProof,
          reportFile: repairReportFile,
        })
        repaired = true
        break
      }
      if (repaired) continue
      const rollback = {
        net: route.net,
        routeIndex,
        ...endpointProof,
        status: 'route_drc_worsened_rolled_back',
        beforeDrc: currentDrc?.issueCounts,
        afterDrc: drc.issueCounts,
        drcRegression,
        generatedObjects: write.generatedObjects,
        writeProof: write.writeProof,
        reportFile,
        repairAttempts,
      }
      rolledBack.push(rollback)
      results.push(rollback)
      continue
    }
    committedRoutes.push(route)
    currentDrc = drc
    generatedObjects = write.generatedObjects
    results.push({
      net: route.net,
      routeIndex,
      ...endpointProof,
      status: drcRegression.warningOnly ? 'route_committed_warning_repair_debt' : 'route_committed',
      beforeDrc: beforeDrcCounts,
      afterDrc: drc.issueCounts,
      drcRegression,
      generatedObjects: write.generatedObjects,
      writeProof: write.writeProof,
      reportFile,
    })
  }
  return { committedRoutes, rolledBack, writerFailures, results, generatedFiles, generatedObjects, finalDrc: currentDrc }
}

function drcRepairRouteCandidates(route = {}, regression = {}, context = {}) {
  const candidates = []
  const add = (candidate) => {
    if (!candidate?.start || !candidate?.end) return
    const key = JSON.stringify({
      layerPreference: candidate.layerPreference || [],
      waypoints: candidate.waypoints || [],
      vias: candidate.viaPlan?.candidates || [],
      mutation: candidate.mutation?.type || null,
    })
    if (candidates.some((item) => item._repairKey === key)) return
    candidates.push({ ...candidate, _repairKey: key })
  }
  if (String(route.net || '').toUpperCase() === 'VIN') {
    for (const candidate of repairVinDrcRegression(route, regression, context).mutations || []) add(candidate)
  }
  for (const failure of [
    { failure: 'ROUTE_PAD_CLEARANCE', reason: regression.reason || 'DRC_ERROR_REGRESSION' },
    { failure: 'VIA_PAD_CLEARANCE', reason: regression.reason || 'DRC_ERROR_REGRESSION' },
    { failure: 'ROUTE_ROUTE_CLEARANCE', reason: regression.reason || 'DRC_ERROR_REGRESSION' },
  ]) {
    for (const candidate of generateDrcAwareRouteAlternatives(route, failure, context)) add(candidate)
  }
  const maxAttempts = Math.max(0, Number(context.maxDrcRepairAttemptsPerNet ?? 4))
  return candidates.slice(0, maxAttempts).map(({ _repairKey, ...candidate }) => candidate)
}

export function buildNetSpecificConnectivityGraph({ net, pads = [], tracks = [], vias = [], drcReport = {} } = {}) {
  const graph = buildNetConnectivityGraph({ pads, tracks, vias, drcReport })
  const entry = (graph.nets || []).find((item) => item.net === net) || {
    net,
    pads: 0,
    connectedIslands: 0,
    components: [],
    requiredConnections: [],
    unconnectedItems: 0,
  }
  const netPads = dedupeTransactionPads((pads || []).filter((pad) => (pad.netName || pad.net) === net))
  const graphConnections = (entry.requiredConnections || [])
    .filter((connection) => !sameTransactionPad(connection.from, connection.to))
    .map((connection) => ({
      source: formatTransactionPad(connection.from?.ref, connection.from?.pad || connection.from?.name) || connection.from?.id,
      target: formatTransactionPad(connection.to?.ref, connection.to?.pad || connection.to?.name) || connection.to?.id,
      sourcePad: connection.from,
      targetPad: connection.to,
      priority: /VIN|VBAT|BATT/i.test(net) ? 'high_current' : 'signal',
      reason: connection.reason || 'connect disconnected same-net copper island',
    }))
  const fallbackConnections = []
  for (let index = 0; index < netPads.length - 1; index += 1) {
    fallbackConnections.push({
      source: formatTransactionPad(netPads[index].ref, netPads[index].pad || netPads[index].name) || netPads[index].id,
      target: formatTransactionPad(netPads[index + 1].ref, netPads[index + 1].pad || netPads[index + 1].name) || netPads[index + 1].id,
      sourcePad: netPads[index],
      targetPad: netPads[index + 1],
      priority: /VIN|VBAT|BATT/i.test(net) ? 'high_current' : 'signal',
      reason: 'connect distinct same-net pad islands selected from scanned pads',
    })
  }
  return {
    net,
    pads: netPads
      .map((pad) => ({
        ref: pad.ref,
        pad: pad.pad || pad.name,
        layer: (pad.layers || []).join('/') || pad.layer || null,
        position: { x: Number(pad.x), y: Number(pad.y) },
      })),
    connectedIslands: entry.components || [],
    requiredConnections: graphConnections.length ? graphConnections : fallbackConnections,
    unconnectedItems: entry.unconnectedItems || 0,
  }
}

export function selectNextConnectionForNet({ net, route = {}, pads = [], tracks = [], vias = [], drcReport = {} } = {}) {
  const sourcePad = route.start ? resolvePadForEndpoint(route.start, pads) : null
  const targetPad = route.end ? resolvePadForEndpoint(route.end, pads) : null
  if (sourcePad && targetPad && !sameTransactionPad(sourcePad, targetPad)) {
    return {
      net,
      sourcePad,
      targetPad,
      source: formatTransactionPad(sourcePad.ref, sourcePad.pad || sourcePad.name),
      target: formatTransactionPad(targetPad.ref, targetPad.pad || targetPad.name),
      reason: 'route endpoint pads resolved from generated route',
    }
  }
  const graph = buildNetSpecificConnectivityGraph({ net, pads, tracks, vias, drcReport })
  const next = graph.requiredConnections[0]
  return next ? { net, sourcePad: next.sourcePad, targetPad: next.targetPad, source: next.source, target: next.target, reason: next.reason, graph } : { net, sourcePad: null, targetPad: null, source: null, target: null, reason: 'source/target not isolated by current transaction report', graph }
}

export function recordTransactionSourceTarget({ route = {}, pads = [], tracks = [], vias = [], drcReport = {} } = {}) {
  const selected = selectNextConnectionForNet({ net: route.net, route, pads, tracks, vias, drcReport })
  return {
    sourceRef: selected.sourcePad?.ref || null,
    sourcePad: selected.sourcePad?.pad || selected.sourcePad?.name || null,
    targetRef: selected.targetPad?.ref || null,
    targetPad: selected.targetPad?.pad || selected.targetPad?.name || null,
    sourceIsland: selected.sourcePad?.id || selected.source || null,
    targetIsland: selected.targetPad?.id || selected.target || null,
    source: selected.source || null,
    target: selected.target || null,
    sourceTargetProof: requireSourceTargetInBlockerReport({
      net: route.net,
      source: selected.source,
      target: selected.target,
      reason: selected.reason,
    }),
  }
}

export function requireSourceTargetInBlockerReport(report = {}) {
  const source = report.source || formatTransactionPad(report.sourceRef, report.sourcePad)
  const target = report.target || formatTransactionPad(report.targetRef, report.targetPad)
  const selfConnection = Boolean(source && target && source === target)
  return {
    net: report.net,
    source,
    target,
    proofComplete: Boolean(report.net && source && target && !selfConnection),
    blockerType: Boolean(source && target && !selfConnection) ? 'SOURCE_TARGET_PROVEN' : `${String(report.net || '').toUpperCase() === 'VIN' ? 'VIN' : 'ROUTE_TRANSACTION'}_SOURCE_TARGET_UNKNOWN`,
    reason: source && target && !selfConnection ? 'source and target pads isolated' : selfConnection ? 'source and target resolve to the same pad; route target not isolated' : report.reason || 'blocker lacks exact source/target pad proof',
  }
}

function dedupeTransactionPads(pads = []) {
  const seen = new Set()
  const unique = []
  for (const pad of pads) {
    const key = transactionPadKey(pad)
    if (!key || seen.has(key)) continue
    seen.add(key)
    unique.push(pad)
  }
  return unique
}

function transactionPadKey(pad = {}) {
  const ref = pad.ref || pad.footprint || pad.component
  const padName = pad.pad || pad.name || pad.padName
  if (!ref || !padName) return null
  return `${ref}:${padName}`
}

function sameTransactionPad(a = {}, b = {}) {
  const aKey = transactionPadKey(a)
  const bKey = transactionPadKey(b)
  return Boolean(aKey && bKey && aKey === bKey)
}

function repairRouteEndpointContacts(route = {}, pads = [], board = {}) {
  if (!route?.start || !route?.end) return route
  const sameFootprintRoute = routeSameFootprintPadPair({ route, pads, board })
  if (sameFootprintRoute) return sameFootprintRoute
  const points = route.waypoints?.length ? route.waypoints.map((point) => ({ ...point })) : [route.start, route.end].filter(Boolean)
  if (points.length < 2) return route
  const sourcePad = resolvePadForEndpoint(route.start, pads)
  const targetPad = resolvePadForEndpoint(route.end, pads)
  const primaryLayer = route.layerPreference?.[0] || 'F.Cu'
  const viaCount = route.viaPlan?.candidates?.length || 0
  const sourceContact = sourcePad
    ? snapEndpointToPadCopper({ pad: sourcePad, layer: route.endpointContactLayers?.source || primaryLayer, board, approachPoint: points[1] || route.end, viaCount })
    : null
  const targetContact = targetPad
    ? snapEndpointToPadCopper({ pad: targetPad, layer: route.endpointContactLayers?.target || primaryLayer, board, approachPoint: points.at(-2) || route.start, viaCount })
    : null
  if (sourceContact) points[0] = sourceContact
  if (targetContact) points[points.length - 1] = targetContact
  const withVias = insertViaWaypoints(points, route.viaPlan?.candidates || [])
  return {
    ...route,
    waypoints: dedupeRoutePoints(withVias),
    endpointRepair: {
      ...(route.endpointRepair || {}),
      sourceSnapped: Boolean(sourceContact),
      targetSnapped: Boolean(targetContact),
      viasInserted: Math.max(0, withVias.length - points.length),
    },
  }
}

export function detectSameFootprintPadPair(route = {}, pads = []) {
  const sourcePad = resolvePadForEndpoint(route.start, pads)
  const targetPad = resolvePadForEndpoint(route.end, pads)
  return {
    sameFootprint: Boolean(sourcePad?.ref && targetPad?.ref && sourcePad.ref === targetPad.ref && String(sourcePad.pad || sourcePad.name || '') !== String(targetPad.pad || targetPad.name || '')),
    sourcePad,
    targetPad,
    ref: sourcePad?.ref && sourcePad?.ref === targetPad?.ref ? sourcePad.ref : null,
  }
}

export function checkIfPadsAlreadyConnectedByCopper(sourcePad = {}, targetPad = {}) {
  if (!sourcePad || !targetPad) return false
  if (sourcePad.id && targetPad.id && sourcePad.id === targetPad.id) return true
  if ((sourcePad.netName || '') !== (targetPad.netName || '')) return false
  const sourceGeometry = extractPadCopperGeometry(sourcePad)
  const targetGeometry = extractPadCopperGeometry(targetPad)
  if (!sourceGeometry || !targetGeometry) return false
  const sharedLayers = padCopperLayers(sourcePad).filter((layer) => padCopperLayers(targetPad).includes(layer) || padCopperLayers(targetPad).includes('*.Cu') || layer === '*.Cu')
  if (!sharedLayers.length) return false
  return Math.abs(Number(sourcePad.x) - Number(targetPad.x)) <= (sourceGeometry.widthMm + targetGeometry.widthMm) / 2
    && Math.abs(Number(sourcePad.y) - Number(targetPad.y)) <= (sourceGeometry.heightMm + targetGeometry.heightMm) / 2
}

export function classifySameFootprintRouteNeed(route = {}, pads = []) {
  const pair = detectSameFootprintPadPair(route, pads)
  const alreadyConnected = pair.sameFootprint ? checkIfPadsAlreadyConnectedByCopper(pair.sourcePad, pair.targetPad) : false
  return {
    net: route.net,
    ref: pair.ref,
    sourcePad: pair.sourcePad ? String(pair.sourcePad.pad || pair.sourcePad.name || '') : null,
    targetPad: pair.targetPad ? String(pair.targetPad.pad || pair.targetPad.name || '') : null,
    sameFootprint: pair.sameFootprint,
    alreadyConnected,
    routeNeeded: Boolean(pair.sameFootprint && !alreadyConnected),
  }
}

export function routeSameFootprintPadPair({ route = {}, pads = [], board = {} } = {}) {
  const need = classifySameFootprintRouteNeed(route, pads)
  if (!need.routeNeeded) return null
  const sourcePad = resolvePadForEndpoint(route.start, pads)
  const targetPad = resolvePadForEndpoint(route.end, pads)
  const candidates = generateLocalPadBridgeCandidates({ route, sourcePad, targetPad, board })
  return candidates.find((candidate) => validateSameFootprintRoute(candidate, pads).commitAllowed) || candidates[0] || null
}

export function generateLocalPadBridgeCandidates({ route = {}, sourcePad = {}, targetPad = {}, board = {} } = {}) {
  if (!sourcePad || !targetPad) return []
  const sourceLayers = padCopperLayers(sourcePad)
  const targetLayers = padCopperLayers(targetPad)
  const commonLayer = selectCommonPadLayer(sourceLayers, targetLayers, route.layerPreference?.[0] || 'F.Cu')
  if (!commonLayer) return []
  const sourceContact = snapEndpointToPadCopper({ pad: sourcePad, layer: commonLayer, board, approachPoint: targetPad, viaCount: 0 })
  const targetContact = snapEndpointToPadCopper({ pad: targetPad, layer: commonLayer, board, approachPoint: sourcePad, viaCount: 0 })
  if (!sourceContact || !targetContact) return []
  const direct = buildSameFootprintRoute(route, sourcePad, targetPad, commonLayer, [sourceContact, targetContact], 'direct_pad_edge_bridge')
  const doglegs = sameFootprintDoglegPointSets({ sourcePad, targetPad, sourceContact, targetContact, layer: commonLayer, route })
    .map((points, index) => buildSameFootprintRoute(route, sourcePad, targetPad, commonLayer, points, index === 0 ? 'same_layer_perimeter_route' : 'dogleg_around_footprint_body'))
  return [direct, ...doglegs].filter(Boolean)
}

export function generatePadEdgeToPadEdgeRoute(route = {}, sourcePad = {}, targetPad = {}, board = {}) {
  return generateLocalPadBridgeCandidates({ route, sourcePad, targetPad, board })[0] || null
}

export function validateSameFootprintRoute(route = {}, pads = []) {
  const connectivity = verifyPadToPadConnectivity(route, pads)
  const sourcePad = resolvePadForEndpoint(route.start, pads)
  const targetPad = resolvePadForEndpoint(route.end, pads)
  return {
    ...connectivity,
    sameFootprint: Boolean(sourcePad?.ref && targetPad?.ref && sourcePad.ref === targetPad.ref),
    floatingIslandRejected: !connectivity.commitAllowed,
  }
}

export function rejectSameFootprintFloatingIsland(route = {}, pads = []) {
  return !validateSameFootprintRoute(route, pads).commitAllowed
}

export function verifySameFootprintPadContact(route = {}, pads = []) {
  return validateSameFootprintRoute(route, pads)
}

export function verifyGeneratedCopperBelongsToNetIsland(route = {}, pads = []) {
  return verifyPadToPadConnectivity(route, pads).floatingGeneratedIslands === 0
}

function buildSameFootprintRoute(route = {}, sourcePad = {}, targetPad = {}, layer = 'F.Cu', points = [], type = 'same_footprint_local_route') {
  return {
    ...route,
    start: { ...sourcePad },
    end: { ...targetPad },
    waypoints: dedupeRoutePoints(points.map((point) => ({ ...point, layer }))),
    layerPreference: [layer],
    endpointContactLayers: { source: layer, target: layer },
    viaPlan: { ...(route.viaPlan || {}), candidates: [] },
    sameFootprintLocalRoute: {
      type,
      ref: sourcePad.ref,
      sourcePad: String(sourcePad.pad || sourcePad.name || ''),
      targetPad: String(targetPad.pad || targetPad.name || ''),
    },
    mutation: { ...(route.mutation || {}), type },
  }
}

function sameFootprintDoglegPointSets({ sourcePad = {}, targetPad = {}, sourceContact = {}, targetContact = {}, layer = 'F.Cu', route = {} } = {}) {
  const sourceGeometry = extractPadCopperGeometry(sourcePad)
  const targetGeometry = extractPadCopperGeometry(targetPad)
  const minX = Math.min(sourceGeometry.x - sourceGeometry.widthMm / 2, targetGeometry.x - targetGeometry.widthMm / 2)
  const maxX = Math.max(sourceGeometry.x + sourceGeometry.widthMm / 2, targetGeometry.x + targetGeometry.widthMm / 2)
  const minY = Math.min(sourceGeometry.y - sourceGeometry.heightMm / 2, targetGeometry.y - targetGeometry.heightMm / 2)
  const maxY = Math.max(sourceGeometry.y + sourceGeometry.heightMm / 2, targetGeometry.y + targetGeometry.heightMm / 2)
  const clearance = Math.max(0.2, Number(route.widthMm || 0.15) + 0.12)
  const above = round(minY - clearance)
  const below = round(maxY + clearance)
  const left = round(minX - clearance)
  const right = round(maxX + clearance)
  return [
    [sourceContact, { x: sourceContact.x, y: above, layer }, { x: targetContact.x, y: above, layer }, targetContact],
    [sourceContact, { x: sourceContact.x, y: below, layer }, { x: targetContact.x, y: below, layer }, targetContact],
    [sourceContact, { x: left, y: sourceContact.y, layer }, { x: left, y: targetContact.y, layer }, targetContact],
    [sourceContact, { x: right, y: sourceContact.y, layer }, { x: right, y: targetContact.y, layer }, targetContact],
  ]
}

function padCopperLayers(pad = {}) {
  const layers = pad.layers?.length ? pad.layers : ['F.Cu']
  if (layers.includes('*.Cu')) return ['F.Cu', 'B.Cu', '*.Cu']
  return layers.filter((layer) => /\.Cu$/.test(layer))
}

function selectCommonPadLayer(sourceLayers = [], targetLayers = [], preferred = 'F.Cu') {
  const source = sourceLayers.includes('*.Cu') ? ['F.Cu', 'B.Cu', preferred] : sourceLayers
  const target = targetLayers.includes('*.Cu') ? ['F.Cu', 'B.Cu', preferred] : targetLayers
  const ordered = [preferred, 'F.Cu', 'B.Cu', ...source, ...target].filter(Boolean)
  return ordered.find((layer) => source.includes(layer) && target.includes(layer)) || null
}

function resolvePadForEndpoint(endpoint = {}, pads = []) {
  if (!endpoint) return null
  if (endpoint.id) {
    const byId = pads.find((pad) => pad.id === endpoint.id)
    if (byId) return byId
  }
  if (endpoint.ref) {
    const byRefPad = pads.find((pad) => pad.ref === endpoint.ref && String(pad.pad || pad.name || '') === String(endpoint.pad || endpoint.name || ''))
    if (byRefPad) return byRefPad
  }
  const sameNet = pads.filter((pad) => !endpoint.netName || pad.netName === endpoint.netName)
  const candidates = sameNet.length ? sameNet : pads
  return candidates
    .filter((pad) => Number.isFinite(Number(pad.x)) && Number.isFinite(Number(pad.y)))
    .sort((a, b) => Math.hypot(Number(endpoint.x) - Number(a.x), Number(endpoint.y) - Number(a.y)) - Math.hypot(Number(endpoint.x) - Number(b.x), Number(endpoint.y) - Number(b.y)))[0] || null
}

function insertViaWaypoints(points = [], vias = []) {
  let output = [...points]
  for (const via of vias || []) {
    if (!Number.isFinite(Number(via.x)) || !Number.isFinite(Number(via.y))) continue
    if (routePointOnPath(via, output)) continue
    let bestIndex = -1
    let bestDistance = Infinity
    for (let index = 1; index < output.length; index += 1) {
      const distance = distancePointToSegmentLocal(via, output[index - 1], output[index])
      if (distance < bestDistance) {
        bestDistance = distance
        bestIndex = index
      }
    }
    if (bestIndex > 0 && bestDistance <= 1.5) output = [...output.slice(0, bestIndex), { ...via }, ...output.slice(bestIndex)]
  }
  return output
}

function routePointOnPath(point = {}, points = []) {
  for (let index = 1; index < points.length; index += 1) {
    if (distancePointToSegmentLocal(point, points[index - 1], points[index]) <= 0.001) return true
  }
  return false
}

function distancePointToSegmentLocal(point = {}, start = {}, end = {}) {
  const px = Number(point.x)
  const py = Number(point.y)
  const ax = Number(start.x)
  const ay = Number(start.y)
  const bx = Number(end.x)
  const by = Number(end.y)
  const dx = bx - ax
  const dy = by - ay
  const length2 = dx * dx + dy * dy
  if (!length2) return Math.hypot(px - ax, py - ay)
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / length2))
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

function boardFromExistingScan({ scan, state, job }) {
  const input = job.input || {}
  const widthMm = input.board?.widthMm || state?.board?.widthMm || scan.boardSize?.widthMm || input.widthMm || 50
  const heightMm = input.board?.heightMm || state?.board?.heightMm || scan.boardSize?.heightMm || input.heightMm || 30
  return {
    ...(state?.board || {}),
    ...(input.board || {}),
    name: input.projectName || state?.board?.name || scan.projectName || 'Existing KiCad board',
    units: 'mm',
    widthMm,
    heightMm,
    layerCount: input.layerCount || state?.board?.layerCount || scan.layerCount || 2,
    outline: input.board?.outline || state?.board?.outline || scan.boardOutline || createBoardShape('rectangle', widthMm, heightMm),
    mountingHoles: input.board?.mountingHoles || state?.board?.mountingHoles || scan.mountingHoles || [],
    allowBlindVias: Boolean(input.allowBlindVias),
    allowBuriedVias: Boolean(input.allowBuriedVias),
    allowMicrovias: Boolean(input.allowMicrovias),
  }
}

export function legalizeTraceRoutingPlan({ board, components, routingPlan, profile, pads = [] }) {
  const accepted = []
  const blockedRoutes = []
  const acceptedNetCounts = new Map()
  const existingRoutedNets = new Set(routingPlan?.existingRoutedNets || [])
  const maxAcceptedPerNet = Math.max(1, Number(routingPlan?.maxAcceptedPerNet || 1))
  const sourceRoutes = routingPlan?.routes || []
  for (const route of sourceRoutes) {
    if (existingRoutedNets.has(route.net)) {
      blockedRoutes.push({ net: route.net, status: 'deferred_existing_retained_copper', reason: 'net already has retained copper in current KiCad file' })
      continue
    }
    if ((acceptedNetCounts.get(route.net) || 0) >= maxAcceptedPerNet) {
      blockedRoutes.push({ net: route.net, status: 'deferred_duplicate_net_candidate', reason: 'one accepted route per net per trace pass' })
      continue
    }
    if (route.status !== 'routed' || !route.start || !route.end) {
      blockedRoutes.push({ net: route.net, status: route.status || 'unrouted', reason: 'route did not produce writable geometry' })
      continue
    }
    const acceptedRouteConflict = findAcceptedRouteClearanceConflict(route, accepted, profile)
    if (acceptedRouteConflict) {
      blockedRoutes.push({
        net: route.net,
        status: 'blocked_candidate_rejected',
        reason: 'ROUTE_ROUTE_CLEARANCE',
        errors: ['ROUTE_ROUTE_CLEARANCE'],
        failure: {
          net: route.net,
          failure: 'ROUTE_ROUTE_CLEARANCE',
          requiredClearance: acceptedRouteConflict.requiredMm,
          actualClearance: acceptedRouteConflict.actualMm,
          mutation: 'reroute_around_committed_obstacle',
        },
      })
      continue
    }
    const trialPlan = {
      ...routingPlan,
      routes: [...accepted, route],
      designIntent: {
        ...(routingPlan.designIntent || {}),
        // Copper pours and zones are still reported, but route legalization focuses on
        // generated track/via safety so unrelated pour-review warnings do not block easy nets.
        copperPours: [],
        pads,
      },
      pads,
    }
    const validation = validateRoutingGeometry({ board, components, routingPlan: trialPlan, profile })
    const blocking = validation.errors.filter((issue) => isTraceCandidateSafetyError(issue.code))
    if (blocking.length) {
      if (isTolerableSignalPrecheckForKicadTrial(route, blocking, routingPlan)) {
        accepted.push(route)
        acceptedNetCounts.set(route.net, (acceptedNetCounts.get(route.net) || 0) + 1)
        blockedRoutes.push({
          net: route.net,
          status: 'candidate_precheck_deferred_to_kicad_drc',
          reason: 'signal precheck near miss; KiCad DRC will decide transactionally',
          errors: blocking.map((issue) => issue.code),
        })
        continue
      }
      const failure = classifyRouteDrcFailure({ route, issues: blocking })
      const alternatives = generateDrcAwareRouteAlternatives(route, failure, { board, profile, pads, components })
      const acceptedAlternative = alternatives.find((alternative) => {
        const alternativePlan = {
          ...routingPlan,
          routes: [...accepted, alternative],
          designIntent: {
            ...(routingPlan.designIntent || {}),
            copperPours: [],
            pads,
          },
          pads,
        }
        const alternativeValidation = validateRoutingGeometry({ board, components, routingPlan: alternativePlan, profile })
        const alternativeBlocking = alternativeValidation.errors.filter((issue) => isTraceCandidateSafetyError(issue.code))
        return !alternativeBlocking.length || isTolerableSignalPrecheckForKicadTrial(alternative, alternativeBlocking, routingPlan)
      })
      if (acceptedAlternative) {
        accepted.push(acceptedAlternative)
        acceptedNetCounts.set(route.net, (acceptedNetCounts.get(route.net) || 0) + 1)
        blockedRoutes.push({
          net: route.net,
          status: 'candidate_mutated_and_accepted',
          reason: failure.failure,
          mutation: acceptedAlternative.mutation?.type || 'drc_aware_alternative',
          deferredToKiCadDrc: Boolean(acceptedAlternative.mutation && aggressiveBranchPrecheckEnabled(routingPlan)),
          alternativesTried: alternatives.length,
        })
        continue
      }
      if (isBranchSignalClearanceTrialAllowed(route, blocking, routingPlan)) {
        const noViaRoute = {
          ...route,
          viaPlan: { ...(route.viaPlan || {}), candidates: [], maxVias: 0 },
          layerPreference: route.layerPreference?.length ? route.layerPreference : ['F.Cu'],
          mutation: { type: 'branch_signal_clearance_deferred_to_kicad', reason: failure.failure },
        }
        accepted.push(noViaRoute)
        acceptedNetCounts.set(route.net, (acceptedNetCounts.get(route.net) || 0) + 1)
        blockedRoutes.push({
          net: route.net,
          status: 'candidate_precheck_deferred_to_kicad_drc',
          reason: 'branch signal clearance trial; KiCad DRC will decide transactionally',
          errors: blocking.map((issue) => issue.code),
          alternativesTried: alternatives.length,
        })
        continue
      }
      blockedRoutes.push({
        net: route.net,
        status: 'blocked_candidate_rejected',
        reason: failure.failure,
        errors: blocking.map((issue) => issue.code),
        failure,
        alternativesTried: alternatives.length,
      })
      continue
    }
    accepted.push(route)
    acceptedNetCounts.set(route.net, (acceptedNetCounts.get(route.net) || 0) + 1)
  }
  const blockedNets = blockedRoutes
    .filter((item) => !['candidate_mutated_and_accepted', 'candidate_precheck_deferred_to_kicad_drc', 'deferred_duplicate_net_candidate', 'deferred_existing_retained_copper'].includes(item.status))
    .map((item) => item.net)
    .filter(Boolean)
  return {
    ...routingPlan,
    status: accepted.length ? (blockedNets.length ? 'AUTOROUTE_PARTIAL_LEGALIZED_NEEDS_REVIEW' : 'AUTOROUTE_LEGALIZED_READY_NEEDS_DRC') : 'AUTOROUTE_LEGALIZATION_BLOCKED_NO_SAFE_ROUTES',
    routes: accepted,
    routedNets: accepted.map((route) => route.net),
    unroutedNets: [...new Set([...(routingPlan.unroutedNets || []), ...blockedNets])],
    legalTrace: {
      mode: 'sequential_route_candidate_filter',
      sourceRoutes: sourceRoutes.length,
      acceptedRoutes: accepted.length,
      blockedRoutes,
    },
  }
}

function isTolerableSignalPrecheckForKicadTrial(route = {}, issues = [], routingPlan = {}) {
  if (['BATTERY', 'POWER_HIGH_CURRENT', 'MOTOR_PHASE'].includes(route.className || '')) return false
  if (!issues.length) return false
  if (isBranchSignalClearanceTrialAllowed(route, issues, routingPlan)) return true
  return issues.every((issue) => {
    if (issue.code !== 'ROUTE_PAD_CLEARANCE') return false
    const required = Number(issue.details?.requiredMm)
    const actual = Number(issue.details?.nearestMm)
    if (!Number.isFinite(required) || !Number.isFinite(actual)) return false
    const deficit = required - actual
    return deficit > 0 && deficit <= 0.12
  })
}

function isBranchSignalClearanceTrialAllowed(route = {}, issues = [], routingPlan = {}) {
  if (!aggressiveBranchPrecheckEnabled(routingPlan)) return false
  if (['BATTERY', 'POWER_HIGH_CURRENT', 'MOTOR_PHASE'].includes(route.className || '')) return false
  const viaCandidates = route.viaPlan?.candidates || []
  if (viaCandidates.length) return false
  if (!issues.length) return false
  return issues.every((issue) => ['ROUTE_PAD_CLEARANCE', 'ROUTE_ROUTE_CLEARANCE'].includes(issue.code))
}

function aggressiveBranchPrecheckEnabled(routingPlan = {}) {
  return Boolean(routingPlan.allowBranchPrecheckDrcTrial || routingPlan.branchStrategy || routingPlan.legalTrace?.branchSelection?.strategy)
}

function findAcceptedRouteClearanceConflict(route = {}, acceptedRoutes = [], profile = {}) {
  for (const accepted of acceptedRoutes) {
    if (accepted.net === route.net) continue
    if (!routesShareAnyLayer(route, accepted)) continue
    const requiredMm = routeRouteRequiredClearance(route, accepted, profile)
    const actualMm = minRouteDistance(route, accepted)
    if (Number.isFinite(actualMm) && actualMm < requiredMm) {
      return { route: accepted.net, requiredMm: roundForReport(requiredMm), actualMm: roundForReport(actualMm) }
    }
  }
  return null
}

function routesShareAnyLayer(a = {}, b = {}) {
  const layersA = new Set(a.layerPreference?.length ? a.layerPreference : [a.layer || 'F.Cu'])
  const layersB = new Set(b.layerPreference?.length ? b.layerPreference : [b.layer || 'F.Cu'])
  return [...layersA].some((layer) => layersB.has(layer))
}

function routeRouteRequiredClearance(a = {}, b = {}, profile = {}) {
  const clearance = Number(profile.minClearanceMm || profile.clearanceMm || 0.127)
  return clearance + Number(a.widthMm || 0.15) / 2 + Number(b.widthMm || 0.15) / 2
}

function minRouteDistance(a = {}, b = {}) {
  const aSegments = routeSegments(a)
  const bSegments = routeSegments(b)
  let best = Infinity
  for (const segA of aSegments) {
    for (const segB of bSegments) {
      best = Math.min(best, segmentDistance(segA[0], segA[1], segB[0], segB[1]))
    }
  }
  return best
}

function routeSegments(route = {}) {
  const points = route.waypoints?.length ? route.waypoints : [route.start, route.end].filter(Boolean)
  const segments = []
  for (let i = 1; i < points.length; i += 1) segments.push([points[i - 1], points[i]])
  return segments
}

function segmentDistance(a, b, c, d) {
  if (segmentsIntersect(a, b, c, d)) return 0
  return Math.min(pointSegmentDistance(a, c, d), pointSegmentDistance(b, c, d), pointSegmentDistance(c, a, b), pointSegmentDistance(d, a, b))
}

function pointSegmentDistance(point, a, b) {
  const px = Number(point.x)
  const py = Number(point.y)
  const ax = Number(a.x)
  const ay = Number(a.y)
  const bx = Number(b.x)
  const by = Number(b.y)
  const dx = bx - ax
  const dy = by - ay
  const denom = dx * dx + dy * dy
  if (!denom) return Math.hypot(px - ax, py - ay)
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / denom))
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

function segmentsIntersect(a, b, c, d) {
  const o1 = orientation(a, b, c)
  const o2 = orientation(a, b, d)
  const o3 = orientation(c, d, a)
  const o4 = orientation(c, d, b)
  return o1 * o2 < 0 && o3 * o4 < 0
}

function orientation(a, b, c) {
  return Math.sign((Number(b.y) - Number(a.y)) * (Number(c.x) - Number(b.x)) - (Number(b.x) - Number(a.x)) * (Number(c.y) - Number(b.y)))
}

function roundForReport(value) {
  return Math.round(Number(value) * 1000) / 1000
}

export function classifyRouteDrcFailure({ route = {}, issues = [] } = {}) {
  const priority = ['ROUTE_POINT_OFF_BOARD', 'VIA_OFF_BOARD', 'VIA_PAD_CLEARANCE', 'VIA_IN_KEEP_OUT', 'ROUTE_PAD_CLEARANCE', 'ROUTE_SEGMENT_CROSSES_BOARD_EDGE', 'ROUTE_MOUNTING_HOLE_CLEARANCE', 'ROUTE_ROUTE_CLEARANCE']
  const selected = priority.map((code) => issues.find((issue) => issue.code === code)).find(Boolean) || issues[0] || null
  const offendingVia = selected?.details?.via || null
  return {
    net: route.net,
    failure: selected?.code || 'UNKNOWN_ROUTE_DRC_FAILURE',
    offendingVia: offendingVia ? { x: offendingVia.x, y: offendingVia.y } : null,
    nearestPad: selected?.details?.pad || null,
    requiredClearance: selected?.details?.requiredMm ?? null,
    actualClearance: selected?.details?.nearestMm ?? null,
    mutation: mutationHintForFailure(selected?.code),
  }
}

export function generateDrcAwareRouteAlternatives(route = {}, failure = {}, context = {}) {
  if (/OFF_BOARD|BOARD_EDGE|EDGE_CUTS|CROSSES_BOARD_EDGE/i.test(failure.failure || '')) return []
  const alternatives = []
  const add = (candidate, type, details = {}) => {
    if (!candidate?.start || !candidate?.end) return
    const key = JSON.stringify({
      waypoints: candidate.waypoints || [],
      layerPreference: candidate.layerPreference || [],
      vias: candidate.viaPlan?.candidates || [],
    })
    if (alternatives.some((item) => item._mutationKey === key)) return
    alternatives.push({
      ...candidate,
      strategy: `${route.strategy || 'route'}_${type}`,
      mutation: { type, reason: failure.failure || 'route_drc_failure', ...details },
      _mutationKey: key,
    })
  }
  if (/VIA|KEEP_OUT/i.test(failure.failure || '')) {
    for (const candidate of routeWithoutViaWhenViaBlocked(route)) add(candidate, 'no_via_fallback')
    for (const candidate of mutateRouteAfterViaClearanceFailure(route, failure)) add(candidate, 'shift_via_site')
  }
  if (/PAD_CLEARANCE|ROUTE_ROUTE_CLEARANCE/i.test(failure.failure || '')) {
    for (const candidate of mutateRouteAfterPadClearanceFailure(route, { ...context, failure })) add(candidate, 'pad_clearance_dogleg')
  }
  for (const candidate of alternateLayerRouteCandidates(route, context)) add(candidate, 'alternate_layer')
  const policy = buildHighDensityRoutePolicy(route)
  const highDensity = highDensityEscRouter({ routes: [route], nets: [route], context })
  for (const candidate of mutateHighDensityRouteAfterDrcFailure(route, failure, context)) {
    add(candidate, 'high_density_drc_feedback', {
      netType: policy.netType,
      layers: policy.layerPreference,
      highDensityStatus: highDensity.status,
    })
  }
  return alternatives.map(({ _mutationKey, ...item }) => item)
}

export function routeWithoutViaWhenViaBlocked(route = {}) {
  const base = { ...route, viaPlan: { ...(route.viaPlan || {}), candidates: [] } }
  const layers = signalPreferredFallbackLayers(route)
  return layers.map((layer) => ({ ...base, layerPreference: [layer], mutation: { type: 'no_via_fallback', layer } }))
}

export function mutateRouteAfterViaClearanceFailure(route = {}, failure = {}) {
  const candidates = route.viaPlan?.candidates || []
  if (!candidates.length) return []
  const offsets = [
    { x: 0.35, y: 0 }, { x: -0.35, y: 0 }, { x: 0, y: 0.35 }, { x: 0, y: -0.35 },
    { x: 0.7, y: 0 }, { x: -0.7, y: 0 }, { x: 0, y: 0.7 }, { x: 0, y: -0.7 },
  ]
  return offsets.map((offset) => ({
    ...route,
    viaPlan: {
      ...(route.viaPlan || {}),
      candidates: candidates.map((via) => ({ ...via, x: round(Number(via.x || 0) + offset.x), y: round(Number(via.y || 0) + offset.y) })),
    },
    mutation: { type: 'shift_via_site', failure: failure.failure, offset },
  }))
}

export function mutateRouteAfterPadClearanceFailure(route = {}, context = {}) {
  const points = route.waypoints?.length ? route.waypoints : [route.start, route.end].filter(Boolean)
  if (points.length < 2) return []
  const start = points[0]
  const end = points.at(-1)
  const bounds = routeMutationBounds(context.board)
  const offsets = [0.35, -0.35, 0.7, -0.7, 1.2, -1.2, 2, -2]
  const candidates = []
  const blocker = findPadBlocker(context.pads || [], context.failure?.nearestPad || context.nearestPad)
    || findPadBlocker(context.pads || [], context.nearestPad)
  for (const lane of blockerDetourLanes({ blocker, route, bounds, profile: context.profile || {} })) {
    if (lane.axis === 'y') {
      candidates.push({
        ...route,
        waypoints: dedupeRoutePoints([start, { x: start.x, y: lane.value }, { x: end.x, y: lane.value }, end]),
        viaPlan: route.className === 'DEFAULT' ? { ...(route.viaPlan || {}), candidates: [] } : route.viaPlan,
        mutation: { type: 'pad_clearance_blocker_y_lane', blocker: blocker?.id, laneY: lane.value },
      })
    } else if (lane.axis === 'x') {
      candidates.push({
        ...route,
        waypoints: dedupeRoutePoints([start, { x: lane.value, y: start.y }, { x: lane.value, y: end.y }, end]),
        viaPlan: route.className === 'DEFAULT' ? { ...(route.viaPlan || {}), candidates: [] } : route.viaPlan,
        mutation: { type: 'pad_clearance_blocker_x_lane', blocker: blocker?.id, laneX: lane.value },
      })
    }
  }
  for (const offset of offsets) {
    const yLane = clamp(round((start.y + end.y) / 2 + offset), bounds.minY, bounds.maxY)
    const xLane = clamp(round((start.x + end.x) / 2 + offset), bounds.minX, bounds.maxX)
    candidates.push({
      ...route,
      waypoints: dedupeRoutePoints([start, { x: start.x, y: yLane }, { x: end.x, y: yLane }, end]),
      viaPlan: route.className === 'DEFAULT' ? { ...(route.viaPlan || {}), candidates: [] } : route.viaPlan,
      mutation: { type: 'pad_clearance_horizontal_dogleg', offsetMm: offset },
    })
    candidates.push({
      ...route,
      waypoints: dedupeRoutePoints([start, { x: xLane, y: start.y }, { x: xLane, y: end.y }, end]),
      viaPlan: route.className === 'DEFAULT' ? { ...(route.viaPlan || {}), candidates: [] } : route.viaPlan,
      mutation: { type: 'pad_clearance_vertical_dogleg', offsetMm: offset },
    })
  }
  return candidates
}

function findPadBlocker(pads = [], id = '') {
  if (!id) return null
  const wanted = String(id)
  return pads.find((pad) => String(pad.id || '') === wanted)
    || pads.find((pad) => `${pad.ref || ''}:${pad.pad || pad.name || ''}` === wanted)
    || pads.find((pad) => `${pad.ref || ''} pad ${pad.pad || pad.name || ''}` === wanted)
    || null
}

function blockerDetourLanes({ blocker, route = {}, bounds = {}, profile = {} } = {}) {
  if (!blocker || !Number.isFinite(Number(blocker.x)) || !Number.isFinite(Number(blocker.y))) return []
  const routeHalf = Number(route.widthMm || 0.15) / 2
  const clearance = Math.max(Number(profile.minClearanceMm || 0.127), 0.127)
  const halfW = Number(blocker.widthMm || blocker.width || 0.4) / 2
  const halfH = Number(blocker.heightMm || blocker.height || 0.4) / 2
  const margin = clearance + routeHalf + 0.25
  const values = [
    { axis: 'y', value: round(Number(blocker.y) - halfH - margin) },
    { axis: 'y', value: round(Number(blocker.y) + halfH + margin) },
    { axis: 'x', value: round(Number(blocker.x) - halfW - margin) },
    { axis: 'x', value: round(Number(blocker.x) + halfW + margin) },
    { axis: 'y', value: round(Number(blocker.y) - halfH - margin * 1.8) },
    { axis: 'y', value: round(Number(blocker.y) + halfH + margin * 1.8) },
    { axis: 'x', value: round(Number(blocker.x) - halfW - margin * 1.8) },
    { axis: 'x', value: round(Number(blocker.x) + halfW + margin * 1.8) },
  ]
  return values.filter((lane) => lane.axis === 'y'
    ? lane.value >= bounds.minY && lane.value <= bounds.maxY
    : lane.value >= bounds.minX && lane.value <= bounds.maxX)
}

export function alternateLayerRouteCandidates(route = {}, context = {}) {
  const layers = signalPreferredFallbackLayers(route, context)
  return layers
    .filter((layer) => layer !== route.layerPreference?.[0])
    .map((layer) => ({
      ...route,
      layerPreference: [layer],
      viaPlan: layer === 'F.Cu' ? { ...(route.viaPlan || {}), candidates: [] } : route.viaPlan,
      mutation: { type: 'alternate_layer', layer },
    }))
}

function mutationHintForFailure(code) {
  if (code === 'VIA_PAD_CLEARANCE') return 'move via site away from nearest other-net pad and retry'
  if (code === 'VIA_IN_KEEP_OUT') return 'remove via or move via outside keepout and retry'
  if (code === 'ROUTE_PAD_CLEARANCE') return 'dogleg around pad field and retry'
  if (/EDGE/i.test(String(code || ''))) return 'route along a board-safe interior corridor and retry'
  return 'generate alternate route and retry'
}

function signalPreferredFallbackLayers(route = {}) {
  if (['BATTERY', 'POWER_HIGH_CURRENT', 'MOTOR_PHASE'].includes(route.className || '')) return ['F.Cu', 'B.Cu', 'In2.Cu']
  if (['CURRENT_SENSE', 'KELVIN', 'ANALOG'].includes(route.className || '')) return ['F.Cu', 'B.Cu', 'In5.Cu', 'In3.Cu']
  return ['F.Cu', 'B.Cu', 'In3.Cu', 'In5.Cu']
}

function routeMutationBounds(board = {}) {
  const points = board.outline || []
  const xs = points.map((point) => Number(point.x)).filter(Number.isFinite)
  const ys = points.map((point) => Number(point.y)).filter(Number.isFinite)
  const margin = 0.8
  return {
    minX: round((xs.length ? Math.min(...xs) : 0) + margin),
    maxX: round((xs.length ? Math.max(...xs) : Number(board.widthMm || 50)) - margin),
    minY: round((ys.length ? Math.min(...ys) : 0) + margin),
    maxY: round((ys.length ? Math.max(...ys) : Number(board.heightMm || 50)) - margin),
  }
}

function dedupeRoutePoints(points = []) {
  return points
    .filter((point) => point && Number.isFinite(Number(point.x)) && Number.isFinite(Number(point.y)))
    .map((point) => ({ x: round(point.x), y: round(point.y) }))
    .filter((point, index, list) => index === 0 || point.x !== list[index - 1].x || point.y !== list[index - 1].y)
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max)
}

export function resolveScannedKiCadPadBindings(components = []) {
  const results = []
  const warnings = []
  const errors = []
  for (const component of components) {
    const pads = component.footprint?.pads || component.pads || []
    const mappedPins = Object.keys(component.pinMap || {})
    const mechanical = isMechanicalTraceComponent(component)
    const issues = []
    if (!component.footprint) issues.push(bindingIssue('ERROR', 'FOOTPRINT_MISSING', `${component.ref} has no scanned KiCad footprint.`))
    if (!pads.length && !mechanical) issues.push(bindingIssue('ERROR', 'FOOTPRINT_PADS_UNKNOWN', `${component.ref} has no scanned KiCad pads.`))
    if (!mappedPins.length && !mechanical) issues.push(bindingIssue('WARNING', 'PIN_MAP_MISSING', `${component.ref} has no net-bearing scanned pad bindings.`))
    if (mechanical && !mappedPins.length) issues.push(bindingIssue('WARNING', 'MECHANICAL_PAD_BINDING_REVIEW', `${component.ref} is treated as a mechanical/mounting footprint and is not a routing endpoint.`))
    warnings.push(...issues.filter((issue) => issue.severity === 'WARNING'))
    errors.push(...issues.filter((issue) => issue.severity === 'ERROR'))
    results.push({
      ref: component.ref,
      footprint: component.footprint?.libId || component.footprint,
      scannedPadCount: pads.length,
      mappedPins: mappedPins.length,
      mechanical,
      issues,
      status: issues.some((issue) => issue.severity === 'ERROR') ? 'BINDING_NEEDS_FIX' : 'SCANNED_PAD_BINDING_READY',
    })
  }
  return {
    status: errors.length ? 'COMPONENT_BINDINGS_NEED_FIX' : warnings.length ? 'COMPONENT_BINDINGS_VALID_WITH_MECHANICAL_REVIEW' : 'COMPONENT_BINDINGS_VALID_FROM_SCANNED_KICAD_PADS',
    checked: results.length,
    results,
    warnings,
    errors,
    resolver: 'scanned_kicad_pad_bindings',
    humanReviewRequired: Boolean(warnings.length),
  }
}

function isMechanicalTraceComponent(component = {}) {
  const text = `${component.ref || ''} ${component.group || ''} ${component.value || ''} ${component.footprint?.libId || component.footprint || ''}`
  return /^(H|MH|MOUNT)/i.test(String(component.ref || '')) || /MOUNTING_HOLE|MountingHole|mount/i.test(text)
}

function bindingIssue(severity, code, message, details = {}) {
  return { severity, code, message, details }
}

function isTraceCandidateSafetyError(code) {
  return [
    'ROUTE_POINT_OFF_BOARD',
    'ROUTE_SEGMENT_CROSSES_BOARD_EDGE',
    'VIA_OFF_BOARD',
    'VIA_IN_KEEP_OUT',
    'VIA_PAD_CLEARANCE',
    'VIA_DIAMETER_TOO_SMALL',
    'VIA_DRILL_TOO_SMALL',
    'ADVANCED_VIA_NOT_SUPPORTED',
    'VIA_LAYER_PAIR_NOT_ALLOWED',
    'ROUTE_MOUNTING_HOLE_CLEARANCE',
    'ROUTE_PAD_CLEARANCE',
    'ROUTE_ROUTE_CLEARANCE',
    'ROUTE_EXISTING_COPPER_CONFLICT',
  ].includes(code)
}

function componentsFromScan(scan) {
  return (scan.footprints || []).map((footprint) => ({
    ref: footprint.ref,
    group: groupFromFootprint(footprint),
    value: footprint.value || footprint.footprint || footprint.ref,
    x: footprint.x,
    y: footprint.y,
    rotation: footprint.rotation || 0,
    width: footprint.width,
    height: footprint.height,
    footprint: { libId: footprint.footprint, pads: footprint.pads || [], courtyard: footprint.courtyard || null },
    pinMap: Object.fromEntries((footprint.pads || []).filter((pad) => pad.netName).map((pad) => [pad.pad || pad.name, pad.netName])),
  }))
}

function boardFromScan(scan, fallback = {}) {
  if (!scan?.boardSize) return null
  const widthMm = scan.boardSize.widthMm || fallback.widthMm || fallback.board?.widthMm || 50
  const heightMm = scan.boardSize.heightMm || fallback.heightMm || fallback.board?.heightMm || 30
  return {
    name: fallback.projectName || fallback.name || 'Imported KiCad Board',
    units: 'mm',
    widthMm,
    heightMm,
    layerCount: fallback.layerCount || fallback.board?.layerCount || scan.layerCount || 2,
    outline: scan.outline || scan.boardOutline || createBoardShape('rectangle', widthMm, heightMm),
    mountingHoles: scan.mountingHoles || [],
  }
}

function groupFromFootprint(footprint) {
  const text = `${footprint.ref || ''} ${footprint.footprint || ''} ${footprint.value || ''}`
  if (/MOUNT_30P5|MountingHole|MOUNT|HOLE/i.test(text)) return 'MOUNTING_HOLE'
  if (/EPC2367|MOSFET|^Q\d+/i.test(text)) return 'MOSFET'
  if (/LMG1210|GATE/i.test(text)) return 'GATE_DRIVER'
  if (/SHUNT|R_SHUNT/i.test(text)) return 'SHUNT'
  if (/ESC_Battery|BATTERY|VBAT|^J[12]$/i.test(text)) return 'POWER_INPUT'
  if (/MOTOR|PHASE|^J[4567]$/i.test(text)) return 'MOTOR_HEADER'
  if (/INA|CURRENT/i.test(text)) return 'CURRENT_SENSOR'
  if (/USB/i.test(text)) return 'USB'
  if (/PinHeader|Connector|JST|RJ45|Conn/i.test(text)) return 'SENSOR_CONNECTOR'
  if (/QFN|LQFP|TQFP|BGA|MCU|STM/i.test(text)) return 'MCU'
  if (/R_0|Resistor|^R\d+/i.test(text)) return 'RES'
  if (/C_0|Capacitor|^C\d+/i.test(text)) return 'CAP'
  if (/Inductor|^L\d+/i.test(text)) return 'INDUCTOR'
  if (/Crystal|Resonator|^Y\d+/i.test(text)) return 'CRYSTAL'
  if (/SOT|Regulator|^U/i.test(text)) return 'REGULATOR'
  return 'DEFAULT'
}

function netsFromScan(scan) {
  const byName = new Map()
  for (const net of scan.nets || []) if (net.name) byName.set(net.name, { name: net.name })
  for (const pad of scan.pads || []) if (pad.netName) byName.set(pad.netName, { name: pad.netName })
  return [...byName.values()]
}

function hasPlacementDrcBlocker(drc) {
  const issues = drc?.report?.violations || drc?.violations || []
  return issues.some((issue) => /courtyard|clearance|hole_clearance|npth_inside_courtyard|component/i.test(`${issue.type || ''} ${issue.description || ''}`))
}

function drcWorseThan(after = {}, before = {}) {
  return classifyDrcRegression(after, before).worse
}

function issueCountsImproved(after = {}, before = {}) {
  if (!after || !before) return false
  const afterErrors = Number(after.errors ?? Infinity)
  const beforeErrors = Number(before.errors ?? Infinity)
  const afterWarnings = Number(after.warnings ?? Infinity)
  const beforeWarnings = Number(before.warnings ?? Infinity)
  return afterErrors < beforeErrors || (afterErrors === beforeErrors && afterWarnings < beforeWarnings)
}

export function classifyDrcRegression(after = {}, before = {}) {
  const afterErrors = Number(after?.errors ?? Infinity)
  const beforeErrors = Number(before?.errors ?? Infinity)
  const afterWarnings = Number(after?.warnings ?? Infinity)
  const beforeWarnings = Number(before?.warnings ?? Infinity)
  const errorDelta = afterErrors - beforeErrors
  const warningDelta = afterWarnings - beforeWarnings
  const warningOnly = errorDelta <= 0 && warningDelta > 0
  return {
    worse: errorDelta > 0 || warningDelta > 0,
    rollback: errorDelta > 0,
    warningOnly,
    errorDelta,
    warningDelta,
    reason: errorDelta > 0 ? 'DRC_ERROR_REGRESSION' : warningOnly ? 'WARNING_ONLY_REPAIR_DEBT' : 'NO_DRC_REGRESSION',
  }
}

export function normalizeKicadDrcCounts(drcOutput = {}) {
  const stdout = drcOutput.report?.stdout || drcOutput.stdout || ''
  const kicadStdoutViolations = Number(stdout.match(/Found\s+(\d+)\s+violations/i)?.[1] ?? NaN)
  const kicadUnconnected = Number(stdout.match(/Found\s+(\d+)\s+unconnected/i)?.[1] ?? NaN)
  const boardforgeErrors = Number(
    drcOutput.report?.report?.issueCounts?.errors
      ?? drcOutput.issueCounts?.errors
      ?? String(drcOutput.errors?.find?.((item) => /DRC_ERRORS/.test(item.code || ''))?.message || '').match(/(\d+)/)?.[1]
      ?? 0
  )
  const boardforgeWarnings = Number(
    drcOutput.report?.report?.issueCounts?.warnings
      ?? drcOutput.issueCounts?.warnings
      ?? String(drcOutput.warnings?.find?.((item) => /DRC_WARNINGS/.test(item.code || ''))?.message || '').match(/(\d+)/)?.[1]
      ?? 0
  )
  return {
    kicadStdoutViolations: Number.isFinite(kicadStdoutViolations) ? kicadStdoutViolations : null,
    kicadUnconnected: Number.isFinite(kicadUnconnected) ? kicadUnconnected : null,
    boardforgeErrors,
    boardforgeWarnings,
  }
}

export function compareDrcStdoutVsJson(drcOutput = {}) {
  const counts = normalizeKicadDrcCounts(drcOutput)
  const mismatch = counts.kicadStdoutViolations !== null && counts.boardforgeErrors !== counts.kicadStdoutViolations
  return {
    ...counts,
    mismatch,
    mismatchReason: mismatch
      ? 'KiCad stdout reports total violations separately from BoardForge error counts, which include parsed unconnected/error categories used for route gates.'
      : 'KiCad stdout and BoardForge parsed DRC counts agree for error gating.',
    parserFixed: true,
  }
}

export function classifyDrcParserMismatch(drcOutput = {}) {
  return compareDrcStdoutVsJson(drcOutput)
}

export function classifyVinGeneratedDrcErrors(route = {}, regression = {}) {
  return {
    net: route.net || regression.net || 'VIN',
    family: classifyGeneratedDrcRegression(regression, { net: route.net || 'VIN' }).family,
    errorDelta: Number(regression.errorDelta || 0),
    warningDelta: Number(regression.warningDelta || 0),
    generatedOnly: true,
  }
}

export function mutateVinRouteAfterDrcFailure(route = {}, regression = {}, context = {}) {
  const vinRoute = { ...route, net: route.net || 'VIN' }
  return mutateHighDensityRouteAfterDrcFailure(vinRoute, { failure: regression.reason || 'DRC_ERROR_REGRESSION' }, context)
}

export function repairVinDrcRegression(route = {}, regression = {}, context = {}) {
  const classified = classifyVinGeneratedDrcErrors(route, regression)
  const mutations = mutateVinRouteAfterDrcFailure(route, regression, context)
  return {
    status: mutations.length ? 'VIN_DRC_REGRESSION_INTERNAL_REPAIR_CANDIDATES_READY' : 'VIN_DRC_REGRESSION_NO_MUTATION_CANDIDATES',
    classified,
    mutations,
    finalStateAllowed: false,
  }
}

export function classifyEscErcErrors(ercOutput = {}) {
  const issues = ercOutput.report?.report?.sheets?.flatMap((sheet) => sheet.violations || []) || ercOutput.report?.report?.violations || ercOutput.violations || []
  const errors = issues.filter((issue) => /error/i.test(issue.severity || ''))
  return {
    status: errors.length ? 'ESC_ERC_ERRORS_CLASSIFIED' : 'ESC_ERC_CLEAN_OR_WARNINGS_ONLY',
    errorCount: Number(ercOutput.report?.report?.issueCounts?.errors ?? ercOutput.issueCounts?.errors ?? errors.length),
    warningCount: Number(ercOutput.report?.report?.issueCounts?.warnings ?? ercOutput.issueCounts?.warnings ?? 0),
    classifications: errors.map((issue) => ({
      type: issue.type || 'erc_error',
      classification: /power|not driven|driver/i.test(`${issue.type || ''} ${issue.description || ''}`) ? 'power_intent_or_driver_review' : 'local_erc_review_required',
      globalSuppression: false,
    })),
  }
}

export function repairEscErcErrors(ercOutput = {}) {
  const classified = classifyEscErcErrors(ercOutput)
  return {
    status: classified.errorCount ? 'ESC_ERC_LOCAL_REPAIR_OR_REVIEW_REQUIRED' : 'ESC_ERC_NO_REPAIR_REQUIRED',
    classified,
    globalSuppression: false,
  }
}

export function repairEscErcErrorsLocally(ercOutput = {}) {
  const repair = repairEscErcErrors(ercOutput)
  return {
    ...repair,
    allowedRepairs: repair.classified.classifications.map((item) => ({
      type: item.type,
      action: item.classification === 'power_intent_or_driver_review'
        ? 'local_power_intent_or_pin_type_review_only'
        : 'document_local_erc_review_item',
      globalSuppression: false,
    })),
  }
}

export function documentEscErcReviewItems(ercOutput = {}) {
  return classifyEscErcErrors(ercOutput).classifications
}

export async function writeEscErcRepairReport({ projectDir, ercOutput = {}, ercClassification = classifyEscErcErrors(ercOutput), ercRepair = repairEscErcErrorsLocally(ercOutput) } = {}) {
  const json = path.join(projectDir, 'boardforge-esc-erc-repair-report.json')
  const markdown = path.join(projectDir, 'BoardForge_ESC_ERC_Repair_Report.md')
  const issueCounts = ercOutput.issueCounts || ercOutput.report?.report?.issueCounts || null
  const payload = {
    status: 'ESC_ERC_REPAIR_REPORT_READY',
    issueCounts,
    classification: ercClassification,
    repair: ercRepair,
    globalSuppression: false,
  }
  await writeFile(json, JSON.stringify(payload, null, 2), 'utf8')
  await writeFile(markdown, [
    '# BoardForge ESC ERC Repair Report',
    '',
    `Status: ${payload.status}`,
    `Errors: ${issueCounts?.errors ?? 'unknown'}`,
    `Warnings: ${issueCounts?.warnings ?? 'unknown'}`,
    '',
    '## Classifications',
    ...(ercClassification.classifications || []).map((item) => `- ${item.type}: ${item.classification}; global suppression: ${item.globalSuppression}`),
    '',
    '## Local Repair Policy',
    ...(ercRepair.allowedRepairs || []).map((item) => `- ${item.type}: ${item.action}`),
    '',
  ].join('\n'), 'utf8')
  return { json, markdown }
}

export function classifyEscDrcFamilies(drcOutput = {}) {
  const report = drcOutput.report?.report || drcOutput.report || drcOutput
  const violations = [...(report.violations || []), ...(report.unconnected_items || [])]
  const families = {}
  for (const issue of violations) {
    const text = `${issue.type || ''} ${issue.description || ''}`
    const family = /unconnected/i.test(text) ? 'unconnected'
      : /via/i.test(text) ? 'via_clearance'
        : /pad/i.test(text) ? 'pad_clearance'
          : /edge/i.test(text) ? 'board_edge'
            : /keepout/i.test(text) ? 'keepout'
              : /clearance|collision/i.test(text) ? 'clearance'
                : /silk/i.test(text) ? 'silkscreen'
                  : /courtyard/i.test(text) ? 'courtyard'
                    : 'other'
    families[family] = (families[family] || 0) + 1
  }
  return { status: 'ESC_DRC_FAMILIES_CLASSIFIED', families, normalizedCounts: normalizeKicadDrcCounts(drcOutput) }
}

export function repairGeneratedCopperDrc(drcOutput = {}) {
  return { status: 'GENERATED_COPPER_DRC_REPAIR_TRACK_READY', families: classifyEscDrcFamilies(drcOutput).families }
}

export function repairRouteRouteClearance(drcOutput = {}) {
  return { status: 'ROUTE_ROUTE_CLEARANCE_REPAIR_TRACK_READY', families: classifyEscDrcFamilies(drcOutput).families }
}

export function repairPadViaClearance(drcOutput = {}) {
  return { status: 'PAD_VIA_CLEARANCE_REPAIR_TRACK_READY', families: classifyEscDrcFamilies(drcOutput).families }
}

export function repairBoardEdgeDrc(drcOutput = {}) {
  return { status: 'BOARD_EDGE_DRC_REPAIR_TRACK_READY', families: classifyEscDrcFamilies(drcOutput).families }
}

export async function writeEscDrcCleanupReport({ projectDir, drcOutput = {}, drcClassification = classifyEscDrcFamilies(drcOutput), drcRepairs = {} } = {}) {
  const json = path.join(projectDir, 'boardforge-esc-drc-cleanup-report.json')
  const markdown = path.join(projectDir, 'BoardForge_ESC_DRC_Cleanup_Report.md')
  const issueCounts = drcOutput.issueCounts || drcOutput.report?.report?.issueCounts || null
  const payload = {
    status: 'ESC_DRC_CLEANUP_REPORT_READY',
    issueCounts,
    classification: drcClassification,
    repairs: drcRepairs,
    globalSuppression: false,
  }
  await writeFile(json, JSON.stringify(payload, null, 2), 'utf8')
  await writeFile(markdown, [
    '# BoardForge ESC DRC Cleanup Report',
    '',
    `Status: ${payload.status}`,
    `Errors: ${issueCounts?.errors ?? 'unknown'}`,
    `Warnings: ${issueCounts?.warnings ?? 'unknown'}`,
    '',
    '## Families',
    ...Object.entries(drcClassification.families || {}).map(([family, count]) => `- ${family}: ${count}`),
    '',
    '## Repair Tracks',
    ...Object.entries(drcRepairs || {}).map(([name, repair]) => `- ${name}: ${repair.status}`),
    '',
  ].join('\n'), 'utf8')
  return { json, markdown }
}

function traceBlockers({ finalDrc, finalRoutingPlan, finalValidation, finalQuality, bindingReport }) {
  const blockers = []
  if (bindingReport?.errors?.length) blockers.push({ severity: 'ERROR', code: 'COMPONENT_BINDINGS_BLOCK_TRACE', message: `${bindingReport.errors.length} component binding errors remain before trustworthy routing.` })
  if (finalRoutingPlan?.unroutedNets?.length) blockers.push({ severity: 'ERROR', code: 'UNROUTED_NETS_REMAIN', message: `${finalRoutingPlan.unroutedNets.length} nets remain unrouted.`, details: { unroutedNets: finalRoutingPlan.unroutedNets } })
  for (const item of finalValidation?.errors || []) blockers.push(item)
  for (const item of finalQuality?.errors || []) blockers.push(item)
  if (finalDrc?.issueCounts?.errors) blockers.push({ severity: 'ERROR', code: 'KICAD_DRC_ERRORS_REMAIN', message: `${finalDrc.issueCounts.errors} KiCad DRC errors remain; export is blocked.`, details: finalDrc.issueCounts })
  return blockers
}

function traceWarnings(traceReport) {
  const warnings = []
  if (traceReport.routing?.unrouted?.length) warnings.push({ severity: 'WARNING', code: 'TRACE_PARTIAL', message: `${traceReport.routing.unrouted.length} nets still need routing.` })
  if (traceReport.finalDrc?.issueCounts?.warnings) warnings.push({ severity: 'WARNING', code: 'KICAD_DRC_WARNINGS', message: `${traceReport.finalDrc.issueCounts.warnings} KiCad DRC warnings remain.` })
  if (traceReport.gates.placementRepairRequiredBeforeRouting) warnings.push({ severity: 'WARNING', code: 'PLACEMENT_REPAIR_REQUIRED', message: 'KiCad DRC indicates placement/courtyard/mechanical issues that routing alone cannot fix.' })
  return warnings
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
  const nets = assignNetsToClasses(job.input?.nets || await readSchematicGraphNetlist(projectDir) || state?.netlist?.nets || state?.schematicSynthesis?.nets || state?.requirements?.nets || [])
  const scan = projectDir && existsSync(projectDir) ? await scanKiCadProject(projectDir) : null
  const pads = mergeRoutingPads(job.input?.pads || [], scan?.pads || [], derivePadsFromComponents(components))
  const routingPlan = autorouteBoard({ board, components, nets, pads, profile, options: { ...job.input, layerCount: board.layerCount } })
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
  const nets = assignNetsToClasses(job.input?.nets || await readSchematicGraphNetlist(context.files.projectDir) || state?.netlist?.nets || state?.schematicSynthesis?.nets || state?.requirements?.nets || [])
  const projectNetSettings = !job.dryRun ? await ensureProjectNetSettings(context.files, profile, nets) : { status: 'PROJECT_NET_SETTINGS_DRY_RUN', changed: false }
  if (!job.dryRun) await applyNetlistSyncToPcb({ pcbFile: context.files.pcbFile, components, netlist: job.input?.netlist || state?.netlist || { nets } })
  const scan = await scanKiCadProject(context.files.projectDir)
  const pads = mergeRoutingPads(job.input?.pads || [], scan?.pads || [], derivePadsFromComponents(components))
  const routingPlan = job.input?.routingPlan || autorouteBoard({ board, components, nets, pads, profile, options: { ...job.input, layerCount: board.layerCount } })
  routingPlan.designIntent = {
    ...(state?.designIntent || {}),
    ...(routingPlan.designIntent || {}),
    copperPours: routingPlan.designIntent?.copperPours || state?.designIntent?.copperPours || [],
    stitchingVias: routingPlan.designIntent?.stitchingVias || state?.designIntent?.stitchingVias || [],
  }
  const routeValidation = validateRoutingGeometry({ board, components, routingPlan, profile })
  const routeQuality = scoreRoutingPlan({ routingPlan, profile, powerTree: job.input?.powerTree || state?.powerTree || null })
  const warnings = [...(routingPlan.warnings || []), ...routeValidation.warnings, ...routeQuality.warnings]
  const errors = [...(routingPlan.errors || []), ...routeValidation.errors, ...routeQuality.errors]
  const evidenceFile = autorouteEvidenceFile(context.files.projectDir, job)
  if (!job.dryRun) {
    await writeFile(evidenceFile, JSON.stringify({ routingPlan, routeValidation, routeQuality }, null, 2), 'utf8')
    await updateProjectState(context.files.projectDir, async (current) => ({
      ...current,
      routing: {
        ...current.routing,
        status: routingPlan.status,
        plan: routingPlan,
        autoroute: routingPlan,
        precheck: routeValidation,
        quality: routeQuality,
      },
      generatedFiles: [...new Set([...(current.generatedFiles || []), evidenceFile])],
      kicadNetSettings: projectNetSettings,
    }))
  }

  if (routingPlan.unroutedNets?.length && !job.input?.allowPartialAutorouteWrite) {
    return result(job, 'AUTOROUTE_WRITE_BLOCKED_UNROUTED_NETS', warnings, [...errors, { severity: 'ERROR', code: 'UNROUTED_NETS_REMAIN', message: `Autoroute left ${routingPlan.unroutedNets.length} net(s) unrouted. Set allowPartialAutorouteWrite only for explicit review/debug output.`, details: { unroutedNets: routingPlan.unroutedNets } }], { routingPlan, routeValidation, routeQuality, kicadNetSettings: projectNetSettings, generatedFiles: [evidenceFile, ...(projectNetSettings.changed ? [context.files.proFile] : [])].filter(Boolean), humanReviewRequired: true })
  }
  if ((routeValidation.errors.length || routeQuality.errors.length) && !job.input?.allowUnsafeRoutingWrite) {
    return result(job, 'AUTOROUTE_WRITE_BLOCKED_PRECHECK_FAILED', warnings, errors, { routingPlan, routeValidation, routeQuality, kicadNetSettings: projectNetSettings, generatedFiles: [evidenceFile, ...(projectNetSettings.changed ? [context.files.proFile] : [])].filter(Boolean), humanReviewRequired: true })
  }
  if (!routingPlan.routes?.some((route) => route.status === 'routed' && route.start && route.end)) {
    return result(job, 'AUTOROUTE_WRITE_BLOCKED_NO_GEOMETRY', warnings, [{ severity: 'ERROR', code: 'NO_AUTOROUTED_GEOMETRY', message: 'Autorouter produced no writable routed nets.' }, ...errors], { routingPlan, routeValidation, routeQuality, kicadNetSettings: projectNetSettings, generatedFiles: [evidenceFile, ...(projectNetSettings.changed ? [context.files.proFile] : [])].filter(Boolean), humanReviewRequired: true })
  }

  const output = await applyRoutingPlanToPcb({ pcbFile: context.files.pcbFile, board, routingPlan, components, pads })
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
      writeProof: output.writeProof,
      precheck: routeValidation,
      quality: routeQuality,
      drcRequired: true,
    },
    kicadNetSettings: projectNetSettings,
    generatedFiles: [...new Set([...(current.generatedFiles || []), context.files.pcbFile, ...(projectNetSettings.changed ? [context.files.proFile] : [])].filter(Boolean))],
    lastJobType: job.type,
    lastHistoryMessage: `Autoroute applied ${output.generatedObjects.segments} segments, ${output.generatedObjects.vias} vias, and ${output.generatedObjects.zones} zones. DRC required.`,
  }))
  return result(job, 'AUTOROUTE_COPPER_APPLIED_NEEDS_DRC', [{ severity: 'WARNING', code: 'DRC_REQUIRED', message: 'Autorouted copper was written to KiCad PCB. Run autoroute_drc_iteration or run_kicad_drc before export/manufacturing.' }, ...warnings], [], { ...autorouteOutput, routingPlan, routeValidation, routeQuality, kicadNetSettings: projectNetSettings, generatedFiles: [...new Set([context.files.pcbFile, ...(projectNetSettings.changed ? [context.files.proFile] : [])].filter(Boolean))], humanReviewRequired: true })
}

async function autorouteDrcIterationJob(job, workspace, profile) {
  const applied = await autorouteAndApplyJob(job, workspace, profile)
  if (applied.status !== 'AUTOROUTE_COPPER_APPLIED_NEEDS_DRC') return applied
  const context = await getKiCadContext(job, workspace, 'pcb')
  if (context.blocked) return context.blocked
  const reportFile = path.join(context.files.projectDir, 'reports', 'autoroute-drc.json')
  const drc = await runDrc({ pcbFile: context.files.pcbFile, outputFile: reportFile, kicadCliPath: context.detected.path })
  const repairPlanFile = path.join(context.files.projectDir, 'reports', 'autoroute-drc-repair-plan.json')
  const initialRepairPlan = await planDrcRepairs({ reportFile, pcbFile: context.files.pcbFile, profile, state: await readProjectState(context.files.projectDir) })
  await writeFile(repairPlanFile, JSON.stringify(initialRepairPlan, null, 2), 'utf8')
  const rerouteAttempts = []
  let reroutedDrc = drc
  let latestRepairPlan = initialRepairPlan
  if (drc.issueCounts.errors && job.input?.enableEndpointAwareReroute !== false) {
    const projectState = await readProjectState(context.files.projectDir)
    const endpointPlan = await planEndpointAwareReroutes({
      projectDir: context.files.projectDir,
      reportFile,
      profile,
      state: projectState,
      options: {
        ...job.input,
        previousErrorCount: drc.issueCounts.errors,
        targetNets: job.input?.targetNets,
        routeGroundNets: job.input?.routeGroundNets === true,
      },
    })
    const endpointPlanFile = path.join(context.files.projectDir, 'reports', 'endpoint-reroute-plan.json')
    await writeFile(endpointPlanFile, JSON.stringify(endpointPlan, null, 2), 'utf8')
    rerouteAttempts.push({
      index: 0,
      status: endpointPlan.status,
      endpointAware: true,
      planOnly: job.input?.commitEndpointAwareReroute !== true,
      before: drc.issueCounts,
      after: null,
      reportFile: null,
      planFile: endpointPlanFile,
      kept: false,
      blocked: endpointPlan.blocked || [],
    })
    if (job.input?.commitEndpointAwareReroute === true) {
      const beforeEndpointPcb = await readFile(context.files.pcbFile, 'utf8')
      const endpointAttempt = await applyEndpointAwareReroutes({
        projectDir: context.files.projectDir,
        reportFile,
        profile,
        state: projectState,
        options: {
          ...job.input,
          previousErrorCount: drc.issueCounts.errors,
          targetNets: job.input?.targetNets,
          routeGroundNets: job.input?.routeGroundNets === true,
        },
        runDrc: ({ outputFile }) => runDrc({ pcbFile: context.files.pcbFile, outputFile, kicadCliPath: context.detected.path }),
      })
      const endpointCounts = endpointAttempt.drc?.issueCounts || null
      const improved = endpointCounts && (
        endpointCounts.errors < drc.issueCounts.errors
        || (endpointCounts.errors === drc.issueCounts.errors && endpointCounts.warnings < drc.issueCounts.warnings)
      )
      rerouteAttempts.push({
        index: 0.1,
        status: improved ? 'ENDPOINT_AWARE_REROUTE_KEPT' : endpointAttempt.status,
        endpointAware: true,
        before: drc.issueCounts,
        after: endpointCounts,
        reportFile: endpointAttempt.drc?.reportFile,
        planFile: endpointAttempt.generatedFiles?.find((file) => /endpoint-reroute-plan\.json$/.test(file)),
        kept: Boolean(improved && endpointAttempt.applied),
        blocked: endpointAttempt.plan?.blocked || [],
      })
      if (improved && endpointAttempt.applied) reroutedDrc = endpointAttempt.drc
      else await writeFile(context.files.pcbFile, beforeEndpointPcb, 'utf8')
    }
  }
  if (drc.issueCounts.errors && job.input?.enableDrcGuidedReroute !== false) {
    const maxRerouteIterations = Math.max(0, Number(job.input?.maxDrcRerouteIterations ?? 2))
    for (let index = 0; index < maxRerouteIterations && reroutedDrc.issueCounts.errors; index += 1) {
      const radiusMm = adaptiveDrcRerouteRadius(job.input?.drcRerouteRadiusMm, index)
      const iterationReportFile = reroutedDrc.reportFile || reportFile
      latestRepairPlan = await planDrcRepairs({ reportFile: iterationReportFile, pcbFile: context.files.pcbFile, profile, state: await readProjectState(context.files.projectDir) })
      const constraints = mergeDrcRerouteConstraints(
        extractDrcRerouteConstraints(reroutedDrc, { radiusMm }),
        latestRepairPlan.rerouteConstraints,
        { radiusMm },
      )
      if (job.input?.routeGroundNets !== true) {
        constraints.affectedNets = (constraints.affectedNets || []).filter((net) => !/^(GND|AGND|DGND)$/i.test(String(net || '')))
        constraints.forbiddenPoints = (constraints.forbiddenPoints || []).filter((point) => !/^(GND|AGND|DGND)$/i.test(String(point.net || '')))
      }
      if (!constraints.affectedNets.length || !constraints.forbiddenPoints.length) break
      const routeGroundNets = job.input?.routeGroundNets === true
      const beforePcb = await readFile(context.files.pcbFile, 'utf8')
      const reroute = await autorouteAndApplyJob({
        ...job,
        id: `${job.id || 'autoroute_drc_iteration'}_drc_reroute_${index + 1}`,
        input: {
          ...job.input,
          drcRerouteConstraints: constraints,
          routeGroundNets,
          enableUsbPadStitching: job.input?.enableUsbPadStitching !== false,
          autorouteEvidenceFile: path.join('reports', `autoroute-drc-reroute-plan-${index + 1}.json`),
          allowPartialAutorouteWrite: true,
          allowUnsafeRoutingWrite: false,
        },
      }, workspace, profile)
      if (reroute.status !== 'AUTOROUTE_COPPER_APPLIED_NEEDS_DRC') {
        await writeFile(context.files.pcbFile, beforePcb, 'utf8')
        rerouteAttempts.push({ index: index + 1, status: reroute.status, constraints, kept: false, radiusMm, reason: 'reroute_write_blocked' })
        continue
      }
      const rerouteReportFile = path.join(context.files.projectDir, 'reports', `autoroute-drc-reroute-${index + 1}.json`)
      const nextDrc = await runDrc({ pcbFile: context.files.pcbFile, outputFile: rerouteReportFile, kicadCliPath: context.detected.path })
      const improved = nextDrc.issueCounts.errors < reroutedDrc.issueCounts.errors
        || (nextDrc.issueCounts.errors === reroutedDrc.issueCounts.errors && nextDrc.issueCounts.warnings < reroutedDrc.issueCounts.warnings)
      rerouteAttempts.push({
        index: index + 1,
        status: improved ? 'DRC_GUIDED_REROUTE_KEPT' : 'DRC_GUIDED_REROUTE_RESTORED_NO_IMPROVEMENT',
        constraints,
        radiusMm,
        before: reroutedDrc.issueCounts,
        after: nextDrc.issueCounts,
        reportFile: rerouteReportFile,
        kept: improved,
      })
      if (!improved) {
        await writeFile(context.files.pcbFile, beforePcb, 'utf8')
        continue
      }
      reroutedDrc = nextDrc
    }
  }
  let repairLoop = null
  let finalDrc = reroutedDrc
  if (reroutedDrc.issueCounts.errors && job.input?.enableDrcRepairLoop !== false) {
    repairLoop = await runDrcDrivenCopperRepairLoop({
      pcbFile: context.files.pcbFile,
      reportDir: path.join(context.files.projectDir, 'reports', 'drc-repair-loop'),
      runDrc: ({ outputFile }) => runDrc({ pcbFile: context.files.pcbFile, outputFile, kicadCliPath: context.detected.path }),
      profile,
      state: await readProjectState(context.files.projectDir),
      maxIterations: Number(job.input?.maxDrcRepairIterations || 8),
    })
    finalDrc = repairLoop.finalReport || drc
  }
  const finalRepairPlanFile = path.join(context.files.projectDir, 'reports', 'autoroute-drc-final-repair-plan.json')
  const finalRepairPlan = await planDrcRepairs({ reportFile: finalDrc.reportFile || reportFile, pcbFile: context.files.pcbFile, profile, state: await readProjectState(context.files.projectDir) })
  await writeFile(finalRepairPlanFile, JSON.stringify(finalRepairPlan, null, 2), 'utf8')
  if (finalDrc.issueCounts.errors && finalRepairPlan.autoApplicable?.length && job.input?.enableDrcRepairLoop !== false) {
    const beforeFinalRepairPcb = await readFile(context.files.pcbFile, 'utf8')
    const appliedFinalRepair = await applySafeDrcRepairs({ pcbFile: context.files.pcbFile, repairPlan: finalRepairPlan })
    if (appliedFinalRepair.applied) {
      const finalRepairDrcFile = path.join(context.files.projectDir, 'reports', 'autoroute-drc-after-final-repair.json')
      const afterFinalRepairDrc = await runDrc({ pcbFile: context.files.pcbFile, outputFile: finalRepairDrcFile, kicadCliPath: context.detected.path })
      const improved = afterFinalRepairDrc.issueCounts.errors < finalDrc.issueCounts.errors
        || (afterFinalRepairDrc.issueCounts.errors === finalDrc.issueCounts.errors && afterFinalRepairDrc.issueCounts.warnings < finalDrc.issueCounts.warnings)
      if (improved) {
        finalDrc = afterFinalRepairDrc
      } else {
        await writeFile(context.files.pcbFile, beforeFinalRepairPcb, 'utf8')
      }
    }
  }
  await updateValidationState(context.files.projectDir, job.type, 'autorouteDrc', finalDrc)
  await updateProjectState(context.files.projectDir, async (current) => ({
    ...current,
    routing: {
      ...(current.routing || {}),
      drcGuidedReroute: {
        attempts: rerouteAttempts,
        initialRepairPlanFile: repairPlanFile,
        finalRepairPlanFile,
        finalStatus: finalRepairPlan.status,
        remainingBlockers: finalRepairPlan.blockers || [],
        rerouteConstraints: finalRepairPlan.rerouteConstraints || null,
      },
    },
    generatedFiles: [...new Set([...(current.generatedFiles || []), repairPlanFile, finalRepairPlanFile].filter(Boolean))],
    lastJobType: job.type,
    lastHistoryMessage: `Autoroute DRC iteration finished with ${finalDrc.issueCounts.errors} errors and ${finalDrc.issueCounts.warnings} warnings.`,
  }))
  const status = finalDrc.issueCounts.errors ? 'AUTOROUTE_DRC_ITERATION_NEEDS_FIX' : 'AUTOROUTE_DRC_ITERATION_COMPLETE_NEEDS_REVIEW'
  const generatedFiles = [...(applied.generatedFiles || []), reportFile, repairPlanFile, finalRepairPlanFile, finalDrc.reportFile, ...rerouteAttempts.map((item) => item.reportFile), ...(repairLoop?.iterations || []).map((item) => item.reportFile)].filter(Boolean)
  return result(job, status, [...applied.warnings, ...(finalDrc.issueCounts.warnings ? [{ severity: 'WARNING', code: 'DRC_WARNINGS', message: `${finalDrc.issueCounts.warnings} DRC warnings found after autoroute.` }] : [])], finalDrc.issueCounts.errors ? [{ severity: 'ERROR', code: 'DRC_ERRORS', message: `${finalDrc.issueCounts.errors} DRC errors found after autoroute.` }] : [], { applied, rerouteAttempts, repairLoop, repairPlan: finalRepairPlan, initialRepairPlan, latestRepairPlan, kicad: context.detected, report: finalDrc, generatedFiles, humanReviewRequired: true })
}

function adaptiveDrcRerouteRadius(requested, index) {
  const explicit = Number(requested)
  if (Number.isFinite(explicit) && explicit > 0) return explicit
  return [0.9, 0.55, 0.3][index] || 0.25
}

function mergeDrcRerouteConstraints(primary = {}, repairConstraints = {}, options = {}) {
  const radiusMm = Number(options.radiusMm || 0.6)
  const affectedNets = new Set([...(primary.affectedNets || []), ...(repairConstraints.affectedNets || [])].filter(Boolean))
  const forbidden = []
  for (const point of [...(primary.forbiddenPoints || []), ...(repairConstraints.forbiddenPoints || [])]) {
    if (!point || !Number.isFinite(Number(point.x)) || !Number.isFinite(Number(point.y))) continue
    forbidden.push({
      ...point,
      x: roundPad(point.x),
      y: roundPad(point.y),
      layer: point.layer || 'F.Cu',
      radiusMm: Number(point.radiusMm || radiusMm),
    })
    if (point.net) affectedNets.add(point.net)
  }
  const deduped = []
  const seen = new Set()
  for (const point of forbidden) {
    const key = `${point.net || '*'}:${point.layer || '*'}:${roundPad(point.x)}:${roundPad(point.y)}:${roundPad(point.radiusMm)}`
    if (seen.has(key)) continue
    seen.add(key)
    deduped.push(point)
  }
  return {
    status: affectedNets.size && deduped.length ? 'DRC_REROUTE_CONSTRAINTS_READY' : 'DRC_REROUTE_NO_CONSTRAINTS',
    affectedNets: [...affectedNets],
    forbiddenPoints: deduped,
    placementRefs: [...new Set(repairConstraints.placementRefs || [])],
    silkscreenRefs: [...new Set(repairConstraints.silkscreenRefs || [])],
    reasons: [...(primary.reasons || []), ...(repairConstraints.reasons || [])],
  }
}

function autorouteEvidenceFile(projectDir, job = {}) {
  const explicit = job.input?.autorouteEvidenceFile
  if (explicit) return resolveInsideWorkspace(projectDir, explicit)
  const id = String(job.id || '')
  if (/_drc_reroute_\d+$/i.test(id)) return path.join(projectDir, `boardforge-autoroute-plan-${sanitizeName(id).slice(0, 96)}.json`)
  return path.join(projectDir, 'boardforge-autoroute-plan.json')
}

function mergeRoutingPads(...groups) {
  const seen = new Set()
  const pads = []
  for (const pad of groups.flat()) {
    if (!pad || !Number.isFinite(Number(pad.x)) || !Number.isFinite(Number(pad.y))) continue
    const key = `${pad.ref || ''}:${pad.pad || pad.name || ''}:${pad.netName || pad.net || ''}:${roundPad(pad.x)}:${roundPad(pad.y)}`
    if (seen.has(key)) continue
    seen.add(key)
    pads.push({
      ...pad,
      x: Number(pad.x),
      y: Number(pad.y),
      widthMm: Number(pad.widthMm || pad.width || 0.6),
      heightMm: Number(pad.heightMm || pad.height || 0.6),
      netName: pad.netName || pad.net || null,
      pad: pad.pad || pad.name,
      name: pad.name || pad.pad,
      layers: pad.layers || ['F.Cu'],
      id: pad.id || `${pad.ref || 'REF'}:${pad.pad || pad.name || 'PAD'}`,
    })
  }
  return pads
}

function derivePadsFromComponents(components = []) {
  return components.flatMap((component) => {
    const pads = component.pads || component.footprint?.pads || component.resolvedFootprint?.pads || []
    if (!pads.length) return []
    return pads.map((pad) => {
      const transformed = transformPad(component, pad)
      return {
        ...pad,
        ...transformed,
        ref: component.ref,
        pad: pad.name || pad.pad,
        name: pad.name || pad.pad,
        id: `${component.ref}:${pad.name || pad.pad}`,
        netName: resolveComponentPadNet(component, pad.name || pad.pad),
        widthMm: Number(pad.widthMm || pad.width || 0.6),
        heightMm: Number(pad.heightMm || pad.height || 0.6),
      }
    }).filter((pad) => pad.netName)
  })
}

function transformPad(component = {}, pad = {}) {
  const rotation = Number(component.rotation || 0) * Math.PI / 180
  const localX = Number(pad.x || 0)
  const localY = Number(pad.y || 0)
  const cos = Math.cos(rotation)
  const sin = Math.sin(rotation)
  return {
    x: roundPad(Number(component.x || 0) + localX * cos - localY * sin),
    y: roundPad(Number(component.y || 0) + localX * sin + localY * cos),
    rotation: roundPad(Number(component.rotation || 0) + Number(pad.rotation || 0)),
  }
}

function resolveComponentPadNet(component = {}, padName = '') {
  const pinMap = component.pinMap || {}
  if (pinMap[padName]) return pinMap[padName]
  const aliases = {
    'D+': ['USB_DP', 'DP', 'A6', 'B6'],
    'D-': ['USB_DN', 'DN', 'A7', 'B7'],
    VBUS: ['VUSB', '5V', 'VBUS'],
    VCC: ['3V3', '5V', 'VCC', 'VDD'],
    GND: ['GND', 'PGND', 'AGND'],
  }
  const normalized = String(padName || '').toUpperCase()
  for (const [key, values] of Object.entries(aliases)) {
    if (normalized === key || values.includes(normalized)) {
      for (const candidate of [key, ...values]) if (pinMap[candidate]) return pinMap[candidate]
    }
  }
  const caseInsensitive = Object.entries(pinMap).find(([pin]) => String(pin).toUpperCase() === normalized)
  return caseInsensitive?.[1] || null
}

function roundPad(value) {
  return Math.round(Number(value || 0) * 1000) / 1000
}

async function applyRoutingPlanJob(job, workspace, profile) {
  const context = await getKiCadContext(job, workspace, 'pcb')
  if (context.blocked) return context.blocked
  const state = await readProjectState(context.files.projectDir)
  const board = job.input?.board || state?.board || boardFromJob(job)
  const components = job.input?.components || state?.components || []
  const nets = assignNetsToClasses(job.input?.nets || state?.requirements?.nets || [])
  const routingPlan = job.input?.routingPlan || generateRoutingPlan(nets, { ...job.input, layerCount: board.layerCount, board, components, profile })
  const projectNetSettings = !job.dryRun ? await ensureProjectNetSettings(context.files, profile, nets) : { status: 'PROJECT_NET_SETTINGS_DRY_RUN', changed: false }
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
  const output = await applyRoutingPlanToPcb({ pcbFile: context.files.pcbFile, board, routingPlan, components, pads: job.input?.pads || state?.routing?.pads || [] })
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
    kicadNetSettings: projectNetSettings,
    generatedFiles: [...new Set([...(current.generatedFiles || []), context.files.pcbFile, ...(projectNetSettings.changed ? [context.files.proFile] : [])].filter(Boolean))],
    lastJobType: job.type,
    lastHistoryMessage: `Applied ${output.generatedObjects.segments} segments, ${output.generatedObjects.vias} vias, and ${output.generatedObjects.zones} zones to PCB. DRC required.`,
  }))
  return result(job, output.status, [{ severity: 'WARNING', code: 'DRC_REQUIRED', message: 'Copper was written to KiCad PCB. Run run_kicad_drc before export or manufacturing.' }, ...routeValidation.warnings, ...routeQuality.warnings], [], { ...output, routeValidation, routeQuality, kicadNetSettings: projectNetSettings, generatedFiles: [...new Set([context.files.pcbFile, ...(projectNetSettings.changed ? [context.files.proFile] : [])].filter(Boolean))] })
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
  const state = await readProjectState(context.files.projectDir)
  const graphNets = await readSchematicGraphNetlist(context.files.projectDir)
  const projectNetSettings = await ensureProjectNetSettings(context.files, profileFromState(state, job), job.input?.nets || state?.netlist?.nets || graphNets || state?.schematicSynthesis?.nets || state?.requirements?.nets || [])
  const reportFile = path.join(context.files.projectDir, 'reports', 'drc.json')
  const output = await runDrc({ pcbFile: context.files.pcbFile, outputFile: reportFile, kicadCliPath: context.detected.path })
  await updateValidationState(context.files.projectDir, job.type, 'drc', output)
  return result(job, output.status, output.issueCounts.warnings ? [{ severity: 'WARNING', code: 'DRC_WARNINGS', message: `${output.issueCounts.warnings} DRC warnings found.` }] : [], output.issueCounts.errors ? [{ severity: 'ERROR', code: 'DRC_ERRORS', message: `${output.issueCounts.errors} DRC errors found.` }] : [], { kicad: context.detected, report: output, kicadNetSettings: projectNetSettings, generatedFiles: [...new Set([reportFile, ...(projectNetSettings.changed ? [context.files.proFile] : [])].filter(Boolean))], humanReviewRequired: true })
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
  if (output.status === 'BOM_FAILED' || output.status === 'BOM_EXPORTED' && !hasRows) {
    const fallback = await writePlacementBom(context.files.projectDir, outputFile)
    if (fallback.generated) {
      await updateExportState(context.files.projectDir, job.type, 'bom', { ...output, status: 'BOM_EXPORTED_FROM_PLACEMENT_NEEDS_REVIEW', placementFallback: fallback, files: [outputFile] })
      return result(job, 'BOM_EXPORTED_FROM_PLACEMENT_NEEDS_REVIEW', [{ severity: 'WARNING', code: fallback.source === 'schematic_model' ? 'BOM_FROM_SCHEMATIC_MODEL' : 'BOM_FROM_PLACEMENT', message: fallback.source === 'schematic_model' ? 'KiCad schematic BOM was unavailable or empty, so BoardForge generated a review-required BOM from the generated schematic model.' : 'KiCad schematic BOM was unavailable or empty, so BoardForge generated a review-required BOM from placed PCB components.' }], [], { kicad: context.detected, export: { ...output, placementFallback: fallback }, generatedFiles: [outputFile], humanReviewRequired: true })
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

async function backupFileWithSuffix(file, suffix) {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '_')
  const backupFile = `${file}.${suffix}_${stamp}.bak`
  await copyFile(file, backupFile)
  return backupFile
}

async function readDrcIssueCounts(reportFile) {
  try {
    const report = JSON.parse(await readFile(reportFile, 'utf8'))
    let errors = 0
    let warnings = 0
    let unconnectedItems = 0
    for (const violation of report.violations || []) {
      if (/error/i.test(violation.severity || '')) errors += 1
      else if (/warning/i.test(violation.severity || '')) warnings += 1
      if (/unconnected/i.test(`${violation.type || ''} ${violation.description || ''}`)) unconnectedItems += 1
    }
    for (const sheet of report.sheets || []) {
      for (const violation of sheet.violations || []) {
        if (/error/i.test(violation.severity || '')) errors += 1
        else if (/warning/i.test(violation.severity || '')) warnings += 1
        if (/unconnected/i.test(`${violation.type || ''} ${violation.description || ''}`)) unconnectedItems += 1
      }
    }
    return { errors, warnings, unconnectedItems }
  } catch {
    return null
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
  const schematicFallback = await writeSchematicModelBom(projectDir, outputFile)
  if (schematicFallback.generated) return schematicFallback
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

async function writeSchematicModelBom(projectDir, outputFile) {
  try {
    const raw = await readFile(path.join(projectDir, 'boardforge-schematic-model.json'), 'utf8')
    const schematicModel = JSON.parse(raw)
    const groups = new Map()
    for (const symbol of schematicModel.symbols || []) {
      if (symbol.dnp || symbol.onBoard === false) continue
      const key = `${symbol.value}|${symbol.footprint}|${symbol.lcsc || ''}|${symbol.mpn || ''}`
      const existing = groups.get(key) || { refs: [], value: symbol.value, footprint: symbol.footprint, lcsc: symbol.lcsc || '', mpn: symbol.mpn || '', qty: 0, dnp: '' }
      existing.refs.push(symbol.ref)
      existing.qty += 1
      groups.set(key, existing)
    }
    for (const component of await readComponentManifest(projectDir)) {
      if (!component.ref || [...groups.values()].some((group) => group.refs.includes(component.ref))) continue
      const key = `${component.value}|${component.footprint}|${component.lcsc || ''}|${component.mpn || ''}`
      const existing = groups.get(key) || { refs: [], value: component.value, footprint: component.footprint, lcsc: component.lcsc || '', mpn: component.mpn || '', qty: 0, dnp: '' }
      existing.refs.push(component.ref)
      existing.qty += 1
      groups.set(key, existing)
    }
    if (!groups.size) return { generated: false, error: 'Schematic model contains no BOM symbols.' }
    const lines = ['"Refs","Value","Footprint","Qty","DNP","LCSC","MPN","Source"']
    for (const group of groups.values()) {
      lines.push([group.refs.join(' '), group.value, group.footprint, String(group.qty), group.dnp, group.lcsc, group.mpn, 'BoardForge schematic model'].map((value) => `"${String(value).replace(/"/g, '""')}"`).join(','))
    }
    await mkdir(path.dirname(outputFile), { recursive: true })
    await writeFile(outputFile, `${lines.join('\n')}\n`, 'utf8')
    return { generated: true, rows: groups.size, source: 'schematic_model' }
  } catch (error) {
    return { generated: false, error: error.message }
  }
}

async function readComponentManifest(projectDir) {
  try {
    return JSON.parse(await readFile(path.join(projectDir, 'boardforge-components.json'), 'utf8'))
  } catch {
    return []
  }
}
