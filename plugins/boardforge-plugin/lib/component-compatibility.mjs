import { readFile } from 'node:fs/promises'

export async function validateComponentBindings(components = []) {
  const results = []
  for (const component of components) {
    results.push(await validateSingleComponentBinding(component))
  }
  const errors = results.flatMap((item) => item.issues.filter((issue) => issue.severity === 'ERROR'))
  const warnings = results.flatMap((item) => item.issues.filter((issue) => issue.severity === 'WARNING'))
  return {
    status: errors.length ? 'COMPONENT_BINDINGS_NEED_FIX' : warnings.length ? 'COMPONENT_BINDINGS_NEED_REVIEW' : 'COMPONENT_BINDINGS_VALID_NEEDS_REVIEW',
    checked: results.length,
    results,
    warnings,
    errors,
    humanReviewRequired: true,
  }
}

async function validateSingleComponentBinding(component) {
  const symbolPins = await loadSymbolPins(component.symbol)
  const footprintData = await loadFootprintData(component.footprint)
  const footprintPads = footprintData.pads
  const pinMap = component.pinMap || {}
  const issues = []

  if (!component.symbol) issues.push(issue('WARNING', 'SYMBOL_MISSING', `${component.ref} has no resolved KiCad symbol.`))
  if (!component.footprint) issues.push(issue('ERROR', 'FOOTPRINT_MISSING', `${component.ref} has no resolved KiCad footprint.`))
  if (component.symbol && !symbolPins.length) issues.push(issue('WARNING', 'SYMBOL_PINS_UNKNOWN', `${component.ref} symbol pins could not be parsed.`, { symbol: assetId(component.symbol) }))
  if (component.footprint && !footprintPads.length) issues.push(issue('ERROR', 'FOOTPRINT_PADS_UNKNOWN', `${component.ref} footprint pads could not be parsed.`, { footprint: assetId(component.footprint) }))

  const pinMapKeys = Object.keys(pinMap)
  if (!pinMapKeys.length) issues.push(issue('WARNING', 'PIN_MAP_MISSING', `${component.ref} has no BoardForge pin map, so nets cannot be assigned safely.`))

  const padNames = new Set(footprintPads.map((pad) => pad.name))
  const symbolNumbers = new Set(symbolPins.map((pin) => pin.number))
  const symbolNames = new Set(symbolPins.map((pin) => pin.name))
  const unmatchedPadKeys = pinMapKeys.filter((key) => footprintPads.length && !padNames.has(key) && !padNames.has(stripLeadingZeros(key)))
  const unmatchedSymbolKeys = pinMapKeys.filter((key) => symbolPins.length && !symbolNumbers.has(key) && !symbolNames.has(key) && !symbolNumbers.has(stripLeadingZeros(key)))
  const criticalPins = criticalPinsFor(component)
  const missingCriticalPins = criticalPins.filter((pin) => !pinMapKeys.some((key) => samePin(key, pin)) && !Object.values(pinMap).some((net) => samePin(net, pin)))
  const netCoverage = netCoverageFor(pinMap)
  const padTypeSummary = summarizePads(footprintPads)
  const equivalence = scoreSymbolFootprintEquivalence({ component, symbolPins, footprintPads, pinMap })

  if (unmatchedPadKeys.length) {
    issues.push(issue('WARNING', 'PIN_MAP_KEYS_NOT_FOOTPRINT_PADS', `${component.ref} pin map has keys that do not match parsed footprint pads.`, { keys: unmatchedPadKeys.slice(0, 12), footprint: assetId(component.footprint) }))
  }
  if (unmatchedSymbolKeys.length) {
    issues.push(issue('WARNING', 'PIN_MAP_KEYS_NOT_SYMBOL_PINS', `${component.ref} pin map has keys that do not match parsed symbol pins.`, { keys: unmatchedSymbolKeys.slice(0, 12), symbol: assetId(component.symbol) }))
  }
  if (symbolPins.length && footprintPads.length && Math.abs(symbolPins.length - footprintPads.length) > Math.max(8, symbolPins.length * 0.5)) {
    issues.push(issue('WARNING', 'SYMBOL_FOOTPRINT_PIN_COUNT_DIVERGES', `${component.ref} symbol pin count and footprint pad count are far apart.`, { symbolPins: symbolPins.length, footprintPads: footprintPads.length }))
  }
  if (equivalence.status === 'mismatch') {
    issues.push(issue('ERROR', 'SYMBOL_FOOTPRINT_PIN_EQUIVALENCE_FAILED', `${component.ref} symbol pins, footprint pads, and pin map do not agree closely enough for safe schematic/PCB sync.`, equivalence))
  } else if (equivalence.status === 'weak') {
    issues.push(issue('WARNING', 'SYMBOL_FOOTPRINT_PIN_EQUIVALENCE_WEAK', `${component.ref} symbol/footprint equivalence is weak and should be reviewed.`, equivalence))
  }
  if (missingCriticalPins.length) {
    issues.push(issue('ERROR', 'CRITICAL_PIN_INTENT_MISSING', `${component.ref} pin map is missing critical power, ground, differential, or service pins.`, { missingCriticalPins }))
  }
  if (netCoverage.powerPins === 0 && requiresPower(component)) {
    issues.push(issue('WARNING', 'POWER_PIN_MAPPING_MISSING', `${component.ref} likely needs explicit power pin mapping before schematic/PCB sync.`))
  }
  if (netCoverage.groundPins === 0 && requiresGround(component)) {
    issues.push(issue('WARNING', 'GROUND_PIN_MAPPING_MISSING', `${component.ref} likely needs explicit ground pin mapping before schematic/PCB sync.`))
  }

  return {
    ref: component.ref,
    group: component.group,
    value: component.value,
    symbol: assetId(component.symbol),
    footprint: assetId(component.footprint),
    symbolPinCount: symbolPins.length,
    footprintPadCount: footprintPads.length,
    courtyard: footprintData.courtyard,
    mappedPins: pinMapKeys.length,
    netCoverage,
    padTypeSummary,
    equivalence,
    missingCriticalPins,
    compatibilityScore: compatibilityScore({ symbolPins, footprintPads, pinMapKeys, issues, netCoverage, equivalence }),
    recommendedActions: recommendedActions(component, issues),
    issues,
  }
}

