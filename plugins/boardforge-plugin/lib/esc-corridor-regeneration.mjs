import { readFile, writeFile } from 'node:fs/promises'
import { round } from './geometry.mjs'

export function analyzeVbatCorridor({ footprints = [], source, target, requiredWidthMm = 1.4, requiredClearanceMm = 0.35 }) {
  const fixedObjects = footprints.filter((footprint) => classifyFootprintMobility(footprint).classification === 'fixed')
  const nearby = footprints
    .map((footprint) => ({ ...footprint, corridor: distanceToCorridor(footprint, source, target) }))
    .filter((footprint) => footprint.corridor.distanceMm <= 6)
    .sort((a, b) => a.corridor.distanceMm - b.corridor.distanceMm)
  const blockers = nearby
    .filter((footprint) => ['fixed', 'semi_fixed'].includes(classifyFootprintMobility(footprint).classification) || footprint.corridor.distanceMm < requiredWidthMm / 2 + requiredClearanceMm)
    .map((footprint) => ({
      ref: footprint.ref,
      type: classifyFootprintMobility(footprint).classification === 'fixed' ? 'fixed_constraint' : 'component_corridor_block',
      movable: classifyFootprintMobility(footprint).classification === 'movable',
      mobility: classifyFootprintMobility(footprint).classification,
      distanceMm: footprint.corridor.distanceMm,
      reason: classifyFootprintMobility(footprint).reason,
    }))
  return {
    net: '/VBAT_RAW',
    source,
    target,
    directLineDistanceMm: round(Math.hypot(target.x - source.x, target.y - source.y)),
    requiredWidthMm,
    requiredClearanceMm,
    nearbyObjects: nearby.map((footprint) => ({
      ref: footprint.ref,
      x: footprint.x,
      y: footprint.y,
      mobility: classifyFootprintMobility(footprint).classification,
      distanceMm: footprint.corridor.distanceMm,
    })),
    blockers,
    fixedObjects: fixedObjects.map((footprint) => footprint.ref),
    recommendedAction: 'open local battery corridor by moving only movable/semi-fixed support parts; preserve J1, mounting holes, and board outline',
  }
}

export function classifyFootprintMobility(footprint = {}) {
  const text = `${footprint.ref || ''} ${footprint.lib || ''} ${footprint.value || ''}`.toUpperCase()
  if (String(footprint.ref || '').toUpperCase() === 'J1' || /MOUNT|MOUNTING|HOLE|FID/.test(text) || footprint.locked) return { classification: 'fixed', reason: 'mechanical, battery connector, mounting, fiducial, or locked footprint' }
  if (/^C1$|1210|BULK|TVS|PROTECT|SHUNT|FUSE/.test(text)) return { classification: 'semi_fixed', reason: 'power topology part; move only minimally when it improves high-current corridor evidence' }
  if (/RESISTOR|CAPACITOR|R_0402|C_0402|R\\d+|C\\d+/.test(text)) return { classification: 'movable', reason: 'small support passive' }
  return { classification: 'movable', reason: 'not marked mechanical or locked' }
}

export function generateVbatCorridorRepairCandidates({ analysis, sourceRef = 'C1' }) {
  const candidate = (id, moves, reason) => ({
    id,
    net: '/VBAT_RAW',
    moves,
    fixedPartsPreserved: ['J1', 'mounting holes', 'board outline'],
    expectedCorridorWidthMm: analysis.requiredWidthMm,
    expectedConnectivityImprovement: 'reduce /VBAT_RAW local unconnected count or create routeable C1/J1 escape',
    humanReviewRequired: true,
    reason,
  })
  return [
    candidate('vbat-corridor-c1-left-0p8', [{ ref: sourceRef, dx: -0.8, dy: 0, classification: 'semi_fixed' }], 'Move C1 away from the J1 battery tab corridor while preserving battery connector geometry.'),
    candidate('vbat-corridor-c1-up-0p6', [{ ref: sourceRef, dx: 0, dy: -0.6, classification: 'semi_fixed' }], 'Move C1 upward to open a top-side escape corridor.'),
    candidate('vbat-corridor-c1-up-1p0', [{ ref: sourceRef, dx: 0, dy: -1.0, classification: 'semi_fixed' }], 'Move C1 farther upward if the shorter move still leaves clearance risk.'),
  ]
}

