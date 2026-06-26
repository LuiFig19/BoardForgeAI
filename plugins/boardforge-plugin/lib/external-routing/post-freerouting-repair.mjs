import fs from 'node:fs';
import path from 'node:path';

const ROUTE_BLOCK_RE = /^\s*\((segment|via)\s*$/;

export function classifyPostFreeRoutingDrc(drcReport) {
  const violations = Array.isArray(drcReport?.violations) ? drcReport.violations : [];
  const families = new Map();

  for (const violation of violations) {
    const type = violation.type || violation.code || 'unknown';
    const family = families.get(type) || {
      type,
      count: 0,
      generatedBySesImport: 0,
      footprintOrLibraryReview: 0,
      safeAutoRepair: false,
      needsLocalReroute: false,
      examples: [],
    };

    family.count += 1;
    const descriptions = (violation.items || []).map((item) => item.description || '').join(' | ');
    const routeOwned = /\bTrack\b|\bVia\b/.test(descriptions);
    const footprintOwned = /\bpad\b|\bPTH pad\b|\bSMD pad\b|\bcourtyard\b|\bsilkscreen\b/i.test(descriptions) && !routeOwned;

    if (routeOwned) family.generatedBySesImport += 1;
    if (footprintOwned) family.footprintOrLibraryReview += 1;
    if (['track_width', 'via_diameter'].includes(type)) family.safeAutoRepair = true;
    if (type === 'drill_out_of_range' && /\bVia\b/.test(descriptions)) family.safeAutoRepair = true;
    if (['clearance', 'copper_edge_clearance'].includes(type) && routeOwned) family.needsLocalReroute = true;
    if (family.examples.length < 5) {
      family.examples.push({
        description: violation.description || '',
        items: (violation.items || []).map((item) => item.description || ''),
      });
    }

    families.set(type, family);
  }

  return {
    totalViolations: violations.length,
    families: [...families.values()].sort((a, b) => b.count - a.count),
  };
}

export function repairImportedRouteDimensions(pcbText, options = {}) {
  const minTrackWidth = options.minTrackWidth ?? 0.2;
  const minViaDiameter = options.minViaDiameter ?? 0.5;
  const minViaDrill = options.minViaDrill ?? 0.3;
  const lines = pcbText.split(/\r?\n/);
  const out = [];
  const stats = {
    segmentsSeen: 0,
    viasSeen: 0,
    trackWidthsRepaired: 0,
    viaDiametersRepaired: 0,
    viaDrillsRepaired: 0,
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const match = line.match(ROUTE_BLOCK_RE);
    if (!match) {
      out.push(line);
      continue;
    }

    const kind = match[1];
    const block = [line];
    let depth = parenDelta(line);
    while (index + 1 < lines.length && depth > 0) {
      index += 1;
      block.push(lines[index]);
      depth += parenDelta(lines[index]);
    }

    if (kind === 'segment') {
      stats.segmentsSeen += 1;
      out.push(...repairSegmentBlock(block, minTrackWidth, stats));
    } else {
      stats.viasSeen += 1;
      out.push(...repairViaBlock(block, minViaDiameter, minViaDrill, stats));
    }
  }

  return {
    pcbText: out.join('\n'),
    ...stats,
  };
}

export function repairImportedRouteDimensionsFile({ inputPath, outputPath, options = {} }) {
  const input = fs.readFileSync(inputPath, 'utf8');
  const result = repairImportedRouteDimensions(input, options);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, result.pcbText);
  const { pcbText: _pcbText, ...summary } = result;
  return summary;
}

export function scanForbiddenViasInPcbText(pcbText = '') {
  const forbidden = [];
  const lines = String(pcbText).split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!/^\s*\(via\b/.test(line)) continue;

    const block = [line];
    let depth = parenDelta(line);
    while (index + 1 < lines.length && depth > 0) {
      index += 1;
      block.push(lines[index]);
      depth += parenDelta(lines[index]);
    }

    const viaText = block.join('\n');
    const match = viaText.match(/\b(blind|buried|microvia|via-in-pad)\b/i);
    if (match) {
      forbidden.push({
        line: index - block.length + 2,
        uuid: parseUuid(block),
        type: match[1],
      });
    }
  }
  return forbidden;
}

export function mutateSegmentDoglegByUuid(pcbText, uuid, options = {}) {
  const offsetMm = options.offsetMm ?? 0.3;
  const lines = pcbText.split(/\r?\n/);
  const out = [];
  let mutated = false;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const match = line.match(ROUTE_BLOCK_RE);
    if (!match || match[1] !== 'segment') {
      out.push(line);
      continue;
    }

    const block = [line];
    let depth = parenDelta(line);
    while (index + 1 < lines.length && depth > 0) {
      index += 1;
      block.push(lines[index]);
      depth += parenDelta(lines[index]);
    }

    if (mutated || !block.some((blockLine) => blockLine.includes(uuid))) {
      out.push(...block);
      continue;
    }

    const segment = parseSegmentBlock(block);
    if (!segment) {
      out.push(...block);
      continue;
    }

    const dogleg = buildDoglegSegments(segment, offsetMm, options.direction);
    out.push(...dogleg.flatMap(formatSegmentBlock));
    mutated = true;
  }

  return {
    pcbText: out.join('\n'),
    mutated,
    uuid,
    offsetMm,
  };
}

export function mutateSegmentDoglegFile({ inputPath, outputPath, uuid, options = {} }) {
  const input = fs.readFileSync(inputPath, 'utf8');
  const result = mutateSegmentDoglegByUuid(input, uuid, options);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, result.pcbText);
  const { pcbText: _pcbText, ...summary } = result;
  return summary;
}

