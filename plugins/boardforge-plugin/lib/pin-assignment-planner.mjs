const esp32S3Pins = {
  power: { '3V3': '3V3', GND: 'GND', EN: 'EN', IO0: 'BOOT' },
  usb: { GPIO19: 'USB_DN', GPIO20: 'USB_DP' },
  i2c: { GPIO8: 'I2C_SDA', GPIO9: 'I2C_SCL' },
  spi: { GPIO11: 'SPI_MOSI', GPIO13: 'SPI_MISO', GPIO12: 'SPI_SCK', GPIO10: 'FLASH_CS' },
  uart: { GPIO43: 'UART_TX', GPIO44: 'UART_RX' },
  swd: { GPIO39: 'JTAG_TCK', GPIO40: 'JTAG_TDO', GPIO41: 'JTAG_TDI', GPIO42: 'JTAG_TMS' },
  sensor: { GPIO4: 'IMU_INT1', GPIO5: 'IMU_INT2' },
}

const stm32Pins = {
  power: { VDD: '3V3', VSS: 'GND', NRST: 'NRST', BOOT0: 'BOOT' },
  usb: { PA11: 'USB_DN', PA12: 'USB_DP' },
  i2c: { PB7: 'I2C_SDA', PB6: 'I2C_SCL' },
  spi: { PA7: 'SPI_MOSI', PA6: 'SPI_MISO', PA5: 'SPI_SCK', PB0: 'FLASH_CS' },
  uart: { PA9: 'UART_TX', PA10: 'UART_RX' },
  swd: { PA13: 'SWDIO', PA14: 'SWCLK' },
  motor: { PB1: 'MOTOR_1', PB2: 'MOTOR_2', PB8: 'MOTOR_3', PB9: 'MOTOR_4' },
  sensor: { PC13: 'IMU_INT1' },
}

export function planPinAssignments({ components = [], nets = [], interfaces = [], input = {} } = {}) {
  const normalizedNets = normalizeNets(nets, input)
  const inferredInterfaces = inferInterfaces(normalizedNets, interfaces, input)
  const controller = selectController(components, input)
  const warnings = []
  const errors = []
  const controllerRequired = inferredInterfaces.some((item) => ['USB', 'I2C', 'SPI', 'UART', 'SWD', 'JTAG', 'CAN', 'SENSOR'].includes(item))
  if (!controller && controllerRequired) errors.push(issue('ERROR', 'CONTROLLER_MISSING', 'No MCU/module component was found for pin assignment.', {}))
  if (!controller && !controllerRequired) warnings.push(issue('WARNING', 'NO_CONTROLLER_PIN_ASSIGNMENT_NEEDED', 'No MCU/module was found; pin assignment is limited to peripheral/connector pin maps.', {}))
  const controllerProfile = controller ? profileFor(controller) : null
  const controllerPinMap = controllerProfile ? buildControllerPinMap(controllerProfile, inferredInterfaces, normalizedNets) : {}
  const peripherals = components
    .filter((component) => component.ref !== controller?.ref)
    .map((component) => mapPeripheral(component, normalizedNets))
  const assignments = [
    ...(controller ? [{ ref: controller.ref, group: controller.group, value: controller.value, role: 'controller', pinMap: controllerPinMap }] : []),
    ...peripherals,
  ]
  const conflicts = findConflicts(assignments)
  errors.push(...conflicts.map((conflict) => issue('ERROR', 'PIN_ASSIGNMENT_CONFLICT', `${conflict.net} is assigned inconsistently on ${conflict.refs.join(', ')}.`, conflict)))
  warnings.push(...bootstrapWarnings(controller, controllerPinMap))
  warnings.push(...missingInterfaceWarnings(inferredInterfaces, controllerPinMap))
  warnings.push(...unassignedNetWarnings(normalizedNets, assignments))
  const status = errors.length ? 'PIN_ASSIGNMENT_BLOCKED' : warnings.length ? 'PIN_ASSIGNMENT_NEEDS_REVIEW' : 'PIN_ASSIGNMENT_READY_NEEDS_REVIEW'
  return {
    status,
    controller: controller ? { ref: controller.ref, group: controller.group, value: controller.value, profile: controllerProfile?.id } : null,
    interfaces: inferredInterfaces,
    nets: normalizedNets,
    assignments,
    controllerPinMap,
    peripheralPinMaps: peripherals,
    conflicts,
    warnings,
    errors,
    actions: recommendedActions({ errors, warnings, inferredInterfaces }),
    humanReviewRequired: true,
  }
}

