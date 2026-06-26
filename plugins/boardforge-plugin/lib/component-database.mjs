import { resolveComponentAssets } from './library-adapter.mjs'
import { validateComponentBindings } from './component-compatibility.mjs'
import { synthesizePinMapFromAssets } from './pin-map-synthesizer.mjs'

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
  { group: 'CAN_TRANSCEIVER', value: 'CAN transceiver routeable fixture', lcsc: 'C53776', mpn: 'SN65HVD230', package: 'Header-1x06 fixture', stockRisk: 'medium', assembly: 'functional footprint review', pins: ['CANH', 'CANL', 'TXD', 'RXD', 'VCC', 'GND'] },
  { group: 'RS485_TRANSCEIVER', value: 'RS485 transceiver routeable fixture', lcsc: 'C8798', mpn: 'MAX3485', package: 'Header-1x06 fixture', stockRisk: 'medium', assembly: 'functional footprint review', pins: ['A', 'B', 'DI', 'RO', 'VCC', 'GND'] },
  { group: 'FIELD_CONNECTOR', value: 'field bus connector', lcsc: 'C492411', mpn: 'PinHeader-1x08', package: 'PinHeader-1x08', stockRisk: 'low', assembly: 'edge/access review', pins: ['CANH', 'CANL', 'RS485_A', 'RS485_B', 'FIELD_IN1', 'FIELD_OUT1', '24V_FIELD', 'GND_FIELD'] },
  { group: 'MOTOR_HEADER', value: 'motor/control output header', lcsc: 'C492409', mpn: 'PinHeader-1x06', package: 'PinHeader-1x06', stockRisk: 'low', assembly: 'edge/access review', pins: ['GND', 'VIN', 'PWM_1', 'PWM_2', 'ENC_A', 'ENC_B'] },
  { group: 'TERMINAL_BLOCK', value: 'industrial field terminal block', lcsc: 'C8465', mpn: 'KF301-8P', package: 'TerminalBlock-8P', stockRisk: 'medium', assembly: 'field wiring clearance review', pins: ['24V_FIELD', 'GND_FIELD', 'FIELD_IN1', 'FIELD_OUT1', 'CANH', 'CANL', 'RS485_A', 'RS485_B'] },
  { group: 'ISOLATOR', value: 'digital isolator fixture', lcsc: 'C105314', mpn: 'ADuM1201', package: 'SOIC-8', stockRisk: 'medium', assembly: 'isolation review', pins: ['VDD1', 'GND1', 'A', 'B', 'VOA', 'VOB', 'GND2', 'VDD2'] },
  { group: 'RELAY_OR_DRIVER', value: 'protected field output driver', lcsc: 'C9683', mpn: 'ULN2003-like', package: 'SOIC-8', stockRisk: 'medium', assembly: 'field driver review', pins: ['VIN', 'OUT', 'IN', 'GND_FIELD', 'VCC', 'GND', 'FIELD_IN1', 'ISO_IN1'] },
  { group: 'TVS', value: 'field surge protection TVS', lcsc: 'C9707', mpn: 'ESD5Zxx', package: 'SOD-323', stockRisk: 'low', assembly: 'protection placement review', pins: ['A', 'K'] },
  { group: 'SENSOR_CONNECTOR', value: 'I2C sensor connector', lcsc: 'C492405', mpn: 'PinHeader-1x04-1.27', package: 'PinHeader-1x04-P1.27-SMD', stockRisk: 'low', assembly: 'edge/access review', pins: ['GND', '3V3', 'SCL', 'SDA'] },
  { group: 'ESC_CONNECTOR', value: 'ESC signal connector', lcsc: 'C492411', mpn: 'PinHeader-1x08-1.27', package: 'PinHeader-1x08-P1.27-SMD', stockRisk: 'low', assembly: 'edge/access review', pins: ['GND', 'VBAT', 'M1', 'M2', 'M3', 'M4', 'CURR', 'TEL'] },
  { group: 'GNSS', value: 'GPS/GNSS connector', lcsc: 'C492413', mpn: 'PinHeader-1x06-1.27', package: 'PinHeader-1x06-P1.27-SMD', stockRisk: 'low', assembly: 'edge/access review', pins: ['VCC', 'GND', 'TX', 'RX', 'SDA', 'SCL'] },
  { group: 'RECEIVER', value: 'RC receiver connector', lcsc: 'C492405', mpn: 'PinHeader-1x04-1.27', package: 'PinHeader-1x04-P1.27-SMD', stockRisk: 'low', assembly: 'edge/access review', pins: ['VCC', 'GND', 'TX', 'RX'] },
  { group: 'TELEMETRY', value: 'telemetry connector', lcsc: 'C492405', mpn: 'PinHeader-1x04-1.27', package: 'PinHeader-1x04-P1.27-SMD', stockRisk: 'low', assembly: 'edge/access review', pins: ['VCC', 'GND', 'TX', 'RX'] },
  { group: 'BUZZER', value: 'buzzer connector', lcsc: 'C492403', mpn: 'PinHeader-1x02-1.27', package: 'PinHeader-1x02-P1.27-SMD', stockRisk: 'low', assembly: 'edge/access review', pins: ['+', '-'] },
  { group: 'CURRENT_SENSOR', value: 'current sense amplifier', lcsc: 'C81381', mpn: 'INA180A1IDBVR', package: 'SOT-23-5', stockRisk: 'medium', assembly: 'analog layout review', pins: ['VIN+', 'VIN-', 'VCC', 'GND', 'OUT'] },
  { group: 'SWITCH', value: 'tactile switch', lcsc: 'C318884', mpn: 'B3S-1000', package: 'SW_SPST', stockRisk: 'low', assembly: 'basic', pins: ['1', '2'] },
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
  return Promise.all(components.map(async (component) => {
    const base = bestCatalogMatch(component)
    const resolved = assets.components?.find((item) => item.ref === component.ref)
    const symbol = preferRichAsset(component.symbol, resolved?.symbol)
    const footprint = preferRichAsset(component.footprint, resolved?.footprint)
    const model3d = preferRichAsset(component.model3d, resolved?.model3d)
    const synthesized = synthesizePinMapFromAssets({ ...component, symbol, footprint }, input.nets || [])
    const pinMap = normalizeCanonicalPinMap(selectPadCompatiblePinMap({
      component,
      base,
      footprint,
      requested: input.pinMaps?.[component.ref] || component.pinMap,
      synthesized: synthesized.pinMap,
    }), component, base, footprint)
    const packageSize = footprintPackageSize(footprint)
    const candidate = {
      ...component,
      value: component.value || base?.value || component.group,
      lcsc: component.lcsc || base?.lcsc || null,
      mpn: component.mpn || base?.mpn || null,
      package: component.package || base?.package || null,
      width: Number(component.width || packageSize.width || 0) || component.width,
      height: Number(component.height || packageSize.height || 0) || component.height,
      courtyard: footprint?.courtyard || component.courtyard,
      assembly: base?.assembly || 'review-required',
      stockRisk: base?.stockRisk || 'unknown',
      pinMap,
      symbol,
      footprint,
      model3d,
    }
    const binding = (await validateComponentBindings([candidate])).results[0]
    const assetStatus = assetStatusFor(candidate, binding)
    return {
      ...candidate,
      assetStatus,
      confidence: resolved?.confidence || 'needs_review',
      footprintConfidence: footprintConfidence(component, resolved?.footprint, base),
      procurement: procurementProfile(component, base),
      substitutions: substitutionCandidates({ ...component, ...base }).slice(0, 3),
      selectionScore: selectionScore(component, base, resolved, binding, synthesized),
      bindingStatus: binding?.issues?.some((issue) => issue.severity === 'ERROR') ? 'binding_errors' : binding?.issues?.some((issue) => issue.severity === 'WARNING') ? 'binding_warnings' : 'binding_ready',
      bindingCompatibilityScore: binding?.compatibilityScore ?? null,
      authoritativePart: authoritativePartFor({ component: candidate, base, resolved, binding, synthesized }),
    }
  }))
}

