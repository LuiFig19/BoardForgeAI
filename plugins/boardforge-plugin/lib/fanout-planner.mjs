export function planFanout(input = {}) {
  const board = input.board || {}
  const components = input.components || []
  const nets = normalizeNets(input.nets || [])
  const stackup = input.stackup || {}
  const layerCount = Number(input.layerCount || stackup.layerCount || board.layerCount || 2)
  const denseParts = components.filter(isDensePackage)
  const connectors = components.filter((component) => /USB|RJ45|CONNECTOR|HEADER|SWD|ESC/i.test(`${component.group || ''} ${component.value || ''}`))
  const plans = denseParts.map((component) => fanoutForComponent(component, { board, nets, layerCount, stackup, input }))
  const connectorPlans = connectors.map((component) => connectorFanout(component, { board, nets }))
  const errors = plans.flatMap((plan) => plan.errors)
  const warnings = [
    ...plans.flatMap((plan) => plan.warnings),
    ...connectorPlans.flatMap((plan) => plan.warnings),
  ]
  return {
    schemaVersion: 1,
    status: errors.length ? 'FANOUT_PLAN_BLOCKED' : 'FANOUT_PLAN_READY_NEEDS_REVIEW',
    layerCount,
    strategy: boardStrategy(board, layerCount, plans),
    denseComponents: plans,
    edgeConnectors: connectorPlans,
    viaPolicy: viaPolicyFor(layerCount, stackup, input),
    routingPreconditions: [
      'place decoupling capacitors before fanout routes',
      'escape power and ground pins first',
      'escape differential pairs as matched pairs on the same layer where possible',
      'do not route under antenna or hot-zone keepouts unless explicitly approved',
    ],
    warnings,
    errors,
    humanReviewRequired: true,
  }
}

function fanoutForComponent(component, context) {
  const packageInfo = packageInfoFor(component)
  const pins = Number(component.pinCount || packageInfo.pinCount || inferPinCount(component))
  const pitchMm = Number(component.pitchMm || packageInfo.pitchMm || 0.5)
  const className = packageClass(component)
  const powerPins = powerPinNets(component, context.nets)
  const signalNets = signalPinNets(component, context.nets)
  const recommendedLayers = layerRecommendation(className, pins, pitchMm, context.layerCount)
  const useBlindVia = className === 'BGA' && pitchMm <= 0.5 && context.layerCount >= 4
  const errors = []
  const warnings = []
  if (className === 'BGA' && context.layerCount < 4) errors.push(issue('ERROR', 'BGA_REQUIRES_4PLUS_LAYERS', `${component.ref} looks like a BGA/dense array and should not be attempted on ${context.layerCount} layers.`, { ref: component.ref }))
  if (pins >= 80 && context.layerCount < 4) warnings.push(issue('WARNING', 'DENSE_IC_ON_LOW_LAYER_COUNT', `${component.ref} has ${pins} pins; four layers are strongly recommended for escape and power integrity.`, { ref: component.ref }))
  if (pitchMm < 0.5 && !context.input.allowMicrovias) warnings.push(issue('WARNING', 'MICROVIA_REVIEW_REQUIRED', `${component.ref} pitch is ${pitchMm} mm; microvia/advanced fab review may be required.`, { ref: component.ref }))
  return {
    ref: component.ref,
    group: component.group || null,
    value: component.value || null,
    packageClass: className,
    pinCount: pins,
    pitchMm,
    recommendedLayers,
    escape: {
      method: className === 'BGA' ? 'dogbone or via-in-pad review' : className === 'QFN' ? 'perimeter escape with corner relief and center thermal pad vias' : 'perimeter escape',
      preferredDirections: preferredDirections(component),
      firstPass: ['GND', 'power rails', ...signalNets.slice(0, 6)],
      powerPins,
      signalNets: signalNets.slice(0, 16),
      viaType: useBlindVia ? 'blind/microvia candidate' : 'standard through via',
      escapeRings: escapeRingsFor({ className, pins, pitchMm, layerCount: context.layerCount, input: context.input }),
      channelBudget: channelBudgetFor({ component, pins, pitchMm, layerCount: context.layerCount, board: context.board }),
      viaInPad: viaInPadPolicy({ className, pitchMm, input: context.input, stackup: context.stackup }),
    },
    manufacturability: manufacturabilityFor({ component, className, pins, pitchMm, layerCount: context.layerCount, input: context.input }),
    decouplingRules: [
      '100nF capacitor per power domain within 2 mm where mechanically possible',
      'bulk capacitor near each regulator or high-current rail entry',
      'short ground return to uninterrupted reference plane',
    ],
    constraints: [
      { kind: 'pin_escape', rule: 'route short orthogonal escape stubs before long routes' },
      { kind: 'reference_plane', rule: 'avoid layer swaps unless adjacent reference plane remains continuous' },
      { kind: 'thermal_pad', rule: className === 'QFN' ? 'thermal pad vias require paste-mask and fab review' : 'thermal copper must not violate keepouts' },
    ],
    warnings,
    errors,
  }
}

