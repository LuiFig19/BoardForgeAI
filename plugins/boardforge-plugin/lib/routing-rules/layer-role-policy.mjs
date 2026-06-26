export const escEightLayerPolicy = Object.freeze({
  'F.Cu': {
    role: 'components_short_critical_routes',
    preferredFor: ['GATE_DRIVE', 'BOOTSTRAP', 'LOCAL_PAD_ESCAPE'],
    avoidFor: ['LONG_SENSITIVE_SIGNAL'],
  },
  'In1.Cu': {
    role: 'gnd_pgnd_reference',
    preferredFor: ['GND', 'PGND', 'RETURN_PATH'],
    avoidFor: ['MOTOR_PHASE', 'SWITCHING_NODE'],
  },
  'In2.Cu': {
    role: 'vbat_vin_high_current_power_support',
    preferredFor: ['HIGH_CURRENT_POWER', 'VBAT', 'VIN'],
    avoidFor: ['CURRENT_SENSE_KELVIN', 'RF_OR_CLOCK', 'SWD_DEBUG', 'I2C'],
  },
  'In3.Cu': {
    role: 'control_signal',
    preferredFor: ['LOW_SPEED_SIGNAL', 'I2C', 'SWD_DEBUG', 'UART', 'SPI'],
    avoidFor: ['MOTOR_PHASE'],
  },
  'In4.Cu': {
    role: 'regulated_rails',
    preferredFor: ['REGULATED_RAIL', 'VREG3V3', 'VREG5', 'VREG12'],
    avoidFor: ['SWITCHING_NODE'],
  },
  'In5.Cu': {
    role: 'protected_sense_kelvin_control',
    preferredFor: ['CURRENT_SENSE_KELVIN', 'ANALOG_SENSE', 'CURRENT_SENSE_REFERENCE'],
    avoidFor: ['HIGH_CURRENT_POWER', 'MOTOR_PHASE', 'SWITCHING_NODE'],
  },
  'In6.Cu': {
    role: 'gnd_return_shield',
    preferredFor: ['GND', 'PGND', 'RETURN_PATH', 'SHIELDING'],
    avoidFor: ['MOTOR_PHASE'],
  },
  'B.Cu': {
    role: 'support_secondary_power_low_speed',
    preferredFor: ['LOW_SPEED_SIGNAL', 'SUPPORT_ROUTE', 'SECONDARY_POWER'],
    avoidFor: [],
  },
})

export function getEscLayerRolePolicy() {
  return escEightLayerPolicy
}

export function preferredLayersForNetRole(netRole = 'LOW_SPEED_SIGNAL') {
  const role = String(netRole).toUpperCase()
  return Object.entries(escEightLayerPolicy)
    .filter(([, policy]) => policy.preferredFor.includes(role))
    .map(([layer]) => layer)
}
