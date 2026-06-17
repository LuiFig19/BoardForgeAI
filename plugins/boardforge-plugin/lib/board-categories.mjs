const categories = {
  embedded_controller: category({
    name: 'Generic embedded controller',
    expectedComponents: ['MCU', 'USB', 'REGULATOR', 'SWD', 'GPIO_HEADER', 'RESET_BOOT', 'CAP', 'RES'],
    interfaces: ['USB', 'GPIO', 'SWD', 'I2C', 'SPI', 'UART'],
    placementPriorities: ['MCU central with fanout space', 'USB/debug edge accessible', 'decoupling close to MCU pins'],
    routingPriorities: ['crystal/debug first', 'power rails before GPIO', 'short USB pair if present'],
    netClasses: ['GROUND', 'POWER_LOW_CURRENT', 'USB_DIFF', 'SPI', 'I2C', 'UART', 'DEBUG', 'RESET', 'BOOT'],
    recommendedLayerCount: 4,
  }),
  iot_sensor: category({
    name: 'IoT sensor board',
    expectedComponents: ['MCU', 'WIRELESS_MODULE', 'SENSOR_CONNECTOR', 'REGULATOR', 'USB', 'BATTERY_CHARGER'],
    interfaces: ['USB', 'I2C', 'SPI', 'UART', 'BLE/Wi-Fi'],
    placementPriorities: ['antenna keepout at board edge', 'sensors away from hot/noisy power', 'battery connector accessible'],
    routingPriorities: ['RF/antenna keepouts', 'quiet sensor nets', 'USB and power before low-speed sensors'],
    netClasses: ['GROUND', 'POWER_LOW_CURRENT', 'USB_DIFF', 'I2C', 'SPI', 'SENSOR', 'RF', 'ANTENNA'],
    recommendedLayerCount: 4,
  }),
  usb_device: category({
    name: 'USB device',
    expectedComponents: ['USB', 'TVS', 'MCU', 'REGULATOR', 'CRYSTAL', 'SWD'],
    interfaces: ['USB', 'SWD'],
    placementPriorities: ['USB connector on edge', 'ESD protector near connector', 'MCU close enough for short DP/DN route'],
    routingPriorities: ['USB differential pair first', 'ground reference continuous under USB', 'VBUS current path width checked'],
    netClasses: ['USB_DIFF', 'POWER_LOW_CURRENT', 'GROUND', 'CRYSTAL', 'DEBUG'],
    recommendedLayerCount: 4,
  }),
  ethernet_device: category({
    name: 'Ethernet device',
    expectedComponents: ['RJ45', 'ETHERNET_PHY', 'MAGNETICS', 'REGULATOR', 'CRYSTAL', 'TVS'],
    interfaces: ['Ethernet', 'MDIO', 'RMII/MII'],
    placementPriorities: ['RJ45/magnetics on edge', 'PHY close to magnetics', 'clock close to PHY'],
    routingPriorities: ['Ethernet differential pairs', 'PHY clock/reference', 'avoid switching noise near magnetics'],
    netClasses: ['ETHERNET_DIFF', 'CLOCK', 'POWER_LOW_CURRENT', 'GROUND', 'ISOLATION_BOUNDARY'],
    recommendedLayerCount: 4,
  }),
  poe_device: category({
    name: 'PoE device',
    expectedComponents: ['RJ45', 'ETHERNET_PHY', 'POE_FRONT_END', 'ISOLATION', 'REGULATOR', 'TVS'],
    interfaces: ['Ethernet', 'PoE', 'USB service'],
    placementPriorities: ['PoE front end near RJ45', 'isolation boundary clear', 'low-voltage logic away from high-voltage PoE section'],
    routingPriorities: ['PoE high-voltage clearance', 'Ethernet pairs', 'primary/secondary isolation rules', 'power conversion thermal paths'],
    netClasses: ['ETHERNET_DIFF', 'HIGH_VOLTAGE', 'ISOLATION_BOUNDARY', 'POWER_HIGH_CURRENT', 'GROUND'],
    recommendedLayerCount: 4,
    warnings: ['PoE isolation and creepage must be reviewed against the chosen PD controller reference design.'],
  }),
  robotics_controller: category({
    name: 'Robotics controller',
    expectedComponents: ['MCU', 'CAN_TRANSCEIVER', 'RS485_TRANSCEIVER', 'MOTOR_HEADER', 'SENSOR_CONNECTOR', 'POWER_INPUT', 'REGULATOR'],
    interfaces: ['CAN', 'RS485', 'UART', 'I2C', 'SPI', 'PWM'],
    placementPriorities: ['field connectors on accessible edges', 'power input and protection separated from MCU/sensors', 'transceivers near connectors'],
    routingPriorities: ['power input first', 'CAN/RS485 pairs', 'PWM/encoder signals', 'sensor buses'],
    netClasses: ['CAN_DIFF', 'RS485_DIFF', 'POWER_HIGH_CURRENT', 'POWER_LOW_CURRENT', 'SENSOR', 'GROUND'],
    recommendedLayerCount: 4,
  }),
  motor_controller: category({
    name: 'Motor controller / ESC / inverter concept',
    expectedComponents: ['MCU', 'GATE_DRIVER', 'MOSFET', 'SHUNT', 'CURRENT_SENSOR', 'POWER_INPUT', 'MOTOR_PHASE_OUTPUT', 'REGULATOR'],
    interfaces: ['PWM', 'CAN/UART', 'current sense', 'phase outputs'],
    placementPriorities: ['MOSFET and shunt power loop compact', 'gate drivers close to MOSFET gates', 'MCU away from hot/noisy switching area'],
    routingPriorities: ['battery and motor phase copper first', 'gate loops short', 'current sense Kelvin routing', 'thermal copper zones'],
    netClasses: ['BATTERY', 'MOTOR_PHASE', 'POWER_HIGH_CURRENT', 'SWITCHING_NODE', 'ANALOG', 'GROUND'],
    recommendedLayerCount: 6,
    warnings: ['High-current motor boards require thermal/current calculation and human power-electronics review.'],
  }),
  battery_charger_bms: category({
    name: 'Battery charger / BMS board',
    expectedComponents: ['CHARGER_IC', 'PROTECTION_FET', 'CURRENT_SENSOR', 'THERMISTOR', 'BATTERY_CONNECTOR', 'REGULATOR'],
    interfaces: ['battery', 'charge input', 'temperature sense', 'fuel gauge/I2C'],
    placementPriorities: ['battery and charge connectors accessible', 'sense traces Kelvin routed', 'thermal components spaced'],
    routingPriorities: ['battery current path', 'sense/Kelvin nets', 'thermal zones', 'charger switching loop'],
    netClasses: ['BATTERY', 'POWER_HIGH_CURRENT', 'SWITCHING_NODE', 'ANALOG', 'SENSOR', 'GROUND'],
    recommendedLayerCount: 4,
  }),
  led_controller: category({
    name: 'LED controller',
    expectedComponents: ['MCU', 'LED_DRIVER', 'MOSFET', 'POWER_INPUT', 'LED_OUTPUT', 'FUSE', 'REGULATOR'],
    interfaces: ['PWM', 'LED outputs', 'power input'],
    placementPriorities: ['LED outputs on accessible edge', 'drivers near MOSFETs/outputs', 'heat paths clear'],
    routingPriorities: ['high-current LED outputs', 'PWM signals', 'ground return and thermal copper'],
    netClasses: ['POWER_HIGH_CURRENT', 'SWITCHING_NODE', 'GROUND', 'UART', 'I2C'],
    recommendedLayerCount: 4,
  }),
  audio_board: category({
    name: 'Audio board',
    expectedComponents: ['CODEC', 'AMPLIFIER', 'CONNECTOR', 'REGULATOR', 'CRYSTAL', 'PASSIVES'],
    interfaces: ['I2S', 'analog audio', 'USB optional'],
    placementPriorities: ['analog path short/quiet', 'power amplifier thermal spacing', 'digital clocks away from analog input'],
    routingPriorities: ['analog nets guarded', 'clock/I2S controlled', 'power separated from low-level audio'],
    netClasses: ['ANALOG', 'CLOCK', 'POWER_LOW_CURRENT', 'POWER_HIGH_CURRENT', 'GROUND'],
    recommendedLayerCount: 4,
  }),
  rf_adjacent: category({
    name: 'RF-adjacent board',
    expectedComponents: ['RF_MODULE', 'ANTENNA', 'MCU', 'REGULATOR', 'MATCHING_NETWORK'],
    interfaces: ['RF module', 'SPI/UART', 'USB optional'],
    placementPriorities: ['antenna edge/keepout', 'matching network next to RF pin', 'no copper under antenna keepout'],
    routingPriorities: ['RF feed/antenna keepout', 'quiet power', 'shield/ground stitching'],
    netClasses: ['RF', 'ANTENNA', 'GROUND', 'POWER_LOW_CURRENT', 'SPI', 'UART'],
    recommendedLayerCount: 4,
    warnings: ['RF performance requires antenna/reference-layout review and cannot be guaranteed from generic routing.'],
  }),
  wearable_pcb: category({
    name: 'Wearable PCB',
    expectedComponents: ['MCU', 'BATTERY_CHARGER', 'SENSOR', 'USB', 'HAPTIC_OR_LED', 'REGULATOR'],
    interfaces: ['BLE', 'USB', 'I2C', 'battery'],
    placementPriorities: ['respect custom outline and height zones', 'edge charging connector', 'antenna and skin-contact keepouts'],
    routingPriorities: ['custom outline clearance', 'battery/charging path', 'sensor quiet zones', 'stitching vias around edges'],
    netClasses: ['BATTERY', 'POWER_LOW_CURRENT', 'SENSOR', 'RF', 'ANTENNA', 'GROUND'],
    recommendedLayerCount: 4,
  }),
  industrial_io: category({
    name: 'Industrial I/O board',
    expectedComponents: ['MCU', 'ISOLATOR', 'RELAY_OR_DRIVER', 'TERMINAL_BLOCK', 'TVS', 'REGULATOR'],
    interfaces: ['RS485', 'CAN', 'digital inputs', 'relay outputs'],
    placementPriorities: ['terminal blocks on field edge', 'isolation barrier clear', 'logic side separated from field side'],
    routingPriorities: ['isolation/creepage', 'surge protection near connectors', 'field power/current traces'],
    netClasses: ['RS485_DIFF', 'CAN_DIFF', 'HIGH_VOLTAGE', 'ISOLATION_BOUNDARY', 'POWER_HIGH_CURRENT', 'GROUND'],
    recommendedLayerCount: 4,
  }),
  test_fixture: category({
    name: 'Test fixture',
    expectedComponents: ['POGO_PINS', 'CONNECTOR', 'MCU', 'PROTECTION', 'MOUNTING_HOLES'],
    interfaces: ['pogo pins', 'USB', 'GPIO', 'power'],
    placementPriorities: ['pogo pattern locked to DUT', 'fixture mounting holes clear', 'operator connectors accessible'],
    routingPriorities: ['test pins to harness/control', 'power rails sized', 'clear labels/silkscreen'],
    netClasses: ['POWER_LOW_CURRENT', 'POWER_HIGH_CURRENT', 'DEFAULT', 'GROUND'],
    recommendedLayerCount: 2,
  }),
  dev_board: category({
    name: 'Dev board',
    expectedComponents: ['MCU', 'USB', 'REGULATOR', 'HEADERS', 'BUTTONS', 'LED', 'DEBUG'],
    interfaces: ['USB', 'GPIO', 'I2C', 'SPI', 'UART', 'debug'],
    placementPriorities: ['headers aligned on grid', 'USB accessible', 'debug buttons reachable'],
    routingPriorities: ['USB/power first', 'headers with readable silkscreen', 'test/debug access'],
    netClasses: ['USB_DIFF', 'POWER_LOW_CURRENT', 'I2C', 'SPI', 'UART', 'DEBUG', 'GROUND'],
    recommendedLayerCount: 4,
  }),
  breakout_board: category({
    name: 'Breakout board',
    expectedComponents: ['TARGET_PART', 'HEADERS', 'DECOUPLING', 'ESD_OPTIONAL'],
    interfaces: ['pin breakout', 'power'],
    placementPriorities: ['target part centered', 'headers on standard pitch', 'labels readable'],
    routingPriorities: ['short fanout', 'power/ground rails', 'clear pin labels'],
    netClasses: ['DEFAULT', 'POWER_LOW_CURRENT', 'GROUND'],
    recommendedLayerCount: 2,
  }),
  adapter_board: category({
    name: 'Adapter board',
    expectedComponents: ['CONNECTOR_A', 'CONNECTOR_B', 'PROTECTION_OPTIONAL', 'MOUNTING_HOLES'],
    interfaces: ['connector conversion'],
    placementPriorities: ['connector mechanical alignment locked', 'edge access', 'strain relief holes if needed'],
    routingPriorities: ['pin mapping correctness', 'power current path', 'label every connector'],
    netClasses: ['DEFAULT', 'POWER_LOW_CURRENT', 'POWER_HIGH_CURRENT', 'GROUND'],
    recommendedLayerCount: 2,
  }),
  carrier_board: category({
    name: 'Carrier board',
    expectedComponents: ['MODULE_CONNECTOR', 'POWER_TREE', 'USB', 'ETHERNET_OPTIONAL', 'GPIO_HEADERS'],
    interfaces: ['module connector', 'USB', 'Ethernet optional', 'GPIO'],
    placementPriorities: ['module connector fixed by datasheet', 'high-speed connectors close to module pins', 'power tree near module input'],
    routingPriorities: ['power sequencing', 'USB/Ethernet differential pairs', 'module fanout', 'ground return'],
    netClasses: ['USB_DIFF', 'ETHERNET_DIFF', 'POWER_LOW_CURRENT', 'POWER_HIGH_CURRENT', 'GROUND', 'DEBUG'],
    recommendedLayerCount: 6,
  }),
  compute_module_carrier: category({
    name: 'Compute module carrier',
    expectedComponents: ['MODULE_CONNECTOR', 'PMIC_OR_REGULATORS', 'USB', 'ETHERNET', 'HDMI', 'MIPI', 'PCIe', 'DDR_IF_APPLICABLE'],
    interfaces: ['USB', 'Ethernet', 'HDMI', 'MIPI', 'PCIe', 'power sequencing'],
    placementPriorities: ['module connector datum locked', 'high-speed connectors placed per reference design', 'power sequencing/thermal zones separated'],
    routingPriorities: ['reference-design constraints first', 'PCIe/MIPI/LVDS diff pairs', 'power sequencing rails', 'SI/PI review gates'],
    netClasses: ['USB_DIFF', 'ETHERNET_DIFF', 'MIPI_DIFF', 'PCIe_DIFF', 'LVDS_DIFF', 'POWER_HIGH_CURRENT', 'GROUND'],
    recommendedLayerCount: 8,
    warnings: ['Compute-module carriers with MIPI/PCIe/DDR require human SI/PI review and vendor reference-design constraints.'],
  }),
  mixed_signal: category({
    name: 'Mixed-signal board',
    expectedComponents: ['MCU', 'ADC_OR_DAC', 'ANALOG_FRONT_END', 'REFERENCE', 'REGULATOR', 'SENSOR_CONNECTOR'],
    interfaces: ['analog', 'SPI/I2C', 'USB optional'],
    placementPriorities: ['analog front end away from switching/power', 'reference and ADC close', 'guard quiet analog regions'],
    routingPriorities: ['analog/sensor nets first', 'quiet ground strategy', 'digital buses kept away from analog inputs'],
    netClasses: ['ANALOG', 'SENSOR', 'POWER_LOW_CURRENT', 'SPI', 'I2C', 'GROUND'],
    recommendedLayerCount: 4,
  }),
  high_current_power: category({
    name: 'High-current power board',
    expectedComponents: ['POWER_INPUT', 'FUSE', 'MOSFET_OR_SWITCH', 'CURRENT_SENSOR', 'OUTPUT_CONNECTOR', 'THERMAL_COPPER'],
    interfaces: ['power input/output', 'current/voltage sense'],
    placementPriorities: ['short high-current path', 'thermal copper around switching/current devices', 'sense lines Kelvin routed'],
    routingPriorities: ['wide pours', 'parallel vias when changing layers', 'thermal bottleneck checks', 'sensitive sense nets separated'],
    netClasses: ['BATTERY', 'POWER_HIGH_CURRENT', 'HIGH_VOLTAGE', 'ANALOG', 'GROUND'],
    recommendedLayerCount: 4,
  }),
  dense_compact: category({
    name: 'Dense compact board',
    expectedComponents: ['MCU', 'CONNECTORS', 'PASSIVES', 'REGULATORS', 'TEST_POINTS'],
    interfaces: ['project specific'],
    placementPriorities: ['component courtyards packed with routing channels', 'test access preserved', 'height/keepout constraints honored'],
    routingPriorities: ['critical nets first', 'HDI/via policy if allowed', 'congestion scoring and honest failure if too dense'],
    netClasses: ['DEFAULT', 'POWER_LOW_CURRENT', 'GROUND', 'USB_DIFF', 'I2C', 'SPI'],
    recommendedLayerCount: 6,
    warnings: ['Dense boards may need smaller packages, extra layers, or HDI features.'],
  }),
  custom_mechanical_outline: category({
    name: 'Custom mechanical outline board',
    expectedComponents: ['MOUNTING_HOLES', 'EDGE_CONNECTORS', 'KEEP_OUTS', 'PROJECT_COMPONENTS'],
    interfaces: ['custom'],
    placementPriorities: ['outline and mounting locked first', 'components kept inside usable regions', 'connectors aligned to requested edges'],
    routingPriorities: ['edge clearance', 'hole/cutout avoidance', 'routing channels through narrow regions'],
    netClasses: ['DEFAULT', 'POWER_LOW_CURRENT', 'GROUND'],
    recommendedLayerCount: 4,
  }),
  drone_flight_controller: category({
    name: 'Drone flight controller',
    expectedComponents: ['MCU', 'IMU', 'BAROMETER', 'BLACKBOX', 'USB', 'ESC_CONNECTOR', 'REGULATOR'],
    interfaces: ['USB', 'SPI', 'I2C', 'UART', 'motor outputs'],
    placementPriorities: ['IMU near center and away from heat', 'USB/ESC connectors on edges', 'barometer protected from heat/airflow'],
    routingPriorities: ['IMU/SPI/clock nets', 'USB pair', 'motor signal outputs', 'ground/regulated rails'],
    netClasses: ['USB_DIFF', 'SPI', 'I2C', 'UART', 'SENSOR', 'GROUND', 'POWER_LOW_CURRENT'],
    recommendedLayerCount: 4,
  }),
  drone_aio: category({
    name: 'Drone AIO board',
    expectedComponents: ['MCU', 'IMU', 'ESC_POWER_STAGE', 'CURRENT_SENSOR', 'USB', 'REGULATOR', 'MOTOR_PADS'],
    interfaces: ['USB', 'SPI', 'I2C', 'motor phase', 'battery'],
    placementPriorities: ['separate IMU from ESC heat/noise', 'battery/motor pads on edges', 'current path compact and thermally reviewed'],
    routingPriorities: ['battery/motor phase copper', 'gate loops', 'IMU isolation', 'USB/debug'],
    netClasses: ['BATTERY', 'MOTOR_PHASE', 'SWITCHING_NODE', 'USB_DIFF', 'SENSOR', 'GROUND'],
    recommendedLayerCount: 6,
    warnings: ['AIO flight-controller plus ESC requires serious thermal and noise review.'],
  }),
}