function buildControllerPinMap(profile, interfaces, nets) {
  const pinMap = { ...profile.power }
  if (interfaces.includes('USB')) Object.assign(pinMap, profile.usb)
  if (interfaces.includes('I2C')) Object.assign(pinMap, profile.i2c)
  if (interfaces.includes('SPI')) Object.assign(pinMap, profile.spi)
  if (interfaces.includes('UART')) Object.assign(pinMap, profile.uart)
  if (interfaces.includes('SWD') || interfaces.includes('JTAG')) Object.assign(pinMap, profile.swd)
  if (interfaces.includes('MOTOR')) Object.assign(pinMap, profile.motor || {})
  if (interfaces.includes('SENSOR')) Object.assign(pinMap, profile.sensor || {})
  for (const net of nets) {
    if (/^CAN_?H$/i.test(net.name) && !Object.values(pinMap).includes(net.name)) pinMap.GPIO6 = 'CAN_H'
    if (/^CAN_?L$/i.test(net.name) && !Object.values(pinMap).includes(net.name)) pinMap.GPIO7 = 'CAN_L'
  }
  return pinMap
}

function mapPeripheral(component, nets) {
  const explicit = component.pinMap || {}
  if (Object.keys(explicit).length) return { ref: component.ref, group: component.group, value: component.value, role: 'peripheral', pinMap: explicit }
  const group = component.group || ''
  const byGroup = {
    USB: { VBUS: 'VUSB', GND: 'GND', 'D+': 'USB_DP', 'D-': 'USB_DN', CC1: 'CC1', CC2: 'CC2' },
    SENSOR_CONNECTOR: { GND: 'GND', '3V3': '3V3', SCL: 'I2C_SCL', SDA: 'I2C_SDA' },
    SWD: { '3V3': '3V3', SWDIO: 'SWDIO', SWCLK: 'SWCLK', NRST: 'NRST', GND: 'GND' },
    RJ45: { 'TX+': 'ETH_TX_P', 'TX-': 'ETH_TX_N', 'RX+': 'ETH_RX_P', 'RX-': 'ETH_RX_N', SHIELD: 'CHASSIS_GND' },
    ETHERNET_PHY: { TXP: 'ETH_TX_P', TXN: 'ETH_TX_N', RXP: 'ETH_RX_P', RXN: 'ETH_RX_N', MDC: 'ETH_MDC', MDIO: 'ETH_MDIO', REFCLK: 'ETH_REFCLK', VDDIO: '3V3', GND: 'GND' },
    IMU: { VDD: '3V3', VDDIO: '3V3', GND: 'GND', SCL: 'I2C_SCL', SDA: 'I2C_SDA', INT1: 'IMU_INT1' },
    BAROMETER: { VDD: '3V3', GND: 'GND', SCL: 'I2C_SCL', SDA: 'I2C_SDA' },
    BLACKBOX: { CS: 'FLASH_CS', MOSI: 'SPI_MOSI', MISO: 'SPI_MISO', SCK: 'SPI_SCK', VCC: '3V3', GND: 'GND' },
    ESC_CONNECTOR: { GND: 'GND', VBAT: 'VBAT', M1: 'MOTOR_1', M2: 'MOTOR_2', M3: 'MOTOR_3', M4: 'MOTOR_4' },
  }
  const selected = byGroup[group] || passivePinMap(component, nets)
  return { ref: component.ref, group, value: component.value, role: 'peripheral', pinMap: selected }
}

function passivePinMap(component, nets) {
  if (component.netA || component.netB) return { 1: component.netA || null, 2: component.netB || null }
  if (/CAP/i.test(component.group || '')) return { 1: nets.some((net) => net.name === '3V3') ? '3V3' : null, 2: 'GND' }
  return {}
}

function findConflicts(assignments) {
  const byRefPin = []
  for (const assignment of assignments) {
    for (const [pin, net] of Object.entries(assignment.pinMap || {})) {
      if (net) byRefPin.push({ ref: assignment.ref, pin, net })
    }
  }
  const byControllerPin = new Map()
  const conflicts = []
  for (const item of byRefPin) {
    const key = `${item.ref}:${item.pin}`
    const existing = byControllerPin.get(key)
    if (existing && existing.net !== item.net) conflicts.push({ refs: [item.ref], pin: item.pin, net: `${existing.net}/${item.net}` })
    byControllerPin.set(key, item)
  }
  return conflicts
}

function bootstrapWarnings(controller, pinMap) {
  const warnings = []
  if (!controller) return warnings
  const text = `${controller.group || ''} ${controller.value || ''}`
  if (/ESP32/i.test(text)) {
    if (!Object.values(pinMap).includes('EN')) warnings.push(issue('WARNING', 'ESP32_EN_NOT_ASSIGNED', 'ESP32 EN/reset net is not assigned.', { ref: controller.ref }))
    if (!Object.values(pinMap).includes('BOOT')) warnings.push(issue('WARNING', 'ESP32_BOOT_NOT_ASSIGNED', 'ESP32 BOOT/IO0 net is not assigned.', { ref: controller.ref }))
  }
  if (/STM32/i.test(text) && !Object.values(pinMap).includes('SWDIO')) warnings.push(issue('WARNING', 'STM32_SWD_NOT_ASSIGNED', 'STM32 SWD pins are not assigned.', { ref: controller.ref }))
  return warnings
}

