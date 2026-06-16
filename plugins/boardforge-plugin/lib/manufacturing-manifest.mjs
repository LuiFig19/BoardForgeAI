import { existsSync, readdirSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { stateFileName } from './project-state.mjs'

export async function buildManufacturingManifest(projectDir, options = {}) {
  const state = await readJson(path.join(projectDir, stateFileName))
  const stackup = await readJson(path.join(projectDir, 'boardforge-stackup-plan.json'))
  const assembly = await readJson(path.join(projectDir, 'boardforge-assembly-plan.json'))
  const bindings = await readJson(path.join(projectDir, 'boardforge-bindings.json'))
  const signalIntegrity = await readJson(path.join(projectDir, 'boardforge-signal-integrity.json'))
  const dfm = await readJson(path.join(projectDir, 'boardforge-dfm-report.json'))
  const preflight = await readJson(path.join(projectDir, 'boardforge-preflight.json'))
  const files = expectedFiles(projectDir)
  const missing = files.filter((file) => file.required && !existsSync(file.path))
  const advancedFab = Boolean(stackup?.hdi?.requiresAdvancedReview)
  const blockers = [
    ...missing.map((file) => ({ severity: 'ERROR', code: 'MANIFEST_REQUIRED_FILE_MISSING', message: `${file.label} is missing.`, path: file.path })),
    ...(advancedFab && !options.approveAdvancedFab ? [{ severity: 'ERROR', code: 'ADVANCED_FAB_APPROVAL_REQUIRED', message: 'Advanced stackup/via review must be approved before manufacturing package release.' }] : []),
    ...(bindings?.errors || []),
    ...(signalIntegrity?.errors || []),
    ...(dfm?.errors || []),
    ...(preflight?.blockers || []),
  ]
  const warnings = [
    ...(stackup?.warnings || []),
    ...(assembly?.warnings || []),
    ...(bindings?.warnings || []),
    ...(signalIntegrity?.warnings || []),
    ...(dfm?.warnings || []),
    ...(preflight?.warnings || []),
  ]
  const manifest = {
    status: blockers.length ? 'MANUFACTURING_MANIFEST_BLOCKED' : warnings.length ? 'MANUFACTURING_MANIFEST_NEEDS_REVIEW' : 'MANUFACTURING_MANIFEST_READY_NEEDS_REVIEW',
    projectName: state?.projectName || path.basename(projectDir),
    projectDir,
    generatedAt: new Date().toISOString(),
    board: state?.board || null,
    componentCount: state?.components?.length || 0,
    stackup: stackup ? { status: stackup.status, layerCount: stackup.layerCount, hdi: stackup.hdi, impedanceIntent: stackup.impedanceIntent } : null,
    assembly: assembly ? { status: assembly.status, assemblyMode: assembly.assemblyMode, connectorAccess: assembly.connectorAccess, serviceAccess: assembly.serviceAccess } : null,
    signalIntegrity: signalIntegrity ? { status: signalIntegrity.status, highSpeedNetCount: signalIntegrity.highSpeedNetCount, gates: signalIntegrity.gates, actions: signalIntegrity.actions || [] } : null,
    dfm: dfm ? { status: dfm.status, errors: dfm.errors?.length || 0, warnings: dfm.warnings?.length || 0, actions: dfm.actions || [] } : null,
    files: files.map((file) => ({ ...file, exists: existsSync(file.path) })),
    gates: {
      requiresErc: true,
      requiresDrc: true,
      requiresBom: true,
      requiresCpl: true,
      advancedFabApprovalRequired: advancedFab,
      approvedAdvancedFab: Boolean(options.approveAdvancedFab),
    },
    blockers,
    warnings,
    humanReviewRequired: true,
  }
  if (options.write !== false) {
    const outputFile = path.join(projectDir, 'boardforge-manufacturing-manifest.json')
    await writeFile(outputFile, JSON.stringify(manifest, null, 2), 'utf8')
    return { ...manifest, outputFile }
  }
  return manifest
}

function expectedFiles(projectDir) {
  return [
    { label: 'KiCad project', path: firstExisting(projectDir, '.kicad_pro'), required: true },
    { label: 'KiCad schematic', path: firstExisting(projectDir, '.kicad_sch'), required: true },
    { label: 'KiCad PCB', path: firstExisting(projectDir, '.kicad_pcb'), required: true },
    { label: 'BoardForge project state', path: path.join(projectDir, stateFileName), required: true },
    { label: 'Component manifest', path: path.join(projectDir, 'boardforge-components.json'), required: true },
    { label: 'Binding report', path: path.join(projectDir, 'boardforge-bindings.json'), required: true },
    { label: 'Stackup plan', path: path.join(projectDir, 'boardforge-stackup-plan.json'), required: true },
    { label: 'Signal integrity report', path: path.join(projectDir, 'boardforge-signal-integrity.json'), required: true },
    { label: 'DFM report', path: path.join(projectDir, 'boardforge-dfm-report.json'), required: false },
    { label: 'Assembly plan', path: path.join(projectDir, 'boardforge-assembly-plan.json'), required: false },
    { label: 'DRC report', path: path.join(projectDir, 'reports', 'drc.json'), required: false },
    { label: 'ERC report', path: path.join(projectDir, 'reports', 'erc.json'), required: false },
    { label: 'BOM CSV', path: path.join(projectDir, 'fab', 'bom.csv'), required: false },
    { label: 'CPL CSV', path: path.join(projectDir, 'fab', 'cpl.csv'), required: false },
  ]
}

function firstExisting(projectDir, extension) {
  try {
    const candidates = readdirSync(projectDir).filter((file) => file.endsWith(extension))
    return candidates.length ? path.join(projectDir, candidates[0]) : path.join(projectDir, `__missing__${extension}`)
  } catch {
    return path.join(projectDir, `__missing__${extension}`)
  }
}

async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'))
  } catch {
    return null
  }
}