export function normalizeCanonicalPinMap(pinMap = {}, component = {}, base = null, footprint = null) {
  const normalized = { ...(pinMap || {}) }
  const group = component.group || base?.group || ''
  const padNames = new Set((footprint?.pads || []).map((pad) => String(pad.name)))
  const put = (keys, net) => {
    for (const key of keys) {
      if (padNames.size && !padNames.has(String(key)) && !padNames.has(stripLeadingZeros(key))) continue
      if (!normalized[key]) normalized[key] = net
    }
  }
  if (group === 'USB') {
    put(['A1', 'A12', 'B1', 'B12', 'GND', 'SHIELD', 'SH1', 'SH2'], 'GND')
    put(['A4', 'A9', 'B4', 'B9', 'VBUS'], 'VUSB')
    put(['A5', 'CC1'], 'CC1')
    put(['B5', 'CC2'], 'CC2')
    put(['A6', 'B6', 'D+', 'DP'], 'USB_DP')
    put(['A7', 'B7', 'D-', 'DN'], 'USB_DN')
  }
  if (group === 'ESP32_S3') {
    put(['1', '15', '38', '39', '40', '41', 'GND'], 'GND')
    put(['2', '3V3', 'VDD', 'VCC'], '3V3')
    put(['3', 'EN'], 'EN')
    put(['13', 'USB_DN', 'D-'], 'USB_DN')
    put(['14', 'USB_DP', 'D+'], 'USB_DP')
    put(['27', 'IO0', 'BOOT'], 'BOOT')
  }
  if (group === 'REGULATOR') {
    put(['1', 'VIN', 'IN'], component.netA || 'VUSB')
    put(['2', 'GND'], 'GND')
    put(['3', 'EN', 'CE'], component.enableNet || component.netA || 'VUSB')
    put(['5', 'VOUT', 'OUT'], component.netB || '3V3')
  }
  if (group === 'CURRENT_SENSOR') {
    put(['VCC', 'VS'], '3V3')
    put(['GND'], 'GND')
    put(['OUT'], 'CURRENT_SENSE')
    put(['VIN+', 'IN+'], 'VBAT')
    put(['VIN-', 'IN-'], 'VBAT_SENSE')
  }
  if (group === 'CAN_TRANSCEIVER') {
    put(['1', 'CANH'], 'CANH')
    put(['2', 'CANL'], 'CANL')
    put(['3', 'TXD'], 'CAN_TX')
    put(['4', 'RXD'], 'CAN_RX')
    put(['5', 'VCC', 'VDD'], '3V3')
    put(['6', 'GND'], 'GND')
  }
  if (group === 'RS485_TRANSCEIVER') {
    put(['1', 'A'], 'RS485_A')
    put(['2', 'B'], 'RS485_B')
    put(['3', 'DI'], 'RS485_TX')
    put(['4', 'RO'], 'RS485_RX')
    put(['5', 'VCC', 'VDD'], '3V3')
    put(['6', 'GND'], 'GND')
  }
  if (group === 'FIELD_CONNECTOR') {
    put(['1'], 'CANH')
    put(['2'], 'CANL')
    put(['3'], 'RS485_A')
    put(['4'], 'RS485_B')
    put(['5'], 'FIELD_IN1')
    put(['6'], 'FIELD_OUT1')
    put(['7'], '24V_FIELD')
    put(['8'], 'GND_FIELD')
  }
  if (group === 'MOTOR_HEADER') {
    put(['1'], 'GND')
    put(['2'], 'VIN')
    put(['3'], 'PWM_1')
    put(['4'], 'PWM_2')
    put(['5'], 'ENC_A')
    put(['6'], 'ENC_B')
  }
  if (group === 'TERMINAL_BLOCK') {
    put(['1'], '24V_FIELD')
    put(['2'], 'GND_FIELD')
    put(['3'], 'FIELD_IN1')
    put(['4'], 'FIELD_OUT1')
    put(['5'], 'CANH')
    put(['6'], 'CANL')
    put(['7'], 'RS485_A')
    put(['8'], 'RS485_B')
  }
  if (group === 'ISOLATOR' || group === 'RELAY_OR_DRIVER') {
    put(['1'], group === 'ISOLATOR' ? '3V3' : '24V_FIELD')
    put(['2'], group === 'ISOLATOR' ? 'GND' : 'FIELD_OUT1')
    put(['3'], group === 'ISOLATOR' ? 'FIELD_IN1' : 'ISO_OUT1')
    put(['4'], 'GND_FIELD')
    put(['5'], '3V3')
    put(['6'], 'GND')
    put(['7'], 'FIELD_IN1')
    put(['8'], 'ISO_IN1')
  }
  if (['IMU', 'BAROMETER', 'BLACKBOX', 'ETHERNET_PHY'].includes(group)) {
    put(['VDD', 'VDDIO', 'VCC', 'VDDA'], '3V3')
    put(['GND', 'VSS', 'EP'], 'GND')
  }
  return normalized
}

