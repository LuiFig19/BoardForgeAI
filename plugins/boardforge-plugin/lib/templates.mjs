import { rectanglePoints, regularPolygonPoints, roundedRectanglePoints } from './geometry.mjs'

function holes(width, height, spacing, diameter) {
  const cx = width / 2
  const cy = height / 2
  const half = spacing / 2
  return [
    { id: 'MH1', x: cx - half, y: cy - half, diameterMm: diameter },
    { id: 'MH2', x: cx + half, y: cy - half, diameterMm: diameter },
    { id: 'MH3', x: cx + half, y: cy + half, diameterMm: diameter },
    { id: 'MH4', x: cx - half, y: cy + half, diameterMm: diameter },
  ]
}

function cornerHoles(width, height, diameter = 3, inset = 5) {
  return [
    { id: 'MH1', x: inset, y: inset, diameterMm: diameter },
    { id: 'MH2', x: width - inset, y: inset, diameterMm: diameter },
    { id: 'MH3', x: width - inset, y: height - inset, diameterMm: diameter },
    { id: 'MH4', x: inset, y: height - inset, diameterMm: diameter },
  ]
}

export const boardTemplates = {
  DRONE_FC_30X30: {
    id: 'DRONE_FC_30X30', name: 'Drone Flight Controller - 30.5x30.5', dimensionsMm: { width: 36, height: 36 }, layerCount: 6,
    outline: (w, h) => roundedRectanglePoints(w, h, 3.2), mountingHoles: (w, h) => holes(w, h, 30.5, 3),
    requiredNetClasses: ['BATTERY', 'POWER_LOW_CURRENT', 'USB_DIFF', 'SPI', 'I2C', 'UART', 'CRYSTAL', 'GROUND', 'SENSOR'],
    componentGroups: ['MCU', 'IMU', 'USB', 'BLACKBOX', 'REGULATOR', 'BAROMETER', 'UART_PADS', 'SWD', 'ESC_CONNECTOR'],
    validationChecks: ['imu_centered', 'usb_on_edge', 'mounting_holes_clear', 'crystal_close', 'ground_strategy'],
    exportRequirements: ['kicad_project', 'drc_report', 'erc_report', 'gerbers', 'drill', 'bom', 'cpl', 'manufacturing_review'],
  },
  DRONE_AIO_WHOOP: {
    id: 'DRONE_AIO_WHOOP', name: 'Drone AIO / Whoop Board', dimensionsMm: { width: 29, height: 29 }, layerCount: 4,
    outline: (w, h) => roundedRectanglePoints(w, h, 4), mountingHoles: (w, h) => holes(w, h, 25.5, 1.6),
    requiredNetClasses: ['BATTERY', 'MOTOR_PHASE', 'POWER_HIGH_CURRENT', 'POWER_LOW_CURRENT', 'USB_DIFF', 'SPI', 'UART', 'GROUND'],
    componentGroups: ['MCU', 'IMU', 'ESC_OUTPUTS', 'USB', 'RECEIVER_PADS', 'VTX_CAMERA_PADS', 'REGULATOR'],
    validationChecks: ['motor_phase_width', 'imu_centered', 'hot_zone_away_from_imu', 'mounting_holes_clear'],
    exportRequirements: ['kicad_project', 'drc_report', 'gerbers', 'drill', 'bom', 'cpl', 'manufacturing_review'],
  },
  ESP32_S3_SENSOR: {
    id: 'ESP32_S3_SENSOR', name: 'ESP32-S3 Sensor Board', dimensionsMm: { width: 58, height: 32 }, layerCount: 4,
    outline: (w, h) => roundedRectanglePoints(w, h, 3), mountingHoles: (w, h) => cornerHoles(w, h, 2.7, 4),
    requiredNetClasses: ['POWER_LOW_CURRENT', 'USB_DIFF', 'I2C', 'UART', 'GROUND', 'SENSOR'],
    componentGroups: ['ESP32_S3', 'USB', 'I2C_HEADER', 'REGULATOR', 'BOOT_RESET', 'FLASH'],
    validationChecks: ['usb_on_edge', 'antenna_keepout', 'regulator_caps_close', 'mounting_holes_clear'],
    exportRequirements: ['kicad_project', 'drc_report', 'gerbers', 'drill', 'bom', 'cpl', 'manufacturing_review'],
  },
  ESP32_S3_POE_SENSOR: {
    id: 'ESP32_S3_POE_SENSOR', name: 'ESP32-S3 PoE Ethernet Sensor', dimensionsMm: { width: 72, height: 45 }, layerCount: 4,
    outline: (w, h) => roundedRectanglePoints(w, h, 3), mountingHoles: (w, h) => cornerHoles(w, h, 3, 5),
    requiredNetClasses: ['POWER_LOW_CURRENT', 'POWER_HIGH_CURRENT', 'ETHERNET_DIFF', 'USB_DIFF', 'I2C', 'GROUND', 'ANALOG'],
    componentGroups: ['RJ45', 'ETHERNET_PHY', 'POE_FRONT_END', 'ISOLATION', 'REGULATOR', 'ESP32_S3', 'USB', 'SENSOR_CONNECTOR'],
    validationChecks: ['rj45_on_edge', 'poe_isolation_clearance', 'ethernet_pairs_short', 'usb_on_edge'],
    exportRequirements: ['kicad_project', 'drc_report', 'gerbers', 'drill', 'bom', 'cpl', 'manufacturing_review'],
  },
  ROBOTICS_CONTROLLER: {
    id: 'ROBOTICS_CONTROLLER', name: 'Robotics Controller', dimensionsMm: { width: 85, height: 55 }, layerCount: 4,
    outline: (w, h) => roundedRectanglePoints(w, h, 4), mountingHoles: (w, h) => cornerHoles(w, h),
    requiredNetClasses: ['BATTERY', 'POWER_LOW_CURRENT', 'CAN_DIFF', 'I2C', 'UART', 'GROUND', 'SENSOR'],
    componentGroups: ['MCU', 'CAN', 'UART', 'I2C', 'MOTOR_HEADERS', 'POWER_INPUT', 'REGULATOR', 'ENCODER_INPUTS', 'DEBUG'],
    validationChecks: ['connectors_accessible', 'can_pair_classified', 'power_entry_clear'],
    exportRequirements: ['kicad_project', 'drc_report', 'gerbers', 'drill', 'bom', 'cpl', 'manufacturing_review'],
  },
  MOTOR_CONTROLLER_ESC: {
    id: 'MOTOR_CONTROLLER_ESC', name: 'Motor Controller / ESC Concept Board', dimensionsMm: { width: 70, height: 42 }, layerCount: 6,
    outline: (w, h) => roundedRectanglePoints(w, h, 3), mountingHoles: (w, h) => holes(w, h, 30.5, 3),
    requiredNetClasses: ['BATTERY', 'MOTOR_PHASE', 'POWER_HIGH_CURRENT', 'CAN_DIFF', 'GROUND', 'ANALOG'],
    componentGroups: ['POWER_INPUT', 'GATE_DRIVERS', 'MOSFET_REGION', 'CURRENT_SHUNTS', 'THERMAL_ZONES', 'MOTOR_OUTPUTS', 'MCU'],
    validationChecks: ['motor_phase_width', 'thermal_zone', 'current_shunt_kelvin', 'hot_power_keepout'],
    exportRequirements: ['kicad_project', 'drc_report', 'gerbers', 'drill', 'bom', 'cpl', 'manufacturing_review'],
  },
}