function connectorFanout(component, context) {
  const names = Object.values(component.pinMap || {}).filter(Boolean)
  const highSpeed = names.filter((name) => /USB|ETH|DP|DN|TX|RX|CAN/i.test(name))
  return {
    ref: component.ref,
    group: component.group || null,
    value: component.value || null,
    edgeRequired: true,
    fanout: highSpeed.length
      ? 'escape high-speed pairs straight from connector pads before bends or vias'
      : 'route connector pins to nearby test/service zones',
    nets: names,
    warnings: context.board.outline?.length ? [] : [issue('WARNING', 'CONNECTOR_EDGE_REVIEW_LIMITED', `${component.ref} edge placement cannot be fully reviewed without an outline.`, { ref: component.ref })],
  }
}

function boardStrategy(board, layerCount, plans) {
  const denseCount = plans.length
  const compact = Number(board.widthMm || 0) * Number(board.heightMm || 0) < 2500
  return {
    level: denseCount > 2 || (compact && denseCount) ? 'compact_dense' : denseCount ? 'standard_dense' : 'simple',
    routeOrder: [
      'mounting holes and board keepouts',
      'edge connectors',
      'power tree and regulator loops',
      'dense IC fanout',
      'high-speed and differential pairs',
      'remaining low-speed signals',
      'ground stitching and copper cleanup',
    ],
    layerAdvice: layerCount >= 4 ? 'use inner reference/power planes and keep top/bottom for placement plus local fanout' : 'two-layer fanout is limited; avoid dense packages and high-speed complexity',
  }
}

function viaPolicyFor(layerCount, stackup, input) {
  const hdi = stackup.hdi || {}
  return {
    standardThroughVias: true,
    blindViasAllowed: Boolean(input.allowBlindVias || hdi.allowed),
    buriedViasAllowed: Boolean(input.allowBuriedVias && hdi.allowed),
    microviasAllowed: Boolean(input.allowMicrovias && hdi.allowed),
    allowedTransitions: layerCount >= 4
      ? stackup.viaTransitionMatrix?.allAllowed || [['F.Cu', 'In1.Cu'], ['F.Cu', 'B.Cu'], ['In2.Cu', 'B.Cu']]
      : [['F.Cu', 'B.Cu']],
    review: hdi.requiresAdvancedReview ? 'manufacturer HDI stackup approval required' : 'standard fab via rules apply',
  }
}

function escapeRingsFor({ className, pins, pitchMm, layerCount, input }) {
  if (className === 'BGA') {
    const rings = Math.max(1, Math.ceil(Math.sqrt(pins) / 2))
    return Array.from({ length: Math.min(rings, 6) }, (_, index) => ({
      ring: index + 1,
      preferredLayer: index < 2 ? 'F.Cu' : layerCount >= 6 ? `In${Math.min(index - 1, layerCount - 2)}.Cu` : 'B.Cu',
      method: pitchMm <= 0.5 && input.allowMicrovias ? 'microvia_escape_review' : index < 2 ? 'dogbone_escape' : 'through_via_escape',
    }))
  }
  if (className === 'QFN') return [
    { ring: 1, preferredLayer: 'F.Cu', method: 'perimeter_stub_escape' },
    { ring: 2, preferredLayer: layerCount >= 4 ? 'B.Cu' : 'F.Cu', method: 'selective_via_escape' },
  ]
  return [{ ring: 1, preferredLayer: 'F.Cu', method: 'perimeter_escape' }]
}

function channelBudgetFor({ component, pins, pitchMm, layerCount, board }) {
  const area = Math.max(1, Number(board.widthMm || board.width || 50) * Number(board.heightMm || board.height || 30))
  const density = pins / area
  const channelsPerLayer = Math.max(4, Math.floor((1 / Math.max(0.25, pitchMm)) * 4))
  return {
    estimatedPinDensity: Number(density.toFixed(4)),
    channelsPerSignalLayer: channelsPerLayer,
    estimatedSignalLayersNeeded: Math.max(1, Math.ceil((pins * 0.55) / channelsPerLayer)),
    risk: density > 0.08 || (pins >= 100 && layerCount < 6) ? 'high_dense_escape_risk' : density > 0.04 ? 'medium_escape_risk' : 'normal',
    rule: `${component.ref || 'component'} fanout must reserve corridors before placing passives too close to package edges.`,
  }
}

function viaInPadPolicy({ className, pitchMm, input, stackup }) {
  const needed = className === 'BGA' && pitchMm <= 0.5
  const allowed = Boolean(input.allowViaInPad || stackup?.hdi?.viaInPadAllowed)
  return {
    needed,
    allowed,
    status: needed && !allowed ? 'VIA_IN_PAD_REVIEW_REQUIRED' : needed ? 'VIA_IN_PAD_ALLOWED_WITH_FILLED_CAPPED_REVIEW' : 'NOT_REQUIRED',
    rule: needed ? 'Use only filled/capped via-in-pad with assembly and fab approval; never open vias in paste pads.' : 'Prefer dogbone/perimeter escape.',
  }
}

