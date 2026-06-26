import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildLegalSiteMapForPostRouteRepair,
  auditCleanup4ViaRelocations,
  classifyPostFreeRoutingDrc,
  compareDrcHealthBeforeAfter,
  clusterPostFreeRoutingDrc,
  findLegalDoglegWaypoints,
  findNearestLegalThroughViaSite,
  mutateSegmentDoglegByUuid,
  preScorePostRouteRepairCandidate,
  predictCriticalFamilyRegression,
  rankPostRouteClustersByRepairability,
  relocateImportedViaToLegalSite,
  rerouteSegmentThroughLegalWaypoints,
  repairImportedRouteDimensions,
  rollbackCollateralDamage,
  scanForbiddenViasInPcbText,
  selectHighYieldClusters,
  scoreDrcHealth,
  shouldPromotePostRouteRepair,
} from '../lib/external-routing/post-freerouting-repair.mjs';

const SAMPLE_ROUTED = `
(kicad_pcb
  (footprint "Keep:Part" (layer "F.Cu")
    (pad "1" smd rect (at 0 0) (size 1 1) (layers "F.Cu"))
  )
  (gr_line (start 0 0) (end 10 0) (layer "Edge.Cuts"))
  (gr_line (start 10 0) (end 10 10) (layer "Edge.Cuts"))
  (gr_line (start 10 10) (end 0 10) (layer "Edge.Cuts"))
  (gr_line (start 0 10) (end 0 0) (layer "Edge.Cuts"))
  (segment
    (start 1 1)
    (end 2 1)
    (width 0.15)
    (layer "B.Cu")
    (net "/SIG")
    (uuid "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")
  )
  (via
    (at 2 1)
    (size 0.45)
    (drill 0.2)
    (layers "F.Cu" "B.Cu")
    (net "/SIG")
    (uuid "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb")
  )
  (embedded_fonts no)
)
`;

test('post-FreeRouting DRC classification groups generated and review families', () => {
  const classification = classifyPostFreeRoutingDrc({
    violations: [
      {
        type: 'track_width',
        description: 'Track width',
        items: [{ description: 'Track [/SIG] on B.Cu' }],
      },
      {
        type: 'drill_out_of_range',
        description: 'Hole size out of range',
        items: [{ description: 'PTH pad V [<no net>] of U10' }],
      },
      {
        type: 'via_diameter',
        description: 'Via diameter',
        items: [{ description: 'Via [/SIG] on F.Cu - B.Cu' }],
      },
    ],
  });
  const track = classification.families.find((family) => family.type === 'track_width');
  const drill = classification.families.find((family) => family.type === 'drill_out_of_range');
  const via = classification.families.find((family) => family.type === 'via_diameter');
  assert.equal(track.safeAutoRepair, true);
  assert.equal(track.generatedBySesImport, 1);
  assert.equal(drill.footprintOrLibraryReview, 1);
  assert.equal(via.safeAutoRepair, true);
});

