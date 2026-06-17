import { assignNetsToClasses } from './net-classes.mjs'

export function selectViaStrategy(input = {}) {
  const nets = assignNetsToClasses(input.nets || [])
  const layerCount = Number(input.layerCount || input.board?.layerCount || input.stackup?.layerCount || 2)
  const profile = input.profile || {}
  const hdi = profile.hdi || {}
  const board = input.board || {}
  const compact = isCompactBoard(board, input.components || [])
  const allowBlind = Boolean(input.allowBlindVias) && /supported|review|quote/i.test(hdi.blindVias || '')
  const allowBuried = Boolean(input.allowBuriedVias) && /supported|review|quote/i.test(hdi.buriedVias || '')
  const allowMicro = Boolean(input.allowMicrovias) && /supported|review|quote/i.test(hdi.microvias || '')
  const allowedTransitions = transitions(layerCount, { allowBlind, allowBuried, allowMicro })
  const strategies = nets.map((net) => {
    const sensitive = ['USB_DIFF', 'ETHERNET_DIFF', 'MIPI_DIFF', 'PCIe_DIFF', 'LVDS_DIFF', 'RF', 'ANTENNA', 'CRYSTAL', 'CLOCK'].includes(net.className)
    const highCurrent = ['BATTERY', 'MOTOR_PHASE', 'POWER_HIGH_CURRENT', 'HIGH_VOLTAGE'].includes(net.className)
    const denseHighSpeed = compact && sensitive && layerCount >= 4
    const viaType = highCurrent
      ? 'through_parallel_array'
      : allowMicro && denseHighSpeed && ['MIPI_DIFF', 'PCIe_DIFF', 'LVDS_DIFF'].includes(net.className)
        ? 'microvia_review'
        : allowBlind && denseHighSpeed
          ? 'blind_via_review'
          : sensitive
            ? 'avoid_or_minimize_through_via'
            : 'through_via'
    const viaBudget = viaBudgetFor({ net, sensitive, highCurrent, compact, viaType, layerCount })
    const preferredLayers = preferredLayersFor(net, layerCount)
    return {
      net: net.name,
      className: net.className,
      viaType,
      preferredLayers,
      allowedTransitions,
      transitionPlan: transitionPlanFor({ net, viaType, preferredLayers, allowedTransitions, layerCount }),
      diameterMm: viaType.includes('micro') ? Math.max(hdi.minMicroviaDiameterMm || 0.15, profile.minViaDiameterMm || 0.15) : Math.max(profile.minViaDiameterMm || 0.45, highCurrent ? 0.8 : 0.45),
      drillMm: viaType.includes('micro') ? Math.max(hdi.minMicroviaDrillMm || 0.075, profile.minViaDrillMm || 0.075) : Math.max(profile.minViaDrillMm || 0.2, highCurrent ? 0.4 : 0.2),
      maxViaCount: viaBudget.maxViaCount,
      returnViaRequired: sensitive || /POWER|BATTERY|MOTOR|HIGH_CURRENT|HIGH_VOLTAGE/i.test(net.className),
      viaArray: highCurrent ? { minParallelVias: Math.max(2, Math.ceil(Number(net.currentA || input.currentA || 2) / 1.5)), rule: 'parallel vias reduce current density and thermal rise' } : null,
      compactBoardPolicy: compact ? 'Prefer fewer layer changes, short escapes, reviewed blind/microvias only when stackup/manufacturer approve them.' : 'Use standard through vias unless signal/current class requires review.',
      warnings: [
        ...(sensitive ? ['Sensitive/high-speed nets should avoid vias unless stackup/return path is reviewed.'] : []),
        ...(viaType.includes('blind') || viaType.includes('micro') ? ['Advanced vias increase cost and require manufacturer stackup approval.'] : []),
        ...(compact && viaType === 'through_via' && layerCount <= 2 ? ['Compact 2-layer boards have low routing escape margin; increase board size/layers if conflicts appear.'] : []),
      ],
    }
  })
  const errors = []
  if (input.allowMicrovias && !allowMicro) errors.push(issue('ERROR', 'MICROVIAS_UNSUPPORTED_BY_PROFILE', `${profile.name || 'Selected manufacturer'} does not support requested microvias in this profile.`))
  if (input.allowBlindVias && !allowBlind) errors.push(issue('ERROR', 'BLIND_VIAS_UNSUPPORTED_BY_PROFILE', `${profile.name || 'Selected manufacturer'} does not support requested blind vias in this profile.`))
  if ((input.allowBlindVias || input.allowMicrovias) && layerCount < 4) errors.push(issue('ERROR', 'ADVANCED_VIAS_NEED_4PLUS_LAYERS', 'Blind and microvia strategies require at least a reviewed 4-layer stackup.'))
  return {
    schemaVersion: 1,
    status: errors.length ? 'VIA_STRATEGY_BLOCKED' : strategies.some((item) => item.warnings.length) ? 'VIA_STRATEGY_NEEDS_REVIEW' : 'VIA_STRATEGY_READY',
    layerCount,
    manufacturer: profile.name || 'Unknown',
    hdi: { allowBlind, allowBuried, allowMicro, profile: hdi },
    compactBoard: compact,
    allowedTransitions,
    strategies,
    warnings: strategies.flatMap((item) => item.warnings.map((message) => issue('WARNING', 'VIA_STRATEGY_REVIEW', `${item.net}: ${message}`, { net: item.net }))),
    errors,
    humanReviewRequired: true,
  }
}

