import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { stateFileName } from './project-state.mjs'

export async function buildManufacturingManifest(projectDir, options = {}) {
  const state = await readJson(path.join(projectDir, stateFileName))
  const stackup = await readJson(path.join(projectDir, 'boardforge-stackup-plan.json'))
  const assembly = await readJson(path.join(projectDir, 'boardforge-assembly-plan.json'))
  const pinAssignments = await readJson(path.join(projectDir, 'boardforge-pin-assignments.json'))
  const bindings = await readJson(path.join(projectDir, 'boardforge-bindings.json'))
  const signalIntegrity = await readJson(path.join(projectDir, 'boardforge-signal-integrity.json'))
  const testStrategy = await readJson(path.join(projectDir, 'boardforge-test-strategy.json'))
  const dfm = await readJson(path.join(projectDir, 'boardforge-dfm-report.json'))
  const preflight = await readJson(path.join(projectDir, 'boardforge-preflight.json'))
  const packageValidation = await readJson(path.join(projectDir, 'boardforge-jlcpcb-package-validation.json'))
  const files = expectedFiles(projectDir)
  const missing = files.filter((file) => file.required && !existsSync(file.path))
  const manufacturingArtifacts = collectManufacturingArtifacts(projectDir)
  const hardGateReview = evaluateHardGates({ files, manufacturingArtifacts, packageValidation })
  const advancedFab = Boolean(stackup?.hdi?.requiresAdvancedReview)
  const rawIssues = [
    ...missing.map((file) => ({ severity: 'ERROR', code: 'MANIFEST_REQUIRED_FILE_MISSING', message: `${file.label} is missing.`, path: file.path })),
    ...(advancedFab && !options.approveAdvancedFab ? [{ severity: 'ERROR', code: 'ADVANCED_FAB_APPROVAL_REQUIRED', message: 'Advanced stackup/via review must be approved before manufacturing package release.' }] : []),
    ...(pinAssignments?.errors || []),
    ...(bindings?.errors || []),
    ...(signalIntegrity?.errors || []),
    ...(testStrategy?.errors || []),
    ...(dfm?.errors || []),
    ...(preflight?.blockers || []),
  ]
  const engineeringReview = classifyEngineeringReview(rawIssues, {
    hardGatesClean: hardGateReview.status !== 'BLOCKED',
    packageValidation,
    board: state?.board || null,
  })
  const blockers = [...hardGateReview.blockers, ...engineeringReview.blockers]
  const warnings = [
    ...hardGateReview.warnings,
    ...engineeringReview.warnings,
    ...(stackup?.warnings || []),
    ...(assembly?.warnings || []),
    ...(pinAssignments?.warnings || []),
    ...(bindings?.warnings || []),
    ...(signalIntegrity?.warnings || []),
    ...(testStrategy?.warnings || []),
    ...(dfm?.warnings || []),
    ...(preflight?.warnings || []),
  ]
  const manifestStatus = blockers.length
    ? 'MANUFACTURING_MANIFEST_BLOCKED'
    : warnings.length || engineeringReview.humanReviewRequired
      ? 'MANUFACTURING_MANIFEST_NEEDS_REVIEW'
      : 'MANUFACTURING_MANIFEST_READY_NEEDS_REVIEW'
  const manifest = {
    status: manifestStatus,
    projectName: state?.projectName || path.basename(projectDir),
    projectDir,
    generatedAt: new Date().toISOString(),
    board: state?.board || null,
    componentCount: state?.components?.length || 0,
    stackup: stackup ? { status: stackup.status, layerCount: stackup.layerCount, hdi: stackup.hdi, impedanceIntent: stackup.impedanceIntent } : null,
    assembly: assembly ? { status: assembly.status, assemblyMode: assembly.assemblyMode, connectorAccess: assembly.connectorAccess, serviceAccess: assembly.serviceAccess } : null,
    pinAssignments: pinAssignments ? { status: pinAssignments.status, controller: pinAssignments.controller, interfaces: pinAssignments.interfaces, conflicts: pinAssignments.conflicts?.length || 0 } : null,
    signalIntegrity: signalIntegrity ? { status: signalIntegrity.status, highSpeedNetCount: signalIntegrity.highSpeedNetCount, gates: signalIntegrity.gates, actions: signalIntegrity.actions || [] } : null,
    testStrategy: testStrategy ? { status: testStrategy.status, requiredTestPoints: testStrategy.requiredTestPoints?.length || 0, programming: testStrategy.programming } : null,
    dfm: dfm ? { status: dfm.status, errors: dfm.errors?.length || 0, warnings: dfm.warnings?.length || 0, actions: dfm.actions || [] } : null,
    files: files.map((file) => ({ ...file, exists: existsSync(file.path) })),
    manufacturingArtifacts,
    packageValidation: packageValidation ? {
      status: packageValidation.status,
      errors: packageValidation.errors?.length || 0,
      warnings: packageValidation.warnings?.length || 0,
      outputFile: packageValidation.outputFile || path.join(projectDir, 'boardforge-jlcpcb-package-validation.json'),
    } : null,
    engineeringReview,
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
    { label: 'Pin assignment plan', path: path.join(projectDir, 'boardforge-pin-assignments.json'), required: true },
    { label: 'Binding report', path: path.join(projectDir, 'boardforge-bindings.json'), required: true },
    { label: 'Stackup plan', path: path.join(projectDir, 'boardforge-stackup-plan.json'), required: true },
    { label: 'Signal integrity report', path: path.join(projectDir, 'boardforge-signal-integrity.json'), required: true },
    { label: 'Test strategy report', path: path.join(projectDir, 'boardforge-test-strategy.json'), required: true },
    { label: 'DFM report', path: path.join(projectDir, 'boardforge-dfm-report.json'), required: false },
    { label: 'Assembly plan', path: path.join(projectDir, 'boardforge-assembly-plan.json'), required: false },
    { label: 'DRC report', path: path.join(projectDir, 'reports', 'drc.json'), required: false },
    { label: 'ERC report', path: path.join(projectDir, 'reports', 'erc.json'), required: false },
    { label: 'BOM CSV', path: path.join(projectDir, 'fab', 'bom.csv'), required: false },
    { label: 'CPL CSV', path: path.join(projectDir, 'fab', 'cpl.csv'), required: false },
  ]
}

