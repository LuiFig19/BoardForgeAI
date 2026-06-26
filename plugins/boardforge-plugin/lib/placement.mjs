import { distance, pointInPolygon, polygonBounds, rectCorners, rectsOverlap, round } from './geometry.mjs'
import { validatePlacement } from './validation.mjs'
import { compilePlacementConstraints } from './placement-constraints.mjs'

const sizes = {
  MCU: [10, 10], ESP32_S3: [48, 41], IMU: [3, 3], USB: [12, 4], RJ45: [16, 16], REGULATOR: [5, 5],
  BLACKBOX: [6, 5], BAROMETER: [3, 3], SWD: [8, 3], ESC_CONNECTOR: [10, 4], SENSOR_CONNECTOR: [12, 4],
  POWER_INPUT: [10, 5], ETHERNET_PHY: [7, 7], POE_FRONT_END: [14, 12], CAP: [2.2, 1.2], RES: [2.2, 1.2],
  TVS: [3, 2], INDUCTOR: [3, 2.2], CAN_TRANSCEIVER: [14, 4], RS485_TRANSCEIVER: [14, 4], FIELD_CONNECTOR: [18, 4],
  MOTOR_HEADER: [14, 4], TERMINAL_BLOCK: [40, 8], ISOLATOR: [6, 5], RELAY_OR_DRIVER: [6, 5], TEST_PAD: [1.2, 1.2], DEFAULT: [4, 3],
}

function component(ref, group, x, y, rotation = 0, options = {}) {
  const [width, height] = sizes[group] || sizes.DEFAULT
  return { ref, group, x: round(x), y: round(y), rotation, width, height, ...options }
}