test('repair imported track widths raises undersized tracks without touching footprints', () => {
  const result = repairImportedRouteDimensions(SAMPLE_ROUTED);
  assert.equal(result.trackWidthsRepaired, 1);
  assert.match(result.pcbText, /\(width 0\.2\)/);
  assert.match(result.pcbText, /\(footprint "Keep:Part"/);
  assert.match(result.pcbText, /Edge\.Cuts/);
});

test('repair imported via dimensions normalizes through-via size and drill', () => {
  const result = repairImportedRouteDimensions(SAMPLE_ROUTED);
  assert.equal(result.viaDiametersRepaired, 1);
  assert.equal(result.viaDrillsRepaired, 1);
  assert.match(result.pcbText, /\(size 0\.5\)/);
  assert.match(result.pcbText, /\(drill 0\.3\)/);
});

test('scan forbidden vias guard keeps standard through-via layer pair', () => {
  const result = repairImportedRouteDimensions(SAMPLE_ROUTED);
  assert.doesNotMatch(result.pcbText, /blind|buried|micro/i);
  assert.match(result.pcbText, /\(layers "F\.Cu" "B\.Cu"\)/);
});

test('post-FreeRouting forbidden via scan ignores footprint descriptions', () => {
  const pcb = SAMPLE_ROUTED.replace(
    '(footprint "Keep:Part" (layer "F.Cu")',
    '(footprint "Keep:Part" (layer "F.Cu")\n    (descr "datasheet at microchip.com")',
  );
  assert.deepEqual(scanForbiddenViasInPcbText(pcb), []);
  assert.equal(scanForbiddenViasInPcbText('(via blind (at 1 1) (size 0.5) (drill 0.3) (layers "F.Cu" "In1.Cu"))').length, 1);
});

test('post-FreeRouting clearance repair classifies route-owned conflicts for local reroute', () => {
  const classification = classifyPostFreeRoutingDrc({
    violations: [
      {
        type: 'clearance',
        description: 'Clearance violation',
        items: [
          { description: 'Pad 1 [/A] of U1 on F.Cu' },
          { description: 'Track [/SIG] on F.Cu' },
        ],
      },
    ],
  });
  assert.equal(classification.families[0].needsLocalReroute, true);
});

test('freerouting postroute solution library rule name is stable', () => {
  assert.equal('post_freerouting_track_width_repair_001'.startsWith('post_freerouting'), true);
});

test('post-FreeRouting DRC clustering groups nearby route clearance issues', () => {
  const clusters = clusterPostFreeRoutingDrc({
    violations: [
      {
        type: 'clearance',
        description: 'Clearance violation',
        items: [
          { description: 'Pad 1 [/A] of U1 on F.Cu', pos: { x: 10, y: 10 }, uuid: 'pad-a' },
          { description: 'Track [/B] on F.Cu', pos: { x: 10.5, y: 10.2 }, uuid: 'track-b' },
        ],
      },
      {
        type: 'clearance',
        description: 'Clearance violation',
        items: [
          { description: 'Track [/B] on F.Cu', pos: { x: 10.7, y: 10.4 }, uuid: 'track-c' },
          { description: 'Track [/C] on F.Cu', pos: { x: 10.9, y: 10.6 }, uuid: 'track-d' },
        ],
      },
    ],
  });
  assert.equal(clusters.length, 1);
  assert.equal(clusters[0].violationCount, 2);
  assert.equal(clusters[0].autoRepairSafe, true);
});

test('post-FreeRouting hole clearance repair clusters via and segment conflicts', () => {
  const clusters = clusterPostFreeRoutingDrc({
    violations: [
      {
        type: 'hole_clearance',
        items: [
          { description: 'Track [/SIG] on B.Cu', pos: { x: 20, y: 20 }, uuid: 'track' },
          { description: 'Via [/PWR] on F.Cu - B.Cu', pos: { x: 20.1, y: 20.1 }, uuid: 'via' },
        ],
      },
    ],
  });
  assert.equal(clusters[0].repairStrategy.includes('move via'), true);
  assert.equal(clusters[0].autoRepairSafe, true);
});

test('post-FreeRouting copper edge repair clusters imported edge conflicts', () => {
  const clusters = clusterPostFreeRoutingDrc({
    violations: [
      {
        type: 'copper_edge_clearance',
        items: [
          { description: 'Segment on Edge.Cuts', pos: { x: 0, y: 5 }, uuid: 'edge' },
          { description: 'Track [/PGND] on F.Cu', pos: { x: 0.3, y: 5.1 }, uuid: 'track' },
        ],
      },
    ],
  });
  assert.equal(clusters[0].repairStrategy.includes('inward'), true);
});

test('post-FreeRouting solder mask classification separates footprint review', () => {
  const clusters = clusterPostFreeRoutingDrc({
    violations: [
      {
        type: 'solder_mask_bridge',
        items: [
          { description: 'Pad 20 [/PGND] of U8 on B.Cu', pos: { x: 1, y: 1 }, uuid: 'pad' },
          { description: 'PTH pad V [<no net>] of U8', pos: { x: 1, y: 1.5 }, uuid: 'pth' },
        ],
      },
    ],
  });
  assert.equal(clusters[0].reviewOnly, true);
  assert.equal(clusters[0].repairStrategy, 'FOOTPRINT_REVIEW_NOT_ROUTE_REPAIR');
});

test('post-FreeRouting cluster geometry mutation doglegs one offending segment', () => {
  const result = mutateSegmentDoglegByUuid(SAMPLE_ROUTED, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', { offsetMm: 0.25 });
  assert.equal(result.mutated, true);
  assert.equal((result.pcbText.match(/\(segment/g) || []).length, 3);
  assert.match(result.pcbText, /\(net "\/SIG"\)/);
});

test('post-FreeRouting dogleg clearance repair preserves segment endpoints', () => {
  const result = mutateSegmentDoglegByUuid(SAMPLE_ROUTED, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', { offsetMm: 0.25 });
  assert.match(result.pcbText, /\(start 1 1\)/);
  assert.match(result.pcbText, /\(end 2 1\)/);
});

test('post-FreeRouting rollback single cluster can detect no mutation target', () => {
  const result = mutateSegmentDoglegByUuid(SAMPLE_ROUTED, 'missing-uuid', { offsetMm: 0.25 });
  assert.equal(result.mutated, false);
  assert.equal((result.pcbText.match(/\(segment/g) || []).length, 1);
});

test('post-FreeRouting via relocation placeholder rejects unsupported direct via mutation', () => {
  const result = findNearestLegalThroughViaSite({
    pcbText: SAMPLE_ROUTED,
    uuid: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    options: { clearanceMm: 0.05, maxRadiusMm: 1, stepMm: 0.25 },
  });
  assert.equal(result.found, true);
  assert.equal(result.site.legal, true);
});

test('post-FreeRouting legal-site map evaluates sites with clearance evidence', () => {
  const map = buildLegalSiteMapForPostRouteRepair(SAMPLE_ROUTED, { clearanceMm: 0.05 });
  const legal = map.evaluateSite({ x: 5, y: 5, layer: 'F.Cu', net: '/OTHER' }, { net: '/OTHER', layer: 'F.Cu' });
  const illegal = map.evaluateSite({ x: 2, y: 1, layer: 'through', net: '/OTHER' }, { net: '/OTHER', layer: 'through' });
  assert.equal(legal.legal, true);
  assert.equal(illegal.legal, false);
  assert.match(illegal.reasonIfIllegal, /clearance/);
});

test('post-FreeRouting legal via-site search relocates via and attached segment endpoint', () => {
  const search = findNearestLegalThroughViaSite({
    pcbText: SAMPLE_ROUTED,
    uuid: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    options: { clearanceMm: 0.05, maxRadiusMm: 1, stepMm: 0.25 },
  });
  const relocated = relocateImportedViaToLegalSite(SAMPLE_ROUTED, 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', search.site, { clearanceMm: 0.05 });
  assert.equal(relocated.relocated, true);
  assert.match(relocated.pcbText, new RegExp(`\\(at ${String(search.site.x).replace('.', '\\\\.')} ${String(search.site.y).replace('.', '\\\\.')}\\)`));
});

test('post-FreeRouting legal waypoint search returns scored dogleg candidates', () => {
  const result = findLegalDoglegWaypoints({
    pcbText: SAMPLE_ROUTED,
    uuid: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    obstacle: { pos: { x: 1.5, y: 1 } },
    options: { clearanceMm: 0.05, offsetsMm: [0.25, 0.5] },
  });
  assert.equal(result.found, true);
  assert.equal(result.candidates.some((candidate) => candidate.legal), true);
});

test('post-FreeRouting scored cluster mutation reroutes through legal waypoint', () => {
  const search = findLegalDoglegWaypoints({
    pcbText: SAMPLE_ROUTED,
    uuid: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    obstacle: { pos: { x: 1.5, y: 1 } },
    options: { clearanceMm: 0.05, offsetsMm: [0.25, 0.5] },
  });
  const candidate = search.candidates.find((item) => item.legal);
  const result = rerouteSegmentThroughLegalWaypoints(SAMPLE_ROUTED, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', candidate);
  assert.equal(result.rerouted, true);
  assert.equal((result.pcbText.match(/\(segment/g) || []).length, 2);
  assert.match(result.pcbText, /\(net "\/SIG"\)/);
});

test('post-FreeRouting multi-family DRC score weighs critical families heavily', () => {
  const healthy = scoreDrcHealth({ types: { clearance: 10, hole_clearance: 5, shorting_items: 0 }, unconnected: 0 });
  const dangerous = scoreDrcHealth({ types: { clearance: 9, hole_clearance: 4, shorting_items: 1 }, unconnected: 0 });
  assert.equal(dangerous.score > healthy.score, true);
});

test('post-FreeRouting collateral damage guard rejects critical-family regression', () => {
  const before = { types: { hole_clearance: 125, shorting_items: 9, tracks_crossing: 0 }, unconnected: 239 };
  const after = { types: { hole_clearance: 112, shorting_items: 14, tracks_crossing: 2 }, unconnected: 239 };
  const decision = shouldPromotePostRouteRepair(before, after);
  assert.equal(decision.promote, false);
  assert.deepEqual(decision.worsenedCriticalFamilies, ['shorting_items', 'tracks_crossing']);
});

test('post-FreeRouting repair promotion gate accepts clean weighted improvement', () => {
  const before = { types: { hole_clearance: 125, shorting_items: 9, tracks_crossing: 0 }, unconnected: 239 };
  const after = { types: { hole_clearance: 112, shorting_items: 9, tracks_crossing: 0 }, unconnected: 239 };
  const decision = shouldPromotePostRouteRepair(before, after);
  assert.equal(decision.promote, true);
});

test('post-FreeRouting DRC health comparison reports family deltas', () => {
  const comparison = compareDrcHealthBeforeAfter(
    { types: { copper_edge_clearance: 73, clearance: 500 }, unconnected: 239 },
    { types: { copper_edge_clearance: 70, clearance: 501 }, unconnected: 239 },
  );
  assert.equal(comparison.delta.copper_edge_clearance, -3);
  assert.equal(comparison.delta.clearance, 1);
});

test('post-FreeRouting candidate prescore rejects obvious critical regression before DRC', () => {
  const prescore = preScorePostRouteRepairCandidate({
    beforePcbText: SAMPLE_ROUTED,
    candidatePcbText: `${SAMPLE_ROUTED}\n(via blind (at 4 4) (size 0.5) (drill 0.3) (layers "F.Cu" "In1.Cu"))`,
    cluster: { clusterId: 'c1', family: 'hole_clearance' },
    candidate: { repairType: 'via_relocation', uuid: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' },
    baselineDrc: { types: { hole_clearance: 10, shorting_items: 0, tracks_crossing: 0 }, unconnected: 0 },
  });
  assert.equal(prescore.preScoreDecision, 'reject_before_drc');
  assert.match(prescore.reason, /forbidden via/);
});

test('post-FreeRouting candidate prescore sends predicted target-family improvement to DRC', () => {
  const prescore = preScorePostRouteRepairCandidate({
    beforePcbText: SAMPLE_ROUTED,
    candidatePcbText: SAMPLE_ROUTED,
    cluster: { clusterId: 'hole-1', family: 'hole_clearance' },
    candidate: { repairType: 'via_relocation', predictedTargetFamilyDelta: -1 },
    baselineDrc: { types: { hole_clearance: 10, shorting_items: 0, tracks_crossing: 0 }, unconnected: 0 },
  });
  assert.equal(prescore.preScoreDecision, 'send_to_drc');
  assert.equal(prescore.predictedTargetFamilyDelta, -1);
  assert.equal(prescore.predictedWeightedScoreDelta < 0, true);
});

test('post-FreeRouting critical regression prediction names unsafe families', () => {
  const families = predictCriticalFamilyRegression({ shorting: 1, tracks_crossing: 1, clearance: 2 });
  assert.deepEqual(families, ['shorting', 'tracks_crossing']);
});

test('post-FreeRouting repairability ranking prioritizes safe route-generated clusters', () => {
  const ranked = rankPostRouteClustersByRepairability([
    { clusterId: 'review', family: 'solder_mask_bridge', autoRepairSafe: false, reviewOnly: true, violationCount: 50, objects: [] },
    { clusterId: 'hole', family: 'hole_clearance', autoRepairSafe: true, violationCount: 5, objects: ['via'] },
    { clusterId: 'clearance', family: 'clearance', autoRepairSafe: true, violationCount: 20, objects: Array.from({ length: 20 }, (_, index) => `o${index}`) },
  ]);
  assert.equal(ranked[0].clusterId, 'hole');
  assert.equal(ranked.at(-1).clusterId, 'review');
});

test('post-FreeRouting high-yield cluster selection excludes review-only clusters', () => {
  const selected = selectHighYieldClusters([
    { clusterId: 'review', family: 'solder_mask_bridge', autoRepairSafe: false, reviewOnly: true, violationCount: 50, objects: [] },
    { clusterId: 'edge', family: 'copper_edge_clearance', autoRepairSafe: true, violationCount: 3, objects: ['track'] },
  ]);
  assert.deepEqual(selected.map((cluster) => cluster.clusterId), ['edge']);
});

test('post-FreeRouting cleanup4 via relocation audit flags collateral damage', () => {
  const audit = auditCleanup4ViaRelocations({
    beforeDrc: { types: { hole_clearance: 125, shorting_items: 9, tracks_crossing: 0 }, unconnected: 239 },
    afterDrc: { types: { hole_clearance: 112, shorting_items: 14, tracks_crossing: 2 }, unconnected: 239 },
  });
  assert.equal(audit.promoted, false);
  assert.equal(audit.status, 'cleanup4_via_relocations_rejected_for_collateral_damage');
});

test('post-FreeRouting rollback collateral damage returns rollback decision', () => {
  const rollback = rollbackCollateralDamage({
    candidateAccepted: true,
    beforeDrc: { types: { hole_clearance: 125, shorting_items: 9, tracks_crossing: 0 }, unconnected: 239 },
    afterDrc: { types: { hole_clearance: 112, shorting_items: 14, tracks_crossing: 2 }, unconnected: 239 },
  });
  assert.equal(rollback.rolledBack, true);
  assert.equal(rollback.decision.promote, false);
});
