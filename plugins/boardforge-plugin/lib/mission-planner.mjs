import { planRequirements } from './requirements-planner.mjs'
import { buildCategoryPlan } from './board-categories.mjs'

export function planMissionRequirements(input = {}) {
  const text = normalize([input.prompt, input.notes, input.projectName, input.boardType].join(' '))
  const vehicle = inferVehicle(text, input)
  const mission = {
    vehicle,
    rangeMiles: numberBefore(text, /(?:mile|miles|mi)\b/) || input.rangeMiles || null,
    enduranceMinutes: numberBefore(text, /(?:minute|minutes|min|mins)\b/) || input.enduranceMinutes || null,
    payload: input.payload || inferPayload(text),
    environment: input.environment || inferEnvironment(text),
  }
  const decisions = decisionQuestions(mission, input)
  const categoryPlan = buildCategoryPlan(input)
  const architecture = architectureForMission(mission, text, input, categoryPlan)
  const boardSpecs = boardSpecsForMission(mission, architecture, input)
  const requirementsPlan = planRequirements({
    ...input,
    prompt: `${input.prompt || ''} ${architecture.requirementPrompt}`,
    interfaces: architecture.interfaces,
    templateId: architecture.templateId,
    projectName: input.projectName || architecture.projectName,
  })
  const feasibility = feasibilityForMission(mission, decisions)
  return {
    status: decisions.required.length ? 'MISSION_PLAN_NEEDS_USER_DECISIONS' : 'MISSION_PLAN_READY_NEEDS_REVIEW',
    mission,
    feasibility,
    decisions,
    architecture,
    categoryPlan,
    boardSpecs,
    requirementsPlan,
    controlledWorkflow: workflowForMission(architecture, input),
    assumptions: [
      'BoardForge designs electronics and KiCad outputs; airframe, propeller, motor, battery, RF compliance, and flight testing remain system-level engineering decisions.',
      ...(mission.vehicle.includes('drone') || mission.vehicle.includes('uav') ? ['Long-range UAV electronics must be validated against local radio, aviation, and safety regulations before flight.'] : []),
      `${categoryPlan.category.name} outputs are review-required until KiCad ERC/DRC and manufacturing gates pass.`,
      ...feasibility.assumptions,
    ],
    humanReviewRequired: true,
  }
}

function inferVehicle(text, input) {
  if (input.vehicle) return input.vehicle
  if (/fixed wing|plane|airplane/.test(text)) return 'fixed_wing_uav'
  if (/drone|quadcopter|quad|uav|flies|flight/.test(text)) return 'multirotor_drone'
  return 'embedded_hardware'
}

function inferPayload(text) {
  if (/camera|video|fpv/.test(text)) return 'camera_or_fpv'
  if (/sensor|mapping|lidar/.test(text)) return 'sensor_payload'
  return 'not_specified'
}

function inferEnvironment(text) {
  if (/outdoor|wind|rain|weather/.test(text)) return 'outdoor'
  return 'not_specified'
}

function decisionQuestions(mission, input) {
  const required = []
  if (!input.airframe && mission.vehicle === 'multirotor_drone') {
    required.push(question('airframe', 'Is this a multirotor, fixed-wing, VTOL, or just the flight-controller electronics?', 'Range/endurance drives battery, current sensing, connector sizing, and whether 15 miles is realistic.'))
  }
  if (!input.battery) {
    required.push(question('battery', 'What battery chemistry, cell count, and target capacity are you using?', 'The PCB power tree and current sensor sizing depend on pack voltage/current.'))
  }
  if (!input.motorEscSystem && /drone|uav|flight/.test(mission.vehicle)) {
    required.push(question('motorEscSystem', 'Are ESCs separate modules, a 4-in-1 ESC, or should BoardForge design ESC/power electronics too?', 'Flight controller boards are very different from high-current ESC or power-distribution boards.'))
  }
  if (!input.radioLink) {
    required.push(question('radioLink', 'What control/telemetry link should be supported: ELRS, SiK, LTE, LoRa, Wi-Fi, or external modem?', 'A 15-mile command/data link needs connector, power, UART/SPI, antenna keepout, and regulatory choices.'))
  }
  if (!input.gnss) {
    required.push(question('gnss', 'Do you need GPS/GNSS, compass, barometer, blackbox, and return-to-home support?', 'Long-range drones usually need navigation sensors and logging.'))
  }
  const optional = [
    question('size', 'Target board size and mounting pattern?', 'Placement, connector edges, and KiCad outline depend on mechanical constraints.'),
    question('manufacturer', 'Default to JLCPCB standard or use advanced HDI/assembly options?', 'This affects via policy, trace/space limits, BOM, CPL, and quote readiness.'),
  ]
  return { required, optional, count: required.length + optional.length }
}