function collectManufacturingArtifacts(projectDir) {
  const gerbers = collectFiles(path.join(projectDir, 'fab', 'gerbers'))
  const drill = collectFiles(path.join(projectDir, 'fab', 'drill'))
  const bom = fileEvidence(path.join(projectDir, 'fab', 'bom.csv'))
  const cpl = fileEvidence(path.join(projectDir, 'fab', 'cpl.csv'))
  const jlcpcbZip = fileEvidence(path.join(projectDir, 'fab', `${path.basename(projectDir)}-jlcpcb.zip`))
  const packageValidation = fileEvidence(path.join(projectDir, 'boardforge-jlcpcb-package-validation.json'))
  const drc = readReportEvidence(path.join(projectDir, 'reports', 'drc.json'))
  const erc = readReportEvidence(path.join(projectDir, 'reports', 'erc.json'))
  return {
    gerbers: { status: gerbers.length ? 'generated' : 'missing', files: gerbers },
    drill: { status: drill.length ? 'generated' : 'missing', files: drill },
    bom,
    cpl,
    jlcpcbZip,
    packageValidation,
    drc,
    erc,
  }
}

function evaluateHardGates({ files, manufacturingArtifacts, packageValidation }) {
  const blockers = []
  const warnings = []
  for (const file of files.filter((item) => item.required)) {
    if (!existsSync(file.path)) blockers.push(issue('ERROR', 'MANIFEST_REQUIRED_FILE_MISSING', `${file.label} is missing.`, { path: file.path }))
  }
  if (!manufacturingArtifacts.erc.exists) blockers.push(issue('ERROR', 'ERC_REPORT_MISSING', 'ERC report is required before manufacturing manifest release.'))
  else if (manufacturingArtifacts.erc.issueCounts.errors > 0) blockers.push(issue('ERROR', 'ERC_ERRORS', `${manufacturingArtifacts.erc.issueCounts.errors} ERC error(s) block manifest release.`))
  if (!manufacturingArtifacts.drc.exists) blockers.push(issue('ERROR', 'DRC_REPORT_MISSING', 'DRC report is required before manufacturing manifest release.'))
  else if (manufacturingArtifacts.drc.issueCounts.errors > 0) blockers.push(issue('ERROR', 'DRC_ERRORS', `${manufacturingArtifacts.drc.issueCounts.errors} DRC error(s) block manifest release.`))
  if (manufacturingArtifacts.gerbers.status !== 'generated') blockers.push(issue('ERROR', 'GERBERS_MISSING', 'Gerber files are required before manufacturing manifest release.'))
  if (manufacturingArtifacts.drill.status !== 'generated') blockers.push(issue('ERROR', 'DRILL_FILES_MISSING', 'Drill files are required before manufacturing manifest release.'))
  if (manufacturingArtifacts.bom.status !== 'generated') blockers.push(issue('ERROR', 'BOM_MISSING', 'BOM CSV is required before manufacturing manifest release.'))
  if (manufacturingArtifacts.cpl.status !== 'generated') blockers.push(issue('ERROR', 'CPL_MISSING', 'CPL CSV is required before manufacturing manifest release.'))
  if (manufacturingArtifacts.jlcpcbZip.status !== 'generated') blockers.push(issue('ERROR', 'JLCPCB_ZIP_MISSING', 'JLCPCB ZIP is required before manufacturing manifest release.'))
  if (!packageValidation) blockers.push(issue('ERROR', 'PACKAGE_VALIDATION_MISSING', 'JLCPCB package validation report is required before manufacturing manifest release.'))
  else if (/BLOCKED|FAILED/i.test(packageValidation.status || '')) blockers.push(issue('ERROR', 'PACKAGE_VALIDATION_BLOCKED', `Package validation status ${packageValidation.status} blocks manifest release.`))
  if (manufacturingArtifacts.erc.issueCounts.warnings > 0) warnings.push(issue('WARNING', 'ERC_WARNINGS_REVIEW', `${manufacturingArtifacts.erc.issueCounts.warnings} ERC warning(s) require review.`))
  if (manufacturingArtifacts.drc.issueCounts.warnings > 0) warnings.push(issue('WARNING', 'DRC_WARNINGS_REVIEW', `${manufacturingArtifacts.drc.issueCounts.warnings} DRC warning(s) require review.`))
  return { status: blockers.length ? 'BLOCKED' : warnings.length ? 'NEEDS_REVIEW' : 'PASS', blockers, warnings }
}