export function generatePlacementPlan(board, template, profile, options = {}) {
  const bounds = polygonBounds(board.outline)
  const width = bounds.maxX - bounds.minX
  const height = bounds.maxY - bounds.minY
  const cx = bounds.minX + width / 2
  const cy = bounds.minY + height / 2
  const edge = profile.componentToEdgeClearanceMm + 3
  const components = []
  if (template?.id === 'ESP32_S3_POE_SENSOR') {
    components.push(component('J1', 'RJ45', bounds.minX + edge + 5, cy, 90), component('U2', 'ETHERNET_PHY', bounds.minX + edge + 20, cy - 5), component('U3', 'POE_FRONT_END', bounds.minX + edge + 21, cy + 9), component('U1', 'ESP32_S3', cx + 11, cy), component('J2', 'USB', bounds.maxX - edge - 5, cy + 10, 270), component('J3', 'SENSOR_CONNECTOR', bounds.maxX - edge - 5, cy - 10, 270), component('U4', 'REGULATOR', cx, cy + 12))
  } else if (template?.id === 'ROBOTICS_CONTROLLER') {
    components.push(component('J1', 'POWER_INPUT', bounds.minX + edge + 6, cy + 24, 90), component('U4', 'REGULATOR', bounds.minX + 34, cy + 22), component('U1', 'MCU', cx - 4, cy), component('U2', 'CAN_TRANSCEIVER', bounds.maxX - 42, cy - 15), component('U3', 'RS485_TRANSCEIVER', bounds.maxX - 42, cy + 15), component('J2', 'FIELD_CONNECTOR', bounds.maxX - edge - 18, cy, 90), component('J3', 'MOTOR_HEADER', cx + 20, bounds.maxY - edge, 0), component('J4', 'SENSOR_CONNECTOR', cx + 22, bounds.minY + edge, 180), component('J5', 'SENSOR_CONNECTOR', bounds.minX + edge + 7, bounds.minY + edge + 7, 90))
  } else if (template?.id === 'INDUSTRIAL_IO') {
    components.push(component('J1', 'TERMINAL_BLOCK', bounds.maxX - edge - 6, cy, 90), component('D1', 'TVS', bounds.maxX - 35, cy - 18), component('D2', 'TVS', bounds.maxX - 35, cy + 18), component('U2', 'ISOLATOR', cx + 18, cy), component('U3', 'RELAY_OR_DRIVER', bounds.maxX - 54, cy + 18), component('U4', 'CAN_TRANSCEIVER', cx - 10, cy - 15), component('U5', 'RS485_TRANSCEIVER', cx - 10, cy + 15), component('U1', 'MCU', bounds.minX + 46, cy), component('J2', 'POWER_INPUT', bounds.minX + edge + 6, cy + 24, 90), component('U6', 'REGULATOR', bounds.minX + 34, cy + 22), component('J3', 'SENSOR_CONNECTOR', bounds.minX + edge + 7, bounds.minY + edge + 7, 90))
  } else if (template?.id === 'DRONE_FC_30X30' || template?.id === 'DRONE_AIO_WHOOP') {
    components.push(component('U1', 'MCU', cx, cy + 3), component('U2', 'IMU', cx, cy - 8), component('Y1', 'DEFAULT', cx + 8, cy + 1), component('J1', 'USB', cx, bounds.minY + edge, 180), component('U3', 'BLACKBOX', cx - 9, cy + 7), component('U4', 'REGULATOR', cx + 10, cy + 8), component('J2', 'ESC_CONNECTOR', cx, bounds.maxY - edge, 0))
  } else {
    components.push(component('U1', template?.id === 'ESP32_S3_SENSOR' ? 'ESP32_S3' : 'MCU', cx, cy), component('J1', 'USB', bounds.minX + edge + 3, cy, 90), component('U2', 'REGULATOR', cx - 13, cy + 8), component('J2', 'SENSOR_CONNECTOR', bounds.maxX - edge - 5, cy, 270))
  }
  const selectedComponents = options.components?.length ? options.components : components
  const issues = validatePlacement(board, selectedComponents, profile)
  const constraints = compilePlacementConstraints(board, selectedComponents, options)
  const scoring = scorePlacement(board, selectedComponents, options.nets || [], profile)
  const constraintIssues = [
    ...constraints.violations.map((rule) => ({ severity: 'ERROR', code: 'PLACEMENT_CONSTRAINT_VIOLATION', message: `${rule.ref} violates ${rule.kind}: ${rule.requirement}`, details: rule })),
    ...constraints.warnings.map((rule) => ({ severity: 'WARNING', code: 'PLACEMENT_CONSTRAINT_REVIEW', message: `${rule.ref} needs ${rule.kind} review: ${rule.requirement}`, details: rule })),
  ]
  const allIssues = [...issues, ...scoring.issues, ...constraintIssues]
  return { status: allIssues.some((item) => ['BLOCKER', 'ERROR'].includes(item.severity)) ? 'NEEDS_FIX' : 'PLACEMENT_PLAN_READY', components: selectedComponents, rulesApplied: ['components fully inside outline', 'edge connectors placed on board edge intent', 'mounting hole clearance checked', 'component overlap checked', 'ratsnest length scored', 'passive proximity scored', 'mechanical/RF/thermal/service constraints compiled'], constraints, scoring, issues: allIssues }
}

