import { polygonBounds, round } from './geometry.mjs'
import { validatePlacement } from './validation.mjs'

const sizes = {
  MCU: [10, 10], ESP32_S3: [18, 14], IMU: [3, 3], USB: [9, 7], RJ45: [16, 16], REGULATOR: [5, 5],
  BLACKBOX: [6, 5], BAROMETER: [3, 3], SWD: [8, 3], ESC_CONNECTOR: [10, 4], SENSOR_CONNECTOR: [10, 4],
  POWER_INPUT: [10, 5], ETHERNET_PHY: [7, 7], POE_FRONT_END: [14, 12], DEFAULT: [4, 3],
}

function component(ref, group, x, y, rotation = 0, options = {}) {
  const [width, height] = sizes[group] || sizes.DEFAULT
  return { ref, group, x: round(x), y: round(y), rotation, width, height, ...options }
}

export function generatePlacementPlan(board, template, profile) {
  const bounds = polygonBounds(board.outline)
  const width = bounds.maxX - bounds.minX
  const height = bounds.maxY - bounds.minY
  const cx = bounds.minX + width / 2
  const cy = bounds.minY + height / 2
  const edge = profile.componentToEdgeClearanceMm + 3
  const components = []
  if (template?.id === 'ESP32_S3_POE_SENSOR') {
    components.push(component('J1', 'RJ45', bounds.minX + edge + 5, cy, 90), component('U2', 'ETHERNET_PHY', bounds.minX + edge + 20, cy - 5), component('U3', 'POE_FRONT_END', bounds.minX + edge + 21, cy + 9), component('U1', 'ESP32_S3', cx + 11, cy), component('J2', 'USB', bounds.maxX - edge - 5, cy + 10, 270), component('J3', 'SENSOR_CONNECTOR', bounds.maxX - edge - 5, cy - 10, 270), component('U4', 'REGULATOR', cx, cy + 12))
  } else if (template?.id === 'DRONE_FC_30X30' || template?.id === 'DRONE_AIO_WHOOP') {
    components.push(component('U1', 'MCU', cx, cy + 3), component('U2', 'IMU', cx, cy - 8), component('Y1', 'DEFAULT', cx + 8, cy + 1), component('J1', 'USB', cx, bounds.minY + edge, 180), component('U3', 'BLACKBOX', cx - 9, cy + 7), component('U4', 'REGULATOR', cx + 10, cy + 8), component('J2', 'ESC_CONNECTOR', cx, bounds.maxY - edge, 0))
  } else {
    components.push(component('U1', template?.id === 'ESP32_S3_SENSOR' ? 'ESP32_S3' : 'MCU', cx, cy), component('J1', 'USB', bounds.minX + edge + 3, cy, 90), component('U2', 'REGULATOR', cx - 13, cy + 8), component('J2', 'SENSOR_CONNECTOR', bounds.maxX - edge - 5, cy, 270))
  }
  const issues = validatePlacement(board, components, profile)
  return { status: issues.some((item) => ['BLOCKER', 'ERROR'].includes(item.severity)) ? 'NEEDS_FIX' : 'PLACEMENT_PLAN_READY', components, rulesApplied: ['components fully inside outline', 'edge connectors placed on board edge intent', 'mounting hole clearance checked', 'component overlap checked'], issues }
}

export function fixComponentOffBoard(board, component, profile) {
  const bounds = polygonBounds(board.outline)
  return { ...component, x: round(Math.max(bounds.minX + component.width / 2 + profile.componentToEdgeClearanceMm, Math.min(bounds.maxX - component.width / 2 - profile.componentToEdgeClearanceMm, component.x))), y: round(Math.max(bounds.minY + component.height / 2 + profile.componentToEdgeClearanceMm, Math.min(bounds.maxY - component.height / 2 - profile.componentToEdgeClearanceMm, component.y))) }
}
