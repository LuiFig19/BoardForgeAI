import { resolveComponentAssets } from './library-adapter.mjs'

const catalog = [
  { group: 'USB', value: 'USB-C receptacle', lcsc: 'C165948', mpn: 'TYPE-C-31-M-12', package: 'USB-C-SMD', stockRisk: 'low', assembly: 'JLCPCB review', pins: ['VBUS', 'GND', 'CC1', 'CC2', 'D+', 'D-'] },
  { group: 'ESP32_S3', value: 'ESP32-S3-WROOM-1', lcsc: 'C2913202', mpn: 'ESP32-S3-WROOM-1-N8R8', package: 'Module', stockRisk: 'medium', assembly: 'JLCPCB review', pins: ['3V3', 'GND', 'USB_DP', 'USB_DN', 'EN', 'IO0', 'SCL', 'SDA'] },
  { group: 'REGULATOR', value: '3V3 regulator', lcsc: 'C347222', mpn: 'ME6211C33M5G', package: 'SOT-23-5', stockRisk: 'low', assembly: 'basic-preferred candidate', pins: ['VIN', 'GND', '3V3', 'EN'] },
  { group: 'RES', value: '10k resistor', lcsc: 'C25804', mpn: '0603WAF1002T5E', package: '0603', stockRisk: 'low', assembly: 'basic', pins: ['1', '2'] },
  { group: 'CAP', value: '100nF capacitor', lcsc: 'C14663', mpn: 'CL10B104KB8NNNC', package: '0603', stockRisk: 'low', assembly: 'basic', pins: ['1', '2'] },
  { group: 'CAP', value: '10uF capacitor', lcsc: 'C19702', mpn: 'CL10A106KP8NNNC', package: '0603', stockRisk: 'low', assembly: 'basic', pins: ['1', '2'] },
  { group: 'RJ45', value: 'RJ45 MagJack', lcsc: 'C2933619', mpn: 'HR911105A', package: 'RJ45-MagJack', stockRisk: 'medium', assembly: 'extended review', pins: ['TX+', 'TX-', 'RX+', 'RX-', 'LED', 'SHIELD'] },
  { group: 'INDUCTOR', value: '2.2uH shielded inductor', lcsc: 'C167943', mpn: 'SWPA3015S2R2MT', package: '3015', stockRisk: 'low', assembly: 'power review', pins: ['1', '2'] },
  { group: 'IMU', value: '6-axis IMU', lcsc: 'C2687302', mpn: 'ICM-42688-P', package: 'LGA-14', stockRisk: 'medium', assembly: 'orientation review', pins: ['VDD', 'VDDIO', 'GND', 'SCL', 'SDA', 'INT1', 'INT2'] },
  { group: 'BAROMETER', value: 'barometric pressure sensor', lcsc: 'C91365', mpn: 'BMP280', package: 'LGA-8', stockRisk: 'medium', assembly: 'orientation review', pins: ['VDD', 'GND', 'SCL', 'SDA', 'CSB', 'SDO'] },
  { group: 'BLACKBOX', value: 'SPI flash memory', lcsc: 'C82317', mpn: 'W25Q128JVSIQ', package: 'SOIC-8', stockRisk: 'low', assembly: 'basic', pins: ['CS', 'MISO', 'WP', 'GND', 'MOSI', 'SCK', 'HOLD', 'VCC'] },
  { group: 'ETHERNET_PHY', value: '10/100 Ethernet PHY', lcsc: 'C18743', mpn: 'LAN8720A-CP-TR', package: 'QFN-24', stockRisk: 'medium', assembly: 'impedance review', pins: ['VDDA', 'VDDIO', 'GND', 'TXP', 'TXN', 'RXP', 'RXN', 'MDC', 'MDIO', 'REFCLK'] },
  { group: 'POE_FRONT_END', value: '802.3af PoE PD front end', lcsc: 'C265873', mpn: 'TPS2375', package: 'SOIC-8', stockRisk: 'medium', assembly: 'high-voltage clearance review', pins: ['VDD', 'VSS', 'RTN', 'DEN', 'CLS', 'UVLO', 'PG', 'AUX'] },
  { group: 'POWER_INPUT', value: 'power input connector', lcsc: 'C160404', mpn: 'KF301-2P', package: 'TerminalBlock-2P', stockRisk: 'low', assembly: 'edge placement review', pins: ['VIN', 'GND'] },
  { group: 'SENSOR_CONNECTOR', value: 'I2C sensor connector', lcsc: 'C492405', mpn: 'PinHeader-1x04', package: 'PinHeader-1x04', stockRisk: 'low', assembly: 'edge/access review', pins: ['GND', '3V3', 'SCL', 'SDA'] },
  { group: 'ESC_CONNECTOR', value: 'ESC signal connector', lcsc: 'C492411', mpn: 'PinHeader-1x08', package: 'PinHeader-1x08', stockRisk: 'low', assembly: 'edge/access review', pins: ['GND', 'VBAT', 'M1', 'M2', 'M3', 'M4', 'CURR', 'TEL'] },
  { group: 'SWD', value: 'SWD programming header', lcsc: 'C492404', mpn: 'PinHeader-1x05', package: 'PinHeader-1x05', stockRisk: 'low', assembly: 'debug access review', pins: ['3V3', 'SWDIO', 'SWCLK', 'NRST', 'GND'] },
]