export function buildLegalSiteMapForPostRouteRepair(pcbText, options = {}) {
  const routeObjects = parseRouteObjects(pcbText);
  const boardBounds = parseBoardBounds(pcbText, options.boardMarginMm ?? 0.5);
  const clearanceMm = options.clearanceMm ?? 0.2;
  const padKeepoutMm = options.padKeepoutMm ?? 0.25;
  const obstacles = [
    ...routeObjects.vias.map((via) => ({
      type: 'via',
      uuid: via.uuid,
      net: via.net,
      layer: 'through',
      point: via.at,
      radius: (via.size || 0.5) / 2 + clearanceMm,
    })),
    ...routeObjects.segments.map((segment) => ({
      type: 'segment',
      uuid: segment.uuid,
      net: segment.net,
      layer: segment.layer,
      start: segment.start,
      end: segment.end,
      radius: (segment.width || 0.2) / 2 + clearanceMm,
    })),
    ...parsePadObstacles(pcbText).map((pad) => ({
      type: 'pad',
      uuid: pad.uuid,
      net: pad.net,
      layer: pad.layer,
      point: pad.at,
      radius: pad.radius + padKeepoutMm,
    })),
  ];

  function evaluateSite(site, context = {}) {
    const point = { x: Number(site.x), y: Number(site.y) };
    const layer = site.layer || context.layer || 'F.Cu';
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      return illegalSite(site, 'site coordinate is not finite');
    }
    if (!pointInBounds(point, boardBounds)) {
      return illegalSite(site, 'site outside board bounds or copper edge clearance');
    }
    const sameNet = context.net || site.net || '';
    const ignoreUuids = new Set(context.ignoreUuids || []);
    let nearestObstacle = null;
    let clearanceMarginMm = Infinity;

    for (const obstacle of obstacles) {
      if (ignoreUuids.has(obstacle.uuid)) continue;
      if (obstacle.net && sameNet && obstacle.net === sameNet && context.allowSameNet !== false) continue;
      if (obstacle.layer && obstacle.layer !== 'through' && layer !== 'through' && obstacle.layer !== layer) continue;
      const distance = obstacle.start
        ? distancePointToSegment(point, obstacle.start, obstacle.end) - obstacle.radius
        : Math.hypot(point.x - obstacle.point.x, point.y - obstacle.point.y) - obstacle.radius;
      if (distance < clearanceMarginMm) {
        clearanceMarginMm = distance;
        nearestObstacle = obstacle;
      }
      if (distance < 0) {
        return {
          ...site,
          layer,
          legal: false,
          clearanceMarginMm: Number(distance.toFixed(4)),
          nearestObstacle: obstacle.uuid || obstacle.type,
          reasonIfIllegal: `${obstacle.type} clearance`,
        };
      }
    }

    return {
      ...site,
      layer,
      legal: true,
      clearanceMarginMm: Number((Number.isFinite(clearanceMarginMm) ? clearanceMarginMm : 99).toFixed(4)),
      nearestObstacle: nearestObstacle?.uuid || nearestObstacle?.type || '',
      reasonIfIllegal: '',
    };
  }

  return {
    boardBounds,
    routeObjects,
    obstacles,
    evaluateSite,
  };
}

export function findNearestLegalThroughViaSite({ pcbText, uuid, seed, net, options = {} } = {}) {
  const map = buildLegalSiteMapForPostRouteRepair(pcbText, options);
  const via = uuid ? map.routeObjects.vias.find((item) => item.uuid === uuid) : null;
  const origin = seed || via?.at;
  if (!origin) return { found: false, reason: 'via seed not found', candidates: [] };
  const viaNet = net || via?.net || '';
  const candidates = rankLegalViaSites({
    map,
    origin,
    net: viaNet,
    ignoreUuids: [uuid].filter(Boolean),
    maxRadiusMm: options.maxRadiusMm ?? 2,
    stepMm: options.stepMm ?? 0.2,
  });
  const best = candidates.find((candidate) => candidate.legal);
  return {
    found: Boolean(best),
    site: best || null,
    candidates,
    reason: best ? '' : 'no legal through-via site found within search radius',
  };
}

export function rankLegalViaSites({ map, origin, net = '', ignoreUuids = [], maxRadiusMm = 2, stepMm = 0.2 } = {}) {
  const candidates = [];
  const angles = [0, 45, 90, 135, 180, 225, 270, 315].map((angle) => angle * Math.PI / 180);
  candidates.push(map.evaluateSite({ x: origin.x, y: origin.y, layer: 'through', net }, { net, layer: 'through', ignoreUuids }));
  for (let radius = stepMm; radius <= maxRadiusMm + 1e-9; radius += stepMm) {
    for (const angle of angles) {
      const raw = {
        x: origin.x + Math.cos(angle) * radius,
        y: origin.y + Math.sin(angle) * radius,
        layer: 'through',
        net,
      };
      const site = map.evaluateSite(raw, { net, layer: 'through', ignoreUuids });
      site.distanceMm = Number(radius.toFixed(4));
      candidates.push(site);
    }
  }
  return candidates.sort((a, b) => {
    if (a.legal !== b.legal) return a.legal ? -1 : 1;
    return (a.distanceMm || 0) - (b.distanceMm || 0) || (b.clearanceMarginMm || 0) - (a.clearanceMarginMm || 0);
  });
}

export function relocateImportedViaToLegalSite(pcbText, uuid, site, options = {}) {
  const map = buildLegalSiteMapForPostRouteRepair(pcbText, options);
  const via = map.routeObjects.vias.find((item) => item.uuid === uuid);
  if (!via) return { pcbText, relocated: false, reason: 'via not found', uuid };
  const legal = map.evaluateSite({ ...site, layer: 'through', net: via.net }, { net: via.net, layer: 'through', ignoreUuids: [uuid] });
  if (!legal.legal) return { pcbText, relocated: false, reason: legal.reasonIfIllegal, site: legal, uuid };

  const updated = replaceViaAtAndAttachedSegments(pcbText, via, { x: legal.x, y: legal.y }, options.attachToleranceMm ?? 0.03);
  return {
    pcbText: updated,
    relocated: true,
    uuid,
    from: via.at,
    to: { x: legal.x, y: legal.y },
    site: legal,
  };
}