export function optimizePlacementPlan(board, template, profile, options = {}) {
  const original = generatePlacementPlan(board, template, profile, options)
  let components = original.components.map((component) => ({ ...component }))
  const actions = []
  const densityClass = classifyPlacementDensity(board, components)
  const denseMode = Boolean(options.densePlacement || densityClass !== 'normal' || (board.layerCount || 2) >= 6)
  const passes = denseMode ? 8 : 3
  for (let pass = 0; pass < passes; pass += 1) {
    components = components.map((component, index) => {
      const moved = repairConstraintPosition(board, component, components, index, profile, options)
      if (moved.x !== component.x || moved.y !== component.y || moved.rotation !== component.rotation) {
        actions.push({ ref: component.ref, kind: 'constraint_repair', from: pickPlacement(component), to: pickPlacement(moved) })
      }
      return moved
    })
    components = resolvePlacementOverlaps(board, components, profile, actions, options)
  }
  const optimized = generatePlacementPlan(board, template, profile, { ...options, components })
  const fixedErrors = original.issues.filter((issue) => ['BLOCKER', 'ERROR'].includes(issue.severity)).length - optimized.issues.filter((issue) => ['BLOCKER', 'ERROR'].includes(issue.severity)).length
  return {
    ...optimized,
    status: optimized.status === 'PLACEMENT_PLAN_READY' ? 'OPTIMIZED_PLACEMENT_READY_NEEDS_REVIEW' : 'OPTIMIZED_PLACEMENT_NEEDS_REVIEW',
    placementMode: denseMode ? 'dense_constraint_repair' : 'standard_constraint_repair',
    densityClass,
    optimizationPasses: passes,
    originalScore: original.scoring.score,
    optimizedScore: optimized.scoring.score,
    fixedErrorCount: Math.max(0, fixedErrors),
    actions: dedupeActions(actions),
    originalIssues: original.issues,
  }
}

export function fixComponentOffBoard(board, component, profile) {
  const bounds = polygonBounds(board.outline)
  return { ...component, x: round(Math.max(bounds.minX + component.width / 2 + profile.componentToEdgeClearanceMm, Math.min(bounds.maxX - component.width / 2 - profile.componentToEdgeClearanceMm, component.x))), y: round(Math.max(bounds.minY + component.height / 2 + profile.componentToEdgeClearanceMm, Math.min(bounds.maxY - component.height / 2 - profile.componentToEdgeClearanceMm, component.y))) }
}

function repairConstraintPosition(board, component, components, index, profile, options) {
  const candidates = candidatePositionsFor(board, component, profile, options)
  return bestCandidate(board, component, components, index, candidates, profile, options)
}

function candidatePositionsFor(board, component, profile, options) {
  const bounds = polygonBounds(board.outline)
  const clearance = profile.componentToEdgeClearanceMm || 1
  const halfW = (component.width || 1) / 2
  const halfH = (component.height || 1) / 2
  const edgeInsetX = clearance + halfW + 0.2
  const edgeInsetY = clearance + halfH + 0.2
  const denseMode = Boolean(options.densePlacement || (board.layerCount || 2) >= 6 || options.components?.length > 12)
  const grid = Math.max(denseMode ? 1.25 : 2.5, Number(options.gridMm || (denseMode ? 1.5 : 3)))
  const centerCandidates = []
  for (let x = bounds.minX + edgeInsetX; x <= bounds.maxX - edgeInsetX; x += grid) {
    for (let y = bounds.minY + edgeInsetY; y <= bounds.maxY - edgeInsetY; y += grid) centerCandidates.push({ x: round(x), y: round(y), rotation: component.rotation || 0 })
  }
  const edgeCandidates = [
    { x: bounds.minX + edgeInsetX, y: component.y, rotation: 90 },
    { x: bounds.maxX - edgeInsetX, y: component.y, rotation: 270 },
    { x: component.x, y: bounds.minY + edgeInsetY, rotation: 180 },
    { x: component.x, y: bounds.maxY - edgeInsetY, rotation: 0 },
    { x: bounds.minX + edgeInsetX, y: bounds.minY + edgeInsetY, rotation: 90 },
    { x: bounds.maxX - edgeInsetX, y: bounds.minY + edgeInsetY, rotation: 270 },
    { x: bounds.minX + edgeInsetX, y: bounds.maxY - edgeInsetY, rotation: 90 },
    { x: bounds.maxX - edgeInsetX, y: bounds.maxY - edgeInsetY, rotation: 270 },
  ].map((candidate) => ({
    ...candidate,
    x: round(clamp(candidate.x, bounds.minX + edgeInsetX, bounds.maxX - edgeInsetX)),
    y: round(clamp(candidate.y, bounds.minY + edgeInsetY, bounds.maxY - edgeInsetY)),
  }))
  const categoryCandidates = categorySpecificCandidates(component, bounds, edgeInsetX, edgeInsetY)
  if (categoryCandidates.length) return categoryCandidates
  const usbSupport = usbSupportCandidates(component, options.components || [], bounds, edgeInsetX, edgeInsetY)
  if (usbSupport.length) return usbSupport
  if (/^(USB|RJ45|POWER_INPUT|SENSOR_CONNECTOR|ESC_CONNECTOR|SWD)$/i.test(component.group || '')) return [...edgeCandidates, ...centerCandidates]
  if (/(ESP32|RF|ANT|WROOM|BLE|WIFI|WI-FI)/i.test(`${component.group || ''} ${component.value || ''}`)) return [...edgeCandidates.slice(2), ...centerCandidates]
  return [{ x: component.x, y: component.y, rotation: component.rotation || 0 }, ...centerCandidates]
}

