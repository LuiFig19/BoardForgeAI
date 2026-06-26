export const escViaPolicy = Object.freeze({
  forbiddenTypes: ['blind', 'buried', 'microvia', 'via-in-pad'],
  classes: {
    signal: { type: 'through', drillMm: 0.2, diameterMm: 0.45, purpose: 'manufacturable_signal_transition' },
    power: { type: 'through', drillMm: 0.3, diameterMm: 0.65, purpose: 'current_sharing_power_transition' },
    stitching: { type: 'through', drillMm: 0.25, diameterMm: 0.55, purpose: 'gnd_pgnd_reference_stitching' },
    sense: { type: 'through', drillMm: 0.2, diameterMm: 0.45, purpose: 'quiet_sense_transition' },
  },
  checks: [
    'drill_size_legal',
    'annular_ring_legal',
    'clearance_legal',
    'not_in_keepout',
    'not_in_mounting_hole_keepout',
    'not_in_pad',
    'correct_net',
  ],
})

export function getEscViaPolicy() {
  return escViaPolicy
}

export function selectViaClassForNetRole(netRole = 'LOW_SPEED_SIGNAL') {
  const role = String(netRole).toUpperCase()
  if (['HIGH_CURRENT_POWER', 'MOTOR_PHASE', 'SWITCHING_NODE', 'PGND'].includes(role)) return escViaPolicy.classes.power
  if (['GND', 'RETURN_PATH'].includes(role)) return escViaPolicy.classes.stitching
  if (['CURRENT_SENSE_KELVIN', 'CURRENT_SENSE_REFERENCE', 'ANALOG_SENSE'].includes(role)) return escViaPolicy.classes.sense
  return escViaPolicy.classes.signal
}

export function isForbiddenViaType(via = {}) {
  const type = String(via.type || via.viaType || '').toLowerCase()
  return escViaPolicy.forbiddenTypes.includes(type)
}
