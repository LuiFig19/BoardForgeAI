export function synthesizePinMapFromAssets(component = {}, nets = [], options = {}) {
  const existing = component.pinMap || {}
  const pads = footprintPads(component)
  const pins = symbolPins(component)
  const netNames = new Set((nets || []).map((net) => typeof net === 'string' ? net : net.name).filter(Boolean))
  const aliases = buildAliasTable(component, netNames, options)
  const pinMap = { ...existing }
  const evidence = []
  const candidates = pads.length ? pads : pins.map((pin) => ({ name: pin.number || pin.name, aliases: [pin.name, pin.number] }))
  for (const candidate of candidates) {
    const padName = String(candidate.name || candidate.number || '').trim()
    if (!padName || pinMap[padName]) continue
    const match = bestNetForPad(candidate, aliases)
    if (!match) continue
    pinMap[padName] = match.net
    evidence.push({ pad: padName, net: match.net, reason: match.reason, confidence: match.confidence })
  }
  const supplemented = addGroupFallbacks(component, pinMap, netNames, { hasMetadata: pads.length > 0 || pins.length > 0 || Object.keys(existing).length > 0 })
  evidence.push(...supplemented.evidence)
  return {
    pinMap: supplemented.pinMap,
    evidence,
    status: evidence.length ? 'PIN_MAP_SYNTHESIZED_NEEDS_REVIEW' : Object.keys(existing).length ? 'PIN_MAP_EXISTING_USED' : 'PIN_MAP_SYNTHESIS_NO_MATCH',
    synthesizedCount: evidence.length,
    humanReviewRequired: true,
  }
}

function footprintPads(component) {
  const footprint = component.footprint
  if (footprint && typeof footprint === 'object' && Array.isArray(footprint.pads)) return footprint.pads
  if (Array.isArray(component.pads)) return component.pads
  return []
}

function symbolPins(component) {
  const symbol = component.symbol
  if (symbol && typeof symbol === 'object' && Array.isArray(symbol.pins)) return symbol.pins
  if (Array.isArray(component.symbolPins)) return component.symbolPins
  return []
}

function buildAliasTable(component, netNames, options) {
  const group = String(component.group || component.value || '').toUpperCase()
  const table = [
    net('GND', ['GND', 'VSS', 'PGND', 'AGND', 'DGND', 'PAD', 'EP', 'EXP', 'THERMAL'], 100),
    net('3V3', ['3V3', 'VDD', 'VCC', 'VDDIO', 'VDDA', 'VDDD', 'VBAT'], 92),
    net('5V', ['5V', 'VCC5', 'VBUS_5V'], 80),
    net('VUSB', ['VBUS', 'VUSB', 'USB_VBUS', 'A4', 'B4', 'A9', 'B9'], 95),
    net('VIN', ['VIN', 'IN', 'INPUT', 'DCIN', 'VRAW'], 86),
    net('USB_DP', ['D+', 'DP', 'USB_DP', 'USBDP', 'USB_P', 'A6', 'B6'], 96),
    net('USB_DN', ['D-', 'DM', 'DN', 'USB_DN', 'USBDM', 'USB_N', 'A7', 'B7'], 96),
    net('CC1', ['CC1', 'A5'], 94),
    net('CC2', ['CC2', 'B5'], 94),
    net('I2C_SCL', ['SCL', 'SCK_I2C', 'I2C_SCL'], 88),
    net('I2C_SDA', ['SDA', 'I2C_SDA'], 88),
    net('SPI_MOSI', ['MOSI', 'SDI', 'DIN'], 82),
    net('SPI_MISO', ['MISO', 'SDO', 'DOUT'], 82),
    net('SPI_SCK', ['SCK', 'SCLK', 'CLK'], 82),
    net('UART_TX', ['TX', 'TXD', 'UART_TX'], 78),
    net('UART_RX', ['RX', 'RXD', 'UART_RX'], 78),
    net('SWDIO', ['SWDIO', 'DIO', 'TMS'], 88),
    net('SWCLK', ['SWCLK', 'SWDCLK', 'CLK', 'TCK'], 84),
    net('NRST', ['NRST', 'RESET', 'RST'], 82),
    net('EN', ['EN', 'ENABLE', 'CHIP_EN', 'CHIP_PU'], 82),
    net('BOOT', ['BOOT', 'BOOT0', 'IO0', 'GPIO0'], 82),
    net('ETH_TX_P', ['TX+', 'TXP', 'TD+', 'ETH_TX_P'], 90),
    net('ETH_TX_N', ['TX-', 'TXN', 'TD-', 'ETH_TX_N'], 90),
    net('ETH_RX_P', ['RX+', 'RXP', 'RD+', 'ETH_RX_P'], 90),
    net('ETH_RX_N', ['RX-', 'RXN', 'RD-', 'ETH_RX_N'], 90),
    net('CAN_H', ['CANH', 'CAN_H'], 88),
    net('CAN_L', ['CANL', 'CAN_L'], 88),
    net('RS485_A', ['A', 'RS485_A', '485A'], 78),
    net('RS485_B', ['B', 'RS485_B', '485B'], 78),
    net('SW', ['SW', 'LX', 'PH', 'PHASE'], 78),
    net('VOUT', ['VOUT', 'OUT', 'OUTPUT'], 78),
  ]
  if (group.includes('REGULATOR') || group.includes('LDO') || group.includes('BUCK')) {
    table.push(net('3V3', ['OUT', 'VOUT', 'FB'], 86), net(options.powerInput || 'VUSB', ['IN', 'VIN'], 90))
  }
  return table.filter((item) => netNames.size === 0 || netNames.has(item.net) || alwaysAllowed(item.net))
}

function net(netName, aliases, confidence) {
  return { net: netName, aliases: aliases.map(normalize), confidence }
}

function bestNetForPad(candidate, aliases) {
  const names = [candidate.name, candidate.number, candidate.pin, ...(candidate.aliases || [])].filter(Boolean).map(normalize)
  let best = null
  for (const entry of aliases) {
    const hit = names.find((name) => entry.aliases.includes(name))
    if (!hit) continue
    const score = entry.confidence + (hit.length > 1 ? 3 : 0)
    if (!best || score > best.score) best = { net: entry.net, reason: `matched ${hit}`, confidence: entry.confidence, score }
  }
  return best
}

function addGroupFallbacks(component, pinMap, netNames, options = {}) {
  const next = { ...pinMap }
  const evidence = []
  if (!options.hasMetadata) return { pinMap: next, evidence }
  const group = String(component.group || '').toUpperCase()
  const add = (pin, net, reason) => {
    if (next[pin]) return
    if (netNames.size && !netNames.has(net) && !alwaysAllowed(net)) return
    next[pin] = net
    evidence.push({ pad: pin, net, reason, confidence: 70 })
  }
  if (group === 'CAP' || group === 'RES' || group === 'INDUCTOR') {
    if (component.netA || component.netB) {
      add('1', component.netA, 'two-terminal netA')
      add('2', component.netB, 'two-terminal netB')
    }
  }
  if (group.includes('USB') && !Object.values(next).includes('GND')) add('A1', 'GND', 'USB ground fallback')
  if (group.includes('USB') && !Object.values(next).includes('VUSB')) add('A4', 'VUSB', 'USB VBUS fallback')
  return { pinMap: next, evidence }
}

function alwaysAllowed(netName) {
  return /^(GND|3V3|5V|VUSB|VIN|VBAT|EN|BOOT|NRST|CC1|CC2)$/.test(netName)
}

function normalize(value) {
  return String(value || '').trim().toUpperCase().replace(/\s+/g, '').replace(/_/g, '')
}
