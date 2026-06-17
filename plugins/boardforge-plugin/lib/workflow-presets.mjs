import { buildCategoryPlan } from './board-categories.mjs'

export function buildWorkflowPreset(input = {}) {
  const preset = input.preset || inferPreset(input)
  const categoryPlan = buildCategoryPlan({ ...input, preset })
  const base = {
    projectName: input.projectName || presetName(preset),
    templateId: input.templateId || templateForPreset(preset),
    manufacturerProfile: input.manufacturerProfile || 'JLCPCB_STANDARD',
    layerCount: input.layerCount || (preset.includes('poe') ? 4 : 2),
    prompt: input.prompt || promptForPreset(preset),
    interfaces: input.interfaces || interfacesForPreset(preset),
    stackup: input.stackup || 'standard manufacturer stackup selected during plan_stackup',
  }
  const steps = [
    step('plan_board_category', base, 'Infer the universal PCB category, required decisions, net classes, placement priorities, and routing priorities.'),
    step('classify_board_architecture', base, 'Classify high-speed, RF, power, industrial, sensor, compact, or general embedded architecture controls.'),
    ...(preset === 'drone_flight_controller' ? [step('plan_mission_requirements', base, 'Convert flight mission goals into user decisions, aircraft assumptions, electronics architecture, and board families.')] : []),
    step('ingest_reference_design', base, 'Extract interfaces, support circuits, numeric constraints, and layout-guide assumptions from prompt/reference text.'),
    step('plan_requirements', base, 'Convert user intent into components, nets, and assumptions.'),
    step('plan_power_tree', base, 'Budget input rails, regulators, decoupling, sequencing, and thermal constraints.'),
    step('plan_stackup', base, 'Select layer roles, via policy, impedance intent, and HDI gates.'),
    step('plan_hdi_manufacturing_strategy', base, 'Plan layer count, density, blind/buried/microvia approvals, and manufacturer quote gates.'),
    step('create_kicad_project', base, 'Create review-required KiCad project, schematic scaffold, PCB, and metadata.'),
    step('synthesize_circuit_blocks', { projectPath: slug(base.projectName), prompt: base.prompt }, 'Convert reference requirements into reviewable schematic circuit blocks and net intent.'),
    step('sync_component_database', { projectPath: slug(base.projectName) }, 'Enrich BOM parts with pin maps, LCSC/MPN, footprints, models, and alternates.'),
    step('generate_design_constraints', { projectPath: slug(base.projectName) }, 'Write reusable BoardForge placement/routing/manufacturing constraints.'),
    step('generate_kicad_rules', { projectPath: slug(base.projectName) }, 'Write KiCad custom rules from BoardForge net classes, diff pairs, and keepouts.'),
    step('synthesize_schematic_design', { projectPath: slug(base.projectName) }, 'Build the component, pin, power, support-passive, and net graph before writing KiCad schematic objects.'),
    step('generate_schematic', { projectPath: slug(base.projectName) }, 'Generate review-required schematic objects before ERC.'),
    step('build_canonical_net_model', { projectPath: slug(base.projectName) }, 'Build the authoritative component/net/pin model that schematic, PCB, BOM, CPL, and routing must follow.'),
    step('validate_schematic_graph', { projectPath: slug(base.projectName) }, 'Validate graph-level schematic intent, power pins, support components, and differential-pair members before placement/routing.'),
    step('plan_pin_map_repairs', { projectPath: slug(base.projectName) }, 'Plan safe pin-map repairs for symbol/footprint/pin mismatches before netlist and PCB sync writes.'),
    step('validate_schematic_pcb_sync', { projectPath: slug(base.projectName) }, 'Check schematic labels, BoardForge netlist, PCB nets, and pad assignments stay synchronized.'),
    step('apply_schematic_pcb_sync', { projectPath: slug(base.projectName) }, 'Write review-required PCB net declarations and footprint pad-net assignments from the BoardForge netlist.'),
    step('audit_asset_resolution', { projectPath: slug(base.projectName) }, 'Block missing symbols/footprints and warn on missing 3D models before physical review.'),
    step('validate_3d_model_coverage', { projectPath: slug(base.projectName) }, 'Check footprint 3D model coverage before visual/mechanical review.'),
    step('audit_bom_sourcing', { projectPath: slug(base.projectName) }, 'Check MPN/LCSC/JLCPCB sourcing readiness before BOM export.'),
    step('generate_engineering_questions', { projectPath: slug(base.projectName), prompt: base.prompt }, 'Return remaining engineering decisions before the design claims completeness.'),
    step('optimize_placement', { projectPath: slug(base.projectName), templateId: base.templateId }, 'Repair placement constraints before copper.'),
    step('solve_placement', { projectPath: slug(base.projectName), templateId: base.templateId }, 'Solve initial placement from board, component roles, edge connectors, power, and passives.'),
    step('apply_placement_plan', { projectPath: slug(base.projectName) }, 'Apply reviewed placement into KiCad PCB footprint coordinates.'),
    step('audit_placement_legality', { projectPath: slug(base.projectName) }, 'Block off-board, overlap, connector-edge, hot/RF, and clearance issues before routing.'),
    step('plan_escape_routing', { projectPath: slug(base.projectName) }, 'Plan dense component escape strategy before fanout/routing.'),
    step('plan_fanout', { projectPath: slug(base.projectName) }, 'Plan package escape, via strategy, and routing preconditions before copper.'),
    step('calculate_power_routing', { projectPath: slug(base.projectName) }, 'Calculate current-driven trace widths, copper-pour need, and parallel-via requirements for power nets.'),
    step('validate_power_integrity', { projectPath: slug(base.projectName) }, 'Validate rails, decoupling, reference nets, and pour requirements before copper.'),
    step('select_via_strategy', { projectPath: slug(base.projectName) }, 'Select through/blind/buried/microvia policy per net using stackup and manufacturer rules.'),
    step('build_noise_map', { projectPath: slug(base.projectName) }, 'Build noisy/sensitive/antenna regions so routing can avoid bad coupling.'),
    step('plan_copper_pours', { projectPath: slug(base.projectName), manufacturerProfile: base.manufacturerProfile }, 'Plan ground/power copper pours and stitching vias with keepouts before route generation.'),
    step('compile_routing_execution_strategy', { projectPath: slug(base.projectName) }, 'Order escape routing, critical nets, power copper, signal completion, DRC loops, and release proof.'),
    step('analyze_routing_congestion', { projectPath: slug(base.projectName) }, 'Map routing channel congestion before autorouting and layer decisions.'),
    step('check_routing_readiness', { projectPath: slug(base.projectName) }, 'Block copper until outline, placement, net classes, schematic graph, stackup, and routing prechecks are acceptable.'),
    step('generate_routing_plan', { projectPath: slug(base.projectName) }, 'Generate partial route plan with via/copper/keepout policy.'),
    step('plan_diff_pair_tuning', { projectPath: slug(base.projectName) }, 'Plan length/spacing tuning for USB, Ethernet, CAN, RF, and other critical pairs.'),
    step('audit_return_path_integrity', { projectPath: slug(base.projectName) }, 'Audit ground reference, split/keepout crossings, sensitive-net via policy, and return-via requirements.'),
    step('autoroute_drc_iteration', { projectPath: slug(base.projectName) }, 'Attempt controlled autorouting and immediately run KiCad DRC.'),
    step('plan_autoroute_repair_loop', { projectPath: slug(base.projectName) }, 'Plan the next controlled DRC/routing repair iterations from KiCad reports.'),
    step('generate_routing_report', { projectPath: slug(base.projectName) }, 'Report routed/unrouted nets, blockers, diff-pair status, power route status, and next fixes.'),
    step('analyze_thermal_bottlenecks', { projectPath: slug(base.projectName) }, 'Check hot parts, current paths, and copper/edge constraints.'),
    step('audit_creepage_clearance', { projectPath: slug(base.projectName) }, 'Audit isolation, high-voltage, PoE, surge, creepage, clearance, and field-connector rules.'),
    step('validate_assembly_orientation', { projectPath: slug(base.projectName) }, 'Check pin-1, polarity, CPL orientation, and placement rotation risks.'),
    step('plan_bringup_reliability_matrix', { projectPath: slug(base.projectName) }, 'Create rail, interface, thermal, ESD/surge, fixture, and production bring-up checks.'),
    step('estimate_board_cost', { projectPath: slug(base.projectName) }, 'Estimate cost drivers before the user commits to fab/assembly.'),
    step('generate_project_review_report', { projectPath: slug(base.projectName) }, 'Create one review report combining schematic, placement, routing, power, via, noise, DFM, and manufacturing gates.'),
    step('run_dfm_checks', { projectPath: slug(base.projectName) }, 'Run board, placement, fanout, power, assembly, and fab DFM checks.'),
    step('run_project_preflight', { projectPath: slug(base.projectName) }, 'Aggregate scan, component, binding, netlist, and manufacturing gates.'),
    step('run_kicad_erc', { projectPath: slug(base.projectName) }, 'Run local KiCad ERC.'),
    step('plan_erc_repairs', { projectPath: slug(base.projectName) }, 'Classify ERC blockers and propose reviewed schematic repairs.'),
    step('run_kicad_drc', { projectPath: slug(base.projectName) }, 'Run local KiCad DRC.'),
    step('plan_drc_repairs', { projectPath: slug(base.projectName) }, 'Classify DRC blockers and propose safe geometry repairs.'),
    step('generate_manufacturing_manifest', { projectPath: slug(base.projectName) }, 'Create final handoff manifest before exports.'),
    step('audit_release_export_gates', { projectPath: slug(base.projectName) }, 'Check all 25 production gates before export or package claims.'),
    step('run_production_readiness_suite', { projectPath: slug(base.projectName) }, 'Run canonical net, asset, placement, routing strategy, and release gate audits together.'),
    step('run_advanced_board_suite', { projectPath: slug(base.projectName) }, 'Run architecture, HDI, return-path, creepage, and bring-up reliability audits together.'),
    step('score_production_readiness', { projectPath: slug(base.projectName) }, 'Score all known engineering gates before release/export.'),
    step('build_release_gate_report', { projectPath: slug(base.projectName) }, 'Build the final release gate report and missing-artifact list.'),
    step('build_verified_demo_recipe', { projectPath: slug(base.projectName), preset }, 'Emit a repeatable demo recipe with pass criteria for local verification.'),
    step('plan_production_pipeline', { projectPath: slug(base.projectName), preset }, 'Create the full controlled production pipeline plan for this board class.'),
  ]
  return {
    status: 'WORKFLOW_PRESET_READY_NEEDS_REVIEW',
    preset,
    categoryPlan,
    projectPath: slug(base.projectName),
    baseInput: base,
    steps,
    exportStepsAfterValidation: [
      step('export_gerbers', { projectPath: slug(base.projectName) }, 'Export only after DRC/ERC are acceptable.'),
      step('export_drill_files', { projectPath: slug(base.projectName) }, 'Export drill files after DRC/ERC.'),
      step('export_bom', { projectPath: slug(base.projectName) }, 'Export BOM after schematic/component review.'),
      step('export_cpl', { projectPath: slug(base.projectName) }, 'Export CPL after placement review.'),
      step('validate_jlcpcb_package', { projectPath: slug(base.projectName) }, 'Validate Gerbers, drill, BOM, CPL, DRC/ERC reports, and assembly refs before package/order.'),
      step('package_jlcpcb', { projectPath: slug(base.projectName) }, 'Package only when required artifacts exist and gates pass.'),
    ],
    safety: ['All writes stay inside workspace.', 'Exports remain blocked until validation artifacts exist.', 'Human review required before manufacturing.'],
    humanReviewRequired: true,
  }
}

