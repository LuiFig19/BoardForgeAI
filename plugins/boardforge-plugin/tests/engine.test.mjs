import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { rectanglePoints } from '../lib/geometry.mjs'
import { getManufacturerProfile } from '../lib/manufacturers.mjs'
import { assignNetsToClasses } from '../lib/net-classes.mjs'
import { validateBoardOutline, validatePlacement } from '../lib/validation.mjs'
import { generateRoutingPlan } from '../lib/routing.mjs'
import { executeJob } from '../lib/jobs.mjs'
import { detectKiCadCli } from '../lib/kicad-cli.mjs'
import { detectKiCadLibraryRoots } from '../lib/library-adapter.mjs'

test('validates a simple rectangular board outline', () => {
  const board = { outline: rectanglePoints(40, 30), mountingHoles: [{ id: 'MH1', x: 5, y: 5, diameterMm: 3 }] }
  const issues = validateBoardOutline(board, getManufacturerProfile())
  assert.equal(issues.length, 0)
})

test('rejects a self-intersecting custom board outline', () => {
  const board = { outline: [{ x: 0, y: 0 }, { x: 20, y: 20 }, { x: 0, y: 20 }, { x: 20, y: 0 }], mountingHoles: [] }
  const issues = validateBoardOutline(board, getManufacturerProfile())
  assert.equal(issues.some((issue) => issue.code === 'OUTLINE_SELF_INTERSECTION'), true)
})

test('assigns USB and battery nets to strict classes', () => {
  const nets = assignNetsToClasses([{ name: 'USB_DP' }, { name: 'USB_DN' }, { name: 'VBAT' }, { name: 'SCL' }])
  assert.equal(nets.find((net) => net.name === 'USB_DP').className, 'USB_DIFF')
  assert.equal(nets.find((net) => net.name === 'VBAT').className, 'BATTERY')
  assert.equal(nets.find((net) => net.name === 'SCL').className, 'I2C')
})

test('detects off-board components', () => {
  const board = { outline: rectanglePoints(20, 20), mountingHoles: [] }
  const issues = validatePlacement(board, [{ ref: 'U1', x: 21, y: 10, width: 6, height: 6 }], getManufacturerProfile())
  assert.equal(issues.some((issue) => issue.code === 'COMPONENT_OFF_BOARD'), true)
})

test('routing plan does not claim full autorouting', () => {
  const plan = generateRoutingPlan(assignNetsToClasses([{ name: 'USB_DP' }, { name: 'GND' }]), { layerCount: 4 })
  assert.equal(plan.status, 'PARTIAL_ROUTING_PLAN')
  assert.deepEqual(plan.routedNets, [])
  assert.equal(plan.unroutedNets.includes('USB_DP'), true)
})

test('create_outline_board writes real KiCad files and review JSON only', async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'boardforge-test-'))
  try {
    const job = {
      id: 'test_outline',
      type: 'create_outline_board',
      allowOverwrite: false,
      input: { projectName: 'Test Outline', templateId: 'ESP32_S3_SENSOR' },
    }
    const result = await executeJob(job, workspace)
    assert.equal(result.status, 'OUTLINE_GENERATED_NEEDS_REVIEW')
    assert.equal(result.generatedFiles.length, 5)
    const pcb = await readFile(path.join(result.projectPath, 'test-outline.kicad_pcb'), 'utf8')
    assert.match(pcb, /Edge\.Cuts/)
    assert.match(pcb, /BoardForge outline-only/)
    const state = JSON.parse(await readFile(path.join(result.projectPath, 'boardforge-project.json'), 'utf8'))
    assert.equal(state.mode, 'outline_only')
    assert.equal(state.board.outline.length > 2, true)
    assert.equal(result.generatedFiles.some((file) => file.endsWith('gerbers.zip')), false)
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})

test('create_kicad_project writes a KiCad schematic scaffold', async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'boardforge-project-test-'))
  try {
    const result = await executeJob({ id: 'project', type: 'create_kicad_project', input: { projectName: 'Sensor Project', templateId: 'ESP32_S3_SENSOR' } }, workspace)
    assert.equal(result.status, 'KICAD_PROJECT_CREATED_NEEDS_REVIEW')
    assert.equal(result.generatedFiles.some((file) => file.endsWith('.kicad_sch')), true)
    const schematic = await readFile(path.join(result.projectPath, 'sensor-project.kicad_sch'), 'utf8')
    assert.match(schematic, /kicad_sch/)
    assert.match(schematic, /BoardForge component manifest/)
    const pcb = await readFile(path.join(result.projectPath, 'sensor-project.kicad_pcb'), 'utf8')
    assert.match(pcb, /footprint/)
    assert.match(pcb, /USB-C/)
    const state = JSON.parse(await readFile(path.join(result.projectPath, 'boardforge-project.json'), 'utf8'))
    assert.equal(state.mode, 'full_project_scaffold')
    assert.ok(state.components.length >= 4)
    assert.equal(result.projectState.components.count >= 4, true)
    const scan = await executeJob({ id: 'scan', type: 'scan_kicad_project', input: { projectPath: 'sensor-project' } }, workspace)
    assert.equal(scan.status, 'SCAN_COMPLETE_NEEDS_REVIEW')
    assert.ok(scan.scan.footprints.length >= 4)
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})