export function buildPowerCorridorMap({ footprints = [], corridors = [] }) {
  return {
    status: 'ESC_POWER_CORRIDOR_MAP_READY',
    corridors: corridors.map((corridor) => {
      const analysis = analyzeVbatCorridor({
        footprints,
        source: corridor.source,
        target: corridor.target,
        requiredWidthMm: corridor.requiredWidthMm || (/VBAT|BATT|VIN/i.test(corridor.net) ? 1.4 : 1.2),
        requiredClearanceMm: corridor.requiredClearanceMm || 0.35,
      })
      return {
        net: corridor.net,
        source: `${corridor.source.ref} pad ${corridor.source.pad}`,
        target: `${corridor.target.ref} pad ${corridor.target.pad}`,
        requiredWidthMm: analysis.requiredWidthMm,
        requiredClearanceMm: analysis.requiredClearanceMm,
        preferredLayers: preferredLayersForNet(corridor.net),
        routeStyles: routeStylesForNet(corridor.net),
        currentBlockers: analysis.blockers,
        movableBlockers: analysis.nearbyObjects.filter((item) => item.mobility === 'movable').slice(0, 8),
        fixedBlockers: analysis.blockers.filter((item) => item.mobility === 'fixed'),
        repairableWithoutFixedMoves: !analysis.blockers.some((item) => item.mobility === 'fixed' && !['J1'].includes(item.ref)),
      }
    }),
  }
}

export function generatePowerCorridorRegenerationCandidates({ corridorMap = {}, footprints = [] }) {
  const movableNearPower = new Set()
  for (const corridor of corridorMap.corridors || []) {
    for (const blocker of corridor.movableBlockers || []) movableNearPower.add(blocker.ref)
  }
  const has = (ref) => footprints.some((footprint) => footprint.ref === ref)
  const move = (ref, dx, dy, classification = classifyFootprintMobility(footprints.find((footprint) => footprint.ref === ref) || { ref }).classification) => ({ ref, dx, dy, classification })
  const candidates = [
    {
      id: 'power-corridor-support-passive-cleanup',
      strategy: 'minimal_support_passive_cleanup',
      moves: [move('C34', 0, -0.8), move('C5', 0, -0.8), move('C20', -0.6, -0.4), move('C21', -0.6, -0.4)].filter((item) => has(item.ref)),
      corridorsOpened: ['/VBAT_RAW'],
      reason: 'Move small passives away from the local battery corridor while preserving high-current connectors.',
    },
    {
      id: 'power-corridor-vbat-highway',
      strategy: 'vbat_highway',
      moves: [move('C34', -0.7, -0.6), move('C5', 0.7, -0.8), move('C20', -0.9, 0), move('C21', -0.9, -0.5), move('R7', 0.8, 0.4), move('R8', 0.8, -0.4)].filter((item) => has(item.ref)),
      corridorsOpened: ['/VBAT_RAW', '/VBAT'],
      reason: 'Create a wider J1-to-bulk-capacitor highway and leave room for In2.Cu via-array escapes.',
    },
    {
      id: 'power-corridor-motor-phase',
      strategy: 'motor_phase_corridor',
      moves: [move('C59', 0, -0.7), move('C92', 0, -0.7), move('C81', 0, 0.7), move('R25', -0.6, 0), move('R37', 0.6, 0)].filter((item) => has(item.ref)),
      corridorsOpened: ['/M3_A_SW', '/M3_B_SW', '/M4_B_SW'],
      reason: 'Open local motor-phase exits while preserving MOSFET/output connector locations.',
    },
    {
      id: 'power-corridor-inner-layer-via-escape',
      strategy: 'inner_layer_power_corridor',
      moves: [move('C34', -0.6, -0.7), move('C5', 0.5, -0.9), move('C6', 0.5, -0.8), move('C20', -0.8, -0.4), move('C21', -0.8, -0.4), move('R1', 0.8, -0.5)].filter((item) => has(item.ref)),
      corridorsOpened: ['/VBAT_RAW', '/M3_A_SW', '/M1_B_SW'],
      reason: 'Clear via-array landing room for F.Cu/B.Cu pad escapes into In2.Cu power corridors.',
    },
    {
      id: 'power-corridor-regional-cleanup',
      strategy: 'power_stage_regional_cleanup',
      moves: [move('C34', -0.7, -0.7), move('C5', 0.7, -0.9), move('C6', 0.7, -0.8), move('C20', -0.9, -0.2), move('C21', -0.9, -0.5), move('R7', 0.8, 0.4), move('R8', 0.8, -0.4), move('R1', 0.8, -0.5)].filter((item) => has(item.ref)),
      corridorsOpened: ['/VBAT_RAW', '/VBAT', '/M3_A_SW', '/M1_B_SW', '/M3_B_SW', '/M4_B_SW'],
      reason: 'Broader cleanup of support parts around the battery and power-stage corridors.',
    },
  ]
  return candidates.map((candidate) => ({
    ...candidate,
    fixedPartsPreserved: ['J1', 'motor output connectors', 'mounting holes', 'board outline'],
    usesApprovedInternalLayers: true,
    preferredInternalLayers: ['In2.Cu', 'In1.Cu', 'In6.Cu'],
    moveCount: candidate.moves.length,
    movedRefs: candidate.moves.map((move) => move.ref),
    humanReviewRequired: true,
    score: scorePowerCorridorRegenerationCandidate(candidate, { movableNearPower }),
  }))
}

