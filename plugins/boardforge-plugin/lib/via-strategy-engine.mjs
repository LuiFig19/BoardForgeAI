import { assignNetsToClasses } from './net-classes.mjs'

export function selectViaStrategy(input = {}) {
  const nets = assignNetsToClasses(input.nets || [])
  const layerCount = Number(input.layerCount || input.board?.layerCount || input.stackup?.layerCount || 2)
  const profile = input.profile || {}
  const hdi = profile.hdi || {}
  const allowBlind = Boolean(input.allowBlindVias) && /supported|review|quote/i.test(hdi.blindVias || '')
  const allowBuried = Boolean(input.allowBuriedVias) && /supported|review|quote/i.test(hdi.buriedVias || '')
  const allowMicro = Boolean(input.allowMicrovias) && /supported|review|quote/i.test(hdi.microvias || '')
  const strategies = nets.map((net) => {
    const sensitive = ['USB_DIFF', 'ETHERNET_DIFF', 'MIPI_DIFF', 'PCIe_DIFF', 'LVDS_DIFF', 'RF', 'ANTENNA', 'CRYSTAL', 'CLOCK'].includes(net.className)
    const highCurrent = ['BATTERY', 'MOTOR_PHASE', 'POWER_HIGH_CURRENT', 'HIGH_VOLTAGE'].includes(net.className)
    const viaType = highCurrent ? 'through_parallel_array' : allowMicro && ['MIPI_DIFF', 'PCIe_DIFF', 'LVDS_DIFF'].includes(net.className) ? 'microvia_review' : allowBlind && sensitive && layerCount >= 4 ? 'blind_via_review' : 'through_via'
    return {
      net: net.name,
      className: net.className,
      viaType: sensitive && !allowBlind && !allowMicro ? 'avoid_or_minimize_through_via' : viaType,
      allowedTransitions: transitions(layerCount, { allowBlind, allowBuried }),
      diameterMm: viaType.includes('micro') ? Math.max(hdi.minMicroviaDiameterMm || 0.15, profile.minViaDiameterMm || 0.15) : Math.max(profile.minViaDiameterMm || 0.45, highCurrent ? 0.8 : 0.45),
      drillMm: viaType.includes('micro') ? Math.max(hdi.minMicroviaDrillMm || 0.075, profile.minViaDrillMm || 0.075) : Math.max(profile.minViaDrillMm || 0.2, highCurrent ? 0.4 : 0.2),
      maxViaCount: sensitive ? 0 : highCurrent ? null : 3,
      warnings: [
        ...(sensitive ? ['Sensitive/high-speed nets should avoid vias unless stackup/return path is reviewed.'] : []),
        ...(viaType.includes('blind') || viaType.includes('micro') ? ['Advanced vias increase cost and require manufacturer stackup approval.'] : []),
      ],
    }
  })
  const errors = []
  if (input.allowMicrovias && !allowMicro) errors.push(issue('ERROR', 'MICROVIAS_UNSUPPORTED_BY_PROFILE', `${profile.name || 'Selected manufacturer'} does not support requested microvias in this profile.`))
  if (input.allowBlindVias && !allowBlind) errors.push(issue('ERROR', 'BLIND_VIAS_UNSUPPORTED_BY_PROFILE', `${profile.name || 'Selected manufacturer'} does not support requested blind vias in this profile.`))
  return {
    schemaVersion: 1,
    status: errors.length ? 'VIA_STRATEGY_BLOCKED' : strategies.some((item) => item.warnings.length) ? 'VIA_STRATEGY_NEEDS_REVIEW' : 'VIA_STRATEGY_READY',
    layerCount,
    manufacturer: profile.name || 'Unknown',
    hdi: { allowBlind, allowBuried, allowMicro, profile: hdi },
    strategies,
    warnings: strategies.flatMap((item) => item.warnings.map((message) => issue('WARNING', 'VIA_STRATEGY_REVIEW', `${item.net}: ${message}`, { net: item.net }))),
    errors,
    humanReviewRequired: true,
  }
}

function transitions(layerCount, policy) {
  if (layerCount < 4) return [['F.Cu', 'B.Cu']]
  return [
    ['F.Cu', 'B.Cu'],
    ...(policy.allowBlind ? [['F.Cu', 'In1.Cu'], ['B.Cu', `In${Math.max(1, layerCount - 2)}.Cu`]] : []),
    ...(policy.allowBuried ? [['In1.Cu', 'In2.Cu']] : []),
  ]
}

function issue(severity, code, message, details = {}) {
  return { severity, code, message, details }
}
