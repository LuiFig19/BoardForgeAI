import { polygonBounds, round } from './geometry.mjs'
import { getManufacturerProfile, manufacturerProfiles } from './manufacturers.mjs'

const signalLayers = ['F.Cu', 'In1.Cu', 'In2.Cu', 'In3.Cu', 'In4.Cu', 'In5.Cu', 'B.Cu']

export function planStackup(input = {}) {
  const board = input.board || {}
  const layerCount = Number(input.layerCount || board.layerCount || 4)
  const profile = getManufacturerProfile(input.manufacturerProfile || input.manufacturer || 'JLCPCB_STANDARD')
  const complexity = scoreBoardComplexity({ ...input, board: { ...board, layerCount } })
  const layers = buildLayerStack(layerCount, input)
  const hdi = planHdiViaPolicy({ input, profile, layerCount, complexity })
  const warnings = [
    ...(!profile.layerOptions?.includes(layerCount) ? [{ severity: 'WARNING', code: 'LAYER_COUNT_REQUIRES_FAB_REVIEW', message: `${profile.name} profile does not list ${layerCount} layers as a standard option.` }] : []),
    ...hdi.warnings,
  ]
  const errors = hdi.errors
  return {
    status: errors.length ? 'STACKUP_PLAN_BLOCKED' : hdi.requiresAdvancedReview || warnings.length ? 'STACKUP_PLAN_NEEDS_REVIEW' : 'STACKUP_PLAN_READY',
    manufacturer: { id: profile.id, name: profile.name },
    layerCount,
    layers,
    complexity,
    hdi,
    impedanceIntent: impedanceIntentFor(input, layers),
    copperStrategy: copperStrategyFor(input, layers),
    thermalStrategy: thermalStrategyFor(input),
    warnings,
    errors,
    humanReviewRequired: true,
  }
}

export function compareManufacturerCapabilities(input = {}) {
  const profiles = Object.values(manufacturerProfiles).map((profile) => {
    const plan = planStackup({ ...input, manufacturerProfile: profile.id })
    return {
      id: profile.id,
      name: profile.name,
      status: plan.status,
      layerOptions: profile.layerOptions,
      minTraceWidthMm: profile.minTraceWidthMm,
      minClearanceMm: profile.minClearanceMm,
      minViaDiameterMm: profile.minViaDiameterMm,
      minViaDrillMm: profile.minViaDrillMm,
      hdi: profile.hdi,
      blockers: plan.errors,
      warnings: plan.warnings,
      estimatedComplexityCostMultiplier: round((profile.hdi?.costMultiplier || 1) * (plan.complexity.level === 'extreme' ? 1.6 : plan.complexity.level === 'high' ? 1.25 : 1), 2),
    }
  })
  return {
    status: 'MANUFACTURER_CAPABILITY_COMPARISON_READY',
    recommended: profiles.find((item) => !item.blockers.length && /supported/i.test(item.hdi?.blindVias || ''))?.id || profiles.find((item) => !item.blockers.length)?.id || profiles[0]?.id,
    profiles,
    humanReviewRequired: true,
  }
}

export function scoreBoardComplexity(input = {}) {
  const board = input.board || {}
  const bounds = board.outline?.length ? polygonBounds(board.outline) : { minX: 0, minY: 0, maxX: board.widthMm || input.widthMm || 50, maxY: board.heightMm || input.heightMm || 30 }
  const area = Math.max(1, Math.abs((bounds.maxX - bounds.minX) * (bounds.maxY - bounds.minY)))
  const components = input.components || []
  const nets = input.nets || []
  const layerCount = Number(input.layerCount || board.layerCount || 2)
  const density = components.length ? components.length / area : estimateDensityFromText(input)
  const highSpeed = countMatches(input, /(usb|ethernet|pcie|mipi|lvds|rf|wifi|wi-fi|ble|ddr|hdmi|camera|can)/gi)
  const power = countMatches(input, /(motor|battery|poe|buck|boost|mosfet|charger|high current|phase|esc)/gi)
  const hdiRequested = wantsAdvancedVias(input)
  const score = Math.round(
    density * 900 +
    components.length * 0.6 +
    nets.length * 0.35 +
    layerCount * 8 +
    highSpeed * 9 +
    power * 8 +
    (hdiRequested ? 28 : 0),
  )
  const level = score >= 95 ? 'extreme' : score >= 65 ? 'high' : score >= 35 ? 'medium' : 'low'
  return {
    score,
    level,
    boardAreaMm2: round(area),
    componentDensityPer1000Mm2: round(density * 1000, 2),
    drivers: [
      ...(density > 0.025 ? ['dense component placement'] : []),
      ...(highSpeed ? ['high-speed or RF interfaces'] : []),
      ...(power ? ['power/thermal constraints'] : []),
      ...(hdiRequested ? ['advanced via request'] : []),
      ...(layerCount >= 6 ? ['six-plus-layer stackup'] : []),
    ],
  }
}