async function loadSymbolPins(symbol) {
  if (symbol && typeof symbol === 'object' && Array.isArray(symbol.pins)) return symbol.pins
  const path = symbol && typeof symbol === 'object' ? symbol.path : null
  const libId = assetId(symbol)
  if (!path) return []
  try {
    return parseSymbolPinsFromText(await readFile(path, 'utf8'), libId)
  } catch {
    return []
  }
}

async function loadFootprintData(footprint) {
  if (footprint && typeof footprint === 'object' && Array.isArray(footprint.pads)) {
    return {
      pads: footprint.pads,
      courtyard: footprint.courtyard || { segments: [], bounds: null, width: 0, height: 0 },
    }
  }
  const path = footprint && typeof footprint === 'object' ? footprint.path : null
  if (!path) return { pads: [], courtyard: { segments: [], bounds: null, width: 0, height: 0 } }
  try {
    const text = await readFile(path, 'utf8')
    return { pads: parseFootprintPadsFromText(text), courtyard: parseFootprintCourtyardFromText(text) }
  } catch {
    return { pads: [], courtyard: { segments: [], bounds: null, width: 0, height: 0 } }
  }
}

export function parseFootprintPadsFromText(text) {
  const pads = []
  const pattern = /\(pad\s+"([^"]+)"\s+([^\s)]+)\s+([^\s)]+)/g
  let match = pattern.exec(String(text || ''))
  while (match) {
    const end = findClosingParen(text, match.index)
    if (end < 0) break
    const block = String(text || '').slice(match.index, end + 1)
    const at = block.match(/\(at\s+([-\d.]+)\s+([-\d.]+)(?:\s+([-\d.]+))?/)
    const size = block.match(/\(size\s+([-\d.]+)\s+([-\d.]+)/)
    const drill = block.match(/\(drill\s+([-\d.]+)/)
    const layers = [...block.matchAll(/"([^"]*\.Cu|\*\.Cu|[^"]*\.Mask|[^"]*\.Paste)"/g)].map((item) => item[1])
    pads.push({
      name: match[1],
      type: match[2],
      shape: match[3],
      x: at ? Number(at[1]) : 0,
      y: at ? Number(at[2]) : 0,
      rotation: at?.[3] ? Number(at[3]) : 0,
      widthMm: size ? Number(size[1]) : 0,
      heightMm: size ? Number(size[2]) : 0,
      drillMm: drill ? Number(drill[1]) : null,
      layers,
      throughHole: match[2] === 'thru_hole' || Boolean(drill),
      copper: layers.some((layer) => layer === '*.Cu' || /\.Cu$/.test(layer)),
    })
    pattern.lastIndex = end + 1
    match = pattern.exec(String(text || ''))
  }
  return pads
}

export function parseFootprintCourtyardFromText(text) {
  const segments = []
  const pattern = /\((?:fp_line|gr_line)\s+\(start\s+([-\d.]+)\s+([-\d.]+)\)\s+\(end\s+([-\d.]+)\s+([-\d.]+)\)[\s\S]*?\(layer\s+"F\.CrtYd"\)/g
  for (const match of String(text || '').matchAll(pattern)) {
    segments.push({ start: { x: Number(match[1]), y: Number(match[2]) }, end: { x: Number(match[3]), y: Number(match[4]) } })
  }
  if (!segments.length) return { segments: [], bounds: null, width: 0, height: 0 }
  const points = segments.flatMap((segment) => [segment.start, segment.end])
  const bounds = {
    minX: Math.min(...points.map((point) => point.x)),
    minY: Math.min(...points.map((point) => point.y)),
    maxX: Math.max(...points.map((point) => point.x)),
    maxY: Math.max(...points.map((point) => point.y)),
  }
  return { segments, bounds, width: Number((bounds.maxX - bounds.minX).toFixed(3)), height: Number((bounds.maxY - bounds.minY).toFixed(3)) }
}

export function parseSymbolPinsFromText(text, libId = '') {
  const symbolName = String(libId).split(':').pop()
  const body = symbolName ? extractSymbolBody(text, symbolName) || String(text || '') : String(text || '')
  const pins = []
  const pinPattern = /\(pin\s+([^\s)]+)\s+([^\s)]+)/g
  let match = pinPattern.exec(body)
  while (match) {
    const end = findClosingParen(body, match.index)
    if (end < 0) break
    const block = body.slice(match.index, end + 1)
    const name = block.match(/\(name\s+"([^"]*)"/)?.[1]
    const number = block.match(/\(number\s+"([^"]*)"/)?.[1]
    if (name || number) pins.push({ name: name || '', number: number || '', electricalType: match[1], graphicalStyle: match[2] })
    pinPattern.lastIndex = end + 1
    match = pinPattern.exec(body)
  }
  return dedupePins(pins)
}

function extractSymbolBody(text, symbolName) {
  const pattern = new RegExp(`\\(symbol\\s+"(?:[^":]+:)?${escapeRegExp(symbolName)}"`)
  const match = pattern.exec(text)
  if (!match) return null
  const end = findClosingParen(text, match.index)
  return end < 0 ? null : text.slice(match.index, end + 1)
}

function findClosingParen(text, start) {
  let depth = 0
  for (let index = start; index < text.length; index += 1) {
    if (text[index] === '(') depth += 1
    if (text[index] === ')') depth -= 1
    if (depth === 0) return index
  }
  return -1
}

function dedupePins(pins) {
  const seen = new Set()
  return pins.filter((pin) => {
    const key = `${pin.number}|${pin.name}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function compatibilityScore({ symbolPins, footprintPads, pinMapKeys, issues, netCoverage = {}, equivalence = {} }) {
  let score = 100
  if (!symbolPins.length) score -= 20
  if (!footprintPads.length) score -= 35
  if (!pinMapKeys.length) score -= 25
  if ((netCoverage.powerPins || 0) === 0) score -= 8
  if ((netCoverage.groundPins || 0) === 0) score -= 8
  if ((netCoverage.differentialPins || 0) === 1) score -= 12
  if (Number.isFinite(equivalence.score)) score -= Math.max(0, 100 - equivalence.score) * 0.35
  score -= issues.filter((item) => item.severity === 'ERROR').length * 30
  score -= issues.filter((item) => item.severity === 'WARNING').length * 8
  return Math.max(0, Math.min(100, score))
}

function scoreSymbolFootprintEquivalence({ component, symbolPins = [], footprintPads = [], pinMap = {} }) {
  const padNames = new Set(footprintPads.map((pad) => normalizePin(pad.name)))
  const symbolNumbers = new Set(symbolPins.map((pin) => normalizePin(pin.number)).filter(Boolean))
  const symbolNames = new Set(symbolPins.map((pin) => normalizePin(pin.name)).filter(Boolean))
  const mappedKeys = Object.keys(pinMap).map(normalizePin)
  const mappedValues = Object.values(pinMap).map(normalizePin)
  const keyPadHits = mappedKeys.filter((key) => padNames.has(key)).length
  const keySymbolHits = mappedKeys.filter((key) => symbolNumbers.has(key) || symbolNames.has(key)).length
  const critical = criticalPinsFor(component).map(normalizePin)
  const criticalHits = critical.filter((pin) => mappedKeys.includes(pin) || mappedValues.includes(pin)).length
  const hasPins = symbolPins.length || footprintPads.length || mappedKeys.length
  const padScore = footprintPads.length ? keyPadHits / Math.max(mappedKeys.length, 1) : 0.5
  const symbolScore = symbolPins.length ? keySymbolHits / Math.max(mappedKeys.length, 1) : 0.5
  const criticalScore = critical.length ? criticalHits / critical.length : 1
  const score = Math.round((padScore * 0.42 + symbolScore * 0.28 + criticalScore * 0.30) * 100)
  const status = !hasPins ? 'unknown' : score >= 75 ? 'strong' : score >= 50 ? 'weak' : 'mismatch'
  return {
    status,
    score,
    keyPadHits,
    keySymbolHits,
    criticalHits,
    criticalCount: critical.length,
    symbolPinCount: symbolPins.length,
    footprintPadCount: footprintPads.length,
    mappedPinCount: mappedKeys.length,
  }
}

function criticalPinsFor(component) {
  const group = component.group || ''
  if (group === 'USB') return ['VBUS', 'GND', 'USB_DP', 'USB_DN', 'CC1', 'CC2']
  if (group === 'ESP32_S3') return ['3V3', 'GND', 'USB_DP', 'USB_DN', 'EN']
  if (group === 'RJ45') return ['ETH_TX_P', 'ETH_TX_N', 'ETH_RX_P', 'ETH_RX_N']
  if (group === 'ETHERNET_PHY') return ['3V3', 'GND', 'ETH_TX_P', 'ETH_TX_N', 'ETH_RX_P', 'ETH_RX_N', 'ETH_MDC', 'ETH_MDIO']
  if (group === 'CAN_TRANSCEIVER') return ['CANH', 'CANL', 'CAN_TX', 'CAN_RX', '3V3', 'GND']
  if (group === 'RS485_TRANSCEIVER') return ['RS485_A', 'RS485_B', 'RS485_TX', 'RS485_RX', '3V3', 'GND']
  if (group === 'FIELD_CONNECTOR') return ['CANH', 'CANL', 'RS485_A', 'RS485_B']
  if (group === 'TERMINAL_BLOCK') return ['24V_FIELD', 'GND_FIELD', 'FIELD_IN1', 'FIELD_OUT1']
  if (group === 'REGULATOR') return ['VIN', 'GND', '3V3']
  if (group === 'POE_FRONT_END') return ['POE_VDD', 'POE_RTN']
  if (group === 'SWD') return ['3V3', 'GND', 'SWDIO', 'SWCLK']
  return []
}

function netCoverageFor(pinMap) {
  const nets = Object.values(pinMap || {}).filter(Boolean).map((net) => String(net).toUpperCase())
  return {
    mappedNetCount: new Set(nets).size,
    powerPins: nets.filter((net) => /^(3V3|5V|VIN|VBAT|VUSB|POE_VDD|VDD|VCC)$/.test(net)).length,
    groundPins: nets.filter((net) => /^(GND|PGND|AGND|CHASSIS|CHASSIS_GND)$/.test(net)).length,
    differentialPins: nets.filter((net) => /(_DP|_DN|_P|_N|TX_P|TX_N|RX_P|RX_N)$/.test(net)).length,
    servicePins: nets.filter((net) => /^(EN|BOOT|RESET|NRST|SWDIO|SWCLK)$/.test(net)).length,
  }
}

function summarizePads(pads) {
  return pads.reduce((summary, pad) => {
    const key = pad.type || 'unknown'
    summary[key] = (summary[key] || 0) + 1
    return summary
  }, {})
}

function recommendedActions(component, issues) {
  const codes = new Set(issues.map((item) => item.code))
  return [
    ...(codes.has('FOOTPRINT_MISSING') ? ['Resolve a KiCad footprint before placement or CPL export.'] : []),
    ...(codes.has('FOOTPRINT_PADS_UNKNOWN') ? ['Use a parseable KiCad footprint or add explicit pad metadata.'] : []),
    ...(codes.has('PIN_MAP_KEYS_NOT_FOOTPRINT_PADS') ? ['Update BoardForge pinMap keys to match footprint pad names.'] : []),
    ...(codes.has('PIN_MAP_KEYS_NOT_SYMBOL_PINS') ? ['Update BoardForge pinMap keys to match schematic symbol pin names/numbers.'] : []),
    ...(codes.has('CRITICAL_PIN_INTENT_MISSING') ? [`Complete critical pin intent for ${component.ref} before netlist-to-PCB sync.`] : []),
    ...(codes.has('POWER_PIN_MAPPING_MISSING') || codes.has('GROUND_PIN_MAPPING_MISSING') ? ['Add explicit power and ground nets before ERC/DRC.'] : []),
  ]
}

function requiresPower(component) {
  return !['RES', 'CAP', 'INDUCTOR', 'TEST_PAD'].includes(component.group)
}

function requiresGround(component) {
  return !['RES', 'INDUCTOR'].includes(component.group)
}

function samePin(a, b) {
  return normalizeAlias(a) === normalizeAlias(b)
}

function issue(severity, code, message, details = {}) {
  return { severity, code, message, details }
}

function assetId(asset) {
  if (!asset) return null
  return typeof asset === 'string' ? asset : asset.libId || asset.name || null
}

function stripLeadingZeros(value) {
  return String(value).replace(/^0+/, '')
}

function normalizePin(value) {
  return stripLeadingZeros(String(value || '').trim().toUpperCase())
}

function normalizeAlias(value) {
  const key = normalizePin(value).replace(/_/g, '')
  const aliases = {
    VBUS: 'VUSB',
    USBVBUS: 'VUSB',
    DPLUS: 'USBDP',
    'D+': 'USBDP',
    DP: 'USBDP',
    USBDP: 'USBDP',
    DMINUS: 'USBDN',
    'D-': 'USBDN',
    DM: 'USBDN',
    DN: 'USBDN',
    USBDN: 'USBDN',
    VDD: '3V3',
    VCC: '3V3',
    VDDIO: '3V3',
    VSS: 'GND',
    PGND: 'GND',
    AGND: 'GND',
    RESET: 'NRST',
    RST: 'NRST',
    BOOT0: 'BOOT',
    IO0: 'BOOT',
  }
  return aliases[key] || key
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