function step(type, input, why) {
  return { type, input, why, dryRunRecommended: ['export_gerbers', 'export_drill_files', 'export_bom', 'export_cpl', 'validate_jlcpcb_package', 'package_jlcpcb'].includes(type) }
}

function inferPreset(input) {
  const text = `${input.projectName || ''} ${input.prompt || ''} ${input.templateId || ''}`.toLowerCase()
  if (/poe|ethernet/.test(text)) return 'poe_esp32_sensor'
  if (/motor controller|esc|inverter|gate driver|mosfet|bldc|foc/.test(text)) return 'motor_controller'
  if (/bms|battery charger|charge controller/.test(text)) return 'battery_charger_bms'
  if (/industrial|relay|terminal block|rs485|isolat/.test(text)) return 'industrial_io'
  if (/compute module|carrier|cm4|sodimm|mipi|pcie|hdmi/.test(text)) return 'compute_module_carrier'
  if (/usb|type-c|type c/.test(text)) return 'usb_device'
  if (/drone|flight|esc/.test(text)) return 'drone_flight_controller'
  return 'esp32_sensor'
}

function templateForPreset(preset) {
  if (preset === 'poe_esp32_sensor') return 'ESP32_S3_POE_SENSOR'
  if (preset === 'drone_flight_controller') return 'DRONE_FC_30X30'
  if (preset === 'usb_device') return 'ESP32_S3_SENSOR'
  return 'ESP32_S3_SENSOR'
}

