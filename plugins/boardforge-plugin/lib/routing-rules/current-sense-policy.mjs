export const escCurrentSensePolicy = Object.freeze({
  roles: ['CURRENT_SENSE_KELVIN', 'CURRENT_SENSE_REFERENCE', 'ANALOG_SENSE'],
  required: [
    'protect_kelvin_relationship',
    'route_on_quiet_layer_or_corridor',
    'avoid_motor_phase_vbat_switching_copper',
    'avoid_noisy_return_path',
    'minimize_loop_area',
    'avoid_unnecessary_vias',
  ],
  preferredLayers: ['In5.Cu', 'In3.Cu', 'B.Cu'],
  rejectNearRoles: ['MOTOR_PHASE', 'SWITCHING_NODE', 'HIGH_CURRENT_POWER'],
})

export function getEscCurrentSensePolicy() {
  return escCurrentSensePolicy
}