export function planViaTransitions({ route = {}, board = {}, profile = {}, stackup = null, input = {} }) {
  const layerCount = Number(board.layerCount || input.layerCount || stackup?.layerCount || 2)
  const hdi = profile.hdi || {}
  const netClass = route.className || 'DEFAULT'
  const advancedAllowed = Boolean(input.allowAdvancedVias || input.allowBlindVias || input.allowBuriedVias || input.allowMicrovias)
  const sensitive = ['USB_DIFF', 'ETHERNET_DIFF', 'RF', 'CRYSTAL', 'CLOCK'].includes(netClass)
  const compact = stackup?.complexity?.level === 'high' || stackup?.complexity?.level === 'extreme'
  if (sensitive && !input.allowSensitiveVias) {
    return { viaStack: 'avoid_vias', maxVias: 0, allowedTransitions: [], warnings: [`${route.net || netClass} should stay same-layer unless impedance/return-path review approves vias.`] }
  }
  if (layerCount >= 4 && advancedAllowed && compact && /supported|review|quote/i.test(`${hdi.blindVias} ${hdi.microvias}`)) {
    return {
      viaStack: input.allowMicrovias ? 'microvia_blind_fanout' : 'blind_via_fanout',
      maxVias: input.allowMicrovias ? 4 : 3,
      allowedTransitions: [...(hdi.supportedBlindViaPairs || [])],
      microvia: Boolean(input.allowMicrovias),
      diameterMm: input.allowMicrovias ? Math.max(hdi.minMicroviaDiameterMm || 0.15, 0.15) : Math.max(profile.minViaDiameterMm || 0.45, 0.45),
      drillMm: input.allowMicrovias ? Math.max(hdi.minMicroviaDrillMm || 0.075, 0.075) : Math.max(profile.minViaDrillMm || 0.2, 0.2),
      warnings: ['Advanced vias require fab quote review and should be used only for dense fanout or unavoidable layer transitions.'],
    }
  }
  return {
    viaStack: layerCount >= 4 ? 'through_via_with_inner_reference' : 'through_via',
    maxVias: compact ? 2 : 4,
    allowedTransitions: [['F.Cu', 'B.Cu']],
    diameterMm: Math.max(profile.minViaDiameterMm || 0.45, 0.45),
    drillMm: Math.max(profile.minViaDrillMm || 0.2, 0.2),
    warnings: [],
  }
}

function buildLayerStack(layerCount, input) {
  if (layerCount <= 1) return [{ index: 1, name: 'F.Cu', role: 'signal_and_power', reference: null }]
  if (layerCount === 2) return [
    { index: 1, name: 'F.Cu', role: 'components_signals_power', reference: 'B.Cu' },
    { index: 2, name: 'B.Cu', role: 'ground_pour_secondary_signals', reference: null },
  ]
  const layers = []
  for (let index = 0; index < layerCount; index += 1) {
    const name = signalLayers[index] || `In${index}.Cu`
    const last = index === layerCount - 1
    layers.push({
      index: index + 1,
      name: last ? 'B.Cu' : name,
      role: layerRole(index, layerCount, input),
      reference: index === 0 ? 'In1.Cu' : index === layerCount - 1 ? `In${Math.max(1, layerCount - 2)}.Cu` : null,
    })
  }
  return layers
}

function layerRole(index, layerCount, input) {
  if (index === 0) return 'components_high_speed_escape'
  if (index === 1) return 'continuous_ground_reference'
  if (index === 2) return /motor|battery|poe|power/i.test(JSON.stringify(input)) ? 'power_planes_high_current' : 'power_planes'
  if (index === layerCount - 1) return 'bottom_components_secondary_signals'
  if (index % 2 === 1) return 'ground_or_return_reference'
  return 'inner_signals_or_split_power'
}