function categorySpecificCandidates(component, bounds, edgeInsetX, edgeInsetY) {
  const w = bounds.maxX - bounds.minX
  const h = bounds.maxY - bounds.minY
  const cx = (bounds.minX + bounds.maxX) / 2
  const cy = (bounds.minY + bounds.maxY) / 2
  const clampPoint = (candidate) => ({
    ...candidate,
    x: round(clamp(candidate.x, bounds.minX + edgeInsetX, bounds.maxX - edgeInsetX)),
    y: round(clamp(candidate.y, bounds.minY + edgeInsetY, bounds.maxY - edgeInsetY)),
  })
  const rows = {
    CAN_TRANSCEIVER: [
      { x: bounds.minX + w * 0.34, y: bounds.minY + h * 0.34, rotation: 90 },
      { x: bounds.minX + w * 0.30, y: bounds.minY + h * 0.42, rotation: 90 },
      { x: cx - 24, y: cy - 12, rotation: 90 },
    ],
    RS485_TRANSCEIVER: [
      { x: bounds.minX + w * 0.34, y: bounds.minY + h * 0.62, rotation: 90 },
      { x: bounds.minX + w * 0.30, y: bounds.minY + h * 0.52, rotation: 90 },
      { x: cx - 24, y: cy + 10, rotation: 90 },
    ],
    FIELD_CONNECTOR: [
      { x: bounds.maxX - 17, y: cy, rotation: 90 },
      { x: bounds.maxX - 17, y: bounds.minY + h * 0.62, rotation: 90 },
    ],
    MOTOR_HEADER: [
      { x: bounds.minX + w * 0.66, y: bounds.maxY - 16, rotation: 90 },
      { x: bounds.minX + w * 0.58, y: bounds.maxY - 16, rotation: 90 },
    ],
    TERMINAL_BLOCK: [
      { x: bounds.maxX - 28, y: cy, rotation: 0 },
      { x: bounds.maxX - 32, y: bounds.minY + h * 0.58, rotation: 0 },
    ],
    ISOLATOR: [{ x: bounds.minX + w * 0.55, y: cy, rotation: 0 }],
    RELAY_OR_DRIVER: [{ x: bounds.minX + w * 0.70, y: bounds.minY + h * 0.67, rotation: 0 }],
  }[component.group]
  if (rows) return rows.map(clampPoint)
  if (component.role === 'debug_header') {
    return [
      { x: bounds.minX + Math.max(edgeInsetX, 12), y: bounds.maxY - Math.max(edgeInsetY, 14), rotation: 90 },
      { x: bounds.minX + Math.max(edgeInsetX, 12), y: bounds.minY + Math.max(edgeInsetY, 14), rotation: 90 },
    ].map(clampPoint)
  }
  return []
}