export function findLegalDoglegWaypoints({ pcbText, uuid, obstacle, options = {} } = {}) {
  const map = buildLegalSiteMapForPostRouteRepair(pcbText, options);
  const segment = map.routeObjects.segments.find((item) => item.uuid === uuid);
  if (!segment) return { found: false, reason: 'segment not found', candidates: [] };
  const midpoint = obstacle?.pos || midpointOf(segment.start, segment.end);
  const dx = segment.end.x - segment.start.x;
  const dy = segment.end.y - segment.start.y;
  const length = Math.hypot(dx, dy) || 1;
  const perpendicular = { x: -dy / length, y: dx / length };
  const along = { x: dx / length, y: dy / length };
  const offsets = options.offsetsMm || [0.25, 0.4, 0.6, 0.8, 1.0, 1.4];
  const layers = options.layers || [segment.layer];
  const candidates = [];
  for (const layer of layers) {
    for (const offset of offsets) {
      for (const sign of [-1, 1]) {
        for (const slide of [0, -0.35, 0.35]) {
          const waypoint = {
            x: midpoint.x + perpendicular.x * offset * sign + along.x * slide,
            y: midpoint.y + perpendicular.y * offset * sign + along.y * slide,
            layer,
            net: segment.net,
          };
          const site = map.evaluateSite(waypoint, { net: segment.net, layer, ignoreUuids: [uuid], allowSameNet: true });
          const legA = scoreSegmentClearance(map, segment.start, site, segment.net, layer, [uuid]);
          const legB = scoreSegmentClearance(map, site, segment.end, segment.net, layer, [uuid]);
          candidates.push({
            ...site,
            waypoint: { x: site.x, y: site.y },
            offsetMm: offset,
            layer,
            legal: site.legal && legA.legal && legB.legal,
            clearanceMarginMm: Math.min(site.clearanceMarginMm, legA.clearanceMarginMm, legB.clearanceMarginMm),
            reasonIfIllegal: site.reasonIfIllegal || legA.reasonIfIllegal || legB.reasonIfIllegal,
          });
        }
      }
    }
  }
  candidates.sort((a, b) => {
    if (a.legal !== b.legal) return a.legal ? -1 : 1;
    return (b.clearanceMarginMm || 0) - (a.clearanceMarginMm || 0);
  });
  return {
    found: candidates.some((candidate) => candidate.legal),
    candidates,
    segment,
  };
}

export function rerouteSegmentThroughLegalWaypoints(pcbText, uuid, waypoints, options = {}) {
  const waypointList = Array.isArray(waypoints) ? waypoints : [waypoints];
  const lines = pcbText.split(/\r?\n/);
  const out = [];
  let rerouted = false;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const match = line.match(ROUTE_BLOCK_RE);
    if (!match || match[1] !== 'segment') {
      out.push(line);
      continue;
    }
    const block = [line];
    let depth = parenDelta(line);
    while (index + 1 < lines.length && depth > 0) {
      index += 1;
      block.push(lines[index]);
      depth += parenDelta(lines[index]);
    }
    if (rerouted || !block.some((blockLine) => blockLine.includes(uuid))) {
      out.push(...block);
      continue;
    }
    const segment = parseSegmentBlock(block);
    if (!segment) {
      out.push(...block);
      continue;
    }
    const points = [segment.start, ...waypointList.map((wp) => ({ x: Number(wp.x ?? wp.waypoint?.x), y: Number(wp.y ?? wp.waypoint?.y) })), segment.end];
    const layer = waypointList.find((wp) => wp.layer)?.layer || segment.layer;
    for (let i = 0; i < points.length - 1; i += 1) {
      out.push(...formatSegmentBlock({ ...segment, layer, start: points[i], end: points[i + 1] }));
    }
    rerouted = true;
  }
  return { pcbText: out.join('\n'), rerouted, uuid, waypoints: waypointList };
}

export function rankSegmentRepairCandidates({ pcbText, uuid, obstacle, options = {} } = {}) {
  const result = findLegalDoglegWaypoints({ pcbText, uuid, obstacle, options });
  return result.candidates || [];
}

export function preScorePostRouteRepairCandidate({ beforePcbText = '', candidatePcbText = '', cluster = {}, candidate = {}, baselineDrc = {}, options = {} } = {}) {
  const repairType = candidate.repairType || candidate.type || 'unknown';
  const targetFamily = cluster.family || candidate.targetFamily || 'unknown';
  const beforeObjects = parseRouteObjects(beforePcbText);
  const candidateObjects = parseRouteObjects(candidatePcbText);
  const candidateMap = buildLegalSiteMapForPostRouteRepair(candidatePcbText, options);
  const forbiddenVias = scanForbiddenViasInPcbText(candidatePcbText);
  const predictedCollateral = predictCandidateDrcDeltas({
    beforeObjects,
    candidateObjects,
    candidateMap,
    forbiddenVias,
    candidate,
    targetFamily,
    options,
  });
  const predictedTargetFamilyDelta = estimateTargetFamilyDelta({ targetFamily, candidate, candidateMap });
  const beforeScore = scoreDrcHealth(baselineDrc).score;
  const baselineCounts = normalizeDrcCounts(baselineDrc);
  const predictedTypes = { ...(baselineCounts.types || {}) };
  const familyDeltaMap = {
    shorting_items: predictedCollateral.shorting,
    tracks_crossing: predictedCollateral.tracks_crossing,
    clearance: predictedCollateral.clearance,
    solder_mask_bridge: predictedCollateral.solder_mask_bridge,
    copper_edge_clearance: predictedCollateral.copper_edge,
    hole_clearance: predictedCollateral.hole_clearance,
    forbidden_via: predictedCollateral.forbidden_via,
  };
  familyDeltaMap[targetFamily] = (familyDeltaMap[targetFamily] || 0) + predictedTargetFamilyDelta;
  for (const [family, delta] of Object.entries(familyDeltaMap)) {
    predictedTypes[family] = Math.max(0, (predictedTypes[family] || 0) + Number(delta || 0));
  }
  const predictedAfter = {
    types: predictedTypes,
    unconnected: (baselineCounts.unconnected || 0) + predictedCollateral.unconnected,
  };
  const predictedWeightedScoreDelta = scoreDrcHealth(predictedAfter).score - beforeScore;
  const rejection = firstPreScoreRejection(predictedCollateral, predictedWeightedScoreDelta, options);
  return {
    candidateId: candidate.candidateId || candidate.uuid || '',
    clusterId: cluster.clusterId || '',
    repairType,
    targetFamily,
    predictedTargetFamilyDelta,
    predictedCollateral,
    predictedWeightedScoreDelta,
    preScoreDecision: rejection ? 'reject_before_drc' : 'send_to_drc',
    reason: rejection || 'predicted weighted score improves with no critical collateral risk',
  };
}

