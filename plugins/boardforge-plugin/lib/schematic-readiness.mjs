import { validateComponentBindings } from './component-compatibility.mjs'
import { boardforgeNetlistFromComponents } from './schematic-generator.mjs'
import { validateSchematicGraph } from './schematic-validator.mjs'

export async function validateSchematicReadiness({ board = {}, components = [], nets = [], bindings = null, options = {} } = {}) {
  const normalized = components.map(normalizeComponent)
  const bindingReport = bindings || await validateComponentBindings(normalized)
  const netlist = boardforgeNetlistFromComponents(normalized, nets)
  const graph = validateSchematicGraph({ board, components: normalized, nets: netlist.nets })
  const errors = [
    ...hardBindingErrors(bindingReport, options),
    ...netlistErrors(netlist),
    ...graph.errors,
    ...assetErrors(normalized),
  ]
  const warnings = [
    ...bindingReport.warnings,
    ...netlist.warnings,
    ...graph.warnings,
    ...assetWarnings(normalized),
  ]
  const status = errors.length
    ? 'SCHEMATIC_READINESS_BLOCKED'
    : warnings.length
      ? 'SCHEMATIC_READINESS_NEEDS_REVIEW'
      : 'SCHEMATIC_READINESS_READY_NEEDS_ERC'
  return {
    status,
    board: { name: board.name || board.projectName || 'BoardForge board' },
    checkedComponents: normalized.length,
    checkedNets: netlist.nets.length,
    bindingReport,
    netlist,
    graph,
    errors,
    warnings,
    blockers: errors,
    readinessGates: gates({ components: normalized, bindingReport, netlist, graph, errors, warnings }),
    nextActions: nextActions(errors, warnings),
    humanReviewRequired: true,
  }
}

function normalizeComponent(component) {
  return {
    ...component,
    ref: component.ref || component.reference || component.designator,
    symbol: component.symbol?.libId ? component.symbol : component.symbol,
    footprint: component.footprint?.libId ? component.footprint : component.footprint,
    pinMap: component.pinMap || {},
  }
}

function hardBindingErrors(bindingReport, options) {
  const hardCodes = new Set([
    'FOOTPRINT_MISSING',
    'FOOTPRINT_PADS_UNKNOWN',
    'PIN_MAP_KEYS_NOT_FOOTPRINT_PADS',
  ])
  if (options.strictSymbols !== false) hardCodes.add('PIN_MAP_KEYS_NOT_SYMBOL_PINS')
  return (bindingReport.results || []).flatMap((result) => (result.issues || [])
    .filter((issue) => issue.severity === 'ERROR' || hardCodes.has(issue.code))
    .map((issue) => ({ ...issue, severity: 'ERROR', ref: result.ref })))
}

function assetErrors(components) {
  const errors = []
  for (const component of components) {
    if (!component.ref) errors.push(issue('ERROR', 'COMPONENT_REF_MISSING', 'Every schematic component needs a stable reference designator.'))
    if (!component.footprint) errors.push(issue('ERROR', 'COMPONENT_FOOTPRINT_UNRESOLVED', `${component.ref || 'component'} has no footprint.`))
    if (!Object.keys(component.pinMap || {}).length) errors.push(issue('ERROR', 'COMPONENT_PINMAP_MISSING', `${component.ref || 'component'} has no pin map.`))
    if (requiresSymbol(component) && !component.symbol) errors.push(issue('ERROR', 'COMPONENT_SYMBOL_UNRESOLVED', `${component.ref || 'component'} has no schematic symbol.`))
  }
  return errors
}

function assetWarnings(components) {
  return components.flatMap((component) => [
    ...(!component.model3d ? [issue('WARNING', 'COMPONENT_3D_MODEL_MISSING', `${component.ref || 'component'} has no linked 3D model.`)] : []),
    ...(Object.keys(component.pinMap || {}).length < expectedMinimumPins(component) ? [issue('WARNING', 'COMPONENT_PINMAP_SPARSE', `${component.ref || 'component'} pin map looks sparse for ${component.group || component.value || 'this component'}.`)] : []),
  ])
}

function netlistErrors(netlist) {
  const errors = []
  for (const net of netlist.nets || []) {
    if (!net.name || /^NC$/i.test(net.name)) continue
    if (isPowerSymbolOnlyNet(net.name)) continue
    if ((net.pins || []).length < 2) errors.push(issue('ERROR', 'NET_HAS_TOO_FEW_CONNECTED_PINS', `${net.name} has fewer than two mapped pins.`, { net: net.name, pins: net.pins || [] }))
  }
  for (const pair of diffPairs(netlist.nets || [])) {
    if (!pair.mate) errors.push(issue('ERROR', 'DIFF_PAIR_MEMBER_MISSING', `${pair.name} is missing mate ${pair.expectedMate}.`, { net: pair.name, expectedMate: pair.expectedMate }))
  }
  return errors
}

