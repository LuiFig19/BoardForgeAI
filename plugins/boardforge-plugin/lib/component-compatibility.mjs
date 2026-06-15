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
  const footprintPads = await loadFootprintPads(component.footprint)
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

  if (unmatchedPadKeys.length) {
    issues.push(issue('WARNING', 'PIN_MAP_KEYS_NOT_FOOTPRINT_PADS', `${component.ref} pin map has keys that do not match parsed footprint pads.`, { keys: unmatchedPadKeys.slice(0, 12), footprint: assetId(component.footprint) }))
  }
  if (unmatchedSymbolKeys.length) {
    issues.push(issue('WARNING', 'PIN_MAP_KEYS_NOT_SYMBOL_PINS', `${component.ref} pin map has keys that do not match parsed symbol pins.`, { keys: unmatchedSymbolKeys.slice(0, 12), symbol: assetId(component.symbol) }))
  }
  if (symbolPins.length && footprintPads.length && Math.abs(symbolPins.length - footprintPads.length) > Math.max(8, symbolPins.length * 0.5)) {
    issues.push(issue('WARNING', 'SYMBOL_FOOTPRINT_PIN_COUNT_DIVERGES', `${component.ref} symbol pin count and footprint pad count are far apart.`, { symbolPins: symbolPins.length, footprintPads: footprintPads.length }))
  }

  return {
    ref: component.ref,
    group: component.group,
    value: component.value,
    symbol: assetId(component.symbol),
    footprint: assetId(component.footprint),
    symbolPinCount: symbolPins.length,
    footprintPadCount: footprintPads.length,
    mappedPins: pinMapKeys.length,
    compatibilityScore: compatibilityScore({ symbolPins, footprintPads, pinMapKeys, issues }),
    issues,
  }
}

async function loadSymbolPins(symbol) {
  const path = typeof symbol === 'object' ? symbol.path : null
  const libId = assetId(symbol)
  if (!path) return []
  try {
    return parseSymbolPinsFromText(await readFile(path, 'utf8'), libId)
  } catch {
    return []
  }
}

async function loadFootprintPads(footprint) {
  const path = typeof footprint === 'object' ? footprint.path : null
  if (!path) return []
  try {
    return parseFootprintPadsFromText(await readFile(path, 'utf8'))
  } catch {
    return []
  }
}

export function parseFootprintPadsFromText(text) {
  return [...String(text || '').matchAll(/\(pad\s+"([^"]+)"\s+([^\s)]+)\s+([^\s)]+)/g)]
    .map((match) => ({ name: match[1], type: match[2], shape: match[3] }))
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

function compatibilityScore({ symbolPins, footprintPads, pinMapKeys, issues }) {
  let score = 100
  if (!symbolPins.length) score -= 20
  if (!footprintPads.length) score -= 35
  if (!pinMapKeys.length) score -= 25
  score -= issues.filter((item) => item.severity === 'ERROR').length * 30
  score -= issues.filter((item) => item.severity === 'WARNING').length * 8
  return Math.max(0, Math.min(100, score))
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

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
