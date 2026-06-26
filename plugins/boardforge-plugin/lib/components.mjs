import crypto from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { polygonBounds } from './geometry.mjs'
import { renderPlacedFootprintsFromLibraries } from './library-adapter.mjs'

const kicadShare = 'C:\\Program Files\\KiCad\\10.0\\share\\kicad\\footprints'

const footprintMap = {
  MCU: { footprint: 'Package_DFN_QFN:QFN-56-1EP_7x7mm_P0.4mm_EP4x4mm', file: 'Package_DFN_QFN.pretty\\QFN-56-1EP_7x7mm_P0.4mm_EP4x4mm.kicad_mod' },
  ESP32_S3: { footprint: 'RF_Module:ESP32-S3-WROOM-1', file: 'RF_Module.pretty\\ESP32-S3-WROOM-1.kicad_mod' },
  IMU: { footprint: 'Package_LGA:LGA-16_3x3mm_P0.5mm', file: 'Package_LGA.pretty\\LGA-16_3x3mm_P0.5mm.kicad_mod' },
  USB: { footprint: 'Connector_USB:USB_C_Receptacle_HRO_TYPE-C-31-M-12', file: 'Connector_USB.pretty\\USB_C_Receptacle_HRO_TYPE-C-31-M-12.kicad_mod' },
  RJ45: { footprint: 'Connector_RJ:RJ45_Amphenol_RJHSE538X', file: 'Connector_RJ.pretty\\RJ45_Amphenol_RJHSE538X.kicad_mod' },
  REGULATOR: { footprint: 'Package_TO_SOT_SMD:SOT-23-5', file: 'Package_TO_SOT_SMD.pretty\\SOT-23-5.kicad_mod' },
  BLACKBOX: { footprint: 'Package_SO:SOIC-8_3.9x4.9mm_P1.27mm', file: 'Package_SO.pretty\\SOIC-8_3.9x4.9mm_P1.27mm.kicad_mod' },
  SENSOR_CONNECTOR: { footprint: 'Connector_PinHeader_2.54mm:PinHeader_1x04_P2.54mm_Vertical', file: 'Connector_PinHeader_2.54mm.pretty\\PinHeader_1x04_P2.54mm_Vertical.kicad_mod' },
  ESC_CONNECTOR: { footprint: 'Connector_PinHeader_2.54mm:PinHeader_1x08_P2.54mm_Vertical', file: 'Connector_PinHeader_2.54mm.pretty\\PinHeader_1x08_P2.54mm_Vertical.kicad_mod' },
  FIELD_CONNECTOR: { footprint: 'Connector_PinHeader_2.54mm:PinHeader_1x08_P2.54mm_Vertical', file: 'Connector_PinHeader_2.54mm.pretty\\PinHeader_1x08_P2.54mm_Vertical.kicad_mod' },
  MOTOR_HEADER: { footprint: 'Connector_PinHeader_2.54mm:PinHeader_1x06_P2.54mm_Vertical', file: 'Connector_PinHeader_2.54mm.pretty\\PinHeader_1x06_P2.54mm_Vertical.kicad_mod' },
  POWER_INPUT: { footprint: 'TerminalBlock:TerminalBlock_MaiXu_MX126-5.0-02P_1x02_P5.00mm', file: 'TerminalBlock.pretty\\TerminalBlock_MaiXu_MX126-5.0-02P_1x02_P5.00mm.kicad_mod' },
  CAN_TRANSCEIVER: { footprint: 'Connector_PinHeader_2.54mm:PinHeader_1x06_P2.54mm_Vertical', file: 'Connector_PinHeader_2.54mm.pretty\\PinHeader_1x06_P2.54mm_Vertical.kicad_mod' },
  RS485_TRANSCEIVER: { footprint: 'Connector_PinHeader_2.54mm:PinHeader_1x06_P2.54mm_Vertical', file: 'Connector_PinHeader_2.54mm.pretty\\PinHeader_1x06_P2.54mm_Vertical.kicad_mod' },
  ETHERNET_PHY: { footprint: 'Connector_PinHeader_2.54mm:PinHeader_1x08_P2.54mm_Vertical', file: 'Connector_PinHeader_2.54mm.pretty\\PinHeader_1x08_P2.54mm_Vertical.kicad_mod' },
  POE_FRONT_END: { footprint: 'Package_SO:SOIC-8_3.9x4.9mm_P1.27mm', file: 'Package_SO.pretty\\SOIC-8_3.9x4.9mm_P1.27mm.kicad_mod' },
  TERMINAL_BLOCK: { footprint: 'TerminalBlock:TerminalBlock_MaiXu_MX126-5.0-08P_1x08_P5.00mm', file: 'TerminalBlock.pretty\\TerminalBlock_MaiXu_MX126-5.0-08P_1x08_P5.00mm.kicad_mod' },
  ISOLATOR: { footprint: 'Package_SO:SOIC-8_3.9x4.9mm_P1.27mm', file: 'Package_SO.pretty\\SOIC-8_3.9x4.9mm_P1.27mm.kicad_mod' },
  RELAY_OR_DRIVER: { footprint: 'Package_SO:SOIC-8_3.9x4.9mm_P1.27mm', file: 'Package_SO.pretty\\SOIC-8_3.9x4.9mm_P1.27mm.kicad_mod' },
  TVS: { footprint: 'Diode_SMD:D_SOD-323', file: 'Diode_SMD.pretty\\D_SOD-323.kicad_mod' },
  DEFAULT: { footprint: 'Resistor_SMD:R_0603_1608Metric', file: 'Resistor_SMD.pretty\\R_0603_1608Metric.kicad_mod' },
  CAP: { footprint: 'Capacitor_SMD:C_0603_1608Metric', file: 'Capacitor_SMD.pretty\\C_0603_1608Metric.kicad_mod' },
  RES: { footprint: 'Resistor_SMD:R_0603_1608Metric', file: 'Resistor_SMD.pretty\\R_0603_1608Metric.kicad_mod' },
}