const aliases = [
  [/compute module|carrier|cm4|sodimm|som|linux|mipi|pcie|pci-e|hdmi|ddr/i, 'compute_module_carrier'],
  [/motor controller|esc|inverter|gate driver|mosfet|phase|bldc|foc/i, 'motor_controller'],
  [/bms|charger|charge|battery management|fuel gauge|balanc/i, 'battery_charger_bms'],
  [/poe|802\.3af|802\.3at|power over ethernet/i, 'poe_device'],
  [/ethernet|rj45|magjack|phy/i, 'ethernet_device'],
  [/industrial|relay|isolat|terminal block|rs485|plc/i, 'industrial_io'],
  [/robot|robotics|encoder|can bus|servo/i, 'robotics_controller'],
  [/wearable|watch|ring|bracelet|flex|skin|tiny shape/i, 'wearable_pcb'],
  [/audio|codec|amplifier|microphone|speaker/i, 'audio_board'],
  [/\brf\b|antenna|lora|lte|gnss|gps|radio/i, 'rf_adjacent'],
  [/led|rgb|neopixel|strip/i, 'led_controller'],
  [/test fixture|pogo|bed of nails/i, 'test_fixture'],
  [/breakout/i, 'breakout_board'],
  [/adapter|converter|pinout/i, 'adapter_board'],
  [/dev board|development board|evaluation board/i, 'dev_board'],
  [/mixed signal|adc|dac|analog front/i, 'mixed_signal'],
  [/high current|power board|distribution|fuse|busbar/i, 'high_current_power'],
  [/dense|compact|hdi|microvia|blind via|buried via/i, 'dense_compact'],
  [/custom outline|custom shape|mechanical|odd shape|weird shape|edge cuts/i, 'custom_mechanical_outline'],
  [/drone aio|whoop|4-in-1/i, 'drone_aio'],
  [/drone|flight controller|uav|quadcopter|multirotor/i, 'drone_flight_controller'],
  [/usb|type-c|type c/i, 'usb_device'],
  [/iot|sensor|environmental|ble|wifi|wi-fi/i, 'iot_sensor'],
]

