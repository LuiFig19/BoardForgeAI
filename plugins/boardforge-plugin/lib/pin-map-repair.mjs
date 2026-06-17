import { validateComponentBindings } from './component-compatibility.mjs'

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
    const value = component.pinMap[repair.from]
    delete component.pinMap[repair.from]
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
  if (!component?.pinMap) return []
  const repairs = []
  const padIssues = result.issues.filter((issue) => issue.code === 'PIN_MAP_KEYS_NOT_FOOTPRINT_PADS')
  for (const issue of padIssues) {
    for (const key of issue.details?.keys || []) {
      const candidate = candidatePadFor(key, result)
      if (candidate && candidate !== key) repairs.push({ ref: result.ref, from: key, to: candidate, reason: 'Pin map key can be normalized to a parsed footprint pad.', safe: true })
    }
  }
  return repairs
}

function candidatePadFor(key, result) {
  const normalized = String(key).replace(/^0+/, '')
  if (normalized !== key) return normalized
  if (/^D\+$/i.test(key)) return 'A6'
  if (/^D-$/i.test(key)) return 'A7'
  if (/^VBUS$/i.test(key)) return 'A4'
  if (/^GND$/i.test(key)) return 'A1'
  if (result.group === 'SENSOR_CONNECTOR' && /^3V3$/i.test(key)) return '1'
  if (result.group === 'SENSOR_CONNECTOR' && /^SCL$/i.test(key)) return '3'
  if (result.group === 'SENSOR_CONNECTOR' && /^SDA$/i.test(key)) return '4'
  return null
}
