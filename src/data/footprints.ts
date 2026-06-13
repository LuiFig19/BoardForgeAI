export type FootprintKind = 'qfn' | 'soic' | 'resistor' | 'capacitor' | 'usb-c' | 'rj45' | 'inductor' | 'testpad' | 'mount'

export type FootprintPackage = {
  id: string
  kind: FootprintKind
  label: string
  body: [number, number, number]
  color: string
  pinCount: number
  heightMm: number
  source: 'built-in' | 'KiCad library' | 'JLCPCB/LCSC' | 'custom'
}

export const footprintPackages: FootprintPackage[] = [
  { id: 'qfn-56', kind: 'qfn', label: 'QFN-56 MCU', body: [0.72, 0.72, 0.1], color: '#202733', pinCount: 56, heightMm: 0.9, source: 'KiCad library' },
  { id: 'soic-8', kind: 'soic', label: 'SOIC-8', body: [0.56, 0.42, 0.13], color: '#1d2430', pinCount: 8, heightMm: 1.55, source: 'KiCad library' },
  { id: 'r-0603', kind: 'resistor', label: 'R 0603', body: [0.24, 0.12, 0.06], color: '#cfc7b8', pinCount: 2, heightMm: 0.45, source: 'JLCPCB/LCSC' },
  { id: 'c-0603', kind: 'capacitor', label: 'C 0603', body: [0.22, 0.12, 0.07], color: '#b88d5d', pinCount: 2, heightMm: 0.55, source: 'JLCPCB/LCSC' },
  { id: 'usb-c-mid', kind: 'usb-c', label: 'USB-C', body: [0.72, 0.44, 0.18], color: '#c6ccd4', pinCount: 16, heightMm: 2.6, source: 'KiCad library' },
  { id: 'rj45-mag', kind: 'rj45', label: 'RJ45 MagJack', body: [0.92, 0.82, 0.48], color: '#233047', pinCount: 12, heightMm: 13.5, source: 'KiCad library' },
  { id: 'l-4x4', kind: 'inductor', label: 'Power inductor', body: [0.48, 0.48, 0.24], color: '#34343a', pinCount: 2, heightMm: 3.8, source: 'JLCPCB/LCSC' },
  { id: 'tp-1mm', kind: 'testpad', label: 'Test pad', body: [0.12, 0.12, 0.012], color: '#e7bd57', pinCount: 1, heightMm: 0.03, source: 'built-in' },
  { id: 'mh-m3', kind: 'mount', label: 'M3 hole', body: [0.2, 0.2, 0.02], color: '#101918', pinCount: 0, heightMm: 0, source: 'built-in' },
]

export type PlacedFootprint = {
  id: string
  packageId: string
  ref: string
  x: number
  y: number
  rotation: number
  side: 'top' | 'bottom'
}

export type BoardRoute = {
  id: string
  layer: 'F.Cu' | 'B.Cu' | 'In1.Cu' | 'In2.Cu'
  net: string
  points: Array<[number, number]>
  width: 'signal' | 'power'
}

export type BoardVia = {
  id: string
  x: number
  y: number
  net: string
}

export const demoPlacedFootprints: PlacedFootprint[] = [
  { id: 'u1', packageId: 'qfn-56', ref: 'U1', x: 0.5, y: 0.48, rotation: 0, side: 'top' },
  { id: 'j1', packageId: 'usb-c-mid', ref: 'J1', x: 0.12, y: 0.5, rotation: 90, side: 'top' },
  { id: 'j2', packageId: 'rj45-mag', ref: 'J2', x: 0.88, y: 0.5, rotation: -90, side: 'top' },
  { id: 'u2', packageId: 'soic-8', ref: 'U2', x: 0.38, y: 0.34, rotation: 0, side: 'top' },
  { id: 'l1', packageId: 'l-4x4', ref: 'L1', x: 0.66, y: 0.28, rotation: 0, side: 'top' },
  { id: 'c1', packageId: 'c-0603', ref: 'C1', x: 0.42, y: 0.58, rotation: 0, side: 'top' },
  { id: 'c2', packageId: 'c-0603', ref: 'C2', x: 0.58, y: 0.58, rotation: 0, side: 'top' },
  { id: 'r1', packageId: 'r-0603', ref: 'R1', x: 0.34, y: 0.64, rotation: 0, side: 'top' },
  { id: 'r2', packageId: 'r-0603', ref: 'R2', x: 0.66, y: 0.64, rotation: 0, side: 'top' },
  { id: 'tp1', packageId: 'tp-1mm', ref: 'TP1', x: 0.24, y: 0.24, rotation: 0, side: 'top' },
  { id: 'tp2', packageId: 'tp-1mm', ref: 'TP2', x: 0.76, y: 0.76, rotation: 0, side: 'top' },
]