function usbSupportCandidates(component, components, bounds, edgeInsetX, edgeInsetY) {
  const supportText = `${component.value || ''} ${component.netA || ''} ${component.netB || ''} ${Object.values(component.pinMap || {}).join(' ')}`
  if (!['RES', 'TVS'].includes(component.group) || !/(CC[12]|USB|ESD|TVS)/i.test(supportText)) return []
  const parent = components.find((item) => item.ref === component.supportsRef && item.group === 'USB')
  if (!parent) return []
  const connectorFacesLeft = (parent.rotation || 0) === 90 || parent.x < (bounds.minX + bounds.maxX) / 2
  const inward = connectorFacesLeft ? 1 : -1
  const side = /CC2/i.test(supportText) ? 1 : -1
  const xBase = parent.x + inward * Math.max(7.5, (parent.width || 10) / 2 + 2.5)
  const candidates = component.group === 'TVS'
    ? [
        { x: xBase + inward * 1.5, y: parent.y, rotation: 0 },
        { x: xBase + inward * 3, y: parent.y, rotation: 0 },
        { x: xBase, y: parent.y + 4, rotation: 0 },
      ]
    : [
        { x: xBase, y: parent.y + side * 2.2, rotation: 0 },
        { x: xBase + inward * 1.8, y: parent.y + side * 2.2, rotation: 0 },
        { x: xBase, y: parent.y + side * 3.8, rotation: 0 },
        { x: xBase + inward * 1.8, y: parent.y + side * 3.8, rotation: 0 },
      ]
  return candidates.map((candidate) => ({
    ...candidate,
    x: round(clamp(candidate.x, bounds.minX + edgeInsetX, bounds.maxX - edgeInsetX)),
    y: round(clamp(candidate.y, bounds.minY + edgeInsetY, bounds.maxY - edgeInsetY)),
  }))
}

function bestCandidate(board, component, components, index, candidates, profile, options) {
  const ranked = candidates
    .map((candidate) => ({ ...component, ...candidate }))
    .filter((candidate) => componentFits(board, candidate, profile))
    .map((candidate) => ({ candidate, score: placementCandidateScore(board, candidate, components, index, profile, options) }))
    .sort((a, b) => a.score - b.score)
  return ranked[0]?.candidate || fixComponentOffBoard(board, component, profile)
}

function placementCandidateScore(board, candidate, components, index, profile, options) {
  const bounds = polygonBounds(board.outline)
  const others = components.filter((_, otherIndex) => otherIndex !== index)
  const overlapPenalty = others.filter((other) => rectsOverlap(candidate, other, profile.componentToComponentClearanceMm || 0)).length * 1000
  const holePenalty = (board.mountingHoles || []).filter((hole) => rectsOverlap(candidate, { x: hole.x, y: hole.y, width: hole.diameterMm + 2, height: hole.diameterMm + 2 })).length * 1000
  const nearestEdge = Math.min(Math.abs(candidate.x - bounds.minX), Math.abs(bounds.maxX - candidate.x), Math.abs(candidate.y - bounds.minY), Math.abs(bounds.maxY - candidate.y))
  const edgePenalty = /^(USB|RJ45|POWER_INPUT)$/i.test(candidate.group || '') ? nearestEdge * 30 : 0
  const rfPenalty = /(ESP32|RF|ANT|WROOM|BLE|WIFI|WI-FI)/i.test(`${candidate.group || ''} ${candidate.value || ''}`) ? nearestEdge * 12 : 0
  const ratsnestPenalty = localRatsnestPenalty(candidate, others, options.nets || [])
  const supportPenalty = supportProximityPenalty(candidate, others)
  const escapePenalty = denseEscapePenalty(candidate, others, options)
  const keepoutPenalty = placementKeepoutPenalty(candidate, options)
  const escapeCorridorPenalty = escapeCorridorBlockPenalty(candidate, others, profile, options)
  return round(overlapPenalty + holePenalty + edgePenalty + rfPenalty + ratsnestPenalty + supportPenalty + escapePenalty + keepoutPenalty + escapeCorridorPenalty + distance(candidate, components[index] || candidate) * 0.5)
}