export function generateTemplateComponents(board, templateId) {
  const bounds = polygonBounds(board.outline)
  const cx = (bounds.minX + bounds.maxX) / 2
  const cy = (bounds.minY + bounds.maxY) / 2
  if (templateId === 'ESP32_S3_POE_SENSOR') {
    return [
      comp('J1', 'RJ45', 'RJ45 MagJack', bounds.maxX - 18, cy - 22, 90),
      comp('U3', 'ETHERNET_PHY', 'Ethernet PHY routeable fixture', bounds.maxX - 48, cy - 22, 90),
      comp('U4', 'POE_FRONT_END', '802.3af PoE front end', bounds.minX + 38, cy + 22, 0),
      comp('U1', 'ESP32_S3', 'ESP32-S3 module', cx, cy + 15, 0),
      comp('U2', 'REGULATOR', '3V3 regulator', bounds.minX + 58, cy + 22, 0, { netA: 'VUSB', netB: '3V3' }),
      comp('J2', 'USB', 'USB-C service', bounds.minX + 10, cy - 22, 90),
      comp('J3', 'SENSOR_CONNECTOR', 'I2C sensor header', bounds.maxX - 30, bounds.maxY - 14, 90),
      comp('C1', 'CAP', '10uF regulator bulk', bounds.minX + 66, cy + 22, 0, { supportsRef: 'U2', netA: 'VUSB', netB: 'GND' }),
      comp('C2', 'CAP', '100nF PHY', bounds.maxX - 58, cy - 22, 0, { supportsRef: 'U3', netA: '3V3', netB: 'GND' }),
      comp('R1', 'RES', '10k EN', cx - 2, cy + 28, 0, { supportsRef: 'U1', netA: 'EN', netB: '3V3' }),
    ]
  }
  if (templateId === 'ROBOTICS_CONTROLLER') {
    return [
      comp('J1', 'POWER_INPUT', '12V power input', bounds.minX + 12, cy + 24, 90, { role: 'edge_power_input', pinMap: { 1: 'VIN', 2: 'GND' } }),
      comp('U4', 'REGULATOR', '3V3 regulator', bounds.minX + 34, cy + 22, 0, { netA: 'VIN', netB: '3V3' }),
      comp('U1', 'MCU', 'Robotics MCU', cx - 4, cy, 0),
      comp('U2', 'CAN_TRANSCEIVER', 'CAN transceiver routeable', bounds.maxX - 42, cy - 15, 0),
      comp('U3', 'RS485_TRANSCEIVER', 'RS485 transceiver routeable', bounds.maxX - 42, cy + 15, 0),
      comp('J2', 'FIELD_CONNECTOR', 'CAN/RS485 field connector', bounds.maxX - 24, cy, 90),
      comp('J3', 'MOTOR_HEADER', 'motor/control outputs', cx + 20, bounds.maxY - 13, 0),
      comp('J4', 'SENSOR_CONNECTOR', 'sensor header', cx + 22, bounds.minY + 10, 180),
      comp('J5', 'SENSOR_CONNECTOR', 'debug header', bounds.minX + 16, bounds.minY + 16, 90, { role: 'debug_header', pinMap: { 1: 'GND', 2: '3V3', 3: 'SWDIO', 4: 'SWCLK' } }),
      comp('C1', 'CAP', '10uF regulator input', bounds.minX + 43, cy + 21, 0, { supportsRef: 'U4', netA: 'VIN', netB: 'GND' }),
      comp('C2', 'CAP', '100nF MCU', cx + 10, cy - 12, 0, { supportsRef: 'U1', netA: '3V3', netB: 'GND' }),
    ]
  }
  if (templateId === 'INDUSTRIAL_IO') {
    return [
      comp('J1', 'TERMINAL_BLOCK', 'field terminal block', bounds.maxX - 10, cy, 90),
      comp('D1', 'TVS', 'field surge clamp', bounds.maxX - 35, cy - 18, 0, { netA: 'FIELD_IN1', netB: 'GND_FIELD' }),
      comp('D2', 'TVS', 'field bus clamp', bounds.maxX - 35, cy + 18, 0, { netA: 'RS485_A', netB: 'GND_FIELD' }),
      comp('U2', 'ISOLATOR', 'digital isolator', cx + 18, cy, 0),
      comp('U3', 'RELAY_OR_DRIVER', 'protected output driver', bounds.maxX - 54, cy + 18, 0),
      comp('U4', 'CAN_TRANSCEIVER', 'CAN transceiver routeable', cx - 10, cy - 15, 0),
      comp('U5', 'RS485_TRANSCEIVER', 'RS485 transceiver routeable', cx - 10, cy + 15, 0),
      comp('U1', 'MCU', 'Industrial controller MCU', bounds.minX + 46, cy, 0),
      comp('J2', 'POWER_INPUT', '24V field power input', bounds.minX + 12, cy + 24, 90, { role: 'edge_power_input', pinMap: { 1: '24V_FIELD', 2: 'GND_FIELD' } }),
      comp('U6', 'REGULATOR', '3V3 isolated logic regulator', bounds.minX + 34, cy + 22, 0, { netA: '24V_FIELD', netB: '3V3' }),
      comp('J3', 'SENSOR_CONNECTOR', 'debug header', bounds.minX + 16, bounds.minY + 16, 90, { role: 'debug_header', pinMap: { 1: 'GND', 2: '3V3', 3: 'SWDIO', 4: 'SWCLK' } }),
      comp('C1', 'CAP', '10uF field input bulk', bounds.minX + 44, cy + 22, 0, { supportsRef: 'U6', netA: '24V_FIELD', netB: 'GND_FIELD' }),
      comp('C2', 'CAP', '100nF MCU', bounds.minX + 58, cy - 10, 0, { supportsRef: 'U1', netA: '3V3', netB: 'GND' }),
    ]
  }
  if (templateId === 'DRONE_FC_30X30' || templateId === 'DRONE_AIO_WHOOP') {
    return [
      comp('U1', 'MCU', 'STM32H7/F7 MCU placeholder', cx, cy + 2, 0),
      comp('U2', 'IMU', 'IMU', cx, cy - 8, 0),
      comp('J1', 'USB', 'USB-C', cx, bounds.minY + 5, 180),
      comp('U3', 'BLACKBOX', 'Blackbox flash', cx - 9, cy + 9, 0),
      comp('U4', 'REGULATOR', '3V3 regulator', cx + 10, cy + 9, 0),
      comp('J2', 'ESC_CONNECTOR', 'ESC connector', cx, bounds.maxY - 5, 0),
    comp('C1', 'CAP', '100nF', cx + 7, cy + 1, 0, { supportsRef: 'U1' }),
    comp('R1', 'RES', '10k', cx - 7, cy + 1, 0, { supportsRef: 'U1' }),
    ]
  }
  return [
    comp('U1', templateId === 'ESP32_S3_SENSOR' ? 'ESP32_S3' : 'MCU', templateId === 'ESP32_S3_SENSOR' ? 'ESP32-S3 module' : 'MCU placeholder', cx, cy, 0),
    comp('J1', 'USB', 'USB-C receptacle', bounds.minX + 7, cy, 90),
    comp('U2', 'REGULATOR', '3V3 buck regulator', cx - 14, cy + 8, 0),
    comp('J2', 'SENSOR_CONNECTOR', 'I2C sensor header', bounds.maxX - 8, cy, 270),
    comp('C1', 'CAP', '10uF', cx - 8, cy + 8, 0, { supportsRef: 'U2' }),
    comp('C2', 'CAP', '100nF', cx + 8, cy + 8, 0, { supportsRef: 'U1' }),
    comp('R1', 'RES', '10k', cx - 8, cy - 8, 0, { supportsRef: 'U1' }),
    comp('R2', 'RES', '10k', cx + 8, cy - 8, 0, { supportsRef: 'U1' }),
  ]
}

