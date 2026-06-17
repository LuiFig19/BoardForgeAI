import { planMissionRequirements } from './mission-planner.mjs'
import { planRequirements } from './requirements-planner.mjs'

const groupRules = [
  ['MCU', /stm32|esp32|rp2040|mcu|microcontroller|processor/i],
  ['IMU', /imu|icm-|mpu-|bmi|lsm6|gyro|accelerometer/i],
  ['BAROMETER', /baro|bmp280|bme280|pressure/i],
  ['BLACKBOX', /flash|w25q|memory|blackbox/i],
  ['USB', /usb|type-c|usb-c/i],
  ['GNSS', /gps|gnss|ublox|u-blox|m10|m8/i],
  ['RECEIVER', /receiver|elrs|crsf|rc input|sb[u]?s/i],
  ['TELEMETRY', /telemetry|sik|lora|modem|radio/i],
  ['CURRENT_SENSOR', /current|ina|hall|shunt|power monitor/i],
  ['REGULATOR', /regulator|buck|ldo|dc-dc|bec/i],
  ['ESC_CONNECTOR', /esc|motor signal|4-in-1/i],
  ['SWD', /swd|jtag|debug|program/i],
  ['BUZZER', /buzzer|lost model/i],
  ['SENSOR_CONNECTOR', /sensor|i2c|qwiic|stemma/i],
  ['RES', /\b(res|resistor|ohm|kΩ|kohm)\b/i],
  ['CAP', /\b(cap|capacitor|uf|nf|pf)\b/i],
  ['INDUCTOR', /inductor|ferrite|bead|uh/i],
  ['POWER_INPUT', /battery|xt30|xt60|power input|vbat|terminal/i],
]

const missionFunctions = {
  long_range_uav_support: [
    ['MCU', 'flight controller MCU'],
    ['IMU', 'motion sensing'],
    ['BAROMETER', 'altitude sensing'],
    ['BLACKBOX', 'flight log storage'],
    ['GNSS', 'long-range navigation / return-to-home'],
    ['RECEIVER', 'control receiver'],
    ['TELEMETRY', 'long-range telemetry'],
    ['CURRENT_SENSOR', 'battery current and voltage sensing'],
    ['REGULATOR', 'regulated rails'],
    ['ESC_CONNECTOR', 'ESC/motor signal handoff'],
    ['USB', 'configuration/debug'],
  ],
  drone_fc_core: [
    ['MCU', 'flight controller MCU'],
    ['IMU', 'motion sensing'],
    ['ESC_CONNECTOR', 'ESC/motor signal handoff'],
    ['REGULATOR', 'regulated rails'],
  ],
}

export function intakeUserBom(input = {}) {
  const rows = parseBomInput(input)
  const components = rows.map((row, index) => normalizeBomRow(row, index))
  const nets = [...new Set(components.flatMap((component) => Object.values(component.pinMap || {}).filter(Boolean)))].map((name) => ({ name }))
  const warnings = []
  if (!components.length) warnings.push(issue('WARNING', 'USER_BOM_EMPTY', 'No parts were parsed from the supplied BOM.'))
  for (const component of components.filter((item) => item.group === 'UNKNOWN')) warnings.push(issue('WARNING', 'USER_BOM_PART_UNCLASSIFIED', `${component.ref} could not be classified.`, { component }))
  return {
    status: warnings.length ? 'USER_BOM_PARSED_NEEDS_REVIEW' : 'USER_BOM_PARSED',
    source: input.bomFile ? 'file' : input.bomText ? 'text' : Array.isArray(input.parts) ? 'parts' : 'components',
    components,
    nets,
    warnings,
    errors: [],
    humanReviewRequired: true,
  }
}

