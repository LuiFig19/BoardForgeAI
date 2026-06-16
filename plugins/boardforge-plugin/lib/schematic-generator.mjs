import crypto from 'node:crypto'
import { assignNetsToClasses } from './net-classes.mjs'

export function generateSchematicModel(board, components = [], input = {}) {
  const nets = assignNetsToClasses(normalizeNets(input.nets, components))
  const symbols = components.map((component, index) => ({
    ref: component.ref,
    value: component.value || component.group || 'component',
    symbol: component.symbol?.libId || component.symbol || null,
    footprint: component.footprint?.libId || component.footprint || null,
    at: { x: 25 + (index % 3) * 45, y: 35 + Math.floor(index / 3) * 32 },
    pinMap: Object.keys(component.pinMap || {}).length ? component.pinMap : fallbackPinMap(component),
    uuid: crypto.randomUUID(),
  }))
  return {
    status: symbols.every((item) => item.symbol && item.footprint) ? 'SCHEMATIC_MODEL_READY_NEEDS_ERC' : 'SCHEMATIC_MODEL_NEEDS_ASSET_REVIEW',
    boardName: board.name,
    symbols,
    nets,
    powerSymbols: [...new Set(nets.filter((net) => /^(GND|3V3|5V|VIN|VBAT|VUSB)$/i.test(net.name)).map((net) => net.name))],
    warnings: ['Native KiCad symbol placement is still review-required; run ERC after generation.'],
    humanReviewRequired: true,
  }
}

export function boardforgeNetlistFromComponents(components = [], nets = []) {
  const mappedComponents = components.map((component) => ({
    ...component,
    pinMap: Object.keys(component.pinMap || {}).length ? component.pinMap : fallbackPinMap(component),
  }))
  const netMap = new Map((nets || []).map((net) => [net.name, { name: net.name, className: net.className || 'DEFAULT', pins: [] }]))
  for (const component of mappedComponents) {
    for (const [pin, netName] of Object.entries(component.pinMap || {})) {
      if (!netName) continue
      const entry = netMap.get(netName) || { name: netName, className: 'DEFAULT', pins: [] }
      entry.pins.push({ ref: component.ref, pin, group: component.group || null, value: component.value || null })
      netMap.set(netName, entry)
    }
  }
  return {
    schemaVersion: 1,
    generatedBy: 'BoardForge Plugin CLI',
    components: mappedComponents.map((component) => ({
      ref: component.ref,
      value: component.value || component.group || '',
      group: component.group || null,
      symbol: component.symbol?.libId || component.symbol || null,
      footprint: component.footprint?.libId || component.footprint || null,
      pinCount: Object.keys(component.pinMap || {}).length,
    })),
    nets: [...netMap.values()].sort((a, b) => a.name.localeCompare(b.name)),
    warnings: [...netMap.values()].filter((net) => net.pins.length < 2).map((net) => ({ severity: 'WARNING', code: 'NET_HAS_FEWER_THAN_TWO_PINS', message: `${net.name} has ${net.pins.length} mapped pin(s).`, net: net.name })),
    humanReviewRequired: true,
  }
}

function fallbackPinMap(component) {
  if (component.group === 'USB') return { VBUS: 'VUSB', GND: 'GND', 'D+': 'USB_DP', 'D-': 'USB_DN', CC1: 'CC1', CC2: 'CC2' }
  if (component.group === 'ESP32_S3') return { '3V3': '3V3', GND: 'GND', USB_DP: 'USB_DP', USB_DN: 'USB_DN', SCL: 'I2C_SCL', SDA: 'I2C_SDA', EN: 'EN', IO0: 'BOOT' }
  if (component.group === 'REGULATOR') return { VIN: 'VIN', GND: 'GND', VOUT: '3V3', EN: 'EN' }
  if (component.group === 'SENSOR_CONNECTOR') return { 1: '3V3', 2: 'GND', 3: 'I2C_SCL', 4: 'I2C_SDA' }
  if (component.group === 'RJ45') return { 'TX+': 'ETH_TX_P', 'TX-': 'ETH_TX_N', 'RX+': 'ETH_RX_P', 'RX-': 'ETH_RX_N', SHIELD: 'CHASSIS' }
  if (component.group === 'CAP') return { 1: '3V3', 2: 'GND' }
  if (component.group === 'RES') return { 1: null, 2: null }
  return {}
}

