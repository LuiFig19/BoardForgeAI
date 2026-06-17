import { assignNetsToClasses, netClassProfiles } from './net-classes.mjs'

export function calculatePowerRouting(input = {}) {
  const nets = assignNetsToClasses(input.nets || [])
  const rails = input.powerTree?.rails || input.rails || []
  const copperWeightOz = Number(input.copperWeightOz || input.profile?.copperWeightOptionsOz?.[0] || 1)
  const maxTempRiseC = Number(input.maxTempRiseC || 20)
  const powerNets = nets.filter((net) => ['BATTERY', 'POWER_HIGH_CURRENT', 'POWER_LOW_CURRENT', 'MOTOR_PHASE', 'HIGH_VOLTAGE', 'SWITCHING_NODE'].includes(net.className))
  const calculations = powerNets.map((net) => {
    const currentA = currentForNet(net, rails, input)
    const widthMm = traceWidthEstimate(currentA, copperWeightOz, maxTempRiseC, net.className)
    const profileWidth = netClassProfiles[net.className]?.traceWidthMm || netClassProfiles.DEFAULT.traceWidthMm
    const recommendedWidthMm = round(Math.max(widthMm, profileWidth, input.profile?.minTraceWidthMm || 0.127))
    const viaCount = Math.max(1, Math.ceil(currentA / viaCurrentCapacityA(input.profile)))
    return {
      net: net.name,
      className: net.className,
      currentA,
      copperWeightOz,
      maxTempRiseC,
      recommendedWidthMm,
      minimumViaCountForLayerChange: viaCount,
      preferCopperPour: currentA >= 0.5 || ['BATTERY', 'MOTOR_PHASE', 'HIGH_VOLTAGE'].includes(net.className),
      voltageDropReview: currentA >= 1,
      thermalReview: currentA >= 1.5 || ['MOTOR_PHASE', 'SWITCHING_NODE'].includes(net.className),
    }
  })
  const errors = calculations.filter((calc) => calc.recommendedWidthMm > Number(input.maxAllowedWidthMm || 10)).map((calc) => issue('ERROR', 'POWER_TRACE_WIDTH_IMPOSSIBLE', `${calc.net} needs ${calc.recommendedWidthMm} mm trace width under current assumptions.`, calc))
  const warnings = calculations.filter((calc) => calc.thermalReview).map((calc) => issue('WARNING', 'POWER_THERMAL_REVIEW', `${calc.net} needs thermal/current review and likely copper pour support.`, calc))
  return {
    schemaVersion: 1,
    status: errors.length ? 'POWER_ROUTING_NEEDS_FIX' : warnings.length ? 'POWER_ROUTING_NEEDS_REVIEW' : 'POWER_ROUTING_READY_NEEDS_DRC',
    calculations,
    assumptions: ['Trace-width estimates are conservative first-pass routing constraints, not a substitute for IPC/current/thermal signoff.', 'High-current layer changes need parallel vias and DRC review.'],
    warnings,
    errors,
    humanReviewRequired: true,
  }
}

function currentForNet(net, rails, input) {
  if (net.currentA) return Number(net.currentA)
  const rail = rails.find((item) => item.name === net.name || item.net === net.name)
  if (rail?.currentMa) return Number(rail.currentMa) / 1000
  if (input.currentA) return Number(input.currentA)
  if (net.className === 'BATTERY' || net.className === 'MOTOR_PHASE') return 5
  if (net.className === 'POWER_HIGH_CURRENT' || net.className === 'HIGH_VOLTAGE') return 2
  if (net.className === 'SWITCHING_NODE') return 1
  return 0.25
}

function traceWidthEstimate(currentA, copperWeightOz, riseC, className) {
  const base = currentA <= 0 ? 0.15 : (currentA * 0.32) / Math.max(0.7, copperWeightOz) * Math.sqrt(20 / Math.max(5, riseC))
  const multiplier = className === 'MOTOR_PHASE' || className === 'BATTERY' ? 1.8 : className === 'SWITCHING_NODE' ? 1.35 : 1
  return base * multiplier
}

function viaCurrentCapacityA(profile = {}) {
  const drill = Number(profile.minViaDrillMm || 0.2)
  return Math.max(0.35, drill * 2.2)
}

function round(value) {
  return Math.round(value * 1000) / 1000
}

function issue(severity, code, message, details = {}) {
  return { severity, code, message, details }
}
