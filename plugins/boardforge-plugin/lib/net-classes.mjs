export const netClassProfiles = {
  DEFAULT: { traceWidthMm: 0.15, clearanceMm: 0.15, viaDiameterMm: 0.45, viaDrillMm: 0.2, layerPreference: ['F.Cu', 'B.Cu'], priority: 50 },
  POWER_LOW_CURRENT: { traceWidthMm: 0.3, clearanceMm: 0.18, viaDiameterMm: 0.6, viaDrillMm: 0.3, layerPreference: ['F.Cu', 'B.Cu'], priority: 80 },
  POWER_HIGH_CURRENT: { traceWidthMm: 0.8, clearanceMm: 0.25, viaDiameterMm: 0.8, viaDrillMm: 0.4, layerPreference: ['F.Cu', 'B.Cu'], priority: 95 },
  USB_DIFF: { traceWidthMm: 0.18, clearanceMm: 0.15, viaDiameterMm: 0.45, viaDrillMm: 0.2, differentialPairGapMm: 0.15, differentialPairWidthMm: 0.18, layerPreference: ['F.Cu'], priority: 90 },
  ETHERNET_DIFF: { traceWidthMm: 0.18, clearanceMm: 0.15, viaDiameterMm: 0.45, viaDrillMm: 0.2, differentialPairGapMm: 0.16, differentialPairWidthMm: 0.18, layerPreference: ['F.Cu'], priority: 90 },
  CAN_DIFF: { traceWidthMm: 0.2, clearanceMm: 0.15, viaDiameterMm: 0.45, viaDrillMm: 0.2, differentialPairGapMm: 0.18, differentialPairWidthMm: 0.2, layerPreference: ['F.Cu', 'B.Cu'], priority: 75 },
  RS485_DIFF: { traceWidthMm: 0.2, clearanceMm: 0.15, viaDiameterMm: 0.45, viaDrillMm: 0.2, differentialPairGapMm: 0.18, differentialPairWidthMm: 0.2, layerPreference: ['F.Cu', 'B.Cu'], priority: 75 },
  LVDS_DIFF: { traceWidthMm: 0.16, clearanceMm: 0.15, viaDiameterMm: 0.45, viaDrillMm: 0.2, differentialPairGapMm: 0.14, differentialPairWidthMm: 0.16, layerPreference: ['F.Cu'], priority: 92 },
  MIPI_DIFF: { traceWidthMm: 0.12, clearanceMm: 0.12, viaDiameterMm: 0.4, viaDrillMm: 0.18, differentialPairGapMm: 0.12, differentialPairWidthMm: 0.12, layerPreference: ['F.Cu'], priority: 96 },
  PCIe_DIFF: { traceWidthMm: 0.13, clearanceMm: 0.13, viaDiameterMm: 0.4, viaDrillMm: 0.18, differentialPairGapMm: 0.13, differentialPairWidthMm: 0.13, layerPreference: ['F.Cu', 'In3.Cu'], priority: 96 },
  SPI: { traceWidthMm: 0.15, clearanceMm: 0.15, viaDiameterMm: 0.45, viaDrillMm: 0.2, layerPreference: ['F.Cu'], priority: 60 },
  I2C: { traceWidthMm: 0.15, clearanceMm: 0.15, viaDiameterMm: 0.45, viaDrillMm: 0.2, layerPreference: ['F.Cu', 'B.Cu'], priority: 55 },
  UART: { traceWidthMm: 0.15, clearanceMm: 0.15, viaDiameterMm: 0.45, viaDrillMm: 0.2, layerPreference: ['F.Cu', 'B.Cu'], priority: 50 },
  CLOCK: { traceWidthMm: 0.15, clearanceMm: 0.18, viaDiameterMm: 0.45, viaDrillMm: 0.2, layerPreference: ['F.Cu'], priority: 85 },
  CRYSTAL: { traceWidthMm: 0.15, clearanceMm: 0.2, viaDiameterMm: 0.45, viaDrillMm: 0.2, layerPreference: ['F.Cu'], priority: 88, maxLengthMm: 12 },
  RF: { traceWidthMm: 0.25, clearanceMm: 0.25, viaDiameterMm: 0.45, viaDrillMm: 0.2, layerPreference: ['F.Cu'], priority: 95 },
  ANTENNA: { traceWidthMm: 0.25, clearanceMm: 0.3, viaDiameterMm: 0.45, viaDrillMm: 0.2, layerPreference: ['F.Cu'], priority: 98 },
  MOTOR_PHASE: { traceWidthMm: 1.2, clearanceMm: 0.35, viaDiameterMm: 0.9, viaDrillMm: 0.45, layerPreference: ['F.Cu', 'B.Cu'], priority: 98 },
  BATTERY: { traceWidthMm: 1.0, clearanceMm: 0.35, viaDiameterMm: 0.9, viaDrillMm: 0.45, layerPreference: ['F.Cu', 'B.Cu'], priority: 99 },
  HIGH_VOLTAGE: { traceWidthMm: 0.6, clearanceMm: 0.8, viaDiameterMm: 0.8, viaDrillMm: 0.4, layerPreference: ['F.Cu', 'B.Cu'], priority: 99 },
  SWITCHING_NODE: { traceWidthMm: 0.6, clearanceMm: 0.35, viaDiameterMm: 0.7, viaDrillMm: 0.35, layerPreference: ['F.Cu'], priority: 94, maxLengthMm: 20 },
  ISOLATION_BOUNDARY: { traceWidthMm: 0.25, clearanceMm: 1.0, viaDiameterMm: 0.6, viaDrillMm: 0.3, layerPreference: ['F.Cu', 'B.Cu'], priority: 99 },
  GROUND: { traceWidthMm: 0.3, clearanceMm: 0.15, viaDiameterMm: 0.5, viaDrillMm: 0.25, layerPreference: ['In1.Cu', 'B.Cu'], priority: 100 },
  ANALOG: { traceWidthMm: 0.15, clearanceMm: 0.2, viaDiameterMm: 0.45, viaDrillMm: 0.2, layerPreference: ['F.Cu'], priority: 70 },
  SENSOR: { traceWidthMm: 0.15, clearanceMm: 0.18, viaDiameterMm: 0.45, viaDrillMm: 0.2, layerPreference: ['F.Cu'], priority: 65 },
  RESET: { traceWidthMm: 0.15, clearanceMm: 0.15, viaDiameterMm: 0.45, viaDrillMm: 0.2, layerPreference: ['F.Cu', 'B.Cu'], priority: 68 },
  BOOT: { traceWidthMm: 0.15, clearanceMm: 0.15, viaDiameterMm: 0.45, viaDrillMm: 0.2, layerPreference: ['F.Cu', 'B.Cu'], priority: 62 },
  DEBUG: { traceWidthMm: 0.15, clearanceMm: 0.15, viaDiameterMm: 0.45, viaDrillMm: 0.2, layerPreference: ['F.Cu', 'B.Cu'], priority: 58 },
}