export function predictCandidateDrcDeltas({ beforeObjects = {}, candidateObjects = {}, candidateMap = null, forbiddenVias = [], candidate = {}, targetFamily = '', options = {} } = {}) {
  const routeCountDelta = (candidateObjects.segments?.length || 0) + (candidateObjects.vias?.length || 0)
    - (beforeObjects.segments?.length || 0) - (beforeObjects.vias?.length || 0);
  const risk = {
    shorting: estimateShortingRisk({ candidateMap, candidate, options }),
    tracks_crossing: estimateTrackCrossingRisk({ routeCountDelta, candidate, options }),
    clearance: estimateLocalClearanceRisk({ candidateMap, candidate, options }),
    solder_mask_bridge: estimateSolderMaskRisk({ candidateMap, candidate, options }),
    copper_edge: estimateCopperEdgeRisk({ candidateMap, candidate, targetFamily, options }),
    hole_clearance: estimateHoleClearanceRisk({ candidateMap, candidate, targetFamily, options }),
    unconnected: candidate.breaksConnectivity ? 1 : 0,
    forbidden_via: forbiddenVias.length,
  };
  return risk;
}

export function predictCriticalFamilyRegression(preScore = {}) {
  const collateral = preScore.predictedCollateral || preScore;
  return ['shorting', 'tracks_crossing', 'unconnected', 'forbidden_via']
    .filter((family) => Number(collateral[family] || 0) > 0);
}

export function estimateLocalClearanceRisk({ candidateMap = null, candidate = {}, options = {} } = {}) {
  const margin = candidate.site?.clearanceMarginMm ?? candidate.clearanceMarginMm;
  const minMargin = options.minPredictedClearanceMarginMm ?? 0.02;
  if (Number.isFinite(margin) && margin < minMargin) return 1;
  if (candidate.reasonIfIllegal && /clearance/i.test(candidate.reasonIfIllegal)) return 1;
  if (candidateMap && candidate.site) {
    const site = candidateMap.evaluateSite(candidate.site, { net: candidate.net, layer: candidate.site.layer || candidate.layer, ignoreUuids: [candidate.uuid].filter(Boolean) });
    if (!site.legal) return 1;
  }
  return 0;
}

export function estimateShortingRisk({ candidateMap = null, candidate = {}, options = {} } = {}) {
  const margin = candidate.site?.clearanceMarginMm ?? candidate.clearanceMarginMm;
  if (Number.isFinite(margin) && margin < (options.shortRiskMarginMm ?? -0.02)) return 1;
  if (candidate.reasonIfIllegal && /short|same location|overlap/i.test(candidate.reasonIfIllegal)) return 1;
  return 0;
}

export function estimateTrackCrossingRisk({ routeCountDelta = 0, candidate = {}, options = {} } = {}) {
  if (candidate.crossingRisk) return 1;
  if (/dogleg|reroute/i.test(candidate.repairType || candidate.type || '') && routeCountDelta > (options.maxRouteObjectDeltaBeforeCrossingRisk ?? 3)) return 1;
  return 0;
}

export function estimateSolderMaskRisk({ candidate = {} } = {}) {
  if (candidate.nearPadMask || /mask/i.test(candidate.reasonIfIllegal || '')) return 1;
  return 0;
}