export function kicadSchematicFromModel(board, schematicModel) {
  const symbolText = schematicModel.symbols.map((symbol) => symbolObject(symbol)).join('\n')
  const connectivity = schematicModel.symbols.flatMap((symbol) => pinConnectivityObjects(symbol))
  const netLabels = schematicModel.nets.map((net, index) => labelObject(net.name, 25, 160 + index * 4, /^(GND|3V3|5V|VIN|VBAT|VUSB)$/i.test(net.name)))
  const instances = schematicModel.symbols.map((symbol) => `\t\t(path "/${symbol.uuid}"\n\t\t\t(reference "${safe(symbol.ref)}")\n\t\t\t(unit 1)\n\t\t\t(value "${safe(symbol.value)}")\n\t\t\t(footprint "${safe(symbol.footprint || '')}")\n\t\t)`).join('\n')
  return `(kicad_sch
\t(version 20250114)
\t(generator "BoardForge Plugin CLI")
\t(generator_version "0.1.0")
\t(uuid "${crypto.randomUUID()}")
\t(paper "A4")
\t(title_block
\t\t(title "${safe(board.name)}")
\t\t(company "BoardForge AI")
\t\t(comment 1 "BoardForge schematic model. ERC and human review required.")
\t)
\t(lib_symbols)
${symbolText}
${connectivity.join('\n')}
${netLabels.join('\n')}
\t(sheet_instances
\t\t(path "/" (page "1"))
\t)
\t(symbol_instances
${instances}
\t)
\t(embedded_fonts no)
)
`
}

function symbolObject(symbol) {
  const libId = symbol.symbol || 'Device:R'
  return `\t(symbol
\t\t(lib_id "${safe(libId)}")
\t\t(at ${symbol.at.x} ${symbol.at.y} 0)
\t\t(unit 1)
\t\t(exclude_from_sim no)
\t\t(in_bom yes)
\t\t(on_board yes)
\t\t(dnp no)
\t\t(uuid "${symbol.uuid}")
\t\t(property "Reference" "${safe(symbol.ref)}"
\t\t\t(at ${symbol.at.x} ${symbol.at.y - 4} 0)
\t\t\t(effects (font (size 1.27 1.27)))
\t\t)
\t\t(property "Value" "${safe(symbol.value)}"
\t\t\t(at ${symbol.at.x} ${symbol.at.y + 4} 0)
\t\t\t(effects (font (size 1.27 1.27)))
\t\t)
\t\t(property "Footprint" "${safe(symbol.footprint || '')}"
\t\t\t(at ${symbol.at.x} ${symbol.at.y + 8} 0)
\t\t\t(effects (font (size 1.0 1.0)) hide)
\t\t)
\t)`
}

function pinConnectivityObjects(symbol) {
  return Object.entries(symbol.pinMap || {}).filter(([, net]) => net).flatMap(([pin, net], index) => {
    const x = symbol.at.x + 18
    const y = symbol.at.y + index * 3
    return [
      `\t(wire (pts (xy ${symbol.at.x + 5} ${y}) (xy ${x} ${y}))\n\t\t(stroke (width 0) (type default))\n\t\t(uuid "${crypto.randomUUID()}")\n\t)`,
      labelObject(net, x, y, /^(GND|3V3|5V|VIN|VBAT|VUSB)$/i.test(net)),
      `\t(text "${safe(`${symbol.ref}.${pin}`)}"\n\t\t(at ${symbol.at.x + 6} ${y - 1.2} 0)\n\t\t(effects (font (size 0.7 0.7)) (justify left bottom))\n\t\t(uuid "${crypto.randomUUID()}")\n\t)`,
    ]
  })
}

function labelObject(name, x, y, global = false) {
  const tag = global ? 'global_label' : 'label'
  const shape = global ? '\n\t\t(shape input)' : ''
  return `\t(${tag} "${safe(name)}"${shape}\n\t\t(at ${x} ${y} 0)\n\t\t(effects (font (size 1.0 1.0)) (justify left bottom))\n\t\t(uuid "${crypto.randomUUID()}")\n\t)`
}

function normalizeNets(nets = [], components = []) {
  const fromPins = components.flatMap((component) => Object.values(component.pinMap || {}).filter(Boolean).map((name) => ({ name })))
  const base = nets.length ? nets : fromPins
  return [...new Map(base.map((net) => [net.name, net])).values()]
}

function safe(value) {
  return String(value || '').replace(/"/g, "'")
}