function assetStatusFor(component, binding) {
  if (!component.symbol || !component.footprint) return 'missing_assets'
  if (binding?.issues?.some((issue) => issue.severity === 'ERROR')) return 'binding_needs_fix'
  if ((binding?.compatibilityScore ?? 0) < 55) return 'weak_binding_needs_review'
  return 'complete_needs_review'
}

function preferRichAsset(explicit, resolved) {
  if (explicit && typeof explicit === 'object') return explicit
  return resolved || explicit || null
}

function authoritativePartFor({ component, base, resolved, binding, synthesized }) {
  return {
    ref: component.ref,
    value: component.value,
    group: component.group,
    lcsc: component.lcsc || base?.lcsc || null,
    mpn: component.mpn || base?.mpn || null,
    package: component.package || base?.package || null,
    symbol: assetId(component.symbol || resolved?.symbol),
    footprint: assetId(component.footprint || resolved?.footprint),
    model3d: modelId(component.model3d || resolved?.model3d),
    pinMapEvidence: synthesized?.evidence || [],
    bindingCompatibilityScore: binding?.compatibilityScore ?? null,
    bindingIssues: (binding?.issues || []).map((issue) => ({ severity: issue.severity, code: issue.code, message: issue.message })),
    humanReviewRequired: true,
  }
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

function selectionScore(component, base, resolved, binding, synthesized) {
  let score = 0
  if (base) score += 25
  if (component.lcsc || base?.lcsc) score += 15
  if (component.mpn || base?.mpn) score += 10
  if (resolved?.symbol) score += 15
  if (resolved?.footprint) score += 20
  if (resolved?.model3d) score += 10
  if ((binding?.compatibilityScore || 0) >= 75) score += 10
  if (synthesized?.evidence?.length) score += 5
  if ((component.stockRisk || base?.stockRisk) === 'low') score += 5
  return Math.min(100, score)
}

function assetId(asset) {
  if (!asset) return null
  return typeof asset === 'string' ? asset : asset.libId || asset.name || null
}

function modelId(model) {
  if (!model) return null
  return typeof model === 'string' ? model : model.path || model.libId || model.name || null
}

function selectedPartKey(component) {
  return [component.ref, component.mpn, component.lcsc, component.package].filter(Boolean).join('|')
}

function defaultPinMap(component, base) {
  const pins = base?.pins || []
  if (component.group === 'RES') return { 1: component.netA || null, 2: component.netB || null }
  if (component.group === 'CAP') return { 1: component.netA || '3V3', 2: component.netB || 'GND' }
  if (component.group === 'USB') return usbPinMap(component)
  if (component.group === 'ESP32_S3') return esp32S3Wroom1PinMap()
  if (component.group === 'REGULATOR') return { VIN: component.netA || 'VUSB', GND: 'GND', VOUT: '3V3' }
  if (component.group === 'TVS') return { 1: 'USB_DP', 2: 'USB_DN', 3: 'GND', 4: 'VUSB' }
  if (component.group === 'RJ45') return { 'TX+': 'ETH_TX_P', 'TX-': 'ETH_TX_N', 'RX+': 'ETH_RX_P', 'RX-': 'ETH_RX_N', LED: '3V3', SHIELD: 'CHASSIS_GND' }
  if (component.group === 'INDUCTOR') return { 1: component.netA || 'SW', 2: component.netB || 'VOUT' }
  if (component.group === 'IMU') return { VDD: '3V3', VDDIO: '3V3', GND: 'GND', SCL: 'I2C_SCL', SDA: 'I2C_SDA', INT1: 'IMU_INT1', INT2: 'IMU_INT2' }
  if (component.group === 'BAROMETER') return { VDD: '3V3', GND: 'GND', SCL: 'I2C_SCL', SDA: 'I2C_SDA', CSB: '3V3', SDO: 'GND' }
  if (component.group === 'BLACKBOX') return { CS: 'FLASH_CS', MISO: 'SPI_MISO', WP: '3V3', GND: 'GND', MOSI: 'SPI_MOSI', SCK: 'SPI_SCK', HOLD: '3V3', VCC: '3V3' }
  if (component.group === 'ETHERNET_PHY') return { VDDA: '3V3', VDDIO: '3V3', GND: 'GND', TXP: 'ETH_TX_P', TXN: 'ETH_TX_N', RXP: 'ETH_RX_P', RXN: 'ETH_RX_N', MDC: 'ETH_MDC', MDIO: 'ETH_MDIO', REFCLK: 'ETH_REFCLK' }
  if (component.group === 'POE_FRONT_END') return { VDD: 'POE_VDD', VSS: 'POE_VSS', RTN: 'POE_RTN', DEN: 'POE_DEN', CLS: 'POE_CLS', UVLO: 'POE_UVLO', PG: 'POE_PG', AUX: 'POE_AUX' }
  if (component.group === 'POWER_INPUT') return { VIN: component.netA || 'VIN', GND: 'GND' }
  if (component.group === 'CAN_TRANSCEIVER') return { 1: 'CANH', 2: 'CANL', 3: 'CAN_TX', 4: 'CAN_RX', 5: '3V3', 6: 'GND' }
  if (component.group === 'RS485_TRANSCEIVER') return { 1: 'RS485_A', 2: 'RS485_B', 3: 'RS485_TX', 4: 'RS485_RX', 5: '3V3', 6: 'GND' }
  if (component.group === 'FIELD_CONNECTOR') return { 1: 'CANH', 2: 'CANL', 3: 'RS485_A', 4: 'RS485_B', 5: 'FIELD_IN1', 6: 'FIELD_OUT1', 7: '24V_FIELD', 8: 'GND_FIELD' }
  if (component.group === 'MOTOR_HEADER') return { 1: 'GND', 2: 'VIN', 3: 'PWM_1', 4: 'PWM_2', 5: 'ENC_A', 6: 'ENC_B' }
  if (component.group === 'TERMINAL_BLOCK') return { 1: '24V_FIELD', 2: 'GND_FIELD', 3: 'FIELD_IN1', 4: 'FIELD_OUT1', 5: 'CANH', 6: 'CANL', 7: 'RS485_A', 8: 'RS485_B' }
  if (component.group === 'ISOLATOR') return { 1: '3V3', 2: 'GND', 3: 'FIELD_IN1', 4: 'FIELD_OUT1', 5: 'ISO_IN1', 6: 'ISO_OUT1', 7: 'GND_FIELD', 8: '24V_FIELD' }
  if (component.group === 'RELAY_OR_DRIVER') return { 1: '24V_FIELD', 2: 'FIELD_OUT1', 3: 'ISO_OUT1', 4: 'GND_FIELD', 5: '3V3', 6: 'GND', 7: 'FIELD_IN1', 8: 'ISO_IN1' }
  if (component.group === 'SENSOR_CONNECTOR') return { 1: 'GND', 2: '3V3', 3: 'I2C_SCL', 4: 'I2C_SDA' }
  if (component.group === 'ESC_CONNECTOR') return { 1: 'GND', 2: 'VBAT', 3: 'MOTOR_1', 4: 'MOTOR_2', 5: 'MOTOR_3', 6: 'MOTOR_4', 7: 'CURRENT_SENSE', 8: 'ESC_TELEMETRY' }
  if (component.group === 'GNSS') return { 1: '3V3', 2: 'GND', 3: 'GPS_RX', 4: 'GPS_TX', 5: 'I2C_SDA', 6: 'I2C_SCL' }
  if (component.group === 'RECEIVER') return { 1: '5V', 2: 'GND', 3: 'RC_RX', 4: 'RC_TX' }
  if (component.group === 'TELEMETRY') return { 1: '5V', 2: 'GND', 3: 'TEL_RX', 4: 'TEL_TX' }
  if (component.group === 'BUZZER') return { 1: '5V', 2: 'BUZZER' }
  if (component.group === 'CURRENT_SENSOR') return { 'VIN+': 'VBAT', 'VIN-': 'CURRENT_SENSE', VCC: '3V3', GND: 'GND', OUT: 'VBAT_SENSE' }
  if (component.group === 'SWITCH') return { 1: component.netA || 'ARM', 2: component.netB || 'GND' }
  if (component.group === 'SWD') return { '3V3': '3V3', SWDIO: 'SWDIO', SWCLK: 'SWCLK', NRST: 'NRST', GND: 'GND' }
  return Object.fromEntries(pins.map((pin) => [pin, null]))
}

function selectPadCompatiblePinMap({ component, base, footprint, requested, synthesized }) {
  const candidates = [
    usefulPinMap(requested),
    usefulPinMap(synthesized),
    defaultPinMap(component, base),
  ].filter(Boolean)
  const padNames = new Set((footprint?.pads || []).map((pad) => String(pad.name)))
  if (!padNames.size) return candidates[0] || {}
  const withScore = candidates.map((pinMap) => {
    const keys = Object.keys(pinMap).map(String)
    const matches = keys.filter((key) => padNames.has(key) || padNames.has(stripLeadingZeros(key))).length
    return { pinMap, matches, total: keys.length }
  })
  withScore.sort((a, b) => (b.matches - a.matches) || (b.total - a.total))
  return withScore[0]?.matches ? withScore[0].pinMap : (candidates[0] || {})
}

function footprintPackageSize(footprint) {
  const width = Number(footprint?.widthMm || footprint?.courtyard?.width || 0)
  const height = Number(footprint?.heightMm || footprint?.courtyard?.height || 0)
  if (!width || !height) return { width: 0, height: 0 }
  return { width, height }
}

function stripLeadingZeros(value) {
  return String(value).replace(/^0+(?=\d)/, '')
}

function esp32S3Wroom1PinMap() {
  return {
    1: 'GND',
    2: '3V3',
    3: 'EN',
    13: 'USB_DN',
    14: 'USB_DP',
    27: 'BOOT',
    32: 'I2C_SCL',
    33: 'I2C_SDA',
    40: 'GND',
    41: 'GND',
  }
}

function usbPinMap(component) {
  const footprint = String(component.footprint?.libId || component.footprint || component.footprintFile || '').toUpperCase()
  const isHeader = /PINHEADER|CONN_01X04|HEADER/.test(footprint) || /DEBUG HEADER/i.test(component.value || '')
  const base = { VBUS: 'VUSB', GND: 'GND', 'D+': 'USB_DP', 'D-': 'USB_DN' }
  return isHeader ? { 1: 'USB_DN', 2: 'USB_DP', 3: 'VUSB', 4: 'GND' } : { ...base, CC1: 'CC1', CC2: 'CC2' }
}

function usefulPinMap(pinMap) {
  if (!pinMap || !Object.keys(pinMap).length) return null
  return Object.values(pinMap).some(Boolean) ? pinMap : null
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