export function estimateCopperEdgeRisk({ candidateMap = null, candidate = {}, targetFamily = '', options = {} } = {}) {
  const point = candidate.site || candidate.waypoint || candidate;
  const bounds = candidateMap?.boardBounds;
  if (!bounds || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return 0;
  const edgeMargin = Math.min(point.x - bounds.minX, bounds.maxX - point.x, point.y - bounds.minY, bounds.maxY - point.y);
  const minEdge = options.minEdgeMarginMm ?? 0.5;
  if (edgeMargin < minEdge && targetFamily !== 'copper_edge_clearance') return 1;
  return 0;
}

export function estimateHoleClearanceRisk({ candidate = {}, targetFamily = '' } = {}) {
  if (targetFamily === 'hole_clearance') return 0;
  if (/hole|PTH|mounting/i.test(candidate.nearestObstacle || candidate.reasonIfIllegal || '')) return 1;
  return 0;
}

export function rankPostRouteClustersByRepairability(clusters = [], options = {}) {
  const familyWeight = {
    hole_clearance: 100,
    copper_edge_clearance: 90,
    clearance: 80,
    solder_mask_bridge: 40,
    track_dangling: 30,
    ...(options.familyWeight || {}),
  };
  return [...clusters].map((cluster) => {
    const reviewPenalty = cluster.reviewOnly ? 1000 : 0;
    const autoBonus = cluster.autoRepairSafe ? 50 : 0;
    const densityPenalty = Math.max(0, (cluster.objects?.length || 0) - 6) * 4;
    const score = (familyWeight[cluster.family] || 10) + autoBonus + Math.min(cluster.violationCount || 0, 20) - densityPenalty - reviewPenalty;
    return { ...cluster, repairabilityScore: score };
  }).sort((a, b) => b.repairabilityScore - a.repairabilityScore || (b.violationCount || 0) - (a.violationCount || 0));
}

export function selectHighYieldClusters(clusters = [], options = {}) {
  const limit = options.limit ?? 50;
  return rankPostRouteClustersByRepairability(clusters, options)
    .filter((cluster) => cluster.autoRepairSafe && !cluster.reviewOnly && (cluster.repairabilityScore || 0) > 0)
    .slice(0, limit);
}

export function deferLowYieldClustersWithReason(clusters = [], options = {}) {
  const selected = new Set(selectHighYieldClusters(clusters, options).map((cluster) => cluster.clusterId));
  return rankPostRouteClustersByRepairability(clusters, options)
    .filter((cluster) => !selected.has(cluster.clusterId))
    .map((cluster) => ({
      clusterId: cluster.clusterId,
      family: cluster.family,
      reason: cluster.reviewOnly
        ? 'review-only footprint/library cluster'
        : !cluster.autoRepairSafe
          ? 'not marked safe for automatic post-route mutation'
          : 'lower repairability score than selected candidates',
      repairabilityScore: cluster.repairabilityScore,
    }));
}

export function scoreDrcHealth(drcLike, options = {}) {
  const weights = {
    forbidden_via: 100000,
    board_outline_change: 100000,
    mounting_hole_move: 100000,
    part_footprint_package_change: 100000,
    shorting_items: 2500,
    tracks_crossing: 2000,
    unconnected_items: 1500,
    clearance: 100,
    hole_clearance: 180,
    copper_edge_clearance: 250,
    solder_mask_bridge: 120,
    drill_out_of_range: 150,
    track_dangling: 150,
    malformed_courtyard: 15,
    courtyards_overlap: 15,
    silk_edge_clearance: 5,
    silk_overlap: 3,
    silk_over_copper: 3,
    lib_footprint_mismatch: 2,
    text_height: 1,
    text_thickness: 1,
    ...(options.weights || {}),
  };
  const counts = normalizeDrcCounts(drcLike);
  let score = 0;
  for (const [family, count] of Object.entries(counts.types)) {
    score += count * (weights[family] ?? 50);
  }
  score += (counts.unconnected || 0) * weights.unconnected_items;
  return {
    score,
    counts,
    weights,
  };
}

export function compareDrcHealthBeforeAfter(before, after, options = {}) {
  const beforeHealth = scoreDrcHealth(before, options);
  const afterHealth = scoreDrcHealth(after, options);
  const families = new Set([...Object.keys(beforeHealth.counts.types), ...Object.keys(afterHealth.counts.types), 'unconnected_items']);
  const delta = {};
  for (const family of families) {
    const beforeCount = family === 'unconnected_items' ? beforeHealth.counts.unconnected : beforeHealth.counts.types[family] || 0;
    const afterCount = family === 'unconnected_items' ? afterHealth.counts.unconnected : afterHealth.counts.types[family] || 0;
    delta[family] = afterCount - beforeCount;
  }
  return {
    before: beforeHealth,
    after: afterHealth,
    delta,
    scoreDelta: afterHealth.score - beforeHealth.score,
    improved: afterHealth.score < beforeHealth.score,
  };
}

export function shouldPromotePostRouteRepair(before, after, options = {}) {
  const criticalFamilies = options.criticalFamilies || [
    'shorting_items',
    'tracks_crossing',
    'unconnected_items',
    'forbidden_via',
    'board_outline_change',
    'mounting_hole_move',
    'part_footprint_package_change',
  ];
  const comparison = compareDrcHealthBeforeAfter(before, after, options);
  const worsenedCriticalFamilies = criticalFamilies.filter((family) => (comparison.delta[family] || 0) > 0);
  const forbiddenViolation = criticalFamilies
    .filter((family) => /forbidden|outline|mounting|part_footprint/.test(family))
    .some((family) => (comparison.after.counts.types[family] || 0) > (comparison.before.counts.types[family] || 0));
  const promote = comparison.improved && worsenedCriticalFamilies.length === 0 && !forbiddenViolation;
  return {
    promote,
    comparison,
    worsenedCriticalFamilies,
    reason: promote
      ? 'weighted DRC score improved with no critical-family regression'
      : explainPromotionRejection(comparison, worsenedCriticalFamilies, forbiddenViolation),
  };
}

export function rollbackCollateralDamage({ candidateAccepted = false, beforePath, candidatePath, outputPath, beforeDrc, afterDrc, options = {} } = {}) {
  const decision = shouldPromotePostRouteRepair(beforeDrc, afterDrc, options);
  if (candidateAccepted && decision.promote) {
    if (candidatePath && outputPath) fs.copyFileSync(candidatePath, outputPath);
    return { rolledBack: false, decision };
  }
  if (beforePath && outputPath) fs.copyFileSync(beforePath, outputPath);
  return { rolledBack: true, decision };
}

export function auditCleanup4ViaRelocations({ beforeDrc, afterDrc } = {}) {
  const decision = shouldPromotePostRouteRepair(beforeDrc, afterDrc);
  return {
    status: decision.promote ? 'cleanup4_via_relocations_promotable' : 'cleanup4_via_relocations_rejected_for_collateral_damage',
    promoted: decision.promote,
    reason: decision.reason,
    scoreDelta: decision.comparison.scoreDelta,
    worsenedCriticalFamilies: decision.worsenedCriticalFamilies,
    delta: decision.comparison.delta,
  };
}

export function clusterPostFreeRoutingDrc(drcReport, options = {}) {
  const gridMm = options.gridMm ?? 3;
  const violations = Array.isArray(drcReport?.violations) ? drcReport.violations : [];
  const clusters = new Map();

  for (const violation of violations) {
    const family = violation.type || violation.code || 'unknown';
    const positions = (violation.items || []).map((item) => item.pos).filter(Boolean);
    const location = averagePosition(positions);
    const bucket = `${Math.floor(location.x / gridMm)}:${Math.floor(location.y / gridMm)}`;
    const key = `${family}:${bucket}`;
    const cluster = clusters.get(key) || {
      clusterId: `${family}_cluster_${String(clusters.size + 1).padStart(3, '0')}`,
      family,
      nets: new Set(),
      objects: new Set(),
      location,
      layer: '',
      violationCount: 0,
      cause: '',
      repairStrategy: '',
      autoRepairSafe: false,
      reviewOnly: false,
      examples: [],
    };

    cluster.violationCount += 1;
    for (const item of violation.items || []) {
      const description = item.description || '';
      const net = description.match(/\[([^\]]+)\]/)?.[1];
      if (net) cluster.nets.add(net);
      const layer = description.match(/\bon\s+([A-Za-z0-9_.]+Cu|[FB]\.[A-Za-z]+)/)?.[1];
      if (layer && !cluster.layer) cluster.layer = layer;
      if (item.uuid) cluster.objects.add(item.uuid);
    }
    if (cluster.examples.length < 5) {
      cluster.examples.push({
        description: violation.description || '',
        items: (violation.items || []).map((item) => item.description || ''),
      });
    }
    clusters.set(key, cluster);
  }

  return [...clusters.values()].map(finalizeCluster).sort((a, b) => b.violationCount - a.violationCount);
}

function repairSegmentBlock(block, minTrackWidth, stats) {
  return block.map((line) => {
    const match = line.match(/^(\s*)\(width\s+([0-9.]+)\)(\s*)$/);
    if (!match) return line;
    const current = Number(match[2]);
    if (!Number.isFinite(current) || current >= minTrackWidth) return line;
    stats.trackWidthsRepaired += 1;
    return `${match[1]}(width ${formatMm(minTrackWidth)})${match[3]}`;
  });
}

