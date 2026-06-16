export function buildWorkflowPreset(input = {}) {
  const preset = input.preset || inferPreset(input)
  const base = {
    projectName: input.projectName || presetName(preset),
    templateId: input.templateId || templateForPreset(preset),
    manufacturerProfile: input.manufacturerProfile || 'JLCPCB_STANDARD',
    layerCount: input.layerCount || (preset.includes('poe') ? 4 : 2),
    prompt: input.prompt || promptForPreset(preset),
    interfaces: input.interfaces || interfacesForPreset(preset),
  }
  const steps = [
    step('plan_requirements', base, 'Convert user intent into components, nets, and assumptions.'),
    step('plan_stackup', base, 'Select layer roles, via policy, impedance intent, and HDI gates.'),
    step('create_kicad_project', base, 'Create review-required KiCad project, schematic scaffold, PCB, and metadata.'),
    step('sync_component_database', { projectPath: slug(base.projectName) }, 'Enrich BOM parts with pin maps, LCSC/MPN, footprints, models, and alternates.'),
    step('generate_design_constraints', { projectPath: slug(base.projectName) }, 'Write reusable BoardForge placement/routing/manufacturing constraints.'),
    step('generate_schematic', { projectPath: slug(base.projectName) }, 'Generate review-required schematic objects before ERC.'),
    step('optimize_placement', { projectPath: slug(base.projectName), templateId: base.templateId }, 'Repair placement constraints before copper.'),
    step('apply_placement_plan', { projectPath: slug(base.projectName) }, 'Apply reviewed placement into KiCad PCB footprint coordinates.'),
    step('generate_routing_plan', { projectPath: slug(base.projectName) }, 'Generate partial route plan with via/copper/keepout policy.'),
    step('run_project_preflight', { projectPath: slug(base.projectName) }, 'Aggregate scan, component, binding, netlist, and manufacturing gates.'),
    step('run_kicad_erc', { projectPath: slug(base.projectName) }, 'Run local KiCad ERC.'),
    step('run_kicad_drc', { projectPath: slug(base.projectName) }, 'Run local KiCad DRC.'),
    step('generate_manufacturing_manifest', { projectPath: slug(base.projectName) }, 'Create final handoff manifest before exports.'),
  ]
  return {
    status: 'WORKFLOW_PRESET_READY_NEEDS_REVIEW',
    preset,
    projectPath: slug(base.projectName),
    baseInput: base,
    steps,
    exportStepsAfterValidation: [
      step('export_gerbers', { projectPath: slug(base.projectName) }, 'Export only after DRC/ERC are acceptable.'),
      step('export_drill_files', { projectPath: slug(base.projectName) }, 'Export drill files after DRC/ERC.'),
      step('export_bom', { projectPath: slug(base.projectName) }, 'Export BOM after schematic/component review.'),
      step('export_cpl', { projectPath: slug(base.projectName) }, 'Export CPL after placement review.'),
      step('package_jlcpcb', { projectPath: slug(base.projectName) }, 'Package only when required artifacts exist and gates pass.'),
    ],
    safety: ['All writes stay inside workspace.', 'Exports remain blocked until validation artifacts exist.', 'Human review required before manufacturing.'],
    humanReviewRequired: true,
  }
}

function step(type, input, why) {
  return { type, input, why, dryRunRecommended: ['export_gerbers', 'export_drill_files', 'export_bom', 'export_cpl', 'package_jlcpcb'].includes(type) }
}

function inferPreset(input) {
  const text = `${input.projectName || ''} ${input.prompt || ''} ${input.templateId || ''}`.toLowerCase()
  if (/poe|ethernet/.test(text)) return 'poe_esp32_sensor'
  if (/drone|flight|esc/.test(text)) return 'drone_flight_controller'
  return 'esp32_sensor'
}

function templateForPreset(preset) {
  if (preset === 'poe_esp32_sensor') return 'ESP32_S3_POE_SENSOR'
  if (preset === 'drone_flight_controller') return 'DRONE_FC_30X30'
  return 'ESP32_S3_SENSOR'
}

function promptForPreset(preset) {
  if (preset === 'poe_esp32_sensor') return 'ESP32-S3 PoE Ethernet environmental sensor with USB-C debug, I2C sensor connector, SWD, 3V3 regulation, RJ45 edge placement, and manufacturing review gates.'
  if (preset === 'drone_flight_controller') return 'Compact drone flight controller with STM32 MCU, IMU, blackbox flash, USB-C, ESC connector, 3V3 regulator, vibration-sensitive sensor placement, and compact routing.'
  return 'ESP32-S3 USB-C environmental sensor board with I2C sensor connector, SWD, 3V3 regulator, mounting holes, and review-required KiCad outputs.'
}

function interfacesForPreset(preset) {
  if (preset === 'poe_esp32_sensor') return ['USB', 'Ethernet', 'I2C', 'SWD']
  if (preset === 'drone_flight_controller') return ['USB', 'SPI', 'I2C', 'UART']
  return ['USB', 'I2C', 'SWD']
}

function presetName(preset) {
  return preset.replace(/_/g, ' ')
}

function slug(name) {
  return String(name || 'boardforge-project').trim().replace(/[^a-zA-Z0-9-_ ]/g, '').replace(/\s+/g, '-').slice(0, 64).toLowerCase() || 'boardforge-project'
}