function transitions(layerCount, policy) {
  if (layerCount < 4) return [['F.Cu', 'B.Cu']]
  const bottomInner = `In${Math.max(1, layerCount - 2)}.Cu`
  return [
    ['F.Cu', 'B.Cu'],
    ...(policy.allowBlind ? [['F.Cu', 'In1.Cu'], ['B.Cu', bottomInner]] : []),
    ...(policy.allowBuried ? [['In1.Cu', 'In2.Cu']] : []),
    ...(policy.allowMicro ? [['F.Cu', 'In1.Cu'], ['B.Cu', bottomInner]] : []),
  ]
}

function preferredLayersFor(net, layerCount) {
  if (layerCount < 4) return ['F.Cu', 'B.Cu']
  if (/GND/i.test(net.name) || net.className === 'GROUND') return ['In1.Cu', `In${Math.max(1, layerCount - 2)}.Cu`]
  if (/USB|ETH|MIPI|PCIe|LVDS|CLK|CRYSTAL|RF|ANT/i.test(`${net.name} ${net.className}`)) return ['F.Cu', 'In1.Cu']
  if (/VBAT|VIN|5V|3V3|VCC|MOTOR|PHASE|POWER|HIGH_CURRENT/i.test(`${net.name} ${net.className}`)) return ['F.Cu', 'B.Cu']
  return ['F.Cu', 'B.Cu']
}

function transitionPlanFor({ net, viaType, preferredLayers, allowedTransitions, layerCount }) {
  const [primary, secondary] = preferredLayers
  const allowed = allowedTransitions.some(([from, to]) => (from === primary && to === secondary) || (from === secondary && to === primary))
  return {
    primaryLayer: primary,
    secondaryLayer: secondary,
    allowed,
    maxLayerChanges: maxLayerChangesFor(net, viaType, layerCount),
    rule: allowed ? `Route ${net.name} primarily on ${primary}; transition to ${secondary} only at controlled escape/obstacle points.` : `Layer pair ${primary}/${secondary} needs stackup review before routing.`,
  }
}

function viaBudgetFor({ net, sensitive, highCurrent, compact, viaType, layerCount }) {
  if (highCurrent) return { maxViaCount: null, reason: 'current-carrying nets use calculated parallel via arrays' }
  if (sensitive) return { maxViaCount: viaType.includes('blind') || viaType.includes('micro') ? 2 : compact ? 0 : 1, reason: 'sensitive nets minimize transitions to preserve impedance/return path' }
  if (compact && layerCount >= 4) return { maxViaCount: 4, reason: 'compact board allows a small reviewed transition budget' }
  return { maxViaCount: 3, reason: 'default manufacturable signal routing budget' }
}

function maxLayerChangesFor(net, viaType, layerCount) {
  if (/RF|ANT|CRYSTAL|CLOCK/i.test(`${net.name} ${net.className}`)) return 0
  if (/USB|ETH|MIPI|PCIe|LVDS/i.test(`${net.name} ${net.className}`)) return viaType.includes('blind') || viaType.includes('micro') ? 2 : 0
  if (/POWER|BATTERY|MOTOR|HIGH_CURRENT|HIGH_VOLTAGE/i.test(net.className)) return layerCount >= 4 ? 4 : 2
  return layerCount >= 4 ? 4 : 2
}

function isCompactBoard(board, components = []) {
  const width = Number(board.widthMm || board.width || 0)
  const height = Number(board.heightMm || board.height || 0)
  const area = width * height
  const componentArea = components.reduce((sum, component) => sum + Number(component.width || component.widthMm || 0) * Number(component.height || component.heightMm || 0), 0)
  return area > 0 && (area < 1200 || componentArea / area > 0.35)
}

function issue(severity, code, message, details = {}) {
  return { severity, code, message, details }
}