function gates({ components, bindingReport, netlist, graph, errors, warnings }) {
  const codes = new Set(errors.map((item) => item.code))
  return [
    gate('components_present', components.length > 0, 'At least one component is required.'),
    gate('references_stable', !codes.has('COMPONENT_REF_MISSING'), 'Every component has a reference designator.'),
    gate('symbols_resolved', !codes.has('COMPONENT_SYMBOL_UNRESOLVED'), 'All symbol assets are resolved.'),
    gate('footprints_resolved', !codes.has('COMPONENT_FOOTPRINT_UNRESOLVED') && !codes.has('FOOTPRINT_MISSING'), 'All footprint assets are resolved.'),
    gate('footprint_pads_parseable', !codes.has('FOOTPRINT_PADS_UNKNOWN'), 'Footprint pads are parseable.'),
    gate('pin_maps_complete', !codes.has('COMPONENT_PINMAP_MISSING') && !codes.has('PIN_MAP_KEYS_NOT_FOOTPRINT_PADS') && !codes.has('PIN_MAP_KEYS_NOT_SYMBOL_PINS'), 'Pin maps match symbol/footprint pins.'),
    gate('netlist_connected', !codes.has('NET_HAS_TOO_FEW_CONNECTED_PINS'), 'Every real net has at least two pins.'),
    gate('diff_pairs_complete', !codes.has('DIFF_PAIR_MEMBER_MISSING'), 'Differential pairs have both members.'),
    gate('schematic_graph', !(graph.errors || []).length, 'Schematic graph passes BoardForge graph checks.'),
    gate('binding_quality', !(bindingReport.errors || []).length, 'Component binding report has no errors.'),
    gate('erc_required', true, 'KiCad ERC must still pass after schematic write.'),
    gate('review_required', warnings.length === 0, 'Warnings are cleared before release export.'),
  ]
}

function nextActions(errors, warnings) {
  const codes = new Set(errors.map((item) => item.code))
  return [
    ...(codes.has('COMPONENT_SYMBOL_UNRESOLVED') || codes.has('COMPONENT_FOOTPRINT_UNRESOLVED') ? [{ command: 'resolve_component_assets', reason: 'Resolve missing KiCad symbols/footprints before schematic generation.' }] : []),
    ...(codes.has('FOOTPRINT_PADS_UNKNOWN') ? [{ command: 'sync_kicad_libraries', reason: 'Index parseable KiCad footprints or choose a different footprint.' }] : []),
    ...(codes.has('PIN_MAP_KEYS_NOT_FOOTPRINT_PADS') || codes.has('PIN_MAP_KEYS_NOT_SYMBOL_PINS') || codes.has('COMPONENT_PINMAP_MISSING') ? [{ command: 'plan_pin_map_repairs', reason: 'Repair pin maps before schematic/netlist sync.' }] : []),
    ...(codes.has('NET_HAS_TOO_FEW_CONNECTED_PINS') || codes.has('DIFF_PAIR_MEMBER_MISSING') ? [{ command: 'synthesize_schematic_design', reason: 'Repair missing net endpoints and differential-pair intent.' }] : []),
    ...(warnings.length && !errors.length ? [{ command: 'run_kicad_erc', reason: 'Warnings remain; generated schematic still requires local ERC and review.' }] : []),
  ]
}

function gate(id, passed, why) {
  return { id, passed: Boolean(passed), why }
}

function requiresSymbol(component) {
  return !['MECHANICAL', 'MOUNT', 'HOLE'].includes(String(component.group || '').toUpperCase())
}

function expectedMinimumPins(component) {
  const group = String(component.group || '').toUpperCase()
  if (/MCU|ESP32|PHY|DRIVER/.test(group)) return 4
  if (/USB|RJ45|CONNECTOR/.test(group)) return 4
  if (/REGULATOR|BUCK|LDO/.test(group)) return 3
  if (/RES|CAP|INDUCTOR|LED|DIODE/.test(group)) return 2
  return 1
}

function isPowerSymbolOnlyNet(name) {
  return /^(GND|PGND|AGND|CHASSIS|3V3|5V|1V8|VIN|VBAT|VUSB|VCC|VDD)$/i.test(name)
}

function diffPairs(nets) {
  const names = new Set(nets.map((net) => net.name))
  return nets
    .filter((net) => /(_DP|_DN|_P|_N|TX_P|TX_N|RX_P|RX_N)$/i.test(net.name || ''))
    .map((net) => ({ name: net.name, expectedMate: mateName(net.name), mate: names.has(mateName(net.name)) }))
}

function mateName(name) {
  if (/_DP$/i.test(name)) return name.replace(/_DP$/i, '_DN')
  if (/_DN$/i.test(name)) return name.replace(/_DN$/i, '_DP')
  if (/_P$/i.test(name)) return name.replace(/_P$/i, '_N')
  if (/_N$/i.test(name)) return name.replace(/_N$/i, '_P')
  if (/TX_P$/i.test(name)) return name.replace(/TX_P$/i, 'TX_N')
  if (/TX_N$/i.test(name)) return name.replace(/TX_N$/i, 'TX_P')
  if (/RX_P$/i.test(name)) return name.replace(/RX_P$/i, 'RX_N')
  if (/RX_N$/i.test(name)) return name.replace(/RX_N$/i, 'RX_P')
  return `${name}_MATE`
}

function issue(severity, code, message, details = {}) {
  return { severity, code, message, details }
}