export function listBoardCategories() {
  return Object.entries(categories).map(([id, item]) => ({ id, ...item }))
}

export function getBoardCategory(id = 'embedded_controller') {
  const key = categories[id] ? id : inferBoardCategory({ boardType: id }).id
  return { id: key, ...categories[key] }
}

export function inferBoardCategory(input = {}) {
  const explicit = input.category || input.boardCategory || input.boardType || input.preset
  if (categories[explicit]) return { id: explicit, confidence: 1, reason: 'explicit category' }
  const text = [
    explicit,
    input.projectName,
    input.prompt,
    input.notes,
    input.useCase,
    ...(input.interfaces || []),
    ...(input.components || []).map((component) => `${component.group || ''} ${component.value || ''}`),
  ].filter(Boolean).join(' ')
  const match = aliases.find(([pattern]) => pattern.test(text))
  if (match) return { id: match[1], confidence: 0.82, reason: `matched ${match[0].source}` }
  return { id: 'embedded_controller', confidence: 0.55, reason: 'default generic embedded controller' }
}

export function buildCategoryPlan(input = {}) {
  const inferred = inferBoardCategory(input)
  const selected = getBoardCategory(inferred.id)
  const warnings = [...selected.manufacturingWarnings]
  if (input.layerCount && input.layerCount < selected.recommendedLayerCount) {
    warnings.push(`${selected.name} normally wants ${selected.recommendedLayerCount} layers; requested ${input.layerCount} layer(s) may block routing or SI/PI goals.`)
  }
  const missingDecisions = []
  if (!input.manufacturer && !input.manufacturerProfile) missingDecisions.push(decision('manufacturerProfile', 'Which manufacturer/profile should constrain trace, via, and assembly rules?'))
  if (!input.widthMm && !input.board?.widthMm && /compact|custom|wearable|carrier|motor|power/i.test(selected.name)) missingDecisions.push(decision('mechanicalEnvelope', 'What exact board size, outline, mounting holes, and connector edge constraints should be locked?'))
  if (selected.netClasses.some((name) => ['POWER_HIGH_CURRENT', 'BATTERY', 'MOTOR_PHASE', 'HIGH_VOLTAGE'].includes(name)) && !input.currentA && !input.powerBudget) missingDecisions.push(decision('currentBudget', 'What voltage/current/thermal limits should be used for high-current routes and pours?'))
  if (selected.netClasses.some((name) => ['MIPI_DIFF', 'PCIe_DIFF', 'LVDS_DIFF', 'ETHERNET_DIFF', 'USB_DIFF'].includes(name)) && !input.stackup) missingDecisions.push(decision('stackup', 'Should BoardForge use a standard stackup or a manufacturer impedance stackup for high-speed routing intent?'))
  return {
    status: missingDecisions.length ? 'BOARD_CATEGORY_PLAN_NEEDS_USER_DECISIONS' : 'BOARD_CATEGORY_PLAN_READY_NEEDS_REVIEW',
    category: selected,
    inferred,
    recommendedPreset: recommendedPresetFor(selected.id),
    expectedComponents: selected.expectedComponents,
    netClasses: selected.netClasses,
    placementPriorities: selected.placementPriorities,
    routingPriorities: selected.routingPriorities,
    recommendedLayerCount: selected.recommendedLayerCount,
    validationRules: selected.validationRules,
    manufacturingWarnings: warnings,
    decisions: { required: missingDecisions, optional: optionalDecisions(selected) },
    workflow: workflowForCategory(selected, input),
    humanReviewRequired: true,
  }
}

