import test from 'node:test'
import assert from 'node:assert/strict'
import {
  detectFreerouting,
  detectJavaRuntime,
  summarizeBackendDetection,
} from '../lib/external-routing/router-backend-detection.mjs'
import {
  buildFreeroutingCommand,
  freeroutingInstallRecord,
  parseFreeroutingProbeOutput,
} from '../lib/external-routing/freerouting.mjs'
import {
  buildManualDsnSesWorkflow,
  detectDsnSesWorkflow,
} from '../lib/external-routing/kicad-dsn-ses-workflow.mjs'

test('java detection records portable runtime path and version', () => {
  const java = detectJavaRuntime([{ path: 'C:/not-real/java.exe' }, { path: 'package.json', version: '25.0.3' }])
  assert.equal(java.found, true)
  assert.equal(java.version, '25.0.3')
})

test('freerouting detection records local jar path', () => {
  const freerouting = detectFreerouting([{ path: 'package.json', version: '2.2.4' }])
  assert.equal(freerouting.found, true)
  assert.equal(freerouting.version, '2.2.4')
})

test('freerouting command builder emits DSN to SES command', () => {
  const cmd = buildFreeroutingCommand({
    javaPath: 'C:/tools/java/bin/java.exe',
    jarPath: 'C:/tools/freerouting/freerouting.jar',
    dsnPath: 'C:/board/input.dsn',
    sesPath: 'C:/board/output.ses',
  })
  assert.equal(cmd.valid, true)
  assert.deepEqual(cmd.args.slice(0, 6), ['-jar', 'C:/tools/freerouting/freerouting.jar', '-de', 'C:/board/input.dsn', '-do', 'C:/board/output.ses'])
  assert.match(cmd.display, /-de/)
})

test('freerouting probe parser confirms DSN-capable runnable jar output', () => {
  const parsed = parseFreeroutingProbeOutput("Freerouting v2.2.4\nOpening 'C:/missing.dsn'...\nCouldn't load the input file 'C:/missing.dsn'")
  assert.equal(parsed.version, '2.2.4')
  assert.equal(parsed.acceptsDsn, true)
  assert.equal(parsed.runnable, true)
})

test('DSN SES workflow detection falls back to manual KiCad GUI when CLI lacks support', () => {
  const workflow = detectDsnSesWorkflow({
    cliExportHelp: 'pcb export gerbers step',
    cliImportHelp: 'pcb import altium eagle',
    guiKnownAvailable: true,
  })
  assert.equal(workflow.cliDsnExport, false)
  assert.equal(workflow.cliSesImport, false)
  assert.equal(workflow.selectedWorkflow, 'manual_kicad_gui_dsn_ses')
})

test('external router manual workflow report includes exact user bridge steps', () => {
  const workflow = buildManualDsnSesWorkflow({
    projectPath: 'C:/board',
    pcbFile: 'FN-ESC1.kicad_pcb',
    dsnPath: 'C:/board/boardforge-freerouting/FN-ESC1.dsn',
    sesPath: 'C:/board/boardforge-freerouting/FN-ESC1.ses',
    freeroutingCommand: '"java" -jar "freerouting.jar" -de "FN-ESC1.dsn" -do "FN-ESC1.ses"',
  })
  assert.ok(workflow.steps.some((step) => /Export > Specctra DSN/.test(step)))
  assert.ok(workflow.steps.some((step) => /Import > Specctra Session/.test(step)))
})

test('backend detection summary requires Java, FreeRouting, and selected DSN workflow', () => {
  const summary = summarizeBackendDetection({
    java: { found: true },
    freerouting: { found: true },
    workflow: { selectedWorkflow: 'manual_kicad_gui_dsn_ses' },
  })
  assert.equal(summary.runnable, true)
  assert.deepEqual(summary.missing, [])
})

test('freerouting install record stores local setup evidence', () => {
  const record = freeroutingInstallRecord({
    javaPath: 'C:/tools/java/bin/java.exe',
    javaVersion: '25.0.3',
    jarPath: 'C:/tools/freerouting/freerouting-2.2.4.jar',
    freeroutingVersion: '2.2.4',
  })
  assert.equal(record.javaFound, true)
  assert.equal(record.freeRoutingFound, true)
  assert.equal(record.installMethod, 'portable_project_tools')
})
