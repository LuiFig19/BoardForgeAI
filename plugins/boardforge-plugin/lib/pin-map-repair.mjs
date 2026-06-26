import { validateComponentBindings } from './component-compatibility.mjs'
import { synthesizePinMapFromAssets } from './pin-map-synthesizer.mjs'

export async function planPinMapRepairs(components = [], options = {}) {
  const bindings = await validateComponentBindings(components)
  const repairs = bindings.results.flatMap((result) => repairForResult(result, components.find((component) => component.ref === result.ref), options))
  const safeRepairs = repairs.filter((repair) => repair.safe)
  const report = {
    status: bindings.errors.length ? 'PIN_MAP_REPAIR_NEEDS_REVIEW' : repairs.length ? 'PIN_MAP_REPAIR_READY_NEEDS_REVIEW' : 'PIN_MAP_REPAIR_NO_ACTIONS',
    checked: components.length,
    repairs,
    safeRepairCount: safeRepairs.length,
    warnings: bindings.warnings,
    errors: bindings.errors,
    actions: repairs.length ? [{ command: 'apply_pin_map_repairs', reason: 'Apply only safe exact pad/name pin-map rewrites, then validate bindings again.' }] : [],
    humanReviewRequired: true,
  }
  return options.applySafe ? applySafePinMapRepairs(components, report) : report
}

export function applySafePinMapRepairs(components = [], repairPlan = {}) {
  const byRef = new Map(components.map((component) => [component.ref, { ...component, pinMap: { ...(component.pinMap || {}) } }]))
  for (const repair of repairPlan.repairs || []) {
    if (!repair.safe) continue
    const component = byRef.get(repair.ref)
    if (!component) continue
    if (repair.action === 'add_pin_map') {
      if (!component.pinMap[repair.to]) component.pinMap[repair.to] = repair.net
      continue
    }
    const value = component.pinMap[repair.from]
    if (repair.from) delete component.pinMap[repair.from]
    component.pinMap[repair.to] = value
  }
  return {
    ...repairPlan,
    status: repairPlan.safeRepairCount ? 'PIN_MAP_REPAIRS_APPLIED_NEEDS_BINDING_RECHECK' : repairPlan.status,
    components: [...byRef.values()],
    humanReviewRequired: true,
  }
}

function repairForResult(result, component) {
  if (!component) return []
  const repairs = []
  const synthesized = synthesizePinMapFromAssets(component, Object.values(component.pinMap || {}).filter(Boolean).map((name) => ({ name })))
  for (const [pin, net] of Object.entries(synthesized.pinMap || {})) {
    if (!component.pinMap?.[pin]) repairs.push({ ref: result.ref, action: 'add_pin_map', to: pin, net, reason: 'Add metadata-derived pin map from parsed symbol/footprint pad aliases.', safe: synthesized.evidence.some((item) => item.pad === pin && item.confidence >= 80) })
  }
  if (!component?.pinMap) return repairs
  const padIssues = result.issues.filter((issue) => issue.code === 'PIN_MAP_KEYS_NOT_FOOTPRINT_PADS')
  for (const issue of padIssues) {
    for (const key of issue.details?.keys || []) {
      const candidate = candidatePadFor(key, result)
      if (candidate && candidate !== key) repairs.push({ ref: result.ref, from: key, to: candidate, reason: 'Pin map key can be normalized to a parsed footprint pad.', safe: true })
    }
  }
  for (const issue of result.issues.filter((item) => item.code === 'CRITICAL_PIN_INTENT_MISSING' || item.code === 'POWER_PIN_MAPPING_MISSING' || item.code === 'GROUND_PIN_MAPPING_MISSING')) {
    for (const missing of issue.details?.missingCriticalPins || inferredMissingPins(issue, result)) {
      const repair = additiveRepairForMissingPin(missing, result, component)
      if (repair) repairs.push(repair)
    }
  }
  return repairs
}

function inferredMissingPins(issue, result) {
  if (issue.code === 'POWER_PIN_MAPPING_MISSING') return ['3V3']
  if (issue.code === 'GROUND_PIN_MAPPING_MISSING') return ['GND']
  return result.missingCriticalPins || []
}

function additiveRepairForMissingPin(pin, result, component) {
  const pinMap = component.pinMap || {}
  const used = new Set(Object.keys(pinMap).map(normalizePin))
  const candidate = candidatePadFor(pin, result)
  if (!candidate || used.has(normalizePin(candidate))) return null
  const net = netForCriticalPin(pin, component)
  if (!net) return null
  return {
    ref: result.ref,
    action: 'add_pin_map',
    to: candidate,
    net,
    reason: `Add safe critical ${pin} intent using known ${result.group || component.group || 'component'} pad alias.`,
    safe: true,
  }
}

function candidatePadFor(key, result) {
  const normalized = String(key).replace(/^0+/, '')
  if (normalized !== key) return normalized
  if (/^D\+$/i.test(key)) return 'A6'
  if (/^USB_DP$/i.test(key)) return 'A6'
  if (/^D-$/i.test(key)) return 'A7'
  if (/^USB_DN$/i.test(key)) return 'A7'
  if (/^VBUS$/i.test(key)) return 'A4'
  if (/^VUSB$/i.test(key)) return 'A4'
  if (/^GND$/i.test(key)) return 'A1'
  if (/^CC1$/i.test(key)) return 'A5'
  if (/^CC2$/i.test(key)) return 'B5'
  if (/^3V3$|^VDD$|^VCC$/i.test(key) && result.group === 'ESP32_S3') return '2'
  if (/^EN$/i.test(key) && result.group === 'ESP32_S3') return '3'
  if (/^BOOT$|^IO0$/i.test(key) && result.group === 'ESP32_S3') return '27'
  if (/^VIN$|^IN$/i.test(key) && result.group === 'REGULATOR') return '1'
  if (/^VOUT$|^OUT$|^3V3$/i.test(key) && result.group === 'REGULATOR') return '5'
  if (result.group === 'SENSOR_CONNECTOR' && /^3V3$/i.test(key)) return '1'
  if (result.group === 'SENSOR_CONNECTOR' && /^SCL$/i.test(key)) return '3'
  if (result.group === 'SENSOR_CONNECTOR' && /^SDA$/i.test(key)) return '4'
  return null
}

function netForCriticalPin(pin, component = {}) {
  const key = normalizePin(pin)
  if (key === 'VBUS') return 'VUSB'
  if (key === 'VUSB') return 'VUSB'
  if (key === 'USB_DP' || key === 'D+') return 'USB_DP'
  if (key === 'USB_DN' || key === 'D-') return 'USB_DN'
  if (key === 'CC1') return 'CC1'
  if (key === 'CC2') return 'CC2'
  if (key === 'GND') return 'GND'
  if (key === '3V3' || key === 'VDD' || key === 'VCC' || key === 'VOUT' || key === 'OUT') return '3V3'
  if (key === 'VIN' || key === 'IN') return component.powerInput || 'VUSB'
  if (key === 'EN') return 'EN'
  if (key === 'BOOT' || key === 'IO0') return 'BOOT'
  return null
}

function normalizePin(value) {
  return String(value || '').replace(/^0+/, '').toUpperCase()
}