const rules = [
  [/^(GND|AGND|DGND|GNDA|GROUND)$/i, 'GROUND'],
  [/^(VBAT|BAT|BATT|BATT\+|PACK\+|VMAIN)$/i, 'BATTERY'],
  [/^(HV|HVIN|PWR_HV|MAINS|LINE|NEUTRAL|POE_VDD|POE_RTN)/i, 'HIGH_VOLTAGE'],
  [/^(VIN|VBUS|5V|3V3|3\.3V|1V8|VCC|VDD|VUSB)$/i, 'POWER_LOW_CURRENT'],
  [/^(USB[_-]?(DP|D\+)|D\+)$/i, 'USB_DIFF'],
  [/^(USB[_-]?(DN|D-)|D-)$/i, 'USB_DIFF'],
  [/^(ETH|ENET|RJ45).*?(TX|RX).*?[PN]$/i, 'ETHERNET_DIFF'],
  [/^(ETH|ENET|RJ45).*?(TX|RX).*(\+|-)$/i, 'ETHERNET_DIFF'],
  [/^CAN[_-]?[HL]$/i, 'CAN_DIFF'],
  [/^(RS485|485|MODBUS).*?([AB]|\+|-)$/i, 'RS485_DIFF'],
  [/^LVDS.*?([PN]|\+|-)$/i, 'LVDS_DIFF'],
  [/^(MIPI|CSI|DSI).*?([PN]|\+|-)$/i, 'MIPI_DIFF'],
  [/^(PCIE|PCIe|PCI-E).*?(TX|RX).*?([PN]|\+|-)$/i, 'PCIe_DIFF'],
  [/^(SCK|MISO|MOSI|CS|SPI)/i, 'SPI'],
  [/^(SDA|SCL|I2C)/i, 'I2C'],
  [/^(TX|RX|UART)/i, 'UART'],
  [/^(XTAL|OSC|CLK)/i, 'CRYSTAL'],
  [/^(SWDIO|SWCLK|JTMS|JTCK|JTAG|DEBUG)/i, 'DEBUG'],
  [/^(NRST|RESET|RST)$/i, 'RESET'],
  [/^(BOOT|BOOT0|BOOT1)$/i, 'BOOT'],
  [/^(ANT|ANTENNA)/i, 'ANTENNA'],
  [/^(RF)/i, 'RF'],
  [/^(SW|LX|PH|PHASE_NODE|BOOTSTRAP)$/i, 'SWITCHING_NODE'],
  [/^(MOTOR|PHASE|U_PHASE|V_PHASE|W_PHASE|PHASE_[ABC]|OUT_[UVW])/i, 'MOTOR_PHASE'],
  [/^(ISO|ISOLATION|PRIMARY|SECONDARY)/i, 'ISOLATION_BOUNDARY'],
  [/^(ADC|ANALOG|SENSE)/i, 'ANALOG'],
  [/^(IMU|BARO|SENSOR)/i, 'SENSOR'],
]