test('library adapter indexes installed KiCad 10 footprints and resolves component assets', async (context) => {
  const roots = detectKiCadLibraryRoots({ kicadMajorVersion: 10 })
  if (!roots.footprints || !roots.symbols) {
    context.skip('KiCad symbol/footprint libraries are not installed on this machine')
    return
  }
  const workspace = await mkdtemp(path.join(tmpdir(), 'boardforge-library-test-'))
  try {
    const sync = await executeJob({
      id: 'library_sync',
      type: 'sync_kicad_libraries',
      input: { kicadMajorVersion: 10, include3dModels: true, maxAssets: 25000 },
    }, workspace)
    assert.equal(sync.status, 'LIBRARY_SYNCED_NEEDS_REVIEW')
    assert.ok(sync.counts.footprints > 100)
    assert.ok(sync.counts.symbols > 100)
    const search = await executeJob({ id: 'library_search', type: 'search_library_assets', input: { query: 'USB C receptacle', limit: 8 } }, workspace)
    assert.equal(search.status, 'LIBRARY_SEARCH_COMPLETE_NEEDS_REVIEW')
    assert.ok(search.footprints.length > 0)
    const resolved = await executeJob({
      id: 'resolve_assets',
      type: 'resolve_component_assets',
      input: {
        components: [
          { ref: 'J1', group: 'USB', value: 'USB-C receptacle' },
          { ref: 'R1', group: 'RES', value: '10k 0603 resistor' },
        ],
      },
    }, workspace)
    assert.ok(['COMPONENT_ASSETS_RESOLVED_NEEDS_REVIEW', 'COMPONENT_ASSETS_NEED_REVIEW'].includes(resolved.status))
    assert.equal(resolved.components.length, 2)
    assert.ok(resolved.components[0].footprint)
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})

test('package_jlcpcb blocks when required export files are missing', async () => {
  const result = await executeJob({ id: 'pkg', type: 'package_jlcpcb', input: {} }, process.cwd())
  assert.ok(['BLOCKED_MISSING_ADAPTER', 'NEEDS_FIX', 'PACKAGE_BLOCKED_MISSING_FILES'].includes(result.status))
  assert.deepEqual(result.generatedFiles, [])
})

test('KiCad CLI adapter runs DRC and exports board files when KiCad is installed', async (context) => {
  const detected = await detectKiCadCli()
  if (!detected.available) {
    context.skip('kicad-cli is not installed on this machine')
    return
  }
  const workspace = await mkdtemp(path.join(tmpdir(), 'boardforge-kicad-test-'))
  try {
    await executeJob({ id: 'project', type: 'create_kicad_project', input: { projectName: 'Adapter Project', templateId: 'ESP32_S3_SENSOR' } }, workspace)
    const input = { projectPath: 'adapter-project' }
    const drc = await executeJob({ id: 'drc', type: 'run_kicad_drc', input }, workspace)
    assert.equal(drc.status, 'DRC_NEEDS_FIX')
    assert.ok(drc.errors.length > 0)
    const erc = await executeJob({ id: 'erc', type: 'run_kicad_erc', input }, workspace)
    assert.equal(erc.status, 'ERC_PASSED')
    const gerbers = await executeJob({ id: 'gerbers', type: 'export_gerbers', input }, workspace)
    assert.equal(gerbers.status, 'GERBERS_EXPORTED')
    assert.ok(gerbers.generatedFiles.length > 0)
    const bom = await executeJob({ id: 'bom', type: 'export_bom', input }, workspace)
    assert.equal(bom.status, 'BOM_EXPORTED_FROM_PLACEMENT_NEEDS_REVIEW')
    const bomCsv = await readFile(path.join(workspace, 'adapter-project', 'fab', 'bom.csv'), 'utf8')
    assert.match(bomCsv, /BoardForge placed components/)
    assert.match(bomCsv, /USB-C/)
    const drill = await executeJob({ id: 'drill', type: 'export_drill_files', input }, workspace)
    assert.equal(drill.status, 'DRILL_EXPORTED')
    const cpl = await executeJob({ id: 'cpl', type: 'export_cpl', input }, workspace)
    assert.equal(cpl.status, 'CPL_EXPORTED')
    const pkg = await executeJob({ id: 'pkg', type: 'package_jlcpcb', input }, workspace)
    assert.equal(pkg.status, 'PACKAGE_BLOCKED_DRC_ERRORS')
    assert.deepEqual(pkg.generatedFiles, [])
    const state = JSON.parse(await readFile(path.join(workspace, 'adapter-project', 'boardforge-project.json'), 'utf8'))
    assert.equal(state.validation.drc.status, 'DRC_NEEDS_FIX')
    assert.equal(state.validation.erc.status, 'ERC_PASSED')
    assert.equal(state.exports.gerbers.status, 'GERBERS_EXPORTED')
    assert.equal(state.exports.drill.status, 'DRILL_EXPORTED')
    assert.equal(state.exports.bom.status, 'BOM_EXPORTED_FROM_PLACEMENT_NEEDS_REVIEW')
    assert.equal(state.exports.cpl.status, 'CPL_EXPORTED')
    assert.equal(state.exports.jlcpcb.status, 'PACKAGE_BLOCKED_DRC_ERRORS')
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})