function planHdiViaPolicy({ input, profile, layerCount, complexity }) {
  const requested = wantsAdvancedVias(input)
  const hdi = profile.hdi || {}
  const advancedStatus = `${hdi.blindVias || ''} ${hdi.buriedVias || ''} ${hdi.microvias || ''}`
  const allowed = /supported|review|quote/i.test(advancedStatus)
  const errors = []
  const warnings = []
  if (requested && layerCount < 4) errors.push({ severity: 'ERROR', code: 'HDI_REQUIRES_4PLUS_LAYERS', message: 'Blind/buried/microvias require at least a 4-layer stackup.' })
  if (requested && !allowed) errors.push({ severity: 'ERROR', code: 'MANUFACTURER_DOES_NOT_SUPPORT_HDI', message: `${profile.name} profile does not support requested advanced vias.` })
  if (requested && /quote|review/i.test(advancedStatus)) warnings.push({ severity: 'WARNING', code: 'HDI_ADVANCED_QUOTE_REQUIRED', message: 'Blind/buried/microvias require manufacturer quote review and higher cost.' })
  if (!requested && ['high', 'extreme'].includes(complexity.level) && layerCount >= 4) warnings.push({ severity: 'WARNING', code: 'HDI_OPTION_RECOMMENDED_FOR_REVIEW', message: 'Board is dense enough that blind/microvias may help fanout, but BoardForge will prefer through vias unless explicitly allowed.' })
  return {
    requested,
    allowed: requested ? allowed && !errors.length : false,
    requiresAdvancedReview: requested || warnings.some((item) => /HDI/.test(item.code)),
    blindVias: hdi.blindVias || 'not_supported',
    buriedVias: hdi.buriedVias || 'not_supported',
    microvias: hdi.microvias || 'not_supported',
    viaInPad: hdi.viaInPad || 'not_supported',
    supportedBlindViaPairs: hdi.supportedBlindViaPairs || [],
    supportedBuriedViaPairs: hdi.supportedBuriedViaPairs || [],
    minMicroviaDiameterMm: hdi.minMicroviaDiameterMm || null,
    minMicroviaDrillMm: hdi.minMicroviaDrillMm || null,
    costMultiplier: hdi.costMultiplier || 1,
    warnings,
    errors,
  }
}

function impedanceIntentFor(input, layers) {
  const text = JSON.stringify(input || {}).toLowerCase()
  const entries = []
  if (/usb/.test(text)) entries.push({ netClass: 'USB_DIFF', targetOhms: 90, preferredLayer: 'F.Cu', referenceLayer: layers.find((layer) => /ground/.test(layer.role))?.name || 'B.Cu', viaPolicy: 'same-layer preferred' })
  if (/ethernet|rj45/.test(text)) entries.push({ netClass: 'ETHERNET_DIFF', targetOhms: 100, preferredLayer: 'F.Cu', referenceLayer: layers.find((layer) => /ground/.test(layer.role))?.name || 'B.Cu', viaPolicy: 'same-layer or matched pair vias with review' })
  if (/rf|antenna|wifi|wi-fi|ble/.test(text)) entries.push({ netClass: 'RF', targetOhms: 50, preferredLayer: 'F.Cu', referenceLayer: layers.find((layer) => /ground/.test(layer.role))?.name || 'B.Cu', viaPolicy: 'avoid vias' })
  return entries
}

function copperStrategyFor(input, layers) {
  const text = JSON.stringify(input || {}).toLowerCase()
  return {
    ground: layers.some((layer) => /ground/.test(layer.role)) ? 'continuous reference plane, stitched to top/bottom pours' : 'bottom copper pour with stitching',
    power: /motor|battery|poe|high current/.test(text) ? 'wide pours, thermal relief review, parallel vias on layer transitions' : 'local pours for VIN/3V3 with decoupling loops minimized',
    splitPlanes: /analog|rf|sensor/.test(text) ? 'avoid split return paths below RF/analog/differential nets' : 'avoid unnecessary splits',
  }
}

function thermalStrategyFor(input) {
  const text = JSON.stringify(input || {}).toLowerCase()
  return {
    heatSources: ['regulator', 'mosfet', 'poe', 'motor', 'charger', 'shunt'].filter((term) => text.includes(term)),
    rules: ['keep heat sources away from RF modules, crystals, IMUs, precision analog, and battery temperature sensors', 'use copper spreading only where it does not violate isolation or antenna keepouts'],
  }
}

function wantsAdvancedVias(input) {
  const text = JSON.stringify(input || '').toLowerCase()
  return Boolean(input.allowBlindVias || input.allowBuriedVias || input.allowMicrovias || /blind via|buried via|microvia|hdi|via-in-pad|via in pad/.test(text))
}

function estimateDensityFromText(input) {
  const text = JSON.stringify(input || '').toLowerCase()
  if (/tiny|compact|wearable|whoop|30x30|dense|hdi/.test(text)) return 0.035
  if (/large|backplane|controller|industrial/.test(text)) return 0.008
  return 0.016
}

function countMatches(input, regex) {
  return (JSON.stringify(input || '').match(regex) || []).length
}
