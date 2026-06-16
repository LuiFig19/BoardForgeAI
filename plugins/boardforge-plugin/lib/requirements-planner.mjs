const templateCircuits = {
  usb_c_device: {
    components: [
      component('J1', 'USB', 'USB-C receptacle', { role: 'edge_usb' }),
      component('RUSB1', 'RES', '5.1k CC pull-down', { netA: 'CC1', netB: 'GND' }),
      component('RUSB2', 'RES', '5.1k CC pull-down', { netA: 'CC2', netB: 'GND' }),
      component('DUSB1', 'TVS', 'USB ESD protection', { package: 'SOT-23-6', pinMap: { VBUS: 'VUSB', GND: 'GND', DP: 'USB_DP', DN: 'USB_DN' } }),
    ],
    nets: ['VUSB', 'GND', 'USB_DP', 'USB_DN', 'CC1', 'CC2'],
    constraints: ['USB-C connector must sit on a board edge', 'USB differential pair should stay short and same-layer where possible'],
  },
  esp32_s3_core: {
    components: [
      component('U1', 'ESP32_S3', 'ESP32-S3-WROOM-1-N8R8', { role: 'mcu_rf_module' }),
      component('C101', 'CAP', '100nF ESP32 decoupling', { netA: '3V3', netB: 'GND' }),
      component('C102', 'CAP', '10uF ESP32 bulk cap', { netA: '3V3', netB: 'GND' }),
      component('R101', 'RES', '10k EN pull-up', { netA: 'EN', netB: '3V3' }),
      component('R102', 'RES', '10k BOOT pull-up', { netA: 'BOOT', netB: '3V3' }),
      component('SW1', 'SWITCH', 'Reset tactile switch', { package: 'SW_SPST', pinMap: { 1: 'EN', 2: 'GND' } }),
      component('SW2', 'SWITCH', 'Boot tactile switch', { package: 'SW_SPST', pinMap: { 1: 'BOOT', 2: 'GND' } }),
    ],
    nets: ['3V3', 'GND', 'EN', 'BOOT', 'USB_DP', 'USB_DN', 'I2C_SCL', 'I2C_SDA'],
    constraints: ['ESP32 antenna keepout must stay copper/component free', 'Decoupling capacitors must sit near module supply pins'],
  },
  regulator_3v3: {
    components: [
      component('U10', 'REGULATOR', '3V3 regulator', { role: 'power_regulator' }),
      component('C10', 'CAP', '10uF regulator input capacitor', { netA: 'VIN', netB: 'GND' }),
      component('C11', 'CAP', '10uF regulator output capacitor', { netA: '3V3', netB: 'GND' }),
      component('L10', 'INDUCTOR', 'ferrite bead / power inductor', { netA: 'VUSB', netB: 'VIN' }),
    ],
    nets: ['VUSB', 'VIN', '3V3', 'GND', 'EN'],
    constraints: ['Input/output capacitors must be close to regulator pins', 'Power path traces need width review'],
  },
  i2c_sensor_header: {
    components: [
      component('J20', 'SENSOR_CONNECTOR', 'I2C sensor connector', { role: 'edge_sensor_header' }),
      component('R20', 'RES', '4.7k I2C SCL pull-up', { netA: 'I2C_SCL', netB: '3V3' }),
      component('R21', 'RES', '4.7k I2C SDA pull-up', { netA: 'I2C_SDA', netB: '3V3' }),
    ],
    nets: ['3V3', 'GND', 'I2C_SCL', 'I2C_SDA'],
    constraints: ['I2C pull-ups should be near the bus source or connector'],
  },
  swd_debug: {
    components: [
      component('J30', 'SWD', 'SWD programming header', { role: 'debug_header' }),
    ],
    nets: ['3V3', 'GND', 'SWDIO', 'SWCLK', 'NRST'],
    constraints: ['SWD header must remain accessible for programming and test'],
  },
  poe_ethernet: {
    components: [
      component('J40', 'RJ45', 'RJ45 MagJack', { role: 'edge_ethernet' }),
      component('U40', 'ETHERNET_PHY', 'LAN8720A Ethernet PHY', { role: 'ethernet_phy' }),
      component('U41', 'POE_FRONT_END', '802.3af PoE PD front end', { role: 'poe_front_end' }),
      component('C40', 'CAP', '100nF PHY decoupling', { netA: '3V3', netB: 'GND' }),
      component('C41', 'CAP', '10uF PoE bulk capacitor', { netA: 'POE_RTN', netB: 'GND' }),
    ],
    nets: ['ETH_TX_P', 'ETH_TX_N', 'ETH_RX_P', 'ETH_RX_N', 'ETH_MDC', 'ETH_MDIO', 'ETH_REFCLK', 'POE_VDD', 'POE_RTN', '3V3', 'GND'],
    constraints: ['RJ45 must sit on an edge', 'Ethernet differential pairs must be short and reviewed for impedance', 'PoE front end needs high-voltage clearance review'],
  },
  drone_fc_core: {
    components: [
      component('U1', 'MCU', 'STM32 flight-controller MCU', { role: 'mcu' }),
      component('U2', 'IMU', '6-axis IMU', { role: 'motion_sensor' }),
      component('U3', 'BAROMETER', 'barometer', { role: 'pressure_sensor' }),
      component('U4', 'BLACKBOX', 'SPI flash blackbox', { role: 'flash' }),
      component('J50', 'ESC_CONNECTOR', 'ESC signal connector', { role: 'edge_esc' }),
      component('C50', 'CAP', '100nF IMU decoupling', { netA: '3V3', netB: 'GND' }),
    ],
    nets: ['3V3', 'GND', 'SPI_MOSI', 'SPI_MISO', 'SPI_SCK', 'FLASH_CS', 'I2C_SCL', 'I2C_SDA', 'IMU_INT1', 'MOTOR_1', 'MOTOR_2', 'MOTOR_3', 'MOTOR_4'],
    constraints: ['IMU should be near board center and away from thermal zones', 'ESC connector should sit on an accessible edge'],
  },
}

