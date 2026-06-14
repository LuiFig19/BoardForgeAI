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
    assert.equal(result.generatedFiles.length, 4)
    const pcb = await readFile(path.join(result.projectPath, 'test-outline.kicad_pcb'), 'utf8')
    assert.match(pcb, /Edge\.Cuts/)
    assert.match(pcb, /BoardForge outline-only/)
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
    assert.match(schematic, /Generated scaffold/)
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
    assert.equal(drc.status, 'DRC_PASSED')
    const erc = await executeJob({ id: 'erc', type: 'run_kicad_erc', input }, workspace)
    assert.equal(erc.status, 'ERC_PASSED')
    const gerbers = await executeJob({ id: 'gerbers', type: 'export_gerbers', input }, workspace)
    assert.equal(gerbers.status, 'GERBERS_EXPORTED')
    assert.ok(gerbers.generatedFiles.length > 0)
    const bom = await executeJob({ id: 'bom', type: 'export_bom', input }, workspace)
    assert.equal(bom.status, 'BOM_EXPORTED')
    const drill = await executeJob({ id: 'drill', type: 'export_drill_files', input }, workspace)
    assert.equal(drill.status, 'DRILL_EXPORTED')
    const cpl = await executeJob({ id: 'cpl', type: 'export_cpl', input }, workspace)
    assert.equal(cpl.status, 'CPL_EXPORTED')
    const pkg = await executeJob({ id: 'pkg', type: 'package_jlcpcb', input }, workspace)
    assert.equal(pkg.status, 'MANUFACTURING_PACKAGE_GENERATED_NEEDS_REVIEW')
    assert.equal(pkg.generatedFiles[0].endsWith('-jlcpcb.zip'), true)
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})
