import { resolveComponentAssets } from './library-adapter.mjs'

const catalog = [
  { group: 'USB', value: 'USB-C receptacle', lcsc: 'C165948', mpn: 'TYPE-C-31-M-12', package: 'USB-C-SMD', stockRisk: 'low', assembly: 'JLCPCB review', pins: ['VBUS', 'GND', 'CC1', 'CC2', 'D+', 'D-'] },
  { group: 'ESP32_S3', value: 'ESP32-S3-WROOM-1', lcsc: 'C2913202', mpn: 'ESP32-S3-WROOM-1-N8R8', package: 'Module', stockRisk: 'medium', assembly: 'JLCPCB review', pins: ['3V3', 'GND', 'USB_DP', 'USB_DN', 'EN', 'IO0', 'SCL', 'SDA'] },
  { group: 'REGULATOR', value: '3V3 regulator', lcsc: 'C347222', mpn: 'ME6211C33M5G', package: 'SOT-23-5', stockRisk: 'low', assembly: 'basic-preferred candidate', pins: ['VIN', 'GND', '3V3', 'EN'] },
  { group: 'RES', value: '10k resistor', lcsc: 'C25804', mpn: '0603WAF1002T5E', package: '0603', stockRisk: 'low', assembly: 'basic', pins: ['1', '2'] },
  { group: 'CAP', value: '100nF capacitor', lcsc: 'C14663', mpn: 'CL10B104KB8NNNC', package: '0603', stockRisk: 'low', assembly: 'basic', pins: ['1', '2'] },
  { group: 'CAP', value: '10uF capacitor', lcsc: 'C19702', mpn: 'CL10A106KP8NNNC', package: '0603', stockRisk: 'low', assembly: 'basic', pins: ['1', '2'] },
  { group: 'RJ45', value: 'RJ45 MagJack', lcsc: 'C2933619', mpn: 'HR911105A', package: 'RJ45-MagJack', stockRisk: 'medium', assembly: 'extended review', pins: ['TX+', 'TX-', 'RX+', 'RX-', 'LED', 'SHIELD'] },
]

export async function buildComponentDatabase({ workspace, input = {} }) {
  const components = input.components || []
  const enriched = await enrichComponents({ workspace, components, input })
  return {
    status: enriched.some((item) => item.assetStatus !== 'complete_needs_review') ? 'COMPONENT_DATABASE_PARTIAL_NEEDS_REVIEW' : 'COMPONENT_DATABASE_READY_NEEDS_REVIEW',
    catalogVersion: 'boardforge-mvp-1',
    components: enriched,
    alternates: components.map((component) => ({ ref: component.ref, candidates: candidatesFor(component).slice(0, 3) })),
    riskSummary: riskSummary(enriched),
    humanReviewRequired: true,
  }
}

export async function enrichComponents({ workspace, components, input = {} }) {
  const assets = await resolveComponentAssets({ workspace, input: { ...input, components } })
  return components.map((component) => {
    const base = bestCatalogMatch(component)
    const resolved = assets.components?.find((item) => item.ref === component.ref)
    return {
      ...component,
      value: component.value || base?.value || component.group,
      lcsc: component.lcsc || base?.lcsc || null,
      mpn: component.mpn || base?.mpn || null,
      package: component.package || base?.package || null,
      assembly: base?.assembly || 'review-required',
      stockRisk: base?.stockRisk || 'unknown',
      pinMap: input.pinMaps?.[component.ref] || defaultPinMap(component, base),
      symbol: resolved?.symbol || component.symbol || null,
      footprint: resolved?.footprint || component.footprint || null,
      model3d: resolved?.model3d || component.model3d || null,
      assetStatus: resolved?.symbol && resolved?.footprint ? 'complete_needs_review' : 'missing_assets',
      confidence: resolved?.confidence || 'needs_review',
    }
  })
}

function bestCatalogMatch(component) {
  return catalog.find((item) => item.group === component.group && text(component.value || '').includes(text(item.value))) || catalog.find((item) => item.group === component.group) || null
}

function candidatesFor(component) {
  return catalog.filter((item) => item.group === component.group || text(item.value).includes(text(component.value))).map((item) => ({ ...item, reason: item.group === component.group ? 'same functional group' : 'value text match' }))
}

function defaultPinMap(component, base) {
  const pins = base?.pins || []
  if (component.group === 'RES') return { 1: component.netA || null, 2: component.netB || null }
  if (component.group === 'CAP') return { 1: component.netA || '3V3', 2: component.netB || 'GND' }
  if (component.group === 'USB') return { VBUS: 'VUSB', GND: 'GND', 'D+': 'USB_DP', 'D-': 'USB_DN', CC1: 'CC1', CC2: 'CC2' }
  if (component.group === 'ESP32_S3') return { '3V3': '3V3', GND: 'GND', USB_DP: 'USB_DP', USB_DN: 'USB_DN', SCL: 'I2C_SCL', SDA: 'I2C_SDA' }
  return Object.fromEntries(pins.map((pin) => [pin, null]))
}

function riskSummary(components) {
  return {
    missingAssets: components.filter((item) => item.assetStatus !== 'complete_needs_review').length,
    unknownStock: components.filter((item) => item.stockRisk === 'unknown').length,
    mediumRisk: components.filter((item) => item.stockRisk === 'medium').length,
    requiresHumanReview: true,
  }
}

function text(value) {
  return String(value || '').toLowerCase()
}