function repairViaBlock(block, minViaDiameter, minViaDrill, stats) {
  return block.map((line) => {
    const sizeMatch = line.match(/^(\s*)\(size\s+([0-9.]+)\)(\s*)$/);
    if (sizeMatch) {
      const current = Number(sizeMatch[2]);
      if (Number.isFinite(current) && current < minViaDiameter) {
        stats.viaDiametersRepaired += 1;
        return `${sizeMatch[1]}(size ${formatMm(minViaDiameter)})${sizeMatch[3]}`;
      }
    }

    const drillMatch = line.match(/^(\s*)\(drill\s+([0-9.]+)\)(\s*)$/);
    if (drillMatch) {
      const current = Number(drillMatch[2]);
      if (Number.isFinite(current) && current < minViaDrill) {
        stats.viaDrillsRepaired += 1;
        return `${drillMatch[1]}(drill ${formatMm(minViaDrill)})${drillMatch[3]}`;
      }
    }

    return line;
  });
}

function parseSegmentBlock(block) {
  const text = block.join('\n');
  const start = text.match(/\(start\s+([-0-9.]+)\s+([-0-9.]+)\)/);
  const end = text.match(/\(end\s+([-0-9.]+)\s+([-0-9.]+)\)/);
  const width = text.match(/\(width\s+([-0-9.]+)\)/);
  const layer = text.match(/\(layer\s+"([^"]+)"\)/);
  const net = text.match(/\(net\s+"([^"]+)"\)/);
  if (!start || !end || !width || !layer || !net) return null;
  return {
    start: { x: Number(start[1]), y: Number(start[2]) },
    end: { x: Number(end[1]), y: Number(end[2]) },
    width: Number(width[1]),
    layer: layer[1],
    net: net[1],
  };
}

function buildDoglegSegments(segment, offsetMm, direction) {
  const dx = segment.end.x - segment.start.x;
  const dy = segment.end.y - segment.start.y;
  const length = Math.hypot(dx, dy);
  if (!Number.isFinite(length) || length < 0.05) return [segment];
  const directionalLength = direction ? Math.hypot(direction.x || 0, direction.y || 0) : 0;
  const nx = directionalLength > 0 ? (direction.x || 0) / directionalLength : -dy / length;
  const ny = directionalLength > 0 ? (direction.y || 0) / directionalLength : dx / length;
  const p1 = {
    x: segment.start.x + dx / 3 + nx * offsetMm,
    y: segment.start.y + dy / 3 + ny * offsetMm,
  };
  const p2 = {
    x: segment.start.x + (2 * dx) / 3 + nx * offsetMm,
    y: segment.start.y + (2 * dy) / 3 + ny * offsetMm,
  };
  return [
    { ...segment, end: p1 },
    { ...segment, start: p1, end: p2 },
    { ...segment, start: p2 },
  ];
}

function parseRouteObjects(pcbText) {
  const lines = pcbText.split(/\r?\n/);
  const segments = [];
  const vias = [];
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(ROUTE_BLOCK_RE);
    if (!match) continue;
    const kind = match[1];
    const block = [lines[index]];
    let depth = parenDelta(lines[index]);
    while (index + 1 < lines.length && depth > 0) {
      index += 1;
      block.push(lines[index]);
      depth += parenDelta(lines[index]);
    }
    if (kind === 'segment') {
      const segment = parseSegmentBlock(block);
      if (segment) {
        segment.uuid = parseUuid(block);
        segments.push(segment);
      }
    } else if (kind === 'via') {
      const via = parseViaBlock(block);
      if (via) vias.push(via);
    }
  }
  return { segments, vias };
}

function parseViaBlock(block) {
  const text = block.join('\n');
  const at = text.match(/\(at\s+([-0-9.]+)\s+([-0-9.]+)\)/);
  const size = text.match(/\(size\s+([-0-9.]+)\)/);
  const drill = text.match(/\(drill\s+([-0-9.]+)\)/);
  const net = text.match(/\(net\s+"([^"]+)"\)/);
  if (!at || !size || !drill || !net) return null;
  return {
    at: { x: Number(at[1]), y: Number(at[2]) },
    size: Number(size[1]),
    drill: Number(drill[1]),
    net: net[1],
    uuid: parseUuid(block),
  };
}

function parseUuid(block) {
  return block.join('\n').match(/\(uuid\s+"([^"]+)"\)/)?.[1] || '';
}

function parseBoardBounds(pcbText, marginMm) {
  const points = [];
  const edgeObjectRe = /\((?:gr_line|gr_rect|gr_arc|gr_circle|gr_poly)[\s\S]*?\(layer\s+"Edge\.Cuts"\)[\s\S]*?\)/g;
  for (const match of pcbText.matchAll(edgeObjectRe)) {
    for (const coord of match[0].matchAll(/\((?:start|end|center|mid|xy)\s+([-0-9.]+)\s+([-0-9.]+)\)/g)) {
      points.push({ x: Number(coord[1]), y: Number(coord[2]) });
    }
  }
  if (!points.length) {
    for (const coord of pcbText.matchAll(/\((?:start|end|at|xy)\s+([-0-9.]+)\s+([-0-9.]+)\)/g)) {
      points.push({ x: Number(coord[1]), y: Number(coord[2]) });
    }
  }
  const xs = points.map((point) => point.x).filter(Number.isFinite);
  const ys = points.map((point) => point.y).filter(Number.isFinite);
  return {
    minX: Math.min(...xs) + marginMm,
    maxX: Math.max(...xs) - marginMm,
    minY: Math.min(...ys) + marginMm,
    maxY: Math.max(...ys) - marginMm,
  };
}