export function generateFullInternalEscRelayoutCandidates({ footprints = [], boardBounds = null }) {
  const bounds = boardBounds || footprintBounds(footprints)
  const internal = footprints.filter((footprint) => isInternalRelayoutFootprint(footprint))
  const byRole = groupByRole(internal)
  const candidate = (id, strategy, zones, reason) => {
    const moves = buildRelayoutMoves({ byRole, zones, bounds })
    return {
      id,
      strategy,
      moves,
      movedRefs: moves.map((move) => move.ref),
      fixedRefsPreserved: footprints.filter((footprint) => !isInternalRelayoutFootprint(footprint)).map((footprint) => footprint.ref),
      boardOutlineChanged: false,
      mountingHolesMoved: false,
      j1Moved: false,
      motorOutputsMoved: false,
      expectedDrcRisk: moves.length > 80 ? 'high' : 'medium',
      vbatCorridorScore: scoreZoneClearance(zones.vbat),
      motorPhaseCorridorScore: scoreZoneClearance(zones.phase),
      currentSenseSeparationScore: scoreZoneClearance(zones.sense),
      gateDriveLoopScore: scoreZoneClearance(zones.gate),
      thermalPowerScore: scoreZoneClearance(zones.power),
      routabilityScore: 0,
      reason,
      usesApprovedInternalLayers: true,
      layerIntent: {
        battery: 'In2.Cu',
        ground: ['In1.Cu', 'In6.Cu'],
        regulatedRails: 'In4.Cu',
        senseControl: 'In5.Cu',
      },
    }
  }

  const left = bounds.minX + 4
  const right = bounds.maxX - 4
  const top = bounds.minY + 4
  const bottom = bounds.maxY - 4
  const midX = (bounds.minX + bounds.maxX) / 2
  const midY = (bounds.minY + bounds.maxY) / 2
  const candidates = [
    candidate('full-relayout-power-stage-first', 'power_stage_first', {
      power: region(left, midY - 7, right, midY + 5),
      phase: region(left + 2, top, right - 2, midY - 4),
      gate: region(left + 3, midY + 2, right - 3, bottom - 4),
      sense: region(left, bottom - 8, right, bottom - 1),
      control: region(midX - 5, midY - 3, midX + 5, midY + 5),
      vbat: region(left, bottom - 5, midX + 2, bottom),
    }, 'Place MOSFET/shunt/power parts first, then tuck gate/control/sense around preserved edge connectors.'),
    candidate('full-relayout-vbat-highway-first', 'vbat_highway_first', {
      power: region(left, bottom - 10, right, bottom - 2),
      phase: region(left + 1, top + 1, right - 1, midY),
      gate: region(left + 2, midY - 2, right - 2, bottom - 9),
      sense: region(right - 8, midY - 1, right, bottom - 4),
      control: region(midX - 6, midY - 2, midX + 6, midY + 4),
      vbat: region(left, bottom - 7, right, bottom),
    }, 'Reserve a continuous bottom/internal In2.Cu VBAT highway from J1 into bulk/power-stage feed.'),
    candidate('full-relayout-motor-phase-first', 'motor_phase_corridor_first', {
      power: region(left + 3, midY - 5, right - 3, bottom - 8),
      phase: region(left, top + 1, right, midY + 1),
      gate: region(left + 2, midY, right - 2, bottom - 7),
      sense: region(left, bottom - 8, right, bottom - 2),
      control: region(midX - 5, bottom - 9, midX + 5, bottom - 3),
      vbat: region(left, bottom - 6, midX + 3, bottom),
    }, 'Open phase corridors first, then place gate/sense/control parts outside the phase highway.'),
    candidate('full-relayout-gate-driver-optimized', 'gate_driver_optimized', {
      power: region(left, top + 3, right, midY - 1),
      phase: region(left, top, right, top + 8),
      gate: region(left + 2, midY - 4, right - 2, midY + 5),
      sense: region(left, bottom - 7, right, bottom - 1),
      control: region(midX - 4, midY + 3, midX + 4, bottom - 5),
      vbat: region(left, bottom - 5, right, bottom),
    }, 'Keep gate-driver/support clusters close to MOSFETs while preserving sense/control corridors.'),
    candidate('full-relayout-sense-protected', 'sense_protected', {
      power: region(left, top + 2, right, midY - 2),
      phase: region(left, top, right, top + 7),
      gate: region(left + 1, midY - 3, right - 1, midY + 4),
      sense: region(left, bottom - 9, right, bottom),
      control: region(midX - 6, bottom - 8, midX + 6, bottom - 2),
      vbat: region(left, midY + 3, right, bottom - 4),
    }, 'Reserve a protected In5.Cu sense/control band before routing high-current copper around it.'),
  ]
  return candidates.map((item) => ({ ...item, routabilityScore: scoreFullInternalRelayoutCandidate(item) }))
}

