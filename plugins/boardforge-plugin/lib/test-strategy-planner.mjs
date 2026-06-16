export function planTestStrategy({ board = {}, components = [], nets = [], powerTree = null, pinAssignments = null, input = {} } = {}) {
  const normalizedNets = [...new Set((nets || []).map((net) => typeof net === 'string' ? net : net.name).filter(Boolean))]
  const requiredTestPoints = requiredTestPointsFor(normalizedNets, powerTree, input)
  const programming = programmingPlan(components, pinAssignments)
  const bringup = bringupSequence(requiredTestPoints, powerTree, normalizedNets)
  const fixture = fixturePlan(board, components, requiredTestPoints)
  const warnings = [
    ...(!programming.available ? [{ severity: 'WARNING', code: 'PROGRAMMING_ACCESS_NOT_CONFIRMED', message: 'Programming/debug header or pads were not confirmed.' }] : []),
    ...requiredTestPoints.filter((item) => item.required && !item.locationHint).map((item) => ({ severity: 'WARNING', code: 'TESTPOINT_LOCATION_NEEDS_PLACEMENT', message: `${item.net} test point needs a reviewed placement hint.`, net: item.net })),
  ]
  const errors = []
  if (!requiredTestPoints.some((item) => item.net === 'GND')) errors.push({ severity: 'ERROR', code: 'GROUND_TESTPOINT_MISSING', message: 'At least one GND test point is required for bring-up and fixture probing.' })
  const status = errors.length ? 'TEST_STRATEGY_BLOCKED' : warnings.length ? 'TEST_STRATEGY_NEEDS_REVIEW' : 'TEST_STRATEGY_READY_NEEDS_REVIEW'
  return {
    status,
    requiredTestPoints,
    programming,
    bringup,
    fixture,
    manufacturingNotes: [
      'Expose test pads on one side when possible for pogo fixture access.',
      'Keep high-voltage and battery test pads clearly separated and labelled.',
      'Do not place pogo pads inside antenna, thermal, or mounting keepouts.',
    ],
    warnings,
    errors,
    actions: recommendedActions({ errors, warnings, programming }),
    humanReviewRequired: true,
  }
}

function requiredTestPointsFor(nets, powerTree, input) {
  const rails = powerTree?.rails?.map((rail) => rail.name) || []
  const selected = new Set(['GND', ...rails, ...nets.filter((net) => /^(3V3|5V|VIN|VBAT|VUSB|POE_VDD|POE_RTN|EN|BOOT|NRST|RESET|SWDIO|SWCLK|USB_DP|USB_DN|I2C_SCL|I2C_SDA)$/i.test(net))])
  if (/factory|fixture|production|jlcpcb/i.test(JSON.stringify(input || {}))) selected.add('CURRENT_SENSE')
  return [...selected].map((net) => ({
    net,
    required: /^(GND|3V3|5V|VIN|VBAT|VUSB|POE_VDD|POE_RTN|EN|BOOT|NRST|RESET|SWDIO|SWCLK)$/i.test(net),
    padDiameterMm: /^(VBAT|VIN|POE_)/i.test(net) ? 1.2 : 0.9,
    clearanceMm: /^(VBAT|VIN|POE_)/i.test(net) ? 1.0 : 0.5,
    locationHint: locationHintFor(net),
    accessSide: 'F.Cu',
  }))
}

function programmingPlan(components, pinAssignments) {
  const debugComponent = components.find((component) => /(SWD|JTAG|PROGRAM|DEBUG)/i.test(`${component.group || ''} ${component.value || ''}`))
  const assigned = new Set(Object.values(pinAssignments?.controllerPinMap || {}))
  const hasSwd = debugComponent || (assigned.has('SWDIO') && assigned.has('SWCLK'))
  return {
    available: Boolean(hasSwd),
    method: debugComponent ? 'dedicated_header_or_pads' : hasSwd ? 'controller_pins_assigned_needs_physical_pads' : 'not_confirmed',
    requiredNets: ['3V3', 'GND', 'SWDIO', 'SWCLK', 'NRST'],
    bootControl: assigned.has('BOOT') || components.some((component) => /BOOT/i.test(`${component.value || ''} ${component.ref || ''}`)) ? 'boot net assigned' : 'boot access needs review',
    resetControl: assigned.has('EN') || assigned.has('NRST') ? 'reset net assigned' : 'reset access needs review',
  }
}

function bringupSequence(testPoints, powerTree, nets) {
  const railNames = powerTree?.rails?.map((rail) => rail.name) || nets.filter((net) => /^(3V3|5V|VIN|VBAT|VUSB|POE_VDD)$/i.test(net))
  return [
    { step: 1, name: 'visual inspection', checks: ['component polarity/orientation', 'solder bridges', 'connector alignment'] },
    { step: 2, name: 'unpowered resistance checks', checks: ['GND to rails resistance', 'USB shield/chassis strategy', 'no rail short'] },
    { step: 3, name: 'current-limited power', checks: railNames.map((rail) => `measure ${rail} at test point`) },
    { step: 4, name: 'programming/debug', checks: ['connect SWD/JTAG/UART', 'flash smoke firmware', 'confirm reset/boot'] },
    { step: 5, name: 'interface validation', checks: testPoints.filter((tp) => /USB|I2C|SPI|CAN|UART/.test(tp.net)).map((tp) => `probe ${tp.net}`) },
  ]
}

function fixturePlan(board, components, testPoints) {
  const componentSideOnly = components.filter((component) => component.side === 'B.Cu').length === 0
  return {
    recommended: testPoints.length >= 4 ? 'single-sided pogo fixture candidate' : 'manual bench bring-up candidate',
    accessSide: componentSideOnly ? 'F.Cu preferred' : 'review mixed-side access',
    minimumPogoPins: testPoints.filter((tp) => tp.required).length,
    boardSupport: (board.mountingHoles || []).length >= 2 ? 'use mounting holes for fixture location' : 'add tooling holes or board-edge locating features',
  }
}

function locationHintFor(net) {
  if (/^(VBAT|VIN|VUSB|POE_)/i.test(net)) return 'near power input/protection path'
  if (/^(3V3|5V)$/i.test(net)) return 'near regulator output and controller supply'
  if (/^(SWDIO|SWCLK|NRST|BOOT|EN)$/i.test(net)) return 'near debug/programming edge'
  if (/USB|I2C|SPI|CAN|UART/i.test(net)) return 'near interface source with probe clearance'
  if (net === 'GND') return 'multiple accessible locations, including near power input'
  return null
}

function recommendedActions({ errors, warnings, programming }) {
  const actions = []
  if (errors.length || warnings.some((warning) => warning.code === 'TESTPOINT_LOCATION_NEEDS_PLACEMENT')) actions.push({ command: 'generate_placement_plan', reason: 'Reserve physical space for test pads before routing.' })
  if (!programming.available) actions.push({ command: 'plan_pin_assignments', reason: 'Confirm debug/programming pins before schematic and PCB handoff.' })
  actions.push({ command: 'generate_design_constraints', reason: 'Persist test pads and fixture access as placement/routing constraints.' })
  return actions
}