export function planRequirements(input = {}) {
  const text = normalizeText([input.prompt, input.notes, input.projectName, input.templateId, input.boardType, ...(input.interfaces || [])].join(' '))
  const selected = selectCircuits(text, input)
  const plannedComponents = mergeComponents(selected.flatMap((circuit) => circuit.components), input.components || [])
  const nets = [...new Set([
    ...selected.flatMap((circuit) => circuit.nets),
    ...(input.nets || []).map((net) => typeof net === 'string' ? net : net.name),
    ...plannedComponents.flatMap((item) => Object.values(item.pinMap || {}).filter(Boolean)),
  ])].filter(Boolean).map((name) => ({ name }))
  return {
    status: 'REQUIREMENTS_PLAN_READY_NEEDS_REVIEW',
    projectName: input.projectName || input.name || 'BoardForge planned project',
    selectedCircuits: selected.map((circuit) => circuit.id),
    components: plannedComponents,
    nets,
    constraints: [...new Set(selected.flatMap((circuit) => circuit.constraints))],
    assumptions: assumptionsFor(selected, text),
    humanReviewRequired: true,
  }
}

function selectCircuits(text, input) {
  const selected = []
  const add = (id) => {
    if (!selected.some((item) => item.id === id)) selected.push({ id, ...templateCircuits[id] })
  }
  if (/esp32|s3|wifi|wi-fi|ble/.test(text) || input.templateId === 'ESP32_S3_SENSOR' || input.templateId === 'ESP32_S3_POE_SENSOR') add('esp32_s3_core')
  if (/usb|type c|type-c|debug/.test(text) || input.interfaces?.includes('USB')) add('usb_c_device')
  if (/regulator|3v3|power|usb powered|battery|poe/.test(text)) add('regulator_3v3')
  if (/i2c|sensor|sht|scd|bme|bmp|barometer/.test(text) || input.interfaces?.includes('I2C')) add('i2c_sensor_header')
  if (/swd|program|debug/.test(text)) add('swd_debug')
  if (/poe|ethernet|rj45|802\.3/.test(text) || input.templateId === 'ESP32_S3_POE_SENSOR' || input.interfaces?.includes('Ethernet')) add('poe_ethernet')
  if (/drone|flight controller|imu|esc|blackbox/.test(text) || input.templateId === 'DRONE_FC_30X30' || input.templateId === 'DRONE_AIO_WHOOP') add('drone_fc_core')
  if (!selected.length) {
    add('esp32_s3_core')
    add('usb_c_device')
    add('regulator_3v3')
  }
  if (!selected.some((item) => item.id === 'regulator_3v3') && selected.some((item) => ['esp32_s3_core', 'drone_fc_core', 'poe_ethernet'].includes(item.id))) add('regulator_3v3')
  return selected
}

function mergeComponents(planned, explicit) {
  const merged = new Map()
  for (const component of planned) merged.set(component.ref, component)
  for (const component of explicit || []) merged.set(component.ref || `X${merged.size + 1}`, { ...component })
  return [...merged.values()].map((component, index) => ({ ...component, ref: component.ref || `X${index + 1}` }))
}

function assumptionsFor(selected, text) {
  const assumptions = ['BoardForge plan is review-required and must pass ERC/DRC before manufacturing.']
  if (!/battery|poe|usb powered|external power/.test(text)) assumptions.push('Power source was not explicit; planner assumes USB/VUSB input feeding local 3V3 regulation.')
  if (selected.some((item) => item.id === 'poe_ethernet')) assumptions.push('PoE/Ethernet circuit requires impedance, isolation, and high-voltage clearance review.')
  if (selected.some((item) => item.id === 'drone_fc_core')) assumptions.push('Flight-controller sensor placement and thermal isolation require human mechanical review.')
  return assumptions
}

function component(ref, group, value, extra = {}) {
  return { ref, group, value, ...extra }
}

function normalizeText(value) {
  return String(value || '').toLowerCase()
}