export const demoBoardRoutes: BoardRoute[] = [
  { id: 'usb_to_mcu', layer: 'F.Cu', net: 'USB_DP_DN', width: 'signal', points: [[0.12, 0.5], [0.28, 0.5], [0.28, 0.48], [0.5, 0.48]] },
  { id: 'eth_to_mcu', layer: 'F.Cu', net: 'ETHERNET', width: 'signal', points: [[0.88, 0.5], [0.74, 0.5], [0.74, 0.48], [0.5, 0.48]] },
  { id: 'sensor_to_mcu', layer: 'F.Cu', net: 'I2C_SENSOR', width: 'signal', points: [[0.5, 0.48], [0.5, 0.34], [0.38, 0.34]] },
  { id: 'power_stage', layer: 'F.Cu', net: 'VIN', width: 'power', points: [[0.66, 0.28], [0.66, 0.4], [0.5, 0.4], [0.5, 0.48]] },
  { id: 'threev3_fanout', layer: 'F.Cu', net: '+3V3', width: 'power', points: [[0.5, 0.48], [0.5, 0.58], [0.66, 0.58], [0.66, 0.64]] },
]

export const demoBoardVias: BoardVia[] = [
  { id: 'via_tp1', x: 0.24, y: 0.25, net: 'I2C_SENSOR' },
  { id: 'via_u2', x: 0.32, y: 0.38, net: '+3V3' },
  { id: 'via_r1', x: 0.41, y: 0.72, net: 'GND' },
  { id: 'via_u1', x: 0.54, y: 0.32, net: 'USB_DP_DN' },
  { id: 'via_pwr', x: 0.62, y: 0.44, net: 'VIN' },
  { id: 'via_l1', x: 0.74, y: 0.26, net: 'VIN' },
  { id: 'via_tp2', x: 0.78, y: 0.74, net: 'GND' },
  { id: 'via_j1', x: 0.2, y: 0.74, net: 'GND' },
]

export function packageById(id: string): FootprintPackage {
  return footprintPackages.find((item) => item.id === id) || footprintPackages[0]
}

function normalizedFootprintBounds(placed: PlacedFootprint) {
  const pkg = packageById(placed.packageId)
  const [bodyX, bodyY] = pkg.body
  const rotation = Math.abs(placed.rotation % 180)
  const rotated = rotation > 45 && rotation < 135
  const sizeX = (rotated ? bodyY : bodyX) / 5.8 + 0.02
  const sizeY = (rotated ? bodyX : bodyY) / 4.2 + 0.02
  return {
    minX: placed.x - sizeX / 2,
    maxX: placed.x + sizeX / 2,
    minY: placed.y - sizeY / 2,
    maxY: placed.y + sizeY / 2,
  }
}

function boundsOverlap(a: ReturnType<typeof normalizedFootprintBounds>, b: ReturnType<typeof normalizedFootprintBounds>) {
  return a.minX < b.maxX && a.maxX > b.minX && a.minY < b.maxY && a.maxY > b.minY
}

export function resolvePlacedFootprints(footprints: PlacedFootprint[] = demoPlacedFootprints) {
  const placed: PlacedFootprint[] = []
  const lanes = [
    [0, 0],
    [0.04, 0],
    [-0.04, 0],
    [0, 0.06],
    [0, -0.06],
    [0.08, 0.06],
    [-0.08, 0.06],
    [0.08, -0.06],
    [-0.08, -0.06],
  ]

  for (const footprint of footprints) {
    let candidate = { ...footprint }
    for (const [dx, dy] of lanes) {
      const shifted = {
        ...footprint,
        x: Math.min(0.92, Math.max(0.08, footprint.x + dx)),
        y: Math.min(0.86, Math.max(0.14, footprint.y + dy)),
      }
      const shiftedBounds = normalizedFootprintBounds(shifted)
      const collides = placed.some((existing) => boundsOverlap(shiftedBounds, normalizedFootprintBounds(existing)))
      if (!collides) {
        candidate = shifted
        break
      }
    }
    placed.push(candidate)
  }

  return placed
}