export function createTemplateBoard(templateId, overrides = {}) {
  const template = boardTemplates[templateId] || boardTemplates.ESP32_S3_SENSOR
  const width = overrides.widthMm || template.dimensionsMm.width
  const height = overrides.heightMm || template.dimensionsMm.height
  return { id: template.id, name: overrides.name || template.name, units: 'mm', widthMm: width, heightMm: height, layerCount: overrides.layerCount || template.layerCount, outline: template.outline(width, height), mountingHoles: template.mountingHoles(width, height), requiredNetClasses: template.requiredNetClasses, componentGroups: template.componentGroups, validationChecks: template.validationChecks, exportRequirements: template.exportRequirements }
}

export function createBoardShape(shape, widthMm, heightMm, options = {}) {
  if (shape === 'rounded_rectangle') return roundedRectanglePoints(widthMm, heightMm, options.radiusMm || 3)
  if (shape === 'circle') return regularPolygonPoints(widthMm, heightMm, 48)
  if (shape === 'hexagon') return regularPolygonPoints(widthMm, heightMm, 6)
  if (shape === 'octagon') return regularPolygonPoints(widthMm, heightMm, 8)
  if (shape === 'capsule') return roundedRectanglePoints(widthMm, heightMm, Math.min(widthMm, heightMm) / 2)
  return rectanglePoints(widthMm, heightMm)
}
