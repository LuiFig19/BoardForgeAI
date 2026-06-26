const templateCircuits = {
  general_mcu_core: {
    components: [
      component('U1', 'MCU', 'Generic QFN MCU', { role: 'mcu' }),
      component('C1', 'CAP', '100nF MCU decoupling', { netA: '3V3', netB: 'GND', supportsRef: 'U1' }),
      component('C2', 'CAP', '10uF local bulk capacitor', { netA: '3V3', netB: 'GND', supportsRef: 'U1' }),
      component('Y1', 'CRYSTAL', 'MCU crystal / oscillator', { netA: 'XTAL_IN', netB: 'XTAL_OUT', supportsRef: 'U1' }),
      component('R1', 'RES', '10k reset pull-up', { netA: 'NRST', netB: '3V3', supportsRef: 'U1' }),
    ],
    nets: ['3V3', 'GND', 'NRST', 'BOOT0', 'XTAL_IN', 'XTAL_OUT', 'SWDIO', 'SWCLK'],
    constraints: ['MCU needs fanout room and decoupling within manufacturer assembly spacing', 'Crystal nets must stay short and quiet'],
  },
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
      component('C101', 'CAP', '100nF ESP32 decoupling', { netA: '3V3', netB: 'GND', supportsRef: 'U1' }),
      component('C102', 'CAP', '10uF ESP32 bulk cap', { netA: '3V3', netB: 'GND', supportsRef: 'U1' }),
      component('R101', 'RES', '10k EN pull-up', { netA: 'EN', netB: '3V3', supportsRef: 'U1' }),
      component('R102', 'RES', '10k BOOT pull-up', { netA: 'BOOT', netB: '3V3', supportsRef: 'U1' }),
      component('SW1', 'SWITCH', 'Reset tactile switch', { package: 'SW_SPST', pinMap: { 1: 'EN', 2: 'GND' } }),
      component('SW2', 'SWITCH', 'Boot tactile switch', { package: 'SW_SPST', pinMap: { 1: 'BOOT', 2: 'GND' } }),
    ],
    nets: ['3V3', 'GND', 'EN', 'BOOT', 'USB_DP', 'USB_DN', 'I2C_SCL', 'I2C_SDA'],
    constraints: ['ESP32 antenna keepout must stay copper/component free', 'Decoupling capacitors must sit near module supply pins'],
  },
  regulator_3v3: {
    components: [
      component('U10', 'REGULATOR', '3V3 buck regulator', { role: 'power_regulator' }),
      component('C10', 'CAP', '10uF regulator input capacitor', { netA: 'VIN', netB: 'GND', supportsRef: 'U10' }),
      component('C11', 'CAP', '10uF regulator output capacitor', { netA: '3V3', netB: 'GND', supportsRef: 'U10' }),
      component('L10', 'INDUCTOR', 'ferrite bead / power inductor', { netA: 'VUSB', netB: 'VIN', supportsRef: 'U10' }),
    ],
    nets: ['VUSB', 'VIN', '3V3', 'GND', 'EN'],
    constraints: ['Input/output capacitors must be close to regulator pins', 'Power path traces need width review'],
  },
  i2c_sensor_header: {
    components: [
      component('J20', 'SENSOR_CONNECTOR', 'I2C sensor connector', { role: 'edge_sensor_header' }),
      component('R20', 'RES', '4.7k I2C SCL pull-up', { netA: 'I2C_SCL', netB: '3V3', supportsRef: 'J20' }),
      component('R21', 'RES', '4.7k I2C SDA pull-up', { netA: 'I2C_SDA', netB: '3V3', supportsRef: 'J20' }),
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
  robotics_io: {
    components: [
      component('U70', 'CAN_TRANSCEIVER', 'CAN transceiver', { role: 'field_bus', pinMap: { CANH: 'CANH', CANL: 'CANL', TXD: 'CAN_TX', RXD: 'CAN_RX', VCC: '3V3', GND: 'GND' } }),
      component('U71', 'RS485_TRANSCEIVER', 'RS485 transceiver', { role: 'field_bus', pinMap: { A: 'RS485_A', B: 'RS485_B', DI: 'RS485_TX', RO: 'RS485_RX', VCC: '3V3', GND: 'GND' } }),
      component('J70', 'SENSOR_CONNECTOR', 'robot sensor/encoder connector', { role: 'edge_sensor_header' }),
      component('J71', 'MOTOR_HEADER', 'motor/control output header', { role: 'edge_motor_control' }),
    ],
    nets: ['CANH', 'CANL', 'CAN_TX', 'CAN_RX', 'RS485_A', 'RS485_B', 'RS485_TX', 'RS485_RX', 'ENC_A', 'ENC_B', 'PWM_1', 'PWM_2', '3V3', 'GND'],
    constraints: ['CAN/RS485 transceivers belong near field connectors with termination/protection review', 'Encoder and sensor inputs need noise separation from motor/power wiring'],
  },
  motor_controller_power_stage: {
    components: [
      component('J80', 'POWER_INPUT', 'battery / DC bus input', { role: 'edge_power_input', pinMap: { VIN: 'VBAT', GND: 'GND' } }),
      component('U80', 'GATE_DRIVER', '3-phase gate driver', { role: 'gate_driver' }),
      component('Q80', 'MOSFET', 'phase A MOSFET half bridge', { role: 'power_switch' }),
      component('Q81', 'MOSFET', 'phase B MOSFET half bridge', { role: 'power_switch' }),
      component('Q82', 'MOSFET', 'phase C MOSFET half bridge', { role: 'power_switch' }),
      component('R80', 'SHUNT', 'current shunt resistor', { role: 'current_sense', netA: 'VBAT', netB: 'CURRENT_SENSE' }),
      component('U81', 'CURRENT_SENSOR', 'current sense amplifier', { role: 'current_sense' }),
      component('J81', 'MOTOR_PHASE_OUTPUT', 'motor phase output pads', { role: 'edge_motor_power' }),
    ],
    nets: ['VBAT', 'GND', 'PHASE_A', 'PHASE_B', 'PHASE_C', 'GATE_A', 'GATE_B', 'GATE_C', 'CURRENT_SENSE', 'SW', 'PWM_A', 'PWM_B', 'PWM_C'],
    constraints: ['Battery and phase routes require wide copper or pours and thermal review', 'Gate driver must be close to MOSFETs', 'Current sense requires Kelvin-style routing and analog noise isolation'],
  },
  battery_charger_bms: {
    components: [
      component('U90', 'CHARGER_IC', 'battery charger / BMS controller', { role: 'charger' }),
      component('Q90', 'PROTECTION_FET', 'battery protection FET', { role: 'power_switch' }),
      component('R90', 'SHUNT', 'battery current shunt', { role: 'current_sense' }),
      component('TH90', 'THERMISTOR', 'battery thermistor input', { role: 'temperature_sensor' }),
      component('J90', 'BATTERY_CONNECTOR', 'battery connector', { role: 'edge_battery' }),
    ],
    nets: ['VBAT', 'PACK_PLUS', 'PACK_MINUS', 'CHARGE_IN', 'CURRENT_SENSE', 'THERMISTOR', 'I2C_SCL', 'I2C_SDA', 'GND'],
    constraints: ['Battery current path must be width/thermal checked', 'Sense traces must avoid switching/high-current loops', 'Thermistor path should be quiet and close to connector intent'],
  },
  led_controller_outputs: {
    components: [
      component('U100', 'LED_DRIVER', 'LED driver / MOSFET driver', { role: 'led_driver' }),
      component('Q100', 'MOSFET', 'LED channel MOSFET', { role: 'power_switch' }),
      component('J100', 'LED_OUTPUT', 'LED strip/output connector', { role: 'edge_led_output' }),
      component('F100', 'FUSE', 'LED power fuse', { role: 'protection' }),
    ],
    nets: ['VIN', 'LED_VPLUS', 'LED_CH1', 'PWM_LED1', 'GND'],
    constraints: ['LED output current needs trace width and fuse/current review', 'MOSFET/driver thermal copper requires spacing from sensors/analog inputs'],
  },
  industrial_io: {
    components: [
      component('J110', 'TERMINAL_BLOCK', 'field terminal block', { role: 'edge_field_io' }),
      component('U110', 'ISOLATOR', 'digital isolator / optocoupler', { role: 'isolation' }),
      component('K110', 'RELAY_OR_DRIVER', 'relay or protected driver', { role: 'field_driver' }),
      component('D110', 'TVS', 'field input surge protection', { role: 'protection' }),
    ],
    nets: ['FIELD_IN1', 'FIELD_OUT1', 'ISO_IN1', 'ISO_OUT1', '24V_FIELD', 'GND_FIELD', '3V3', 'GND'],
    constraints: ['Isolation boundary must remain clear', 'TVS/protection should be next to terminal block', 'Field side and logic side require creepage/clearance review'],
  },
  compute_module_carrier: {
    components: [
      component('J120', 'MODULE_CONNECTOR', 'compute module connector', { role: 'module_connector' }),
      component('U120', 'PMIC_OR_REGULATORS', 'power sequencing regulators', { role: 'power_tree' }),
      component('J121', 'USB', 'USB connector', { role: 'edge_usb' }),
      component('J122', 'RJ45', 'Ethernet connector', { role: 'edge_ethernet' }),
      component('J123', 'MIPI_CONNECTOR', 'MIPI/CSI/DSI connector', { role: 'edge_high_speed' }),
    ],
    nets: ['USB_DP', 'USB_DN', 'ETH_TX_P', 'ETH_TX_N', 'ETH_RX_P', 'ETH_RX_N', 'MIPI_D0_P', 'MIPI_D0_N', 'PCIE_TX_P', 'PCIE_TX_N', '5V', '3V3', 'GND'],
    constraints: ['Module connector placement must follow datasheet/reference design', 'MIPI/PCIe/Ethernet require stackup and human SI review', 'Power sequencing and rail current require vendor constraints'],
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
  long_range_uav_support: {
    components: [
      component('J60', 'GNSS', 'GPS/GNSS connector', { role: 'edge_gnss', pinMap: { VCC: '3V3', GND: 'GND', TX: 'GPS_RX', RX: 'GPS_TX', SDA: 'I2C_SDA', SCL: 'I2C_SCL' } }),
      component('J61', 'RECEIVER', 'RC receiver / ELRS connector', { role: 'edge_receiver', pinMap: { VCC: '5V', GND: 'GND', TX: 'RC_RX', RX: 'RC_TX' } }),
      component('J62', 'TELEMETRY', 'long-range telemetry connector', { role: 'edge_telemetry', pinMap: { VCC: '5V', GND: 'GND', TX: 'TEL_RX', RX: 'TEL_TX' } }),
      component('U60', 'CURRENT_SENSOR', 'battery current/voltage monitor', { role: 'power_monitor', pinMap: { VIN: 'VBAT', VOUT: 'VBAT_SENSE', GND: 'GND', OUT: 'CURRENT_SENSE' } }),
      component('J63', 'BUZZER', 'lost-model buzzer connector', { role: 'edge_buzzer', pinMap: { '+': '5V', '-': 'BUZZER' } }),
      component('SW60', 'SWITCH', 'arming / safety switch input', { package: 'SW_SPST', pinMap: { 1: 'ARM', 2: 'GND' } }),
    ],
    nets: ['5V', 'VBAT', 'VBAT_SENSE', 'CURRENT_SENSE', 'GPS_RX', 'GPS_TX', 'RC_RX', 'RC_TX', 'TEL_RX', 'TEL_TX', 'BUZZER', 'ARM', '3V3', 'GND'],
    constraints: ['GNSS and telemetry connectors need RF/antenna keepouts', 'Battery voltage/current sensing needs reviewed divider/current-sense values', 'Receiver and telemetry UARTs must not conflict with USB/SWD/debug pins', 'Long-range failsafe, buzzer, and arming inputs require firmware-level validation'],
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
  const droneFlightController = /drone|flight controller|uav|imu|blackbox/.test(text) || input.templateId === 'DRONE_FC_30X30' || input.templateId === 'DRONE_AIO_WHOOP'
  if (/mcu|microcontroller|embedded controller|generic controller|controller board/.test(text)) add('general_mcu_core')
  if (/esp32|s3|wifi|wi-fi|ble/.test(text) || input.templateId === 'ESP32_S3_SENSOR' || input.templateId === 'ESP32_S3_POE_SENSOR') add('esp32_s3_core')
  if (/usb|type c|type-c|debug/.test(text) || input.interfaces?.includes('USB')) add('usb_c_device')
  if (/regulator|3v3|power|usb powered|battery|poe/.test(text)) add('regulator_3v3')
  if (/i2c|sensor|sht|scd|bme|bmp|barometer/.test(text) || input.interfaces?.includes('I2C')) add('i2c_sensor_header')
  if (/swd|program|debug/.test(text)) add('swd_debug')
  if (/poe|ethernet|rj45|802\.3/.test(text) || input.templateId === 'ESP32_S3_POE_SENSOR' || input.interfaces?.includes('Ethernet')) add('poe_ethernet')
  if (/robotics|robot controller|encoder|rs485|servo/.test(text) || (!droneFlightController && (/can/.test(text) || input.interfaces?.includes('CAN')))) add('robotics_io')
  const ledOrLoadSwitchContext = /led|rgb|strip|neopixel|load switch|switched output|mosfet output/.test(text) && !/motor|bldc|phase|esc|inverter|gate driver/.test(text)
  const explicitMotorPowerStage = !ledOrLoadSwitchContext && /motor controller|inverter|gate driver|mosfet|phase current|phase output|bldc|foc|motor driver|motor drivers/.test(text)
    || (/esc/.test(text) && !/esc\s+(signal\s+)?connector|flight controller|drone|uav/.test(text))
  if (explicitMotorPowerStage && !droneFlightController) add('motor_controller_power_stage')
  if (/bms|battery charger|charger|charge controller|fuel gauge|thermistor|protection fet/.test(text)) add('battery_charger_bms')
  if (/led|rgb|strip|neopixel/.test(text)) add('led_controller_outputs')
  if (/industrial|relay|isolat|terminal block|24v|plc|field io|field i\/o/.test(text)) add('industrial_io')
  if (/compute module|carrier|cm4|sodimm|som|linux|mipi|pcie|pci-e|hdmi|ddr/.test(text)) add('compute_module_carrier')
  if (droneFlightController) add('drone_fc_core')
  if (/long range|15 miles|mile|miles|gps|gnss|telemetry|receiver|elrs|return to home|current sense|battery life|30 min|30 minutes/.test(text)) {
    add('drone_fc_core')
    add('long_range_uav_support')
  }
  if (!selected.length) {
    add('general_mcu_core')
    add('usb_c_device')
    add('regulator_3v3')
  }
  if (!selected.some((item) => item.id === 'regulator_3v3') && selected.some((item) => ['general_mcu_core', 'esp32_s3_core', 'drone_fc_core', 'poe_ethernet', 'robotics_io', 'compute_module_carrier'].includes(item.id))) add('regulator_3v3')
  if (!selected.some((item) => ['general_mcu_core', 'esp32_s3_core', 'drone_fc_core', 'compute_module_carrier'].includes(item.id)) && selected.some((item) => ['robotics_io', 'motor_controller_power_stage', 'battery_charger_bms', 'led_controller_outputs', 'industrial_io'].includes(item.id))) add('general_mcu_core')
  if (selected.some((item) => item.id === 'esp32_s3_core')) return selected.filter((item) => item.id !== 'general_mcu_core')
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
  if (selected.some((item) => item.id === 'motor_controller_power_stage')) assumptions.push('Motor-controller power stages require thermal/current calculations, safe gate-drive review, and DRC before any manufacturing claim.')
  if (selected.some((item) => item.id === 'compute_module_carrier')) assumptions.push('Compute-module carriers with MIPI/PCIe/DDR-class interfaces require vendor reference design constraints and human SI/PI review.')
  if (selected.some((item) => item.id === 'industrial_io')) assumptions.push('Industrial I/O designs require isolation, surge, field-power, and regulatory review.')
  if (selected.some((item) => item.id === 'drone_fc_core')) assumptions.push('Flight-controller sensor placement and thermal isolation require human mechanical review.')
  if (selected.some((item) => item.id === 'long_range_uav_support')) assumptions.push('Long-range drone goals require battery, airframe, RF link, failsafe, firmware, and regulatory review beyond PCB generation.')
  return assumptions
}

function component(ref, group, value, extra = {}) {
  return { ref, group, value, ...extra }
}

function normalizeText(value) {
  return String(value || '').toLowerCase()
}