export function auditUserBom(input = {}) {
  const intake = input.intake || intakeUserBom(input)
  const missionPlan = input.missionPlan || planMissionRequirements(input)
  const requirementsPlan = input.requirementsPlan || missionPlan.requirementsPlan || planRequirements(input)
  const components = intake.components || []
  const normalizedGroups = new Set(components.map((component) => component.group))
  const requiredFunctions = requiredFunctionsFor(requirementsPlan, missionPlan)
  const gaps = requiredFunctions
    .filter(([group]) => !normalizedGroups.has(group))
    .map(([group, purpose]) => ({ group, purpose, severity: group === 'GNSS' || group === 'CURRENT_SENSOR' ? 'ERROR' : 'WARNING' }))
  const compatibility = components.map((component) => auditComponent(component, missionPlan))
  const powerBudget = estimatePowerBudget(components, input, missionPlan)
  const substitutions = components.filter((component) => needsSubstitution(component)).map((component) => ({
    ref: component.ref,
    reason: substitutionReason(component),
    preferredGroup: component.group,
    action: 'resolve_component_assets or replace with JLCPCB-available equivalent before schematic freeze',
  }))
  const questions = clarificationQuestions({ missionPlan, gaps, compatibility, powerBudget, input })
  const errors = [
    ...gaps.filter((gap) => gap.severity === 'ERROR').map((gap) => issue('ERROR', 'USER_BOM_MISSION_FUNCTION_MISSING', `User BOM is missing ${gap.purpose}.`, gap)),
    ...compatibility.flatMap((item) => item.errors),
    ...powerBudget.errors,
  ]
  const warnings = [
    ...intake.warnings,
    ...gaps.filter((gap) => gap.severity !== 'ERROR').map((gap) => issue('WARNING', 'USER_BOM_MISSION_FUNCTION_REVIEW', `User BOM may need ${gap.purpose}.`, gap)),
    ...compatibility.flatMap((item) => item.warnings),
    ...powerBudget.warnings,
  ]
  return {
    status: errors.length ? 'USER_BOM_AUDIT_NEEDS_FIX' : warnings.length || questions.length ? 'USER_BOM_AUDIT_NEEDS_REVIEW' : 'USER_BOM_AUDIT_READY_NEEDS_REVIEW',
    intake,
    missionPlan,
    requirementsPlan,
    components,
    missingFunctions: gaps,
    compatibility,
    powerBudget,
    substitutions,
    questions,
    workflow: userBomWorkflow(input),
    warnings,
    errors,
    humanReviewRequired: true,
  }
}

function parseBomInput(input) {
  if (Array.isArray(input.components)) return input.components
  if (Array.isArray(input.parts)) return input.parts
  if (input.bomText) return parseDelimited(input.bomText)
  return []
}