export function createNetClasses(profile) {
  return Object.entries(netClassProfiles).map(([name, values]) => ({
    name,
    ...values,
    traceWidthMm: Math.max(values.traceWidthMm, profile.minTraceWidthMm),
    clearanceMm: Math.max(values.clearanceMm, profile.minClearanceMm),
    viaDiameterMm: Math.max(values.viaDiameterMm, profile.minViaDiameterMm),
    viaDrillMm: Math.max(values.viaDrillMm, profile.minViaDrillMm),
  }))
}

export const classifyNet = (name) => rules.find(([pattern]) => pattern.test(name))?.[1] || 'DEFAULT'
export const assignNetsToClasses = (nets) => nets.map((net) => ({ ...net, className: net.className || classifyNet(net.name) }))

export function validateNetClasses(nets) {
  const issues = []
  for (const net of nets) {
    const className = net.className || classifyNet(net.name)
    if (!netClassProfiles[className]) issues.push({ severity: 'ERROR', code: 'UNKNOWN_NET_CLASS', message: `${net.name} has unknown net class ${className}` })
    if (/USB.*(DP|DN|D\+|D-)/i.test(net.name) && className !== 'USB_DIFF') issues.push({ severity: 'ERROR', code: 'USB_DIFF_UNCLASSIFIED', message: `${net.name} must use USB_DIFF net class` })
    if (/(VBAT|BAT|MOTOR|PHASE)/i.test(net.name) && !['BATTERY', 'MOTOR_PHASE', 'POWER_HIGH_CURRENT'].includes(className)) issues.push({ severity: 'ERROR', code: 'POWER_TOO_THIN_RISK', message: `${net.name} needs a high-current net class` })
  }
  return issues
}