function classifyEngineeringReview(rawIssues, context) {
  const sections = {
    pinMapEquivalence: reviewSection('PASS', 'Pin-map equivalence has no blocking evidence.'),
    railCurrentReview: reviewSection('PASS', 'Rail current has no blocking evidence.'),
    thermalReview: reviewSection('PASS', 'Thermal review has no blocking evidence.'),
  }
  const blockers = []
  const warnings = []
  for (const item of rawIssues) {
    if (isPinMapIssue(item)) {
      applyReviewClassification(sections.pinMapEquivalence, item, classifyPinMapIssue(item, context))
      continue
    }
    if (isRailCurrentIssue(item)) {
      applyReviewClassification(sections.railCurrentReview, item, classifyRailCurrentIssue(item, context))
      continue
    }
    if (isThermalIssue(item)) {
      applyReviewClassification(sections.thermalReview, item, classifyThermalIssue(item, context))
      continue
    }
    blockers.push(item)
  }
  for (const section of Object.values(sections)) {
    for (const item of section.blockers) blockers.push(item)
    for (const item of section.reviewItems) warnings.push({ ...item, severity: 'WARNING' })
  }
  return {
    status: blockers.length ? 'BLOCKED' : warnings.length ? 'NEEDS_REVIEW' : 'PASS',
    pinMapEquivalence: sectionSummary(sections.pinMapEquivalence),
    railCurrentReview: sectionSummary(sections.railCurrentReview),
    thermalReview: sectionSummary(sections.thermalReview),
    blockers,
    warnings,
    humanReviewRequired: warnings.length > 0 || /POE|INDUSTRIAL|ROBOT/i.test(`${context.board?.name || ''}`),
  }
}

function classifyPinMapIssue(item, context) {
  if (!context.hardGatesClean) return { status: 'BLOCKED', reason: 'Pin-map issue remains blocking because hard manufacturing gates are not clean.' }
  if (/FOOTPRINT_MISSING|FOOTPRINT_PADS_UNKNOWN/i.test(item.code || '')) return { status: 'BLOCKED', reason: 'A required footprint or pad model is missing.' }
  return {
    status: 'NEEDS_REVIEW',
    reason: 'ERC/DRC/export/package evidence is clean; this is metadata/datasheet equivalence uncertainty, not proven broken connectivity.',
  }
}