export async function buildComponentDatabase({ workspace, input = {} }) {
  const components = input.components || []
  const enriched = await enrichComponents({ workspace, components, input })
  return {
    status: enriched.some((item) => item.assetStatus !== 'complete_needs_review') ? 'COMPONENT_DATABASE_PARTIAL_NEEDS_REVIEW' : 'COMPONENT_DATABASE_READY_NEEDS_REVIEW',
    catalogVersion: 'boardforge-mvp-1',
    components: enriched,
    alternates: enriched.map((component) => ({ ref: component.ref, selected: selectedPartKey(component), candidates: substitutionCandidates(component).slice(0, 5) })),
    riskSummary: riskSummary(enriched),
    procurementSummary: procurementSummary(enriched),
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
      footprintConfidence: footprintConfidence(component, resolved?.footprint, base),
      procurement: procurementProfile(component, base),
      substitutions: substitutionCandidates({ ...component, ...base }).slice(0, 3),
      selectionScore: selectionScore(component, base, resolved),
    }
  })
}

function bestCatalogMatch(component) {
  return catalog.find((item) => item.group === component.group && text(component.value || '').includes(text(item.value))) || catalog.find((item) => item.group === component.group) || null
}

function candidatesFor(component) {
  return catalog.filter((item) => item.group === component.group || text(item.value).includes(text(component.value))).map((item) => ({ ...item, reason: item.group === component.group ? 'same functional group' : 'value text match' }))
}

function substitutionCandidates(component) {
  const base = bestCatalogMatch(component) || component
  return candidatesFor(component)
    .filter((candidate) => candidate.mpn !== base.mpn || candidate.lcsc !== base.lcsc)
    .map((candidate) => ({
      group: candidate.group,
      value: candidate.value,
      lcsc: candidate.lcsc,
      mpn: candidate.mpn,
      package: candidate.package,
      stockRisk: candidate.stockRisk,
      assembly: candidate.assembly,
      compatibility: packageFamily(candidate.package) === packageFamily(base.package) ? 'drop_in_package_family_needs_review' : 'same_function_relayout_required',
      reason: candidate.group === base.group ? 'same functional group' : 'catalog text match',
    }))
}

function footprintConfidence(component, footprint, base) {
  const libId = footprint?.libId || component.footprint?.libId || component.footprint || ''
  const packageName = component.package || base?.package || ''
  const normalizedFootprint = text(libId)
  const normalizedPackage = text(packageName)
  const packageHit = normalizedPackage && normalizedFootprint.includes(normalizedPackage.replace(/[^a-z0-9]/g, ''))
  const groupHit = component.group && normalizedFootprint.includes(text(component.group).replace(/_/g, ''))
  const score = Math.min(100, (footprint ? 45 : 0) + (packageHit ? 35 : 0) + (groupHit ? 10 : 0) + (footprint?.models3d?.length ? 10 : 0))
  return {
    score,
    status: score >= 80 ? 'strong_match_needs_review' : score >= 45 ? 'usable_match_needs_review' : 'weak_or_missing_match',
    footprint: libId || null,
    expectedPackage: packageName || null,
    checks: {
      footprintResolved: Boolean(footprint || component.footprint),
      packageTextMatched: Boolean(packageHit),
      groupTextMatched: Boolean(groupHit),
      modelLinked: Boolean(footprint?.models3d?.length || component.model3d),
    },
  }
}

function procurementProfile(component, base) {
  const risk = component.stockRisk || base?.stockRisk || 'unknown'
  return {
    lcsc: component.lcsc || base?.lcsc || null,
    mpn: component.mpn || base?.mpn || null,
    package: component.package || base?.package || null,
    stockRisk: risk,
    lifecycleRisk: risk === 'low' ? 'low_review' : risk === 'medium' ? 'alternate_recommended' : 'unknown_requires_supplier_check',
    assemblyRisk: /review|extended|orientation|power|high-voltage/i.test(base?.assembly || component.assembly || '') ? 'review_required' : 'basic_candidate',
  }
}

function selectionScore(component, base, resolved) {
  let score = 0
  if (base) score += 25
  if (component.lcsc || base?.lcsc) score += 15
  if (component.mpn || base?.mpn) score += 10
  if (resolved?.symbol) score += 15
  if (resolved?.footprint) score += 20
  if (resolved?.model3d) score += 10
  if ((component.stockRisk || base?.stockRisk) === 'low') score += 5
  return Math.min(100, score)
}