function comp(ref, group, value, x, y, rotation, options = {}) {
  const fp = footprintMap[group] || footprintMap.DEFAULT
  const [width, height] = {
    MCU: [10, 10], ESP32_S3: [48, 41], IMU: [3, 3], USB: [9, 7], RJ45: [16, 16], REGULATOR: [5, 5],
    BLACKBOX: [6, 5], ETHERNET_PHY: [10, 4], POE_FRONT_END: [6, 5], SENSOR_CONNECTOR: [12, 4], ESC_CONNECTOR: [10, 4],
    FIELD_CONNECTOR: [18, 4], MOTOR_HEADER: [14, 4], POWER_INPUT: [11, 8], CAN_TRANSCEIVER: [14, 4], RS485_TRANSCEIVER: [14, 4],
    TERMINAL_BLOCK: [40, 8], ISOLATOR: [6, 5], RELAY_OR_DRIVER: [6, 5], TVS: [2, 1.5], CAP: [2.2, 1.2], RES: [2.2, 1.2],
  }[group] || [4, 3]
  return { ref, group, value, x, y, rotation, width, height, footprint: fp.footprint, footprintFile: fp.file, ...options, pinMap: options.pinMap || defaultPinMap(ref, group, value, options) }
}

function defaultPinMap(ref, group, value, options = {}) {
  if (group === 'USB') return { A1: 'GND', B1: 'GND', A4: 'VUSB', B4: 'VUSB', A5: 'CC1', B5: 'CC2', A6: 'USB_DP', B6: 'USB_DP', A7: 'USB_DN', B7: 'USB_DN', A9: 'VUSB', B9: 'VUSB' }
  if (group === 'ESP32_S3') return esp32S3Wroom1PinMap()
  if (group === 'MCU') return { VDD: '3V3', VSS: 'GND', SWDIO: 'SWDIO', SWCLK: 'SWCLK', NRST: 'NRST' }
  if (group === 'REGULATOR') return { 1: options.netA || 'VUSB', 2: 'GND', 3: 'EN', 5: options.netB || '3V3' }
  if (group === 'SENSOR_CONNECTOR') return { 1: 'GND', 2: '3V3', 3: 'I2C_SCL', 4: 'I2C_SDA' }
  if (group === 'RJ45') return { 'TX+': 'ETH_TX_P', 'TX-': 'ETH_TX_N', 'RX+': 'ETH_RX_P', 'RX-': 'ETH_RX_N', LED: '3V3', SHIELD: 'CHASSIS_GND' }
  if (group === 'ETHERNET_PHY') return { 1: 'ETH_TX_P', 2: 'ETH_TX_N', 3: 'ETH_RX_P', 4: 'ETH_RX_N', 5: 'ETH_MDC', 6: 'ETH_MDIO', 7: '3V3', 8: 'GND' }
  if (group === 'POE_FRONT_END') return { 1: 'POE_VDD', 2: 'POE_RTN', 3: 'POE_DEN', 4: 'POE_CLS', 5: '3V3', 6: 'GND', 7: 'POE_PG', 8: 'POE_AUX' }
  if (group === 'POWER_INPUT') return { 1: options.netA || 'VIN', 2: options.netB || 'GND' }
  if (group === 'CAN_TRANSCEIVER') return { 1: 'CANH', 2: 'CANL', 3: 'CAN_TX', 4: 'CAN_RX', 5: '3V3', 6: 'GND' }
  if (group === 'RS485_TRANSCEIVER') return { 1: 'RS485_A', 2: 'RS485_B', 3: 'RS485_TX', 4: 'RS485_RX', 5: '3V3', 6: 'GND' }
  if (group === 'FIELD_CONNECTOR') return { 1: 'CANH', 2: 'CANL', 3: 'RS485_A', 4: 'RS485_B', 5: 'FIELD_IN1', 6: 'FIELD_OUT1', 7: '24V_FIELD', 8: 'GND_FIELD' }
  if (group === 'MOTOR_HEADER') return { 1: 'GND', 2: 'VIN', 3: 'PWM_1', 4: 'PWM_2', 5: 'ENC_A', 6: 'ENC_B' }
  if (group === 'TERMINAL_BLOCK') return { 1: '24V_FIELD', 2: 'GND_FIELD', 3: 'FIELD_IN1', 4: 'FIELD_OUT1', 5: 'CANH', 6: 'CANL', 7: 'RS485_A', 8: 'RS485_B' }
  if (group === 'ISOLATOR') return { 1: '3V3', 2: 'GND', 3: 'FIELD_IN1', 4: 'FIELD_OUT1', 5: 'ISO_IN1', 6: 'ISO_OUT1', 7: 'GND_FIELD', 8: '24V_FIELD' }
  if (group === 'RELAY_OR_DRIVER') return { 1: '24V_FIELD', 2: 'FIELD_OUT1', 3: 'ISO_OUT1', 4: 'GND_FIELD', 5: '3V3', 6: 'GND', 7: 'FIELD_IN1', 8: 'ISO_IN1' }
  if (group === 'TVS') return { 1: options.netB || 'GND_FIELD', 2: options.netA || (/RS485/i.test(value || '') ? 'RS485_A' : 'FIELD_IN1') }
  if (group === 'BLACKBOX') return { CS: 'FLASH_CS', MISO: 'SPI_MISO', WP: '3V3', GND: 'GND', MOSI: 'SPI_MOSI', SCK: 'SPI_SCK', HOLD: '3V3', VCC: '3V3' }
  if (group === 'IMU') return { VDD: '3V3', VDDIO: '3V3', GND: 'GND', SCL: 'I2C_SCL', SDA: 'I2C_SDA', INT1: 'IMU_INT1', INT2: 'IMU_INT2' }
  if (group === 'ESC_CONNECTOR') return { GND: 'GND', VBAT: 'VBAT', M1: 'MOTOR_1', M2: 'MOTOR_2', M3: 'MOTOR_3', M4: 'MOTOR_4', CURR: 'CURRENT_SENSE', TEL: 'ESC_TELEMETRY' }
  if (group === 'CAP') return { 1: options.netA || (/10uF|bulk|input/i.test(value || '') ? 'VUSB' : '3V3'), 2: options.netB || 'GND' }
  if (group === 'RES') {
    if (/CC1/i.test(value || '')) return { 1: 'CC1', 2: 'GND' }
    if (/CC2/i.test(value || '')) return { 1: 'CC2', 2: 'GND' }
    if (/BOOT/i.test(value || '') || ref === 'R2') return { 1: 'BOOT', 2: '3V3' }
    return { 1: 'EN', 2: '3V3' }
  }
  return {}
}

