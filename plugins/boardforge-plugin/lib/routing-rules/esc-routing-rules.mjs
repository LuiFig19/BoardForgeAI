import { getEscLayerRolePolicy } from './layer-role-policy.mjs'
import { getEscViaPolicy, selectViaClassForNetRole } from './via-policy.mjs'
import { getEscHighCurrentPolicy, isHighCurrentRole } from './high-current-policy.mjs'
import { getEscGateDrivePolicy } from './gate-drive-policy.mjs'
import { getEscCurrentSensePolicy } from './current-sense-policy.mjs'
import { buildHighDensityRoutePolicy, classifyEscRouteNet } from '../high-density-esc-router.mjs'

export function getEscRoutingRules() {
  return {
    boardTypes: ['ESC', 'motor-controller', 'dense-mixed-signal', 'flight-controller'],
    layerPolicy: getEscLayerRolePolicy(),
    viaPolicy: getEscViaPolicy(),
    highCurrentPolicy: getEscHighCurrentPolicy(),
    gateDrivePolicy: getEscGateDrivePolicy(),
    currentSensePolicy: getEscCurrentSensePolicy(),
    retainedCopperPolicy: {
      routeOneNetAtATime: true,
      updateObstacleMapAfterCommit: true,
      rollbackOnlyFailedCandidate: true,
      preserveCommittedCopper: true,
    },
    blockedNetPolicy: {
      requireExactSourceTarget: true,
      requireExactReason: true,
      continueAfterBlockedNet: true,
    },
  }
}

export function buildEscRouteDecision(netName = '', context = {}) {
  const netRole = classifyEscRouteNet(netName, context)
  const highDensity = buildHighDensityRoutePolicy({ net: netName, ...context })
  return {
    net: netName,
    netRole,
    layerPreference: highDensity.layerPreference,
    viaClass: selectViaClassForNetRole(netRole),
    highCurrent: isHighCurrentRole(netRole),
    rules: getEscRoutingRules(),
  }
}

export function applyEscRoutingRulesToBoardContext(boardContext = {}) {
  const rules = getEscRoutingRules()
  const nets = boardContext.nets || boardContext.netNames || []
  return {
    ...boardContext,
    routingRules: rules,
    netDecisions: nets.map((net) => buildEscRouteDecision(net.name || net.net || net, net)),
  }
}