function selectedPartKey(component) {
  return [component.ref, component.mpn, component.lcsc, component.package].filter(Boolean).join('|')
}

function defaultPinMap(component, base) {
  const pins = base?.pins || []
  if (component.group === 'RES') return { 1: component.netA || null, 2: component.netB || null }
  if (component.group === 'CAP') return { 1: component.netA || '3V3', 2: component.netB || 'GND' }
  if (component.group === 'USB') return { VBUS: 'VUSB', GND: 'GND', 'D+': 'USB_DP', 'D-': 'USB_DN', CC1: 'CC1', CC2: 'CC2' }
  if (component.group === 'ESP32_S3') return { '3V3': '3V3', GND: 'GND', USB_DP: 'USB_DP', USB_DN: 'USB_DN', SCL: 'I2C_SCL', SDA: 'I2C_SDA' }
  if (component.group === 'RJ45') return { 'TX+': 'ETH_TX_P', 'TX-': 'ETH_TX_N', 'RX+': 'ETH_RX_P', 'RX-': 'ETH_RX_N', LED: '3V3', SHIELD: 'CHASSIS_GND' }
  if (component.group === 'INDUCTOR') return { 1: component.netA || 'SW', 2: component.netB || 'VOUT' }
  if (component.group === 'IMU') return { VDD: '3V3', VDDIO: '3V3', GND: 'GND', SCL: 'I2C_SCL', SDA: 'I2C_SDA', INT1: 'IMU_INT1', INT2: 'IMU_INT2' }
  if (component.group === 'BAROMETER') return { VDD: '3V3', GND: 'GND', SCL: 'I2C_SCL', SDA: 'I2C_SDA', CSB: '3V3', SDO: 'GND' }
  if (component.group === 'BLACKBOX') return { CS: 'FLASH_CS', MISO: 'SPI_MISO', WP: '3V3', GND: 'GND', MOSI: 'SPI_MOSI', SCK: 'SPI_SCK', HOLD: '3V3', VCC: '3V3' }
  if (component.group === 'ETHERNET_PHY') return { VDDA: '3V3', VDDIO: '3V3', GND: 'GND', TXP: 'ETH_TX_P', TXN: 'ETH_TX_N', RXP: 'ETH_RX_P', RXN: 'ETH_RX_N', MDC: 'ETH_MDC', MDIO: 'ETH_MDIO', REFCLK: 'ETH_REFCLK' }
  if (component.group === 'POE_FRONT_END') return { VDD: 'POE_VDD', VSS: 'POE_VSS', RTN: 'POE_RTN', DEN: 'POE_DEN', CLS: 'POE_CLS', UVLO: 'POE_UVLO', PG: 'POE_PG', AUX: 'POE_AUX' }
  if (component.group === 'POWER_INPUT') return { VIN: component.netA || 'VIN', GND: 'GND' }
  if (component.group === 'SENSOR_CONNECTOR') return { GND: 'GND', '3V3': '3V3', SCL: 'I2C_SCL', SDA: 'I2C_SDA' }
  if (component.group === 'ESC_CONNECTOR') return { GND: 'GND', VBAT: 'VBAT', M1: 'MOTOR_1', M2: 'MOTOR_2', M3: 'MOTOR_3', M4: 'MOTOR_4', CURR: 'CURRENT_SENSE', TEL: 'ESC_TELEMETRY' }
  if (component.group === 'SWD') return { '3V3': '3V3', SWDIO: 'SWDIO', SWCLK: 'SWCLK', NRST: 'NRST', GND: 'GND' }
  return Object.fromEntries(pins.map((pin) => [pin, null]))
}

function riskSummary(components) {
  return {
    missingAssets: components.filter((item) => item.assetStatus !== 'complete_needs_review').length,
    unknownStock: components.filter((item) => item.stockRisk === 'unknown').length,
    mediumRisk: components.filter((item) => item.stockRisk === 'medium').length,
    weakFootprintMatches: components.filter((item) => item.footprintConfidence?.status === 'weak_or_missing_match').length,
    requiresHumanReview: true,
  }
}

function procurementSummary(components) {
  return {
    total: components.length,
    lcscLinked: components.filter((item) => item.procurement?.lcsc).length,
    alternatesAvailable: components.filter((item) => item.substitutions?.length).length,
    reviewRequired: components.filter((item) => item.procurement?.assemblyRisk === 'review_required' || item.procurement?.lifecycleRisk !== 'low_review').length,
  }
}

function packageFamily(value) {
  return text(value).replace(/[^a-z0-9]/g, '').replace(/metric$/, '')
}

function text(value) {
  return String(value || '').toLowerCase()
}
