import crypto from 'node:crypto'
import { assignNetsToClasses } from './net-classes.mjs'

export function generateSchematicModel(board, components = [], input = {}) {
  const nets = assignNetsToClasses(normalizeNets(input.nets, components))
  const symbols = placeSymbols(components.map((component) => {
    const fallback = fallbackAssets(component)
    const symbol = component.symbol?.libId || component.symbol || fallback.symbol
    const footprint = component.footprint?.libId || component.footprint || fallback.footprint
    const pinMap = hasUsefulPinMap(component.pinMap) ? component.pinMap : fallbackPinMap(component)
    return {
      ref: component.ref,
      value: component.value || component.group || 'component',
      group: component.group || inferGroup(component),
      role: component.role || null,
      symbol,
      footprint,
      model3d: component.model3d || fallback.model3d || null,
      package: component.package || fallback.package || null,
      assetSource: component.assetSource || (fallback.assumed ? 'BoardForge controlled library default' : null),
      assetConfidence: component.assetConfidence || component.confidence || (fallback.assumed ? 'ASSUMED_REVIEW_REQUIRED' : 'UNRESOLVED'),
      reviewNotes: [...new Set([component.reviewNotes, fallback.reviewNotes].filter(Boolean))],
      lcsc: component.lcsc || component.procurement?.lcsc || null,
      mpn: component.mpn || null,
      supportsRef: component.supportsRef || null,
      pinMap,
      pinCount: Object.keys(pinMap || {}).filter((pin) => pinMap[pin]).length,
      uuid: crypto.randomUUID(),
    }
  }))
  const powerSymbols = [...new Set(nets.filter((net) => isPowerNet(net.name)).map((net) => net.name))]
  const diffPairs = detectDiffPairs(nets)
  const warnings = schematicWarnings(symbols, nets)
  const readinessGates = [
    gate('symbol_binding', !symbols.some((item) => !item.symbol), 'Every component must resolve to a KiCad symbol.'),
    gate('footprint_binding', !symbols.some((item) => !item.footprint), 'Every component must resolve to a KiCad footprint.'),
    gate('pin_mapping', !symbols.some((item) => !item.pinCount), 'Every schematic symbol should have mapped electrical pins.'),
    gate('connectivity', !weakNets(nets, symbols).length, 'Every non-power net should have at least two pins.'),
    gate('erc_required', false, 'KiCad ERC must pass before release or PCB sync.'),
  ]
  const blocked = readinessGates.some((item) => item.status === 'blocked' && item.name !== 'erc_required')
  return {
    schemaVersion: 2,
    generatedBy: 'BoardForge Plugin CLI',
    generatedAt: new Date().toISOString(),
    status: blocked ? 'SCHEMATIC_MODEL_NEEDS_ASSET_REVIEW' : 'SCHEMATIC_MODEL_READY_NEEDS_ERC',
    boardName: board.name,
    summary: {
      symbolCount: symbols.length,
      netCount: nets.length,
      powerRails: powerSymbols,
      differentialPairCount: diffPairs.length,
      assumedAssets: symbols.filter((item) => /ASSUMED/i.test(item.assetConfidence || '')).map((item) => item.ref),
      missingAssets: symbols.filter((item) => !item.symbol || !item.footprint).map((item) => item.ref),
    },
    readinessGates,
    symbols,
    nets,
    powerSymbols,
    powerRails: powerSymbols.map((name) => ({
      name,
      pins: pinsForNet(name, symbols).length,
      className: nets.find((net) => net.name === name)?.className || 'POWER',
    })),
    differentialPairs: diffPairs,
    netGroups: groupNets(nets),
    warnings,
    humanReviewRequired: true,
  }
}