function promptForPreset(preset) {
  if (preset === 'motor_controller') return 'Motor controller / ESC concept with MCU, gate driver, MOSFET power stage, shunts, current sensing, DC bus input, motor phase outputs, thermal copper, high-current routing constraints, and DRC-required KiCad output.'
  if (preset === 'battery_charger_bms') return 'Battery charger / BMS concept with charger IC, protection FETs, current sense, thermistor, battery connector, regulated rails, thermal/high-current constraints, and manufacturing review gates.'
  if (preset === 'industrial_io') return 'Industrial I/O controller with terminal blocks, isolated inputs/outputs, surge protection, RS485/CAN option, regulated logic rails, isolation boundary, and wide-clearance manufacturing rules.'
  if (preset === 'compute_module_carrier') return 'Compute module carrier with locked module connector, power sequencing, USB, Ethernet, MIPI/PCIe placeholders, high-speed routing intent, and human SI/PI review gates.'
  if (preset === 'usb_device') return 'USB-C device board with MCU, ESD protection, regulator, oscillator, SWD/debug, short USB differential pair routing, and KiCad ERC/DRC gates.'
  if (preset === 'poe_esp32_sensor') return 'ESP32-S3 PoE Ethernet environmental sensor with USB-C debug, I2C sensor connector, SWD, 3V3 regulation, RJ45 edge placement, and manufacturing review gates.'
  if (preset === 'drone_flight_controller') return 'Long-range drone flight controller with STM32 MCU, IMU, barometer, blackbox flash, USB-C, GPS/GNSS connector, receiver/telemetry UART, ESC connector, voltage/current sensing, 3V3 regulator, vibration-sensitive sensor placement, and compact routing.'
  return 'ESP32-S3 USB-C environmental sensor board with I2C sensor connector, SWD, 3V3 regulator, mounting holes, and review-required KiCad outputs.'
}

function interfacesForPreset(preset) {
  if (preset === 'motor_controller') return ['PWM', 'CAN', 'current sense', 'motor phase']
  if (preset === 'battery_charger_bms') return ['battery', 'I2C', 'temperature sense']
  if (preset === 'industrial_io') return ['RS485', 'CAN', 'digital input', 'relay output']
  if (preset === 'compute_module_carrier') return ['USB', 'Ethernet', 'MIPI', 'PCIe', 'power sequencing']
  if (preset === 'usb_device') return ['USB', 'SWD']
  if (preset === 'poe_esp32_sensor') return ['USB', 'Ethernet', 'I2C', 'SWD']
  if (preset === 'drone_flight_controller') return ['USB', 'SPI', 'I2C', 'UART', 'GPS', 'Telemetry', 'CAN']
  return ['USB', 'I2C', 'SWD']
}

function presetName(preset) {
  return preset.replace(/_/g, ' ')
}

function slug(name) {
  return String(name || 'boardforge-project').trim().replace(/[^a-zA-Z0-9-_ ]/g, '').replace(/\s+/g, '-').slice(0, 64).toLowerCase() || 'boardforge-project'
}
