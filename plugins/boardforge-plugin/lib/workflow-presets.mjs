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
    ...(preset === 'drone_flight_controller' ? [step('plan_mission_requirements', base, 'Convert flight mission goals into user decisions, aircraft assumptions, electronics architecture, and board families.')] : []),
    step('plan_requirements', base, 'Convert user intent into components, nets, and assumptions.'),
    step('plan_power_tree', base, 'Budget input rails, regulators, decoupling, sequencing, and thermal constraints.'),
    step('plan_stackup', base, 'Select layer roles, via policy, impedance intent, and HDI gates.'),
    step('create_kicad_project', base, 'Create review-required KiCad project, schematic scaffold, PCB, and metadata.'),
    step('sync_component_database', { projectPath: slug(base.projectName) }, 'Enrich BOM parts with pin maps, LCSC/MPN, footprints, models, and alternates.'),
    step('generate_design_constraints', { projectPath: slug(base.projectName) }, 'Write reusable BoardForge placement/routing/manufacturing constraints.'),
    step('generate_kicad_rules', { projectPath: slug(base.projectName) }, 'Write KiCad custom rules from BoardForge net classes, diff pairs, and keepouts.'),
    step('synthesize_schematic_design', { projectPath: slug(base.projectName) }, 'Build the component, pin, power, support-passive, and net graph before writing KiCad schematic objects.'),
    step('generate_schematic', { projectPath: slug(base.projectName) }, 'Generate review-required schematic objects before ERC.'),
    step('validate_schematic_graph', { projectPath: slug(base.projectName) }, 'Validate graph-level schematic intent, power pins, support components, and differential-pair members before placement/routing.'),
    step('plan_pin_map_repairs', { projectPath: slug(base.projectName) }, 'Plan safe pin-map repairs for symbol/footprint/pin mismatches before netlist and PCB sync writes.'),
    step('validate_schematic_pcb_sync', { projectPath: slug(base.projectName) }, 'Check schematic labels, BoardForge netlist, PCB nets, and pad assignments stay synchronized.'),
    step('apply_schematic_pcb_sync', { projectPath: slug(base.projectName) }, 'Write review-required PCB net declarations and footprint pad-net assignments from the BoardForge netlist.'),
    step('validate_3d_model_coverage', { projectPath: slug(base.projectName) }, 'Check footprint 3D model coverage before visual/mechanical review.'),
    step('audit_bom_sourcing', { projectPath: slug(base.projectName) }, 'Check MPN/LCSC/JLCPCB sourcing readiness before BOM export.'),
    step('optimize_placement', { projectPath: slug(base.projectName), templateId: base.templateId }, 'Repair placement constraints before copper.'),
    step('apply_placement_plan', { projectPath: slug(base.projectName) }, 'Apply reviewed placement into KiCad PCB footprint coordinates.'),
    step('plan_fanout', { projectPath: slug(base.projectName) }, 'Plan package escape, via strategy, and routing preconditions before copper.'),
    step('calculate_power_routing', { projectPath: slug(base.projectName) }, 'Calculate current-driven trace widths, copper-pour need, and parallel-via requirements for power nets.'),
    step('select_via_strategy', { projectPath: slug(base.projectName) }, 'Select through/blind/buried/microvia policy per net using stackup and manufacturer rules.'),
    step('build_noise_map', { projectPath: slug(base.projectName) }, 'Build noisy/sensitive/antenna regions so routing can avoid bad coupling.'),
    step('plan_copper_pours', { projectPath: slug(base.projectName), manufacturerProfile: base.manufacturerProfile }, 'Plan ground/power copper pours and stitching vias with keepouts before route generation.'),
    step('check_routing_readiness', { projectPath: slug(base.projectName) }, 'Block copper until outline, placement, net classes, schematic graph, stackup, and routing prechecks are acceptable.'),
    step('generate_routing_plan', { projectPath: slug(base.projectName) }, 'Generate partial route plan with via/copper/keepout policy.'),
    step('autoroute_drc_iteration', { projectPath: slug(base.projectName) }, 'Attempt controlled autorouting and immediately run KiCad DRC.'),
    step('generate_routing_report', { projectPath: slug(base.projectName) }, 'Report routed/unrouted nets, blockers, diff-pair status, power route status, and next fixes.'),
    step('generate_project_review_report', { projectPath: slug(base.projectName) }, 'Create one review report combining schematic, placement, routing, power, via, noise, DFM, and manufacturing gates.'),
    step('run_dfm_checks', { projectPath: slug(base.projectName) }, 'Run board, placement, fanout, power, assembly, and fab DFM checks.'),
    step('run_project_preflight', { projectPath: slug(base.projectName) }, 'Aggregate scan, component, binding, netlist, and manufacturing gates.'),
    step('run_kicad_erc', { projectPath: slug(base.projectName) }, 'Run local KiCad ERC.'),
    step('plan_erc_repairs', { projectPath: slug(base.projectName) }, 'Classify ERC blockers and propose reviewed schematic repairs.'),
    step('run_kicad_drc', { projectPath: slug(base.projectName) }, 'Run local KiCad DRC.'),
    step('plan_drc_repairs', { projectPath: slug(base.projectName) }, 'Classify DRC blockers and propose safe geometry repairs.'),
    step('generate_manufacturing_manifest', { projectPath: slug(base.projectName) }, 'Create final handoff manifest before exports.'),
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