export function boardforgeNetlistFromComponents(components = [], nets = []) {
  const mappedComponents = components.map((component) => ({
    ...component,
    pinMap: hasUsefulPinMap(component.pinMap) ? component.pinMap : fallbackPinMap(component),
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
  if (component.group === 'REGULATOR') return { VIN: 'VUSB', GND: 'GND', VOUT: '3V3', EN: '3V3' }
  if (component.group === 'SENSOR_CONNECTOR') return { 1: '3V3', 2: 'GND', 3: 'I2C_SCL', 4: 'I2C_SDA' }
  if (component.group === 'RJ45') return { 'TX+': 'ETH_TX_P', 'TX-': 'ETH_TX_N', 'RX+': 'ETH_RX_P', 'RX-': 'ETH_RX_N', SHIELD: 'CHASSIS' }
  if (component.group === 'CAP') return { 1: '3V3', 2: 'GND' }
  if (component.group === 'RES') return { 1: component.netA || null, 2: component.netB || null }
  if (component.group === 'TVS') return { VBUS: 'VUSB', DP: 'USB_DP', DN: 'USB_DN', GND: 'GND' }
  return {}
}

function hasUsefulPinMap(pinMap) {
  return Boolean(pinMap && Object.keys(pinMap).length && Object.values(pinMap).some(Boolean))
}

export function kicadSchematicFromModel(board, schematicModel) {
  const symbolText = schematicModel.symbols.map((symbol) => symbolObject(symbol)).join('\n')
  const connectivity = []
  const netLabels = schematicModel.nets.map((net, index) => noteObject(`net ${net.name}`, 25, 176 + index * 4))
  const reviewText = reviewObjects(schematicModel)
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
\t\t(comment 1 "BoardForge schematic model generated for ERC and human review.")
\t\t(comment 2 "Generated from structured BoardForge component, pin-map, and net intent.")
\t)
\t(lib_symbols)
${reviewText}
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
\t\t(property "BoardForge_Group" "${safe(symbol.group || '')}"
\t\t\t(at ${symbol.at.x} ${symbol.at.y + 11} 0)
\t\t\t(effects (font (size 0.8 0.8)) hide)
\t\t)
\t\t(property "BoardForge_AssetConfidence" "${safe(symbol.assetConfidence || '')}"
\t\t\t(at ${symbol.at.x} ${symbol.at.y + 13} 0)
\t\t\t(effects (font (size 0.8 0.8)) hide)
\t\t)
\t)`
}

function pinConnectivityObjects(symbol) {
  return Object.entries(symbol.pinMap || {}).filter(([, net]) => net).flatMap(([pin, net], index) => {
    const x = symbol.at.x + 18
    const y = symbol.at.y + index * 3
    return [
      `\t(wire (pts (xy ${symbol.at.x + 5} ${y}) (xy ${x} ${y}))\n\t\t(stroke (width 0) (type default))\n\t\t(uuid "${crypto.randomUUID()}")\n\t)`,
      labelObject(net, x, y, isPowerNet(net)),
      `\t(text "${safe(`${symbol.ref}.${pin}`)}"\n\t\t(at ${symbol.at.x + 6} ${y - 1.2} 0)\n\t\t(effects (font (size 0.7 0.7)) (justify left bottom))\n\t\t(uuid "${crypto.randomUUID()}")\n\t)`,
    ]
  })
}

function labelObject(name, x, y, global = false) {
  const tag = global ? 'global_label' : 'label'
  const shape = global ? '\n\t\t(shape input)' : ''
  return `\t(${tag} "${safe(name)}"${shape}\n\t\t(at ${x} ${y} 0)\n\t\t(effects (font (size 1.0 1.0)) (justify left bottom))\n\t\t(uuid "${crypto.randomUUID()}")\n\t)`
}

function noteObject(text, x, y) {
  return `\t(text "${safe(text)}"\n\t\t(at ${x} ${y} 0)\n\t\t(effects (font (size 0.9 0.9)) (justify left bottom))\n\t\t(uuid "${crypto.randomUUID()}")\n\t)`
}

function normalizeNets(nets = [], components = []) {
  const fromPins = components.flatMap((component) => Object.values(component.pinMap || {}).filter(Boolean).map((name) => ({ name })))
  const base = nets.length ? nets : fromPins
  return [...new Map(base.map((net) => [net.name, net])).values()]
}

function placeSymbols(symbols) {
  const lanes = {
    connector_left: { x: 22, y: 36, count: 0 },
    power_top: { x: 78, y: 28, count: 0 },
    controller_center: { x: 88, y: 72, count: 0 },
    support_bottom: { x: 35, y: 116, count: 0 },
    sensor_right: { x: 144, y: 52, count: 0 },
    generic: { x: 122, y: 112, count: 0 },
  }
  return symbols.map((symbol) => {
    const lane = lanes[laneForSymbol(symbol)]
    const at = { x: lane.x + (lane.count % 2) * 32, y: lane.y + Math.floor(lane.count / 2) * 24 }
    lane.count += 1
    return { ...symbol, at }
  })
}

function laneForSymbol(symbol) {
  const text = `${symbol.group || ''} ${symbol.value || ''} ${symbol.ref || ''}`
  if (/(USB|RJ45|CONNECTOR|JST|SWD)/i.test(text)) return 'connector_left'
  if (/(REGULATOR|LDO|BUCK|PMIC|POWER|POE)/i.test(text)) return 'power_top'
  if (/(ESP32|STM32|MCU|PROCESSOR|FPGA|SOC)/i.test(text)) return 'controller_center'
  if (/(CAP|RES|TVS|ESD|CRYSTAL|OSCILLATOR)/i.test(text) || symbol.role === 'support_component') return 'support_bottom'
  if (/(SENSOR|IMU|BAROMETER|ADC|FLASH)/i.test(text)) return 'sensor_right'
  return 'generic'
}

function fallbackAssets(component) {
  const group = inferGroup(component)
  if (group === 'CAP') return assumedAsset('Device:C', /10uF|1uF/i.test(component.value || '') ? 'Capacitor_SMD:C_0805_2012Metric' : 'Capacitor_SMD:C_0603_1608Metric', 'Capacitor value/package default requires review.', /10uF|1uF/i.test(component.value || '') ? '0805' : '0603')
  if (group === 'RES') return assumedAsset('Device:R', 'Resistor_SMD:R_0603_1608Metric', 'Resistor value/package default requires review.', '0603')
  if (group === 'TVS') return assumedAsset('Device:D_TVS_x2_AAC', 'Package_TO_SOT_SMD:SOT-23-6', 'TVS package is a controlled placeholder; select an exact part.', 'SOT-23-6')
  if (group === 'REGULATOR') return assumedAsset('Regulator_Linear:AP2112K-3.3', 'Package_TO_SOT_SMD:SOT-23-5', 'Regulator default is an assumption; verify current, thermal, and pinout.', 'SOT-23-5')
  if (group === 'USB') return assumedAsset('Connector:USB_C_Receptacle_USB2.0', 'Connector_USB:USB_C_Receptacle_HRO_TYPE-C-31-M-12', 'USB-C connector footprint must match selected supplier part.', 'USB-C')
  if (group === 'ESP32_S3') return assumedAsset('RF_Module:ESP32-S3-WROOM-1', 'RF_Module:ESP32-S3-WROOM-1', 'ESP32 module variant and antenna keepout must be verified.', 'module')
  if (group === 'RJ45') return assumedAsset('Connector:RJ45', 'Connector_RJ:RJ45_Amphenol_RJHSE538X', 'RJ45 magnetics and footprint must match selected part.', 'RJ45')
  return {}
}

function assumedAsset(symbol, footprint, reviewNotes, packageName) {
  return { symbol, footprint, reviewNotes, package: packageName, assumed: true, model3d: null }
}

function schematicWarnings(symbols, nets) {
  const warnings = [
    { severity: 'WARNING', code: 'ERC_REQUIRED', message: 'KiCad ERC must pass before PCB sync, placement signoff, or export.' },
  ]
  for (const symbol of symbols) {
    if (!symbol.symbol) warnings.push({ severity: 'WARNING', code: 'SYMBOL_UNRESOLVED', message: `${symbol.ref} has no KiCad symbol binding.`, ref: symbol.ref })
    if (!symbol.footprint) warnings.push({ severity: 'WARNING', code: 'FOOTPRINT_UNRESOLVED', message: `${symbol.ref} has no KiCad footprint binding.`, ref: symbol.ref })
    if (!symbol.pinCount) warnings.push({ severity: 'WARNING', code: 'PIN_MAP_EMPTY', message: `${symbol.ref} has no mapped schematic pins.`, ref: symbol.ref })
    if (/ASSUMED/i.test(symbol.assetConfidence || '')) warnings.push({ severity: 'WARNING', code: 'ASSET_ASSUMPTION_REVIEW', message: `${symbol.ref} uses a controlled default asset and needs part-number review.`, ref: symbol.ref })
  }
  for (const net of weakNets(nets, symbols)) warnings.push({ severity: 'WARNING', code: 'NET_HAS_FEWER_THAN_TWO_PINS', message: `${net.name} has ${net.pinCount} mapped pin(s).`, net: net.name })
  return warnings
}

function weakNets(nets, symbols) {
  return nets.map((net) => ({ ...net, pinCount: pinsForNet(net.name, symbols).length }))
    .filter((net) => net.pinCount < 2 && !isPowerNet(net.name) && !/^CHASSIS$/i.test(net.name))
}

function pinsForNet(name, symbols) {
  return symbols.flatMap((symbol) => Object.entries(symbol.pinMap || {})
    .filter(([, net]) => net === name)
    .map(([pin]) => ({ ref: symbol.ref, pin })))
}

function detectDiffPairs(nets) {
  const names = new Set(nets.map((net) => net.name))
  const pairs = [
    ['USB_DP', 'USB_DN', 'USB'],
    ['ETH_TX_P', 'ETH_TX_N', 'ETH_TX'],
    ['ETH_RX_P', 'ETH_RX_N', 'ETH_RX'],
    ['CAN_P', 'CAN_N', 'CAN'],
  ]
  return pairs.filter(([p, n]) => names.has(p) || names.has(n)).map(([positive, negative, name]) => ({
    name,
    positive,
    negative,
    status: names.has(positive) && names.has(negative) ? 'PAIR_COMPLETE_NEEDS_LENGTH_MATCH' : 'PAIR_INCOMPLETE',
  }))
}

function groupNets(nets) {
  return {
    power: nets.filter((net) => isPowerNet(net.name)).map((net) => net.name),
    differential: [...new Set(detectDiffPairs(nets).flatMap((pair) => [pair.positive, pair.negative]))],
    signal: nets.filter((net) => !isPowerNet(net.name)).map((net) => net.name),
  }
}

function gate(name, pass, message) {
  return { name, status: pass ? 'passed' : 'blocked', message }
}

function reviewObjects(schematicModel) {
  const lines = [
    `BoardForge generated schematic - review required`,
    `Power rails: ${(schematicModel.powerSymbols || []).join(', ') || 'none mapped'}`,
    `Differential pairs: ${(schematicModel.differentialPairs || []).map((pair) => `${pair.positive}/${pair.negative}`).join(', ') || 'none'}`,
    `Required gates: ERC, schematic/PCB sync, DRC before manufacturing export`,
  ]
  return lines.map((line, index) => `\t(text "${safe(line)}"\n\t\t(at 25 ${18 + index * 5} 0)\n\t\t(effects (font (size 1.1 1.1)) (justify left bottom))\n\t\t(uuid "${crypto.randomUUID()}")\n\t)`).join('\n')
}

function inferGroup(component) {
  const text = `${component.group || ''} ${component.ref || ''} ${component.value || ''} ${component.mpn || ''}`
  if (/usb/i.test(text)) return 'USB'
  if (/rj45|ethernet/i.test(text)) return 'RJ45'
  if (/esp32/i.test(text)) return 'ESP32_S3'
  if (/regulator|ldo|buck/i.test(text)) return 'REGULATOR'
  if (/cap|uf|nf/i.test(text)) return 'CAP'
  if (/res|ohm|pull/i.test(text)) return 'RES'
  if (/tvs|esd/i.test(text)) return 'TVS'
  if (/sensor|imu|barometer/i.test(text)) return 'SENSOR_CONNECTOR'
  return component.group || 'GENERIC'
}

function isPowerNet(name) {
  return /^(GND|3V3|5V|VIN|VBAT|VUSB|VCC|VDD|VDDA|CHASSIS)$/i.test(name || '')
}

function safe(value) {
  return String(value || '').replace(/"/g, "'")
}
