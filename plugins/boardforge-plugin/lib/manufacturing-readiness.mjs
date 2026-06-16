import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

export async function validateManufacturingReadiness(projectDir, options = {}) {
  const reportsDir = path.join(projectDir, 'reports')
  const fabDir = path.join(projectDir, 'fab')
  const drc = await readReport(path.join(reportsDir, 'drc.json'), 'DRC')
  const erc = await readReport(path.join(reportsDir, 'erc.json'), 'ERC')
  const bom = await validateBom(path.join(fabDir, 'bom.csv'))
  const cpl = await validateCpl(path.join(fabDir, 'cpl.csv'))
  const stackup = await validateStackup(path.join(projectDir, 'boardforge-stackup-plan.json'), options)
  const errors = [
    ...gateReport(drc, 'DRC', options.requireDrc !== false),
    ...gateReport(erc, 'ERC', options.requireErc !== false),
    ...bom.errors,
    ...cpl.errors,
    ...stackup.errors,
  ]
  const warnings = [...drc.warnings, ...erc.warnings, ...bom.warnings, ...cpl.warnings, ...stackup.warnings]
  return {
    status: errors.length ? 'MANUFACTURING_READINESS_BLOCKED' : warnings.length ? 'MANUFACTURING_READINESS_NEEDS_REVIEW' : 'MANUFACTURING_READINESS_READY_NEEDS_REVIEW',
    reports: { drc, erc },
    stackup,
    bom,
    cpl,
    errors,
    warnings,
    humanReviewRequired: true,
  }
}

async function validateStackup(file, options) {
  if (!existsSync(file)) return { file, exists: false, errors: [], warnings: [{ severity: 'WARNING', code: 'STACKUP_PLAN_MISSING', message: 'No BoardForge stackup plan was found; advanced via/export review is limited.' }] }
  try {
    const stackup = JSON.parse(await readFile(file, 'utf8'))
    const advanced = Boolean(stackup.hdi?.requiresAdvancedReview)
    return {
      file,
      exists: true,
      advancedViaReviewRequired: advanced,
      errors: advanced && !options.approveAdvancedFab ? [{ severity: 'ERROR', code: 'ADVANCED_FAB_APPROVAL_REQUIRED', message: 'Stackup uses or recommends HDI/advanced via review. Pass approveAdvancedFab only after manufacturer quote/stackup approval.' }] : [],
      warnings: advanced ? [{ severity: 'WARNING', code: 'ADVANCED_STACKUP_REVIEW', message: 'Blind/buried/microvia decisions require manufacturer stackup approval before fabrication.' }] : [],
    }
  } catch (error) {
    return { file, exists: true, errors: [{ severity: 'ERROR', code: 'STACKUP_PLAN_UNREADABLE', message: error.message }], warnings: [] }
  }
}

export async function validateExportGate(projectDir, kind, options = {}) {
  const readiness = await validateManufacturingReadiness(projectDir, {
    ...options,
    requireDrc: ['gerbers', 'drill', 'cpl', 'jlcpcb'].includes(kind),
    requireErc: ['bom', 'jlcpcb'].includes(kind),
  })
  if (options.allowUnvalidatedExport) return { allowed: true, readiness, warnings: [{ severity: 'WARNING', code: 'UNVALIDATED_EXPORT_ALLOWED', message: `${kind} export is allowed by explicit override, but validation is not clean.` }] }
  const blocking = readiness.errors.filter((issue) => issue.code !== 'BOM_MISSING' && issue.code !== 'CPL_MISSING')
  return { allowed: blocking.length === 0, readiness, errors: blocking, warnings: readiness.warnings }
}

async function readReport(file, label) {
  if (!existsSync(file)) return { label, file, exists: false, issueCounts: { errors: 0, warnings: 0 }, warnings: [], errors: [] }
  try {
    const report = JSON.parse(await readFile(file, 'utf8'))
    const issueCounts = extractReportIssues(report)
    return {
      label,
      file,
      exists: true,
      issueCounts,
      warnings: issueCounts.warnings ? [{ severity: 'WARNING', code: `${label}_WARNINGS`, message: `${issueCounts.warnings} ${label} warnings found.` }] : [],
      errors: issueCounts.errors ? [{ severity: 'ERROR', code: `${label}_ERRORS`, message: `${issueCounts.errors} ${label} errors found.` }] : [],
    }
  } catch (error) {
    return { label, file, exists: true, issueCounts: { errors: 1, warnings: 0 }, warnings: [], errors: [{ severity: 'ERROR', code: `${label}_REPORT_UNREADABLE`, message: error.message }] }
  }
}

function gateReport(report, label, required) {
  if (!required) return []
  if (!report.exists) return [{ severity: 'ERROR', code: `${label}_REPORT_MISSING`, message: `${label} report is required before this manufacturing step.` }]
  return report.errors
}