function esp32S3Wroom1PinMap() {
  return {
    1: 'GND',
    2: '3V3',
    3: 'EN',
    13: 'USB_DN',
    14: 'USB_DP',
    27: 'BOOT',
    32: 'I2C_SCL',
    33: 'I2C_SDA',
    40: 'GND',
    41: 'GND',
  }
}

export async function renderPlacedFootprints(components = [], options = {}) {
  const controlled = await renderPlacedFootprintsFromLibraries(components, options)
  if (controlled.rendered.length) return controlled.rendered
  const rendered = []
  for (const component of components) {
    try {
      const file = path.join(kicadShare, component.footprintFile)
      let content = await readFile(file, 'utf8')
      content = content.replace(/\(footprint\s+"([^"]+)"/, `(footprint "${component.footprint}"`)
      content = content.replace(/(\(layer\s+"F\.Cu"\)\s*)/, `$1\n\t(at ${component.x.toFixed(3)} ${component.y.toFixed(3)} ${component.rotation || 0})\n`)
      content = content.replace(/REF\*\*/g, component.ref)
      content = content.replace(new RegExp(escapeRegExp(path.basename(component.footprint, '')), 'g'), component.value)
      content = content.replace(/\(property\s+"Value"\s+"[^"]+"/, `(property "Value" "${component.value.replace(/"/g, "'")}"`)
      content = content.replace(/\(uuid\s+"[^"]+"\)/g, () => `(uuid "${crypto.randomUUID()}")`)
      rendered.push(content)
    } catch (error) {
      rendered.push(`  (gr_text "${component.ref} footprint missing: ${component.footprint}" (at ${component.x} ${component.y} 0) (layer "Cmts.User")\n    (effects (font (size 1 1) (thickness 0.12))) (uuid "${crypto.randomUUID()}"))`)
    }
  }
  return rendered
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