function parseDelimited(text) {
  const lines = String(text || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  if (!lines.length) return []
  const delimiter = lines[0].includes('\t') ? '\t' : ','
  const first = splitLine(lines[0], delimiter)
  const hasHeader = first.some((cell) => /ref|designator|mpn|part|value|qty|package|lcsc/i.test(cell))
  const header = hasHeader ? first.map(headerKey) : []
  return lines.slice(hasHeader ? 1 : 0).map((line, index) => {
    const cells = splitLine(line, delimiter)
    if (hasHeader) return Object.fromEntries(header.map((key, cellIndex) => [key, cells[cellIndex] || '']))
    return { ref: `U${index + 1}`, value: cells[0], mpn: cells[1] || '', package: cells[2] || '', quantity: Number(cells[3] || 1) }
  })
}

function splitLine(line, delimiter) {
  const cells = []
  let current = ''
  let quoted = false
  for (const char of String(line || '')) {
    if (char === '"') quoted = !quoted
    else if (char === delimiter && !quoted) {
      cells.push(current.trim())
      current = ''
    } else current += char
  }
  cells.push(current.trim())
  return cells
}

function normalizeBomRow(row, index) {
  const ref = row.ref || row.refs || row.designator || row.reference || inferRef(row, index)
  const value = row.value || row.part || row.name || row.description || row.mpn || row.MPN || ''
  const mpn = row.mpn || row.MPN || row.manufacturerPartNumber || ''
  const lcsc = row.lcsc || row.LCSC || ''
  const group = row.group || inferGroup(`${ref} ${value} ${mpn}`)
  return {
    ...row,
    ref,
    group,
    value: value || group,
    mpn: mpn || null,
    lcsc: lcsc || null,
    package: row.package || row.footprintPackage || row.Package || null,
    quantity: Number(row.quantity || row.qty || 1),
    voltageRatingV: numberField(row.voltageRatingV || row.voltage || row.vmax),
    currentRatingA: numberField(row.currentRatingA || row.current || row.imax),
    pinMap: Object.keys(row.pinMap || {}).length ? row.pinMap : defaultPinMapFor(group),
    source: 'user_bom',
  }
}

function auditComponent(component, missionPlan) {
  const warnings = []
  const errors = []
  if (!component.mpn && !component.lcsc) warnings.push(issue('WARNING', 'USER_BOM_PART_NO_SUPPLIER_ID', `${component.ref} has no MPN or LCSC supplier id.`, { ref: component.ref }))
  if (!component.package && !component.footprint) warnings.push(issue('WARNING', 'USER_BOM_PACKAGE_MISSING', `${component.ref} needs a package/footprint before KiCad placement.`, { ref: component.ref }))
  if (requiresPower(component.group) && !hasPowerPin(component)) warnings.push(issue('WARNING', 'USER_BOM_POWER_PINMAP_MISSING', `${component.ref} needs explicit power pins/nets.`, { ref: component.ref }))
  if (requiresGround(component.group) && !hasGroundPin(component)) warnings.push(issue('WARNING', 'USER_BOM_GROUND_PINMAP_MISSING', `${component.ref} needs explicit ground pins/nets.`, { ref: component.ref }))
  if (component.group === 'REGULATOR' && missionPlan.mission?.enduranceMinutes >= 30 && !component.currentRatingA) warnings.push(issue('WARNING', 'REGULATOR_CURRENT_RATING_UNKNOWN', `${component.ref} regulator current rating is needed for 30 minute endurance review.`))
  if (component.group === 'POWER_INPUT' && missionPlan.mission?.vehicle?.includes('drone') && component.currentRatingA && component.currentRatingA < 20) errors.push(issue('ERROR', 'POWER_CONNECTOR_CURRENT_TOO_LOW', `${component.ref} current rating looks low for a drone power path.`, { currentRatingA: component.currentRatingA }))
  return { ref: component.ref, group: component.group, warnings, errors, score: Math.max(0, 100 - warnings.length * 12 - errors.length * 35) }
}

function estimatePowerBudget(components, input, missionPlan) {
  const loadMa = components.reduce((sum, component) => sum + loadFor(component), 0)
  const batteryWh = input.batteryWh || batteryWhFrom(input.battery)
  const enduranceHours = (missionPlan.mission?.enduranceMinutes || input.enduranceMinutes || 0) / 60
  const electronicsWh = loadMa * 0.001 * 5 * Math.max(enduranceHours, 0.1)
  const warnings = []
  const errors = []
  if (!batteryWh) warnings.push(issue('WARNING', 'BATTERY_CAPACITY_UNKNOWN', 'Battery Wh/cell count/capacity is required before endurance can be verified.'))
  else if (electronicsWh > batteryWh * 0.15) warnings.push(issue('WARNING', 'ELECTRONICS_POWER_BUDGET_HIGH', 'Electronics budget consumes a large share of battery energy; review regulators and peripherals.', { electronicsWh, batteryWh }))
  return {
    estimatedElectronicsLoadMa: Math.round(loadMa),
    estimatedElectronicsWh: Number(electronicsWh.toFixed(2)),
    batteryWh: batteryWh || null,
    enduranceTargetMinutes: missionPlan.mission?.enduranceMinutes || input.enduranceMinutes || null,
    warnings,
    errors,
  }
}

function userBomWorkflow(input) {
  const projectPath = slug(input.projectName || 'user-bom-project')
  return [
    { type: 'plan_mission_requirements', why: 'Confirm mission goal and required decisions.' },
    { type: 'intake_user_bom', why: 'Normalize the supplied user parts list.' },
    { type: 'audit_user_bom', why: 'Check user parts against mission, power, package, and sourcing requirements.' },
    { type: 'sync_component_database', input: { projectPath }, why: 'Resolve symbols, footprints, 3D models, LCSC/MPN alternates.' },
    { type: 'validate_component_bindings', input: { projectPath }, why: 'Verify pin maps against symbols and footprints.' },
    { type: 'generate_schematic', input: { projectPath }, why: 'Generate schematic from verified user parts.' },
    { type: 'apply_placement_plan', input: { projectPath }, why: 'Place verified parts under role constraints.' },
    { type: 'autoroute_drc_iteration', input: { projectPath }, why: 'Route and run DRC.' },
    { type: 'run_kicad_erc', input: { projectPath }, why: 'Run ERC.' },
    { type: 'generate_manufacturing_manifest', input: { projectPath }, why: 'Gate JLCPCB package readiness.' },
  ]
}

function requiredFunctionsFor(requirementsPlan, missionPlan) {
  const selected = new Set([...(requirementsPlan.selectedCircuits || []), ...(missionPlan.architecture?.architectureType?.includes('long_range') ? ['long_range_uav_support'] : [])])
  return [...selected].flatMap((id) => missionFunctions[id] || [])
}

function clarificationQuestions({ missionPlan, gaps, compatibility, powerBudget, input }) {
  const questions = []
  if (missionPlan.decisions?.required?.length) questions.push(...missionPlan.decisions.required.slice(0, 5))
  if (gaps.length) questions.push({ id: 'missing_functions', prompt: `Do you want BoardForge to add missing functions: ${gaps.map((gap) => gap.group).join(', ')}?`, why: 'The supplied BOM does not fully satisfy the mission architecture.' })
  if (compatibility.some((item) => item.warnings.some((warning) => warning.code === 'USER_BOM_PACKAGE_MISSING'))) questions.push({ id: 'packages', prompt: 'Can BoardForge choose exact JLCPCB/KiCad footprints for parts missing packages?', why: 'Footprint confidence gates placement, CPL, and 3D view.' })
  if (!powerBudget.batteryWh && !input.battery) questions.push({ id: 'battery_wh', prompt: 'What battery cell count, capacity, chemistry, and maximum current should be assumed?', why: 'Endurance and regulator/current-sense sizing need battery data.' })
  return dedupeById(questions).slice(0, 8)
}

function defaultPinMapFor(group) {
  if (group === 'GNSS') return { VCC: '3V3', GND: 'GND', TX: 'GPS_RX', RX: 'GPS_TX' }
  if (group === 'RECEIVER') return { VCC: '5V', GND: 'GND', TX: 'RC_RX', RX: 'RC_TX' }
  if (group === 'TELEMETRY') return { VCC: '5V', GND: 'GND', TX: 'TEL_RX', RX: 'TEL_TX' }
  if (group === 'CURRENT_SENSOR') return { VIN: 'VBAT', VOUT: 'VBAT_SENSE', GND: 'GND', OUT: 'CURRENT_SENSE' }
  if (group === 'REGULATOR') return { VIN: 'VBAT', GND: 'GND', OUT: '5V' }
  if (group === 'POWER_INPUT') return { VIN: 'VBAT', GND: 'GND' }
  if (group === 'ESC_CONNECTOR') return { GND: 'GND', VBAT: 'VBAT', M1: 'MOTOR_1', M2: 'MOTOR_2', M3: 'MOTOR_3', M4: 'MOTOR_4' }
  if (group === 'USB') return { VBUS: 'VUSB', GND: 'GND', DP: 'USB_DP', DN: 'USB_DN' }
  if (group === 'IMU') return { VDD: '3V3', GND: 'GND', SCL: 'I2C_SCL', SDA: 'I2C_SDA', INT1: 'IMU_INT1' }
  if (group === 'BAROMETER') return { VDD: '3V3', GND: 'GND', SCL: 'I2C_SCL', SDA: 'I2C_SDA' }
  if (group === 'BLACKBOX') return { VCC: '3V3', GND: 'GND', CS: 'FLASH_CS', MISO: 'SPI_MISO', MOSI: 'SPI_MOSI', SCK: 'SPI_SCK' }
  if (group === 'SWD') return { VCC: '3V3', GND: 'GND', SWDIO: 'SWDIO', SWCLK: 'SWCLK' }
  if (group === 'BUZZER') return { '+': '5V', '-': 'BUZZER' }
  return {}
}

function inferGroup(text) {
  return groupRules.find(([, pattern]) => pattern.test(text))?.[0] || 'UNKNOWN'
}

function inferRef(row, index) {
  const group = inferGroup(`${row.value || row.part || row.name || row.mpn || ''}`)
  const prefix = group === 'RES' ? 'R' : group === 'CAP' ? 'C' : group.startsWith('J') || /CONNECTOR|USB|GNSS|RECEIVER|TELEMETRY|ESC|POWER_INPUT/.test(group) ? 'J' : 'U'
  return `${prefix}${index + 1}`
}

function headerKey(value) {
  const key = String(value || '').trim().toLowerCase()
  if (/^refs?$|designator|reference/.test(key)) return 'ref'
  if (/qty|quantity/.test(key)) return 'quantity'
  if (/mpn|manufacturer/.test(key)) return 'mpn'
  if (/lcsc/.test(key)) return 'lcsc'
  if (/package|footprint/.test(key)) return 'package'
  if (/value|part|description|name/.test(key)) return 'value'
  return key.replace(/[^a-z0-9]+/g, '_')
}

function loadFor(component) {
  if (component.currentMa) return Number(component.currentMa)
  if (component.group === 'MCU') return 120
  if (component.group === 'GNSS') return 45
  if (component.group === 'RECEIVER') return 120
  if (component.group === 'TELEMETRY') return 250
  if (component.group === 'IMU' || component.group === 'BAROMETER') return 8
  if (component.group === 'BLACKBOX') return 20
  return 2
}

function batteryWhFrom(value) {
  const text = String(value || '')
  const mah = Number(text.match(/(\d+(?:\.\d+)?)\s*mAh/i)?.[1] || 0)
  const cells = Number(text.match(/(\d+)\s*s/i)?.[1] || 0)
  return mah && cells ? Number(((mah / 1000) * cells * 3.7).toFixed(2)) : null
}

function hasPowerPin(component) {
  return Object.values(component.pinMap || {}).some((net) => /3V3|5V|VBAT|VIN|VUSB|VCC|VDD/i.test(net))
}

function hasGroundPin(component) {
  return Object.values(component.pinMap || {}).some((net) => /GND/i.test(net))
}

function requiresPower(group) {
  return !['RES', 'CAP', 'INDUCTOR', 'UNKNOWN'].includes(group)
}

function requiresGround(group) {
  return !['RES', 'INDUCTOR', 'UNKNOWN'].includes(group)
}

function needsSubstitution(component) {
  return !component.lcsc || !component.mpn || component.group === 'UNKNOWN' || !component.package
}

function substitutionReason(component) {
  if (component.group === 'UNKNOWN') return 'part function unknown'
  if (!component.lcsc && !component.mpn) return 'missing supplier identity'
  if (!component.package) return 'missing package/footprint'
  return 'review JLCPCB assembly availability'
}

function numberField(value) {
  if (value === undefined || value === null || value === '') return null
  const parsed = Number(String(value).replace(/[^\d.]/g, ''))
  return Number.isFinite(parsed) ? parsed : null
}

function dedupeById(items) {
  const seen = new Set()
  return items.filter((item) => {
    if (seen.has(item.id)) return false
    seen.add(item.id)
    return true
  })
}

function slug(name) {
  return String(name || 'user-bom-project').trim().replace(/[^a-zA-Z0-9-_ ]/g, '').replace(/\s+/g, '-').slice(0, 64).toLowerCase() || 'user-bom-project'
}

function issue(severity, code, message, details = {}) {
  return { severity, code, message, details }
}