function architectureForMission(mission, text, input, categoryPlan) {
  if (!mission.vehicle.includes('drone') && !mission.vehicle.includes('uav') && !/flight/.test(text)) {
    return architectureForCategory(categoryPlan, input)
  }
  const longRange = (mission.rangeMiles || 0) >= 5 || /long range|15 miles|telemetry|return to home/.test(text)
  const interfaces = ['USB', 'SPI', 'I2C', 'UART', ...(longRange ? ['GPS', 'Telemetry', 'CAN'] : [])]
  return {
    projectName: input.projectName || (longRange ? 'Long Range Drone Controller' : 'Drone Flight Controller'),
    templateId: 'DRONE_FC_30X30',
    architectureType: longRange ? 'long_range_uav_flight_controller' : 'flight_controller',
    requirementPrompt: [
      'drone flight controller with STM32 MCU, IMU, barometer, blackbox flash, USB-C, SWD, ESC connector, 3V3 regulator',
      longRange ? 'GNSS connector, telemetry UART, current/voltage sensing, buzzer, safety/arming input, external receiver, return-to-home support' : '',
    ].filter(Boolean).join(', '),
    interfaces,
    boardFamilies: [
      'flight_controller_logic_board',
      ...(input.includePowerDistribution ? ['power_distribution_board'] : []),
      ...(input.includeEscDesign ? ['esc_or_motor_driver_board'] : []),
    ],
    constraints: [
      'IMU near center of gravity and isolated from hot regulators',
      'Barometer away from prop wash and heat',
      'GNSS/telemetry connectors on accessible edges',
      'Antenna/RF regions require copper and via keepouts',
      'Battery/current sensing needs reviewed trace width and connector current rating',
    ],
  }
}

function architectureForCategory(categoryPlan, input) {
  const category = categoryPlan.category
  return {
    projectName: input.projectName || category.name,
    templateId: category.defaultPreset || null,
    architectureType: category.id,
    requirementPrompt: [
      category.name,
      category.expectedComponents.join(', '),
      category.interfaces.join(', '),
      ...(input.prompt ? [input.prompt] : []),
    ].join(', '),
    interfaces: category.interfaces,
    boardFamilies: [category.id],
    constraints: [
      ...category.placementPriorities,
      ...category.routingPriorities,
      ...category.mechanicalConstraints,
    ],
  }
}

function boardSpecsForMission(mission, architecture, input) {
  const layerCount = input.layerCount || ((mission.rangeMiles || 0) >= 5 ? 4 : 2)
  return {
    recommendedLayerCount: layerCount,
    targetCad: 'KiCad',
    manufacturer: input.manufacturer || 'JLCPCB',
    boardType: architecture.architectureType,
    outline: input.outline || (architecture.architectureType.includes('flight_controller') ? '30.5 x 30.5 mm flight-controller mounting unless user specifies another frame' : 'user-specified mechanical envelope required before final placement/routing'),
    requiredReports: ['ERC', 'DRC', 'BOM', 'CPL', 'Gerbers', 'drill files', 'JLCPCB package'],
    exportGate: 'Do not export manufacturing package until ERC/DRC reports and component bindings are acceptable.',
  }
}

function feasibilityForMission(mission, decisions) {
  const warnings = []
  if ((mission.rangeMiles || 0) >= 15 && mission.vehicle === 'multirotor_drone') warnings.push('15-mile multirotor range with 30-minute endurance is system-level hard; battery, airframe, prop efficiency, radio link, and regulation dominate the PCB design.')
  if ((mission.enduranceMinutes || 0) >= 30) warnings.push('30-minute endurance requires current budget and power-path review before board routing.')
  return {
    status: warnings.length || decisions.required.length ? 'FEASIBILITY_REVIEW_REQUIRED' : 'FEASIBILITY_READY_NEEDS_REVIEW',
    warnings,
    assumptions: warnings,
  }
}

function workflowForMission(architecture, input) {
  const projectPath = slug(input.projectName || architecture.projectName)
  return [
    { type: 'plan_mission_requirements', why: 'Convert user mission goal into decisions and electronics architecture.' },
    { type: 'plan_requirements', why: 'Turn architecture into components, nets, constraints, and assumptions.' },
    { type: 'plan_power_tree', why: 'Budget battery/input rails, regulators, current sensors, decoupling, and thermal risk.' },
    { type: 'plan_stackup', why: 'Choose layers, via policy, impedance/return path, and HDI gates.' },
    { type: 'create_kicad_project', why: 'Create local KiCad project with schematic/PCB scaffold.' },
    { type: 'sync_component_database', input: { projectPath }, why: 'Resolve symbols, footprints, 3D models, LCSC/MPN candidates.' },
    { type: 'plan_pin_assignments', input: { projectPath }, why: 'Assign MCU pins for IMU, barometer, GPS, receiver, telemetry, ESC, USB, SWD.' },
    { type: 'generate_schematic', input: { projectPath }, why: 'Write review-required KiCad schematic objects.' },
    { type: 'generate_kicad_rules', input: { projectPath }, why: 'Write net classes, keepouts, diff pairs, and route constraints.' },
    { type: 'apply_placement_plan', input: { projectPath }, why: 'Apply reviewed physical placement.' },
    { type: 'autoroute_drc_iteration', input: { projectPath }, why: 'Attempt controlled copper and immediately run KiCad DRC.' },
    { type: 'run_kicad_erc', input: { projectPath }, why: 'Run KiCad ERC before export.' },
    { type: 'generate_manufacturing_manifest', input: { projectPath }, why: 'Summarize readiness and blockers before JLCPCB files.' },
  ]
}

function question(id, prompt, why) {
  return { id, prompt, why, required: true }
}

function numberBefore(text, unitPattern) {
  const match = text.match(new RegExp(`(\\d+(?:\\.\\d+)?)\\s*${unitPattern.source}`))
  return match ? Number(match[1]) : null
}

function slug(name) {
  return String(name || 'boardforge-project').trim().replace(/[^a-zA-Z0-9-_ ]/g, '').replace(/\s+/g, '-').slice(0, 64).toLowerCase() || 'boardforge-project'
}

function normalize(value) {
  return String(value || '').toLowerCase()
}