function classifyRailCurrentIssue(item, context) {
  if (!context.hardGatesClean) return { status: 'BLOCKED', reason: 'Rail current issue remains blocking because hard manufacturing gates are not clean.' }
  if (/NO_POWER_PATH|POWER_INPUT_MISSING/i.test(item.code || '')) return { status: 'BLOCKED', reason: 'A required power path is missing.' }
  return {
    status: 'NEEDS_REVIEW',
    reason: 'Current estimate exceeds conservative metadata budget, but ERC/DRC/export/package evidence is clean; requires engineering load verification.',
  }
}

function classifyThermalIssue(item, context) {
  if (!context.hardGatesClean) return { status: 'BLOCKED', reason: 'Thermal issue remains blocking because hard manufacturing gates are not clean.' }
  return {
    status: 'NEEDS_REVIEW',
    reason: 'Thermal risk is inferred from conservative estimates; no DRC/export/package evidence proves a thermal-rule violation.',
  }
}

function applyReviewClassification(section, item, classification) {
  if (classification.status === 'BLOCKED') {
    section.status = 'BLOCKED'
    section.blockers.push({ ...item, reviewReason: classification.reason })
    return
  }
  if (classification.status === 'NEEDS_REVIEW' && section.status !== 'BLOCKED') section.status = 'NEEDS_REVIEW'
  section.reviewItems.push({ ...item, reviewReason: classification.reason })
}

function sectionSummary(section) {
  return {
    status: section.status,
    reason: section.reason,
    checked: section.blockers.length + section.reviewItems.length,
    blockers: section.blockers,
    reviewItems: section.reviewItems,
  }
}

function reviewSection(status, reason) {
  return { status, reason, blockers: [], reviewItems: [] }
}

function isPinMapIssue(item) {
  return /PIN|FOOTPRINT|SYMBOL|BINDING|SCHEMATIC_PCB/i.test(`${item.code || ''} ${item.message || ''}`)
}

function isRailCurrentIssue(item) {
  return /RAIL_CURRENT|CURRENT|POWER_INPUT|POWER_PATH/i.test(`${item.code || ''} ${item.message || ''}`)
}

function isThermalIssue(item) {
  return /THERMAL|HIGH_THERMAL|REGULATOR_THERMAL|HEAT/i.test(`${item.code || ''} ${item.message || ''}`)
}

function collectFiles(directory) {
  try {
    const entries = readdirSync(directory, { withFileTypes: true })
    return entries.flatMap((entry) => {
      const full = path.join(directory, entry.name)
      return entry.isDirectory() ? collectFiles(full) : [full]
    }).filter((file) => fileEvidence(file).status === 'generated')
  } catch {
    return []
  }
}

function fileEvidence(file) {
  try {
    const info = statSync(file)
    return { status: info.isFile() && info.size > 0 ? 'generated' : 'missing', path: file, size: info.size }
  } catch {
    return { status: 'missing', path: file, size: 0 }
  }
}

function readReportEvidence(file) {
  const evidence = fileEvidence(file)
  const report = readJsonSync(file)
  return {
    ...evidence,
    exists: evidence.status === 'generated',
    issueCounts: report ? extractReportIssues(report) : { errors: 0, warnings: 0 },
  }
}

function readJsonSync(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

function extractReportIssues(report) {
  const severities = collectIssueSeverities(report)
  return {
    errors: severities.filter((severity) => severity === 'error').length,
    warnings: severities.filter((severity) => severity === 'warning').length,
  }
}

function collectIssueSeverities(value) {
  if (!value || typeof value !== 'object') return []
  const severities = []
  if (!Array.isArray(value) && typeof value.severity === 'string' && isIssueLike(value)) severities.push(value.severity.toLowerCase())
  for (const [key, child] of Object.entries(value)) {
    if (key === 'included_severities' || key === 'ignored_checks') continue
    if (Array.isArray(child)) severities.push(...child.flatMap((item) => collectIssueSeverities(item)))
    else if (child && typeof child === 'object') severities.push(...collectIssueSeverities(child))
  }
  return severities
}

function isIssueLike(value) {
  return Boolean(value.type || value.description || value.message || value.items || value.pos || value.code)
}

function issue(severity, code, message, details = {}) {
  return { severity, code, message, ...details }
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