function category(input) {
  const normalized = {
    expectedComponents: [],
    interfaces: [],
    placementPriorities: [],
    routingPriorities: [],
    netClasses: [],
    recommendedLayerCount: 4,
    clearanceNotes: ['Use manufacturer profile minimums as hard floors; widen power/current paths from electrical requirements.'],
    mechanicalConstraints: ['Keep all components/courtyards inside board outline and away from mounting holes/cutouts.'],
    validationRules: ['validate_board_outline', 'validate_placement', 'validate_net_classes', 'validate_routing_geometry', 'run_dfm_checks', 'run_kicad_drc', 'run_kicad_erc'],
    manufacturingWarnings: [],
    defaultPreset: null,
    ...input,
  }
  normalized.manufacturingWarnings = input.manufacturingWarnings || input.warnings || []
  delete normalized.warnings
  return normalized
}

function recommendedPresetFor(categoryId) {
  if (categoryId === 'poe_device') return 'poe_esp32_sensor'
  if (categoryId === 'drone_flight_controller') return 'drone_flight_controller'
  if (categoryId === 'motor_controller') return 'motor_controller'
  if (categoryId === 'usb_device') return 'usb_device'
  return categoryId
}

function workflowForCategory(category, input) {
  const projectPath = slug(input.projectName || category.name)
  return [
    { type: 'plan_board_category', why: 'Infer PCB type, decisions, net classes, and context-aware engineering rules.' },
    { type: 'plan_requirements', why: 'Turn the category and prompt into concrete components, nets, and constraints.' },
    { type: 'plan_stackup', why: 'Select layer roles, via strategy, and high-speed/power routing gates.' },
    { type: 'plan_power_tree', why: 'Budget rails, current, regulators, and thermal risk.' },
    { type: 'create_kicad_project', why: 'Create the controlled KiCad project scaffold.', input: { projectPath } },
    { type: 'sync_component_database', why: 'Resolve symbols, footprints, 3D models, and sourcing confidence.', input: { projectPath } },
    { type: 'generate_kicad_rules', why: 'Write KiCad custom rules for classes, diff pairs, keepouts, and manufacturer limits.', input: { projectPath } },
    { type: 'optimize_placement', why: 'Generate and repair placement before copper.', input: { projectPath } },
    { type: 'autoroute_drc_iteration', why: 'Route controlled copper and immediately run KiCad DRC.', input: { projectPath } },
    { type: 'generate_routing_report', why: 'Explain routed/unrouted nets, blockers, DRC state, and next fixes.', input: { projectPath } },
  ]
}

function optionalDecisions(category) {
  return [
    decision('assemblyTarget', `Use JLCPCB assembly, hand assembly, or fab-only for ${category.name}?`),
    decision('reviewDepth', 'Should BoardForge prioritize low cost, compact size, performance margin, or strict manufacturability?'),
  ]
}

function decision(id, prompt) {
  return { id, prompt, required: true }
}

function slug(name) {
  return String(name || 'boardforge-project').trim().replace(/[^a-zA-Z0-9-_ ]/g, '').replace(/\s+/g, '-').slice(0, 64).toLowerCase() || 'boardforge-project'
}
