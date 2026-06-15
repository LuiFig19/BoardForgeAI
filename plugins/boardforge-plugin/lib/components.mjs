import crypto from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { polygonBounds } from './geometry.mjs'
import { renderPlacedFootprintsFromLibraries } from './library-adapter.mjs'

const kicadShare = 'C:\\Program Files\\KiCad\\10.0\\share\\kicad\\footprints'

const footprintMap = {
  MCU: { footprint: 'Package_DFN_QFN:QFN-56-1EP_7x7mm_P0.4mm_EP4x4mm', file: 'Package_DFN_QFN.pretty\\QFN-56-1EP_7x7mm_P0.4mm_EP4x4mm.kicad_mod' },
  ESP32_S3: { footprint: 'RF_Module:ESP32-S2-WROVER', file: 'RF_Module.pretty\\ESP32-S2-WROVER.kicad_mod' },
  IMU: { footprint: 'Package_LGA:LGA-16_3x3mm_P0.5mm', file: 'Package_LGA.pretty\\LGA-16_3x3mm_P0.5mm.kicad_mod' },
  USB: { footprint: 'Connector_USB:USB_C_Receptacle_Amphenol_12401610E4-2A', file: 'Connector_USB.pretty\\USB_C_Receptacle_Amphenol_12401610E4-2A.kicad_mod' },
  RJ45: { footprint: 'Connector_RJ:RJ45_Amphenol_RJHSE538X', file: 'Connector_RJ.pretty\\RJ45_Amphenol_RJHSE538X.kicad_mod' },
  REGULATOR: { footprint: 'Package_TO_SOT_SMD:SOT-23-5', file: 'Package_TO_SOT_SMD.pretty\\SOT-23-5.kicad_mod' },
  BLACKBOX: { footprint: 'Package_SO:SOIC-8_3.9x4.9mm_P1.27mm', file: 'Package_SO.pretty\\SOIC-8_3.9x4.9mm_P1.27mm.kicad_mod' },
  SENSOR_CONNECTOR: { footprint: 'Connector_PinHeader_2.54mm:PinHeader_1x04_P2.54mm_Vertical', file: 'Connector_PinHeader_2.54mm.pretty\\PinHeader_1x04_P2.54mm_Vertical.kicad_mod' },
  ESC_CONNECTOR: { footprint: 'Connector_PinHeader_2.54mm:PinHeader_1x08_P2.54mm_Vertical', file: 'Connector_PinHeader_2.54mm.pretty\\PinHeader_1x08_P2.54mm_Vertical.kicad_mod' },
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
      comp('J1', 'RJ45', 'RJ45 MagJack', bounds.minX + 10, cy, 90),
      comp('U1', 'ESP32_S3', 'ESP32-S3 module', cx + 12, cy, 0),
      comp('U2', 'REGULATOR', '3V3 regulator', cx - 5, cy + 11, 0),
      comp('U3', 'BLACKBOX', 'Ethernet/PoE controller placeholder', cx - 8, cy - 8, 0),
      comp('J2', 'USB', 'USB-C service', bounds.maxX - 7, cy + 11, 270),
      comp('J3', 'SENSOR_CONNECTOR', 'I2C sensor header', bounds.maxX - 8, cy - 12, 270),
      comp('C1', 'CAP', '10uF', cx - 14, cy + 10, 0),
      comp('R1', 'RES', '10k', cx + 1, cy + 10, 0),
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
      comp('C1', 'CAP', '100nF', cx + 7, cy + 1, 0),
      comp('R1', 'RES', '10k', cx - 7, cy + 1, 0),
    ]
  }
  return [
    comp('U1', templateId === 'ESP32_S3_SENSOR' ? 'ESP32_S3' : 'MCU', templateId === 'ESP32_S3_SENSOR' ? 'ESP32-S3 module' : 'MCU placeholder', cx, cy, 0),
    comp('J1', 'USB', 'USB-C', bounds.minX + 7, cy, 90),
    comp('U2', 'REGULATOR', '3V3 regulator', cx - 14, cy + 8, 0),
    comp('J2', 'SENSOR_CONNECTOR', 'I2C sensor header', bounds.maxX - 8, cy, 270),
    comp('C1', 'CAP', '10uF', cx - 8, cy + 8, 0),
    comp('C2', 'CAP', '100nF', cx + 8, cy + 8, 0),
    comp('R1', 'RES', '10k', cx - 8, cy - 8, 0),
    comp('R2', 'RES', '10k', cx + 8, cy - 8, 0),
  ]
}

function comp(ref, group, value, x, y, rotation) {
  const fp = footprintMap[group] || footprintMap.DEFAULT
  const [width, height] = {
    MCU: [10, 10], ESP32_S3: [18, 14], IMU: [3, 3], USB: [9, 7], RJ45: [16, 16], REGULATOR: [5, 5],
    BLACKBOX: [6, 5], SENSOR_CONNECTOR: [10, 4], ESC_CONNECTOR: [10, 4], CAP: [1.6, 0.8], RES: [1.6, 0.8],
  }[group] || [4, 3]
  return { ref, group, value, x, y, rotation, width, height, footprint: fp.footprint, footprintFile: fp.file }
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
