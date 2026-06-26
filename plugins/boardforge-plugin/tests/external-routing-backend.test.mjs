import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildExternalRouterRuleGeneration,
  parseKiCadCliPcbHelp,
  scanForbiddenVias,
  selectExternalRoutingBackend,
  validateExternalRouterResult,
} from '../lib/external-routing-backend.mjs'

test('ESC external routing workflow selects FreeRouting only when DSN/SES flow is complete', () => {
  const selected = selectExternalRoutingBackend({
    javaFound: true,
    freeroutingJar: 'C:/tools/freerouting.jar',
    dsnExportAvailable: true,
    sesImportAvailable: true,
  })
  assert.equal(selected.available, true)
  assert.equal(selected.backend, 'freerouting_dsn_ses')
  assert.match(selected.commands.autoroute, /freerouting\.jar/)
})

test('DSN export check detects absent Specctra support in KiCad CLI help', () => {
  const parsed = parseKiCadCliPcbHelp('Usage: kicad-cli pcb export [gerbers|step|pos]\nUsage: kicad-cli pcb import [altium|eagle]')
  assert.equal(parsed.hasPcbExport, true)
  assert.equal(parsed.hasDsnExport, false)
})

test('SES import check detects Specctra import support when advertised', () => {
  const parsed = parseKiCadCliPcbHelp('Usage: kicad-cli pcb import specctra ses')
  assert.equal(parsed.hasPcbImport, true)
  assert.equal(parsed.hasSesImport, true)
})

test('external router rule generation preserves ESC layer and via policy', () => {
  const rules = buildExternalRouterRuleGeneration({ boardType: 'ESC', layerCount: 8 })
  assert.equal(rules.layerCount, 8)
  assert.deepEqual(rules.viaPolicy.allowed, ['through'])
  assert.ok(rules.viaPolicy.forbidden.includes('via-in-pad'))
  assert.ok(rules.netClasses.HIGH_CURRENT_POWER.preferredLayers.includes('In2.Cu'))
  assert.ok(rules.netClasses.CURRENT_SENSE.preferredLayers.includes('In5.Cu'))
})

test('external router result validation rejects forbidden vias and spec changes', () => {
  const result = validateExternalRouterResult({
    originalSpec: { partsChanged: 0, footprintsChanged: 1, boardOutlineChanged: false },
    before: { unconnected: 499 },
    after: { unconnected: 450 },
    forbiddenVias: [{ type: 'microvia' }],
  })
  assert.equal(result.valid, false)
  assert.deepEqual(result.forbiddenChanges, ['footprintsChanged'])
  assert.equal(result.forbiddenVias.length, 1)
})

test('forbidden via scan catches blind buried micro and via-in-pad candidates', () => {
  const bad = scanForbiddenVias([
    { type: 'through' },
    { type: 'blind' },
    { viaType: 'microvia' },
    { kind: 'via-in-pad' },
  ])
  assert.equal(bad.length, 3)
})

test('original spec preserved after import is required for backend validation', () => {
  const result = validateExternalRouterResult({
    originalSpec: {
      partsChanged: 0,
      footprintsChanged: 0,
      packagesChanged: 0,
      padsNetsChanged: 0,
      boardOutlineChanged: false,
      mountingHolesChanged: false,
    },
    before: { unconnected: 499 },
    after: { unconnected: 420 },
    forbiddenVias: [],
  })
  assert.equal(result.valid, true)
})

test('ESC routing backend supervisor reports exact missing external requirements', () => {
  const selected = selectExternalRoutingBackend({
    javaFound: false,
    freeroutingJar: null,
    dsnExportAvailable: false,
    sesImportAvailable: false,
  })
  assert.equal(selected.available, false)
  assert.equal(selected.backend, 'external_router_unavailable')
  assert.deepEqual(selected.missing, ['java_runtime', 'freerouting', 'dsn_export', 'ses_import'])
})
