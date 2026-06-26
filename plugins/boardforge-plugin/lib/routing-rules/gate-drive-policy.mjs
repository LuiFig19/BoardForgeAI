export const escGateDrivePolicy = Object.freeze({
  roles: ['GATE_DRIVE', 'BOOTSTRAP'],
  gateDrive: [
    'keep_loops_short',
    'keep_gate_resistors_close_to_gates',
    'avoid_motor_phase_and_vbat_copper',
    'prefer_local_layers',
    'avoid_unnecessary_vias',
  ],
  bootstrap: [
    'keep_bootstrap_path_short',
    'keep_bootstrap_cap_driver_relationship_intact',
    'avoid_unnecessary_layer_changes',
    'avoid_noise_coupling_to_sense_control',
  ],
  preferredLayers: ['F.Cu', 'B.Cu', 'In3.Cu'],
})

export function getEscGateDrivePolicy() {
  return escGateDrivePolicy
}