function manufacturabilityFor({ component, className, pins, pitchMm, layerCount, input }) {
  return {
    assemblyRisk: pitchMm < 0.5 ? 'fine_pitch_review' : pins >= 100 ? 'dense_part_review' : 'standard_review',
    minimumRecommendedLayers: className === 'BGA' ? Math.max(6, layerCount) : pins >= 100 ? 6 : 4,
    pasteMaskReview: className === 'QFN' || className === 'BGA',
    fabApprovalRequired: Boolean(input.allowBlindVias || input.allowMicrovias || input.allowViaInPad || pitchMm < 0.5),
    notes: [
      'Verify courtyard and pick-and-place origin before release.',
      'Keep decoupling close, but do not block escape corridors.',
      'Reserve local ground via returns around package transitions.',
    ],
  }
}

function normalizeNets(nets) {
  return (nets || []).map((net) => typeof net === 'string' ? { name: net } : net).filter((net) => net.name)
}

function isDensePackage(component) {
  const text = `${component.ref || ''} ${component.group || ''} ${component.value || ''} ${component.package || ''} ${component.footprint || ''}`
  return /(QFN|QFP|TQFP|BGA|LGA|WLCSP|ESP32|STM32|MCU|PHY|PMIC|DRIVER)/i.test(text)
}

function packageClass(component) {
  const text = `${component.package || ''} ${component.footprint || ''} ${component.value || ''}`
  if (/BGA|WLCSP/i.test(text)) return 'BGA'
  if (/QFN|DFN|LGA|ESP32/i.test(text)) return 'QFN'
  if (/QFP|TQFP|LQFP/i.test(text)) return 'QFP'
  return /MODULE|WROOM/i.test(text) ? 'MODULE' : 'IC'
}

function packageInfoFor(component) {
  const text = `${component.package || ''} ${component.footprint || ''} ${component.value || ''}`
  if (/ESP32|WROOM/i.test(text)) return { pinCount: 41, pitchMm: 1.27 }
  if (/QFN[-_ ]?56/i.test(text)) return { pinCount: 56, pitchMm: 0.5 }
  if (/QFN[-_ ]?32/i.test(text)) return { pinCount: 32, pitchMm: 0.5 }
  if (/TQFP[-_ ]?100/i.test(text)) return { pinCount: 100, pitchMm: 0.5 }
  if (/BGA/i.test(text)) return { pinCount: 100, pitchMm: 0.5 }
  return {}
}

function inferPinCount(component) {
  const pinMapCount = Object.keys(component.pinMap || {}).length
  if (pinMapCount) return pinMapCount
  if (/ESP32|WROOM/i.test(`${component.group || ''} ${component.value || ''}`)) return 41
  if (/MCU|STM32/i.test(`${component.group || ''} ${component.value || ''}`)) return 64
  if (/PHY/i.test(`${component.group || ''} ${component.value || ''}`)) return 32
  return 16
}

function layerRecommendation(className, pins, pitchMm, currentLayers) {
  const minimum = className === 'BGA' ? 4 : pins >= 80 || pitchMm < 0.5 ? 4 : 2
  return {
    minimum,
    current: currentLayers,
    acceptable: currentLayers >= minimum,
    reason: currentLayers >= minimum ? 'layer count can support first-pass fanout review' : `${minimum}+ layers recommended for this package density`,
  }
}

function powerPinNets(component, nets) {
  const mapped = Object.values(component.pinMap || {}).filter((name) => /GND|3V3|5V|VDD|VIN|VBAT|VUSB|POE/i.test(name))
  return [...new Set([...mapped, ...nets.filter((net) => /GND|3V3|5V|VDD|VIN|VBAT|VUSB|POE/i.test(net.name)).map((net) => net.name)])]
}

function signalPinNets(component, nets) {
  const mapped = Object.values(component.pinMap || {}).filter((name) => !/GND|3V3|5V|VDD|VIN|VBAT|VUSB|POE/i.test(name))
  return [...new Set([...mapped, ...nets.filter((net) => !/GND|3V3|5V|VDD|VIN|VBAT|VUSB|POE/i.test(net.name)).map((net) => net.name)])]
}

function preferredDirections(component) {
  const text = `${component.group || ''} ${component.value || ''}`
  if (/ESP32|WROOM|RF/i.test(text)) return ['antenna side clear', 'USB/debug opposite antenna', 'sensors away from regulator']
  if (/PHY|ETH/i.test(text)) return ['RJ45 side', 'MCU side', 'short clock path']
  return ['nearest board edge', 'nearest power decoupling cluster']
}

function issue(severity, code, message, data = {}) {
  return { severity, code, message, ...data }
}