export function scoreFullInternalRelayoutCandidate(candidate = {}) {
  let score = 50
  score += Number(candidate.vbatCorridorScore || 0) * 0.8
  score += Number(candidate.motorPhaseCorridorScore || 0) * 0.7
  score += Number(candidate.currentSenseSeparationScore || 0) * 0.5
  score += Number(candidate.gateDriveLoopScore || 0) * 0.4
  score += Number(candidate.thermalPowerScore || 0) * 0.3
  score -= Math.min(35, (candidate.moves || []).length * 0.18)
  if (candidate.boardOutlineChanged || candidate.mountingHolesMoved || candidate.j1Moved || candidate.motorOutputsMoved) score -= 200
  if (candidate.usesApprovedInternalLayers) score += 12
  return round(score)
}

export function scorePowerCorridorRegenerationCandidate(candidate = {}, evidence = {}) {
  let score = 50
  score += (candidate.corridorsOpened || []).length * 8
  score -= (candidate.moves || []).length * 2
  score -= (candidate.moves || []).reduce((sum, move) => sum + Math.hypot(move.dx || 0, move.dy || 0), 0) * 2
  if (candidate.usesApprovedInternalLayers) score += 12
  if ((candidate.moves || []).some((move) => move.ref === 'J1' || /^H\d+/i.test(move.ref))) score -= 120
  if ((evidence.targetNetsImproved || 0) > 0) score += evidence.targetNetsImproved * 30
  if ((evidence.errorsAfter ?? Infinity) <= (evidence.errorsBefore ?? 0)) score += 16
  if ((evidence.warningsAfter ?? Infinity) <= (evidence.warningsBefore ?? 0)) score += 8
  if ((evidence.errorsAfter ?? 0) > (evidence.errorsBefore ?? Infinity)) score -= Math.min(30, (evidence.errorsAfter - evidence.errorsBefore) * 4)
  return round(score)
}

export function scoreVbatCorridorCandidate(candidate = {}, evidence = {}) {
  let score = 50
  const movedDistance = (candidate.moves || []).reduce((sum, move) => sum + Math.hypot(move.dx || 0, move.dy || 0), 0)
  score -= movedDistance * 6
  if ((evidence.vbatRawAfter ?? Infinity) < (evidence.vbatRawBefore ?? 0)) score += 35
  if ((evidence.errorsAfter ?? Infinity) <= (evidence.errorsBefore ?? 0)) score += 20
  if ((evidence.warningsAfter ?? Infinity) <= (evidence.warningsBefore ?? 0)) score += 10
  if ((candidate.moves || []).some((move) => move.ref === 'J1')) score -= 100
  return round(score)
}

function isInternalRelayoutFootprint(footprint = {}) {
  const ref = String(footprint.ref || '').toUpperCase()
  const text = `${ref} ${footprint.lib || ''} ${footprint.value || ''}`.toUpperCase()
  if (footprint.locked) return false
  if (/^H\d+/.test(ref) || /MOUNT|MOUNTING|HOLE|FID/.test(text)) return false
  if (/^J\d+/.test(ref)) return false
  return true
}

function groupByRole(footprints = []) {
  const roles = { mosfet: [], gate: [], shunt: [], sense: [], regulator: [], bulk: [], passive: [], control: [], test: [] }
  for (const footprint of footprints) roles[roleForFootprint(footprint)].push(footprint)
  return roles
}