function placementKeepoutPenalty(candidate, options = {}) {
  const keepouts = [...(options.keepouts || []), ...(options.zones || [])]
  return keepouts.reduce((sum, zone) => {
    if (zone.allowPlacement === true) return sum
    const rect = zoneRect(zone)
    if (!rect) return sum
    const overlaps = rectsOverlap(candidate, rect, Number(zone.clearanceMm || 0))
    const text = `${zone.kind || ''} ${zone.id || ''} ${zone.reason || ''}`
    const severity = /antenna|rf|heat|thermal|isolation|high.?voltage/i.test(text) ? 1800 : 650
    return sum + (overlaps ? severity : 0)
  }, 0)
}

function escapeCorridorBlockPenalty(candidate, others, profile = {}, options = {}) {
  const active = others.filter((item) => /(BGA|QFN|MCU|PROCESSOR|ESP32|STM32|FPGA|ASIC|ETHERNET_PHY|USB|RJ45)/i.test(`${item.group || ''} ${item.value || ''} ${item.package || ''}`))
  if (!active.length) return 0
  const clearance = Math.max(profile.componentToComponentClearanceMm || 0.25, options.escapeCorridorMm || 1.2)
  return active.reduce((sum, item) => {
    const corridor = escapeCorridorRect(item, clearance)
    if (!corridor) return sum
    if (!rectsOverlap(candidate, corridor, 0)) return sum
    const candidateText = `${candidate.group || ''} ${candidate.value || ''}`
    const isSupport = ['CAP', 'RES', 'INDUCTOR', 'TVS'].includes(candidate.group) || /support/i.test(candidate.role || '')
    const penalty = isSupport && candidate.supportsRef === item.ref ? 80 : /connector|usb|rj45/i.test(candidateText) ? 350 : 900
    return sum + penalty
  }, 0)
}

function escapeCorridorRect(component, clearance) {
  const width = Number(component.width || 0)
  const height = Number(component.height || 0)
  if (!width || !height) return null
  const horizontal = width >= height
  return {
    x: component.x,
    y: component.y,
    width: horizontal ? width + clearance * 2 : width + clearance * 6,
    height: horizontal ? height + clearance * 6 : height + clearance * 2,
  }
}

function zoneRect(zone = {}) {
  if (Number.isFinite(Number(zone.x)) && Number.isFinite(Number(zone.y)) && Number(zone.width || zone.widthMm) && Number(zone.height || zone.heightMm)) {
    return { x: Number(zone.x), y: Number(zone.y), width: Number(zone.width || zone.widthMm), height: Number(zone.height || zone.heightMm) }
  }
  if (Array.isArray(zone.polygon) && zone.polygon.length) {
    const bounds = polygonBounds(zone.polygon)
    return { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2, width: bounds.maxX - bounds.minX, height: bounds.maxY - bounds.minY }
  }
  return null
}

function supportProximityPenalty(candidate, others) {
  if (!candidate.supportsRef && !['CAP', 'RES', 'INDUCTOR', 'TVS'].includes(candidate.group)) return 0
  const parent = others.find((item) => item.ref === candidate.supportsRef)
  if (!parent) return 0
  const d = distance(candidate, parent)
  const target = candidate.group === 'CAP' ? 4 : candidate.group === 'TVS' ? 6 : 8
  return d <= target ? d * 0.1 : (d - target) * 18
}

function denseEscapePenalty(candidate, others, options) {
  if (!options.densePlacement && !options.components?.length) return 0
  if (!['CAP', 'RES', 'INDUCTOR'].includes(candidate.group)) return 0
  const active = others.filter((item) => /(BGA|QFN|MCU|PROCESSOR|ESP32|STM32|FPGA|ASIC)/i.test(`${item.group || ''} ${item.value || ''} ${item.package || ''}`))
  return active.reduce((sum, item) => {
    const d = distance(candidate, item)
    const corridor = Math.max(item.width || 0, item.height || 0) / 2 + 1.2
    return sum + (d < corridor ? (corridor - d) * 12 : 0)
  }, 0)
}