function parsePadObstacles(pcbText) {
  const pads = [];
  const footprintRe = /\(footprint\s+"[^"]+"[\s\S]*?(?=\n\s*\(footprint\s+"|\n\s*\(gr_|\n\s*\(segment|\n\s*\(via|\n\s*\(zone|\n\s*\(embedded_fonts|\n\))/g;
  for (const footprint of pcbText.matchAll(footprintRe)) {
    const fpText = footprint[0];
    const fpAt = fpText.match(/\(at\s+([-0-9.]+)\s+([-0-9.]+)/);
    const origin = fpAt ? { x: Number(fpAt[1]), y: Number(fpAt[2]) } : { x: 0, y: 0 };
    for (const pad of fpText.matchAll(/\(pad\s+"[^"]+"[\s\S]*?\(size\s+([-0-9.]+)\s+([-0-9.]+)\)[\s\S]*?\)/g)) {
      const padText = pad[0];
      const at = padText.match(/\(at\s+([-0-9.]+)\s+([-0-9.]+)/);
      const net = padText.match(/\(net\s+"([^"]+)"\)/)?.[1] || '';
      const uuid = padText.match(/\(uuid\s+"([^"]+)"\)/)?.[1] || '';
      const layer = padText.match(/\(layers\s+"([^"]+)"/)?.[1] || 'F.Cu';
      const sx = Number(pad[1]);
      const sy = Number(pad[2]);
      pads.push({
        at: {
          x: origin.x + Number(at?.[1] || 0),
          y: origin.y + Number(at?.[2] || 0),
        },
        radius: Math.max(sx, sy) / 2,
        net,
        uuid,
        layer,
      });
    }
  }
  return pads;
}

function pointInBounds(point, bounds) {
  return point.x >= bounds.minX && point.x <= bounds.maxX && point.y >= bounds.minY && point.y <= bounds.maxY;
}

function illegalSite(site, reason) {
  return { ...site, legal: false, clearanceMarginMm: -Infinity, nearestObstacle: '', reasonIfIllegal: reason };
}

function distancePointToSegment(point, start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(point.x - start.x, point.y - start.y);
  const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared));
  return Math.hypot(point.x - (start.x + t * dx), point.y - (start.y + t * dy));
}

function scoreSegmentClearance(map, start, end, net, layer, ignoreUuids = []) {
  const ignore = new Set(ignoreUuids);
  let margin = Infinity;
  let nearest = null;
  for (const obstacle of map.obstacles) {
    if (ignore.has(obstacle.uuid)) continue;
    if (obstacle.net && net && obstacle.net === net) continue;
    if (obstacle.layer && obstacle.layer !== 'through' && layer !== 'through' && obstacle.layer !== layer) continue;
    const distance = obstacle.start
      ? segmentToSegmentDistance(start, end, obstacle.start, obstacle.end) - obstacle.radius
      : distancePointToSegment(obstacle.point, start, end) - obstacle.radius;
    if (distance < margin) {
      margin = distance;
      nearest = obstacle;
    }
    if (distance < 0) {
      return {
        legal: false,
        clearanceMarginMm: Number(distance.toFixed(4)),
        nearestObstacle: obstacle.uuid || obstacle.type,
        reasonIfIllegal: `${obstacle.type} clearance`,
      };
    }
  }
  return {
    legal: true,
    clearanceMarginMm: Number((Number.isFinite(margin) ? margin : 99).toFixed(4)),
    nearestObstacle: nearest?.uuid || nearest?.type || '',
    reasonIfIllegal: '',
  };
}

function segmentToSegmentDistance(a1, a2, b1, b2) {
  if (segmentsIntersect(a1, a2, b1, b2)) return 0;
  return Math.min(
    distancePointToSegment(a1, b1, b2),
    distancePointToSegment(a2, b1, b2),
    distancePointToSegment(b1, a1, a2),
    distancePointToSegment(b2, a1, a2),
  );
}

function segmentsIntersect(a1, a2, b1, b2) {
  const ccw = (p1, p2, p3) => (p3.y - p1.y) * (p2.x - p1.x) > (p2.y - p1.y) * (p3.x - p1.x);
  return ccw(a1, b1, b2) !== ccw(a2, b1, b2) && ccw(a1, a2, b1) !== ccw(a1, a2, b2);
}

function midpointOf(start, end) {
  return { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
}

function replaceViaAtAndAttachedSegments(pcbText, via, point, toleranceMm) {
  const lines = pcbText.split(/\r?\n/);
  const out = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const match = line.match(ROUTE_BLOCK_RE);
    if (!match) {
      out.push(line);
      continue;
    }
    const kind = match[1];
    const block = [line];
    let depth = parenDelta(line);
    while (index + 1 < lines.length && depth > 0) {
      index += 1;
      block.push(lines[index]);
      depth += parenDelta(lines[index]);
    }
    if (kind === 'via' && block.some((blockLine) => blockLine.includes(via.uuid))) {
      out.push(...block.map((blockLine) => blockLine.replace(/\(at\s+[-0-9.]+\s+[-0-9.]+\)/, `(at ${formatCoord(point.x)} ${formatCoord(point.y)})`)));
      continue;
    }
    if (kind === 'segment') {
      const segment = parseSegmentBlock(block);
      if (segment && segment.net === via.net) {
        out.push(...block.map((blockLine) => {
          if (distancePoints(segment.start, via.at) <= toleranceMm) {
            blockLine = blockLine.replace(/\(start\s+[-0-9.]+\s+[-0-9.]+\)/, `(start ${formatCoord(point.x)} ${formatCoord(point.y)})`);
          }
          if (distancePoints(segment.end, via.at) <= toleranceMm) {
            blockLine = blockLine.replace(/\(end\s+[-0-9.]+\s+[-0-9.]+\)/, `(end ${formatCoord(point.x)} ${formatCoord(point.y)})`);
          }
          return blockLine;
        }));
        continue;
      }
    }
    out.push(...block);
  }
  return out.join('\n');
}

function distancePoints(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function formatSegmentBlock(segment) {
  return [
    '\t(segment',
    `\t\t(start ${formatCoord(segment.start.x)} ${formatCoord(segment.start.y)})`,
    `\t\t(end ${formatCoord(segment.end.x)} ${formatCoord(segment.end.y)})`,
    `\t\t(width ${formatMm(segment.width)})`,
    `\t\t(layer "${segment.layer}")`,
    `\t\t(net "${segment.net}")`,
    `\t\t(uuid "${cryptoRandomUuid()}")`,
    '\t)',
  ];
}

function formatCoord(value) {
  return Number(value).toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
}

function cryptoRandomUuid() {
  return globalThis.crypto?.randomUUID?.() || 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const random = Math.floor(Math.random() * 16);
    const value = char === 'x' ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

function finalizeCluster(cluster) {
  const descriptions = cluster.examples.flatMap((example) => example.items).join(' | ');
  const hasRoute = /\bTrack\b|\bVia\b/.test(descriptions);
  const hasFootprintOnly = !hasRoute && /\bpad\b|\bPTH pad\b|\bSMD pad\b|\bcourtyard\b|silkscreen/i.test(descriptions);

  if (cluster.family === 'clearance' && hasRoute) {
    cluster.cause = 'imported route too close to pad, via, or other route';
    cluster.repairStrategy = 'local reroute, dogleg, layer change, or via relocation';
    cluster.autoRepairSafe = true;
  } else if (cluster.family === 'hole_clearance' && hasRoute) {
    cluster.cause = 'imported route or via too close to a hole or PTH pad';
    cluster.repairStrategy = 'move via or dogleg segment around hole clearance area';
    cluster.autoRepairSafe = true;
  } else if (cluster.family === 'copper_edge_clearance' && hasRoute) {
    cluster.cause = 'imported route copper too close to Edge.Cuts';
    cluster.repairStrategy = 'nudge or dogleg route inward without changing Edge.Cuts';
    cluster.autoRepairSafe = true;
  } else if (cluster.family === 'solder_mask_bridge') {
    cluster.cause = hasRoute ? 'route or pad mask aperture bridge near imported copper' : 'footprint pad/mask geometry review';
    cluster.repairStrategy = hasRoute ? 'reroute imported copper if route-owned; otherwise classify footprint review' : 'FOOTPRINT_REVIEW_NOT_ROUTE_REPAIR';
    cluster.autoRepairSafe = hasRoute;
    cluster.reviewOnly = !hasRoute;
  } else if (hasFootprintOnly) {
    cluster.cause = 'footprint or library geometry review';
    cluster.repairStrategy = 'review-only in post-route cleanup because footprints are locked';
    cluster.reviewOnly = true;
  } else {
    cluster.cause = 'mixed or unclassified DRC cluster';
    cluster.repairStrategy = 'manual/local analysis required before mutation';
  }

  return {
    ...cluster,
    nets: [...cluster.nets].sort(),
    objects: [...cluster.objects].sort(),
  };
}

function normalizeDrcCounts(drcLike = {}) {
  if (drcLike.types || Number.isFinite(drcLike.unconnected)) {
    return {
      types: { ...(drcLike.types || {}) },
      unconnected: Number(drcLike.unconnected || drcLike.kiCadStdoutUnconnected || 0),
    };
  }
  const violations = Array.isArray(drcLike.violations) ? drcLike.violations : [];
  const types = {};
  let unconnected = 0;
  for (const violation of violations) {
    const type = violation.type || violation.code || 'unknown';
    if (/unconnected/i.test(type) || /unconnected/i.test(violation.description || '')) {
      unconnected += 1;
    } else {
      types[type] = (types[type] || 0) + 1;
    }
  }
  return { types, unconnected };
}

function estimateTargetFamilyDelta({ targetFamily = '', candidate = {}, candidateMap = null } = {}) {
  if (candidate.predictedTargetFamilyDelta !== undefined) return Number(candidate.predictedTargetFamilyDelta);
  if (candidateMap && candidate.site) {
    const site = candidateMap.evaluateSite(candidate.site, { net: candidate.net, layer: candidate.site.layer || candidate.layer, ignoreUuids: [candidate.uuid].filter(Boolean) });
    if (site.legal && ['hole_clearance', 'copper_edge_clearance', 'clearance'].includes(targetFamily)) return -1;
  }
  if (/dogleg|reroute|via_relocation|segment_nudge/i.test(candidate.repairType || candidate.type || '')) return -1;
  return 0;
}

function firstPreScoreRejection(predictedCollateral = {}, predictedWeightedScoreDelta = 0, options = {}) {
  if ((predictedCollateral.forbidden_via || 0) > 0) return 'predicted forbidden via risk';
  if ((predictedCollateral.shorting || 0) > 0) return 'predicted shorting regression';
  if ((predictedCollateral.tracks_crossing || 0) > 0) return 'predicted track-crossing regression';
  if ((predictedCollateral.unconnected || 0) > 0) return 'predicted unconnected regression';
  if ((predictedCollateral.copper_edge || 0) > 0 && options.allowEdgeRisk !== true) return 'predicted copper-edge regression';
  if ((predictedCollateral.hole_clearance || 0) > 0 && options.allowHoleRisk !== true) return 'predicted hole-clearance regression';
  if (predictedWeightedScoreDelta >= 0 && options.allowNeutralPreScore !== true) return 'predicted weighted DRC score does not improve';
  return '';
}

function explainPromotionRejection(comparison, worsenedCriticalFamilies, forbiddenViolation) {
  if (forbiddenViolation) return 'forbidden board/spec/via family regressed';
  if (worsenedCriticalFamilies.length) return `critical family worsened: ${worsenedCriticalFamilies.join(', ')}`;
  if (!comparison.improved) return 'weighted DRC score did not improve';
  return 'post-route repair promotion guard rejected candidate';
}

function averagePosition(positions) {
  if (!positions.length) return { x: 0, y: 0 };
  const sum = positions.reduce((acc, pos) => ({ x: acc.x + (pos.x || 0), y: acc.y + (pos.y || 0) }), { x: 0, y: 0 });
  return { x: Number((sum.x / positions.length).toFixed(4)), y: Number((sum.y / positions.length).toFixed(4)) };
}

function parenDelta(line) {
  let delta = 0;
  let quoted = false;
  let escaped = false;
  for (const char of line) {
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (char === '"') {
      quoted = !quoted;
      continue;
    }
    if (quoted) continue;
    if (char === '(') delta += 1;
    if (char === ')') delta -= 1;
  }
  return delta;
}

function formatMm(value) {
  return Number(value).toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

if (import.meta.url === `file://${process.argv[1]?.replaceAll('\\', '/')}`) {
  const [, , command, inputPath, outputPath, drcPath] = process.argv;
  if (command === 'repair') {
    console.log(JSON.stringify(repairImportedRouteDimensionsFile({ inputPath, outputPath }), null, 2));
  } else if (command === 'classify') {
    const report = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
    const classification = classifyPostFreeRoutingDrc(report);
    if (outputPath) {
      fs.writeFileSync(outputPath, JSON.stringify(classification, null, 2));
    }
    console.log(JSON.stringify(classification, null, 2));
  } else if (command === 'classify-and-repair') {
    const report = JSON.parse(fs.readFileSync(drcPath, 'utf8'));
    const classification = classifyPostFreeRoutingDrc(report);
    const repair = repairImportedRouteDimensionsFile({ inputPath, outputPath });
    console.log(JSON.stringify({ classification, repair }, null, 2));
  } else {
    console.error('Usage: node post-freerouting-repair.mjs repair <input.kicad_pcb> <output.kicad_pcb>');
    process.exit(2);
  }
}