function roleForFootprint(footprint = {}) {
  const ref = String(footprint.ref || '').toUpperCase()
  const text = `${ref} ${footprint.lib || ''} ${footprint.value || ''}`.toUpperCase()
  if (/^Q\d+|MOSFET|EPC/.test(text)) return 'mosfet'
  if (/SHUNT|R_SHUNT/.test(text)) return 'shunt'
  if (/INA|SENSE|CURRENT/.test(text)) return 'sense'
  if (/GATE|DRIVER|DDA|TPS|LMG/.test(text)) return 'gate'
  if (/REG|VREG|LDO|BUCK|FB\d+|L\d+/.test(text)) return 'regulator'
  if (/^TP/.test(ref)) return 'test'
  if (/^U\d+/.test(ref)) return 'control'
  if (/^C1$|1210|0805|BULK/.test(text)) return 'bulk'
  return 'passive'
}

function buildRelayoutMoves({ byRole = {}, zones = {}, bounds }) {
  const placements = [
    ...placeRole(byRole.mosfet, zones.power, { pitchX: 3.4, pitchY: 3.0, rotation: 0 }),
    ...placeRole(byRole.shunt, zones.phase, { pitchX: 4.2, pitchY: 2.8, rotation: -90 }),
    ...placeRole(byRole.bulk, zones.vbat, { pitchX: 3.2, pitchY: 2.7, rotation: 0 }),
    ...placeRole(byRole.gate, zones.gate, { pitchX: 2.8, pitchY: 2.4, rotation: 0 }),
    ...placeRole(byRole.sense, zones.sense, { pitchX: 2.4, pitchY: 2.0, rotation: 0 }),
    ...placeRole(byRole.regulator, zones.control, { pitchX: 2.8, pitchY: 2.4, rotation: 0 }),
    ...placeRole(byRole.control, zones.control, { pitchX: 3.0, pitchY: 2.6, rotation: 0 }),
    ...placeRole(byRole.passive, expandedRegion(zones.gate, bounds, 1.5), { pitchX: 1.35, pitchY: 1.2, rotation: 0 }),
    ...placeRole(byRole.test, expandedRegion(zones.sense, bounds, 1.2), { pitchX: 1.8, pitchY: 1.5, rotation: 0 }),
  ]
  return placements
    .map(({ footprint, x, y, rotation }) => ({ ref: footprint.ref, dx: round(x - footprint.x), dy: round(y - footprint.y), rotation, classification: roleForFootprint(footprint) }))
    .filter((move) => Math.abs(move.dx) > 0.02 || Math.abs(move.dy) > 0.02)
}

function placeRole(footprints = [], zone, { pitchX, pitchY, rotation }) {
  if (!zone || !footprints.length) return []
  const width = Math.max(0.1, zone.maxX - zone.minX)
  const columns = Math.max(1, Math.floor(width / pitchX))
  return footprints.map((footprint, index) => {
    const col = index % columns
    const row = Math.floor(index / columns)
    return {
      footprint,
      x: round(Math.min(zone.maxX, zone.minX + pitchX * (col + 0.5))),
      y: round(Math.min(zone.maxY, zone.minY + pitchY * (row + 0.5))),
      rotation,
    }
  })
}

function footprintBounds(footprints = []) {
  if (!footprints.length) return { minX: 0, minY: 0, maxX: 50, maxY: 50 }
  return {
    minX: Math.min(...footprints.map((footprint) => footprint.x)),
    minY: Math.min(...footprints.map((footprint) => footprint.y)),
    maxX: Math.max(...footprints.map((footprint) => footprint.x)),
    maxY: Math.max(...footprints.map((footprint) => footprint.y)),
  }
}

function region(minX, minY, maxX, maxY) {
  return { minX: round(Math.min(minX, maxX)), minY: round(Math.min(minY, maxY)), maxX: round(Math.max(minX, maxX)), maxY: round(Math.max(minY, maxY)) }
}

function expandedRegion(zone, bounds, amount) {
  if (!zone) return bounds
  return region(Math.max(bounds.minX, zone.minX - amount), Math.max(bounds.minY, zone.minY - amount), Math.min(bounds.maxX, zone.maxX + amount), Math.min(bounds.maxY, zone.maxY + amount))
}

function scoreZoneClearance(zone = {}) {
  return round(Math.max(0, zone.maxX - zone.minX) * Math.max(0, zone.maxY - zone.minY))
}

