import { polygonBounds, round } from './geometry.mjs'
import { assignNetsToClasses } from './net-classes.mjs'

export function buildDesignConstraints(board, components = [], nets = [], profile = {}, plans = {}) {
  const bounds = board.outline?.length ? polygonBounds(board.outline) : { minX: 0, minY: 0, maxX: board.widthMm || 50, maxY: board.heightMm || 30 }
  const classifiedNets = assignNetsToClasses(nets)
  return {
    schemaVersion: 1,
    status: 'CONSTRAINTS_READY_NEEDS_REVIEW',
    board: {
      name: board.name,
      units: board.units || 'mm',
      widthMm: round(bounds.maxX - bounds.minX),
      heightMm: round(bounds.maxY - bounds.minY),
      layerCount: board.layerCount || 2,
      outlinePointCount: board.outline?.length || 0,
      mountingHoleCount: board.mountingHoles?.length || 0,
    },
    manufacturer: {
      id: profile.id,
      name: profile.name,
      minTraceWidthMm: profile.minTraceWidthMm,
      minClearanceMm: profile.minClearanceMm,
      minViaDiameterMm: profile.minViaDiameterMm,
      minViaDrillMm: profile.minViaDrillMm,
      componentToComponentClearanceMm: profile.componentToComponentClearanceMm,
      componentToEdgeClearanceMm: profile.componentToEdgeClearanceMm,
      hdi: profile.hdi || null,
    },
    placement: {
      edgeConnectors: components.filter((component) => /^(USB|RJ45|POWER_INPUT|SENSOR_CONNECTOR|ESC_CONNECTOR|SWD)$/i.test(component.group || '')).map(({ ref, group, x, y }) => ({ ref, group, x, y, rule: 'must remain accessible from board edge' })),
      rfKeepouts: components.filter((component) => /(ESP32|RF|ANT|WROOM|BLE|WIFI|WI-FI)/i.test(`${component.group || ''} ${component.value || ''}`)).map(({ ref, value }) => ({ ref, value, rule: 'antenna region needs edge exposure and copper/component keepout' })),
      thermalSources: components.filter((component) => /(REGULATOR|MOSFET|POE|MOTOR|SHUNT|CHARGER|GATE)/i.test(`${component.group || ''} ${component.value || ''}`)).map(({ ref, group, value }) => ({ ref, group, value, rule: 'separate from RF, crystals, sensors, and precision analog' })),
      serviceAccess: components.filter((component) => /(SWD|BOOT|RESET|TEST|PAD|USB)/i.test(`${component.group || ''} ${component.value || ''}`)).map(({ ref, group, value }) => ({ ref, group, value, rule: 'must stay reachable for programming/test' })),
    },
    routing: {
      netClasses: classifiedNets,
      differentialPairs: pairNets(classifiedNets),
      powerNets: classifiedNets.filter((net) => /POWER|BATTERY/.test(net.className || '')).map((net) => net.name),
      groundNets: classifiedNets.filter((net) => /GND|GROUND/i.test(net.name || '')).map((net) => net.name),
      viaPolicy: plans.stackup?.viaPolicy || plans.routingPlan?.designIntent?.viaRules || null,
      copperPours: plans.routingPlan?.designIntent?.copperPours || plans.designIntent?.copperPours || [],
      keepouts: plans.routingPlan?.designIntent?.zones || plans.designIntent?.zones || [],
    },
    manufacturingGates: {
      requireErcBeforeExport: true,
      requireDrcBeforeExport: true,
      requireBomBeforeJlcpcb: true,
      requireCplBeforeJlcpcb: true,
      requireHumanReview: true,
      advancedFabApprovalRequired: Boolean(plans.stackup?.hdi?.requiresAdvancedReview),
    },
    plans: {
      requirements: plans.requirementsPlan?.status || null,
      stackup: plans.stackup?.status || null,
      assembly: plans.assemblyPlan?.status || null,
      complexBoard: plans.complexPlan?.status || null,
    },
    humanReviewRequired: true,
  }
}

function pairNets(nets) {
  const names = new Set(nets.map((net) => net.name))
  return nets
    .filter((net) => /(_DP|_P|TX_P|RX_P)$/.test(net.name))
    .map((positive) => {
      const negative = positive.name.replace(/(_DP|_P|TX_P|RX_P)$/, (match) => ({ _DP: '_DN', _P: '_N', TX_P: 'TX_N', RX_P: 'RX_N' })[match])
      return names.has(negative) ? { positive: positive.name, negative, className: positive.className } : null
    })
    .filter(Boolean)
}