function localRatsnestPenalty(candidate, others, nets) {
  const connectedRefs = new Set()
  for (const net of nets || []) {
    if (Array.isArray(net.refs) && net.refs.includes(candidate.ref)) net.refs.forEach((ref) => connectedRefs.add(ref))
  }
  for (const [pin, net] of Object.entries(candidate.pinMap || {})) {
    if (!pin || !net) continue
    for (const other of others) {
      if (Object.values(other.pinMap || {}).includes(net)) connectedRefs.add(other.ref)
    }
  }
  return others.filter((other) => connectedRefs.has(other.ref)).reduce((sum, other) => sum + distance(candidate, other) * 0.12, 0)
}

function resolvePlacementOverlaps(board, components, profile, actions, options) {
  let next = [...components]
  for (let index = 0; index < next.length; index += 1) {
    const component = next[index]
    const overlaps = next.some((other, otherIndex) => otherIndex !== index && rectsOverlap(component, other, profile.componentToComponentClearanceMm || 0))
    if (!overlaps) continue
    const repaired = bestCandidate(board, component, next, index, candidatePositionsFor(board, component, profile, options), profile, options)
    if (repaired.x !== component.x || repaired.y !== component.y || repaired.rotation !== component.rotation) {
      actions.push({ ref: component.ref, kind: 'overlap_repair', from: pickPlacement(component), to: pickPlacement(repaired) })
      next = next.map((item, itemIndex) => (itemIndex === index ? repaired : item))
    }
  }
  return next
}

function componentFits(board, component, profile) {
  const polygon = board.outline || []
  return rectCorners(component, profile.componentToEdgeClearanceMm || 0).every((corner) => pointInPolygon(corner, polygon))
}

function pickPlacement(component) {
  return { x: round(component.x), y: round(component.y), rotation: component.rotation || 0 }
}

