export const escHighCurrentPolicy = Object.freeze({
  roles: ['HIGH_CURRENT_POWER', 'MOTOR_PHASE', 'SWITCHING_NODE', 'PGND'],
  required: [
    'wide_copper_or_zone',
    'current_capable_corridor',
    'through_via_array_for_layer_change',
    'avoid_board_edge_and_mounting_holes',
    'avoid_unrelated_sensitive_nets',
    'no_thin_signal_trace_for_power',
  ],
  preferredLayers: {
    HIGH_CURRENT_POWER: ['In2.Cu', 'F.Cu', 'B.Cu'],
    MOTOR_PHASE: ['F.Cu', 'B.Cu', 'In2.Cu'],
    SWITCHING_NODE: ['F.Cu', 'B.Cu', 'In2.Cu'],
    PGND: ['In1.Cu', 'In6.Cu', 'F.Cu', 'B.Cu'],
  },
  acceptanceEvidence: ['width_used', 'layer_used', 'via_count', 'current_sharing_reason', 'parallel_copper_or_zone', 'drc_result'],
})

export function getEscHighCurrentPolicy() {
  return escHighCurrentPolicy
}

export function isHighCurrentRole(netRole = '') {
  return escHighCurrentPolicy.roles.includes(String(netRole).toUpperCase())
}