function preferredLayersForNet(net = '') {
  if (/VBAT|VIN|BATT/i.test(net)) return ['F.Cu pad escape', 'In2.Cu power corridor', 'B.Cu support']
  if (/PGND|GND/i.test(net)) return ['In1.Cu reference', 'In6.Cu return', 'F.Cu/B.Cu stitching']
  if (/SW|PHASE|MOTOR/i.test(net)) return ['F.Cu/B.Cu short phase copper', 'In2.Cu assisted corridor when legal']
  if (/VREG|5V|3V3|12V/i.test(net)) return ['In4.Cu regulated rail', 'F.Cu/B.Cu pad escape']
  if (/SHUNT|SENSE|KELVIN/i.test(net)) return ['In5.Cu protected sense corridor']
  return ['In3.Cu signal', 'F.Cu/B.Cu escape']
}

function routeStylesForNet(net = '') {
  if (/VBAT|VIN|BATT/i.test(net)) return ['wide track', 'In2.Cu zone', 'through-via array mixed bundle']
  if (/PGND|GND/i.test(net)) return ['In1/In6 zones', 'stitching vias']
  if (/SW|PHASE|MOTOR/i.test(net)) return ['wide track', 'phase zone', 'inner-layer assisted bundle']
  return ['controlled route', 'protected corridor']
}

export async function applyCorridorMovesToPcb({ pcbFile, moves = [] }) {
  const original = await readFile(pcbFile, 'utf8')
  let next = original
  const applied = []
  for (const move of moves) {
    const result = moveFootprint(next, move)
    next = result.content
    applied.push(result.applied)
  }
  if (next !== original) await writeFile(pcbFile, next, 'utf8')
  return { status: applied.length ? 'ESC_CORRIDOR_MOVES_APPLIED_NEEDS_DRC' : 'ESC_CORRIDOR_NO_MOVES_APPLIED', applied }
}

export function parsePcbFootprints(content = '') {
  const footprints = []
  const pattern = /\(footprint\s+"([^"]+)"/g
  let match
  while ((match = pattern.exec(content))) {
    const start = match.index
    const end = findClosingParen(content, start)
    if (end < 0) continue
    const block = content.slice(start, end + 1)
    const ref = block.match(/\(property\s+"Reference"\s+"([^"]+)"/)?.[1]
    const at = block.match(/\(at\s+([-\d.]+)\s+([-\d.]+)(?:\s+([-\d.]+))?\)/)
    if (!ref || !at) continue
    footprints.push({ ref, lib: match[1], x: Number(at[1]), y: Number(at[2]), rotation: Number(at[3] || 0), locked: /\(locked\)/.test(block), start, end })
  }
  return footprints
}

function moveFootprint(content, move) {
  const refMatch = new RegExp(`\\(property\\s+"Reference"\\s+"${escapeRegExp(move.ref)}"`).exec(content)
  if (!refMatch) throw new Error(`Footprint ${move.ref} was not found.`)
  const start = content.lastIndexOf('(footprint', refMatch.index)
  const end = findClosingParen(content, start)
  const block = content.slice(start, end + 1)
  const at = block.match(/\(at\s+([-\d.]+)\s+([-\d.]+)([^)]*)\)/)
  if (!at) throw new Error(`Footprint ${move.ref} has no top-level at position.`)
  const x = round(Number(at[1]) + Number(move.dx || 0))
  const y = round(Number(at[2]) + Number(move.dy || 0))
  const rotation = Number.isFinite(Number(move.rotation)) ? ` ${Number(move.rotation)}` : at[3]
  const updated = block.replace(at[0], `(at ${x} ${y}${rotation})`)
  return {
    content: `${content.slice(0, start)}${updated}${content.slice(end + 1)}`,
    applied: { ref: move.ref, from: { x: Number(at[1]), y: Number(at[2]), rotation: Number(at[3] || 0) }, to: { x, y, rotation: Number(rotation || 0) }, dx: Number(move.dx || 0), dy: Number(move.dy || 0) },
  }
}

function distanceToCorridor(point, source, target) {
  const dx = target.x - source.x
  const dy = target.y - source.y
  const lengthSquared = Math.max(0.000001, dx * dx + dy * dy)
  const along = Math.max(0, Math.min(1, ((point.x - source.x) * dx + (point.y - source.y) * dy) / lengthSquared))
  const x = source.x + along * dx
  const y = source.y + along * dy
  return { distanceMm: round(Math.hypot(point.x - x, point.y - y)), along: round(along) }
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

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