function dedupeActions(actions) {
  const seen = new Set()
  return actions.filter((action) => {
    const key = `${action.ref}:${action.kind}:${action.to.x}:${action.to.y}:${action.to.rotation}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function classifyPlacementDensity(board, components) {
  const bounds = polygonBounds(board.outline || [])
  const boardArea = Math.max(1, (bounds.maxX - bounds.minX) * (bounds.maxY - bounds.minY))
  const componentArea = components.reduce((sum, component) => sum + Number(component.width || 0) * Number(component.height || 0), 0)
  const density = componentArea / boardArea
  if (density > 0.5 || components.length / boardArea > 0.018) return 'extreme_dense'
  if (density > 0.35 || components.length / boardArea > 0.01) return 'dense'
  return 'normal'
}

export function scorePlacement(board, components = [], nets = [], profile = {}) {
  const bounds = polygonBounds(board.outline || [])
  const boardArea = Math.max(1, (bounds.maxX - bounds.minX) * (bounds.maxY - bounds.minY))
  const componentArea = components.reduce((sum, component) => sum + Number(component.width || 0) * Number(component.height || 0), 0)
  const density = componentArea / boardArea
  const edgeConnectorScore = scoreEdgeConnectors(bounds, components, profile)
  const ratsnest = estimateRatsnest(components, nets)
  const passiveScore = scorePassiveProximity(components)
  const densityPenalty = density > 0.5 ? 25 : density > 0.35 ? 12 : 0
  const ratsnestPenalty = Math.min(25, ratsnest.totalLengthMm / Math.max(1, components.length * 20))
  const score = Math.max(0, Math.round(100 - densityPenalty - ratsnestPenalty - (100 - edgeConnectorScore) * 0.25 - (100 - passiveScore) * 0.2))
  const issues = []
  if (density > 0.5) issues.push({ severity: 'WARNING', code: 'PLACEMENT_DENSITY_HIGH', message: 'Component density is high for automated routing; board may need to grow or use more layers.', details: { density } })
  if (edgeConnectorScore < 70) issues.push({ severity: 'WARNING', code: 'EDGE_CONNECTOR_PLACEMENT_WEAK', message: 'One or more connectors are not close to a board edge.', details: { edgeConnectorScore } })
  if (ratsnest.totalLengthMm > components.length * 35) issues.push({ severity: 'WARNING', code: 'RATSNEST_LONG', message: 'Estimated connection length is high; placement should be optimized before routing.', details: ratsnest })
  return {
    score,
    density: round(density),
    edgeConnectorScore,
    passiveProximityScore: passiveScore,
    ratsnest,
    issues,
  }
}

function scoreEdgeConnectors(bounds, components, profile) {
  const connectors = components.filter((component) => /^(USB|RJ45|SENSOR_CONNECTOR|ESC_CONNECTOR|POWER_INPUT)$/i.test(component.group || ''))
  if (!connectors.length) return 100
  const clearance = profile.componentToEdgeClearanceMm || 1
  const scores = connectors.map((component) => {
    const nearest = Math.min(Math.abs(component.x - bounds.minX), Math.abs(component.x - bounds.maxX), Math.abs(component.y - bounds.minY), Math.abs(component.y - bounds.maxY))
    return nearest <= clearance + Math.max(component.width || 0, component.height || 0) / 2 + 2 ? 100 : Math.max(0, 100 - nearest * 5)
  })
  return Math.round(scores.reduce((sum, item) => sum + item, 0) / scores.length)
}

function estimateRatsnest(components, nets) {
  const componentByRef = new Map(components.map((component) => [component.ref, component]))
  const explicit = nets.flatMap((net) => Array.isArray(net.refs) ? pairs(net.refs).map(([a, b]) => ({ net: net.name, a, b })) : [])
  const inferred = inferNetPairs(components)
  const pairsToScore = explicit.length ? explicit : inferred
  const connections = pairsToScore.map((connection) => {
    const a = componentByRef.get(connection.a)
    const b = componentByRef.get(connection.b)
    const lengthMm = a && b ? round(distance(a, b)) : 0
    return { ...connection, lengthMm }
  }).filter((connection) => connection.lengthMm > 0)
  return {
    connectionCount: connections.length,
    totalLengthMm: round(connections.reduce((sum, connection) => sum + connection.lengthMm, 0)),
    longestMm: round(Math.max(0, ...connections.map((connection) => connection.lengthMm))),
    connections: connections.slice(0, 24),
  }
}

function inferNetPairs(components) {
  const byNet = new Map()
  for (const component of components) {
    for (const net of Object.values(component.pinMap || {}).filter(Boolean)) {
      const refs = byNet.get(net) || []
      refs.push(component.ref)
      byNet.set(net, refs)
    }
  }
  return [...byNet.entries()].flatMap(([net, refs]) => pairs([...new Set(refs)]).map(([a, b]) => ({ net, a, b })))
}

function pairs(items) {
  const output = []
  for (let index = 0; index < items.length; index += 1) {
    for (let other = index + 1; other < items.length; other += 1) output.push([items[index], items[other]])
  }
  return output
}

function scorePassiveProximity(components) {
  const active = components.filter((component) => !['RES', 'CAP', 'INDUCTOR'].includes(component.group))
  const passives = components.filter((component) => ['RES', 'CAP', 'INDUCTOR'].includes(component.group))
  if (!active.length || !passives.length) return 100
  const scores = passives.map((passive) => {
    const nearest = Math.min(...active.map((item) => distance(passive, item)))
    return nearest <= 8 ? 100 : Math.max(0, 100 - (nearest - 8) * 8)
  })
  return Math.round(scores.reduce((sum, item) => sum + item, 0) / scores.length)
}