async function validateBom(file) {
  if (!existsSync(file)) return { file, exists: false, rowCount: 0, errors: [{ severity: 'ERROR', code: 'BOM_MISSING', message: 'BOM CSV has not been exported.' }], warnings: [] }
  const rows = parseCsv(await readFile(file, 'utf8'))
  const header = rows[0] || []
  const body = rows.slice(1).filter((row) => row.some((cell) => cell.trim()))
  const warnings = []
  const errors = []
  for (const required of ['Refs', 'Value', 'Footprint']) {
    if (!header.includes(required)) errors.push({ severity: 'ERROR', code: 'BOM_REQUIRED_COLUMN_MISSING', message: `BOM is missing required column ${required}.` })
  }
  if (!body.length) warnings.push({ severity: 'WARNING', code: 'BOM_EMPTY', message: 'BOM CSV contains no component rows.' })
  const refsIndex = header.indexOf('Refs')
  const valueIndex = header.indexOf('Value')
  const footprintIndex = header.indexOf('Footprint')
  for (const [index, row] of body.entries()) {
    if (refsIndex >= 0 && !row[refsIndex]?.trim()) errors.push({ severity: 'ERROR', code: 'BOM_ROW_MISSING_REFS', message: `BOM row ${index + 2} is missing refs.` })
    if (valueIndex >= 0 && !row[valueIndex]?.trim()) warnings.push({ severity: 'WARNING', code: 'BOM_ROW_MISSING_VALUE', message: `BOM row ${index + 2} is missing value.` })
    if (footprintIndex >= 0 && !row[footprintIndex]?.trim()) warnings.push({ severity: 'WARNING', code: 'BOM_ROW_MISSING_FOOTPRINT', message: `BOM row ${index + 2} is missing footprint.` })
  }
  return { file, exists: true, rowCount: body.length, errors, warnings }
}

async function validateCpl(file) {
  if (!existsSync(file)) return { file, exists: false, rowCount: 0, errors: [{ severity: 'ERROR', code: 'CPL_MISSING', message: 'CPL/pick-and-place CSV has not been exported.' }], warnings: [] }
  const rows = parseCsv(await readFile(file, 'utf8'))
  const header = rows[0] || []
  const body = rows.slice(1).filter((row) => row.some((cell) => cell.trim()))
  const warnings = []
  const errors = []
  const refIndex = findHeader(header, ['Ref', 'Designator', 'Refs'])
  const xIndex = findHeader(header, ['PosX', 'X', 'Mid X'])
  const yIndex = findHeader(header, ['PosY', 'Y', 'Mid Y'])
  const rotIndex = findHeader(header, ['Rot', 'Rotation'])
  if (refIndex < 0) errors.push({ severity: 'ERROR', code: 'CPL_REF_COLUMN_MISSING', message: 'CPL is missing a reference/designator column.' })
  if (xIndex < 0 || yIndex < 0) errors.push({ severity: 'ERROR', code: 'CPL_COORD_COLUMNS_MISSING', message: 'CPL is missing X/Y coordinate columns.' })
  if (!body.length) warnings.push({ severity: 'WARNING', code: 'CPL_EMPTY', message: 'CPL CSV contains no placement rows.' })
  for (const [index, row] of body.entries()) {
    if (refIndex >= 0 && !row[refIndex]?.trim()) errors.push({ severity: 'ERROR', code: 'CPL_ROW_MISSING_REF', message: `CPL row ${index + 2} is missing ref.` })
    if (xIndex >= 0 && Number.isNaN(Number(row[xIndex]))) errors.push({ severity: 'ERROR', code: 'CPL_ROW_BAD_X', message: `CPL row ${index + 2} has non-numeric X coordinate.` })
    if (yIndex >= 0 && Number.isNaN(Number(row[yIndex]))) errors.push({ severity: 'ERROR', code: 'CPL_ROW_BAD_Y', message: `CPL row ${index + 2} has non-numeric Y coordinate.` })
    if (rotIndex >= 0 && row[rotIndex] && Number.isNaN(Number(row[rotIndex]))) warnings.push({ severity: 'WARNING', code: 'CPL_ROW_BAD_ROTATION', message: `CPL row ${index + 2} has non-numeric rotation.` })
  }
  return { file, exists: true, rowCount: body.length, errors, warnings }
}

function findHeader(header, names) {
  const normalized = header.map((item) => String(item || '').trim().toLowerCase())
  return normalized.findIndex((item) => names.map((name) => name.toLowerCase()).includes(item))
}

function parseCsv(text) {
  return String(text || '').trim().split(/\r?\n/).filter(Boolean).map((line) => {
    const cells = []
    let current = ''
    let quoted = false
    for (let index = 0; index < line.length; index += 1) {
      const char = line[index]
      if (char === '"' && line[index + 1] === '"') {
        current += '"'
        index += 1
      } else if (char === '"') {
        quoted = !quoted
      } else if (char === ',' && !quoted) {
        cells.push(current)
        current = ''
      } else {
        current += char
      }
    }
    cells.push(current)
    return cells
  })
}

function extractReportIssues(report) {
  const text = JSON.stringify(report || {})
  const errors = (text.match(/"severity"\s*:\s*"error"/gi) || []).length
  const warnings = (text.match(/"severity"\s*:\s*"warning"/gi) || []).length
  return { errors, warnings }
}