function missingInterfaceWarnings(interfaces, pinMap) {
  const warnings = []
  const values = new Set(Object.values(pinMap))
  const required = {
    USB: ['USB_DP', 'USB_DN'],
    I2C: ['I2C_SCL', 'I2C_SDA'],
    SPI: ['SPI_MOSI', 'SPI_MISO', 'SPI_SCK'],
    UART: ['UART_TX', 'UART_RX'],
    SWD: ['SWDIO', 'SWCLK'],
    MOTOR: ['MOTOR_1', 'MOTOR_2'],
  }
  for (const iface of interfaces) {
    const missing = (required[iface] || []).filter((net) => !values.has(net))
    if (missing.length) warnings.push(issue('WARNING', 'INTERFACE_PIN_ASSIGNMENT_INCOMPLETE', `${iface} has unassigned controller nets.`, { interface: iface, missing }))
  }
  return warnings
}

function unassignedNetWarnings(nets, assignments) {
  const assigned = new Set(assignments.flatMap((assignment) => Object.values(assignment.pinMap || {}).filter(Boolean)))
  return nets
    .filter((net) => !assigned.has(net.name) && !/^(GND|3V3|5V|VIN|VBAT|VUSB|CHASSIS_GND|POE_)/i.test(net.name))
    .map((net) => issue('WARNING', 'NET_NOT_ASSIGNED_TO_PIN', `${net.name} is not assigned to any planned pin.`, { net: net.name }))
}

function recommendedActions({ errors, warnings, inferredInterfaces }) {
  const actions = []
  if (errors.some((issue) => issue.code === 'CONTROLLER_MISSING')) actions.push({ command: 'plan_requirements', reason: 'Select a controller before schematic pin assignment.' })
  if (warnings.some((issue) => issue.code === 'INTERFACE_PIN_ASSIGNMENT_INCOMPLETE')) actions.push({ command: 'validate_component_bindings', reason: 'Confirm symbol pins and footprint pads for incomplete interfaces.' })
  if (inferredInterfaces.some((item) => ['USB', 'I2C', 'SPI', 'UART', 'SWD'].includes(item))) actions.push({ command: 'generate_schematic', reason: 'Use reviewed pin maps when generating schematic labels and symbol properties.' })
  if (!actions.length) actions.push({ command: 'generate_netlist', reason: 'Pin assignments are ready for netlist review.' })
  return actions
}

function inferInterfaces(nets, interfaces, input) {
  const text = JSON.stringify({ nets, interfaces, input }).toUpperCase()
  const found = new Set((interfaces || []).map((item) => String(item).toUpperCase().replace(/[^A-Z0-9]/g, '_')))
  if (/(USB_(DP|DN)|\bUSB\b|D\+|D-)/.test(text)) found.add('USB')
  if (/I2C|SCL|SDA/.test(text)) found.add('I2C')
  if (/SPI|MOSI|MISO|SCK/.test(text)) found.add('SPI')
  if (/UART|TX|RX/.test(text)) found.add('UART')
  if (/SWD|JTAG|PROGRAM/.test(text)) found.add('SWD')
  if (/CAN/.test(text)) found.add('CAN')
  if (/MOTOR_|ESC/.test(text)) found.add('MOTOR')
  if (/IMU|BARO|SENSOR/.test(text)) found.add('SENSOR')
  return [...found]
}

function selectController(components, input) {
  return (components || []).find((component) => /(ESP32|STM32|MCU|PROCESSOR|CONTROLLER)/i.test(`${component.group || ''} ${component.value || ''}`))
    || input.controller
    || null
}

function profileFor(component) {
  const text = `${component.group || ''} ${component.value || ''}`
  if (/ESP32/i.test(text)) return { id: 'ESP32_S3_DEFAULT_REVIEW', ...esp32S3Pins }
  if (/STM32|MCU|FLIGHT/i.test(text)) return { id: 'STM32_DEFAULT_REVIEW', ...stm32Pins }
  return { id: 'GENERIC_CONTROLLER_REVIEW', power: { VDD: '3V3', GND: 'GND' }, usb: {}, i2c: {}, spi: {}, uart: {}, swd: {}, sensor: {} }
}

function normalizeNets(nets, input) {
  return [...new Set([...(nets || []).map((net) => typeof net === 'string' ? net : net.name), ...(input.nets || []).map((net) => typeof net === 'string' ? net : net.name)].filter(Boolean))].map((name) => ({ name }))
}

function issue(severity, code, message, details = {}) {
  return { severity, code, message, details }
}
