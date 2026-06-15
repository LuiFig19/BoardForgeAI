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
  const errors = [
    ...gateReport(drc, 'DRC', options.requireDrc !== false),
    ...gateReport(erc, 'ERC', options.requireErc !== false),
    ...bom.errors,
    ...cpl.errors,
  ]
  const warnings = [...drc.warnings, ...erc.warnings, ...bom.warnings, ...cpl.warnings]
  return {
    status: errors.length ? 'MANUFACTURING_READINESS_BLOCKED' : warnings.length ? 'MANUFACTURING_READINESS_NEEDS_REVIEW' : 'MANUFACTURING_READINESS_READY_NEEDS_REVIEW',
    reports: { drc, erc },
    bom,
    cpl,
    errors,
    warnings,
    humanReviewRequired: true,
  }
}

export async function validateExportGate(projectDir, kind, options = {}) {
  const readiness = await validateManufacturingReadiness(projectDir, {
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
  const body = rows.slice(1).filter((row) => row.some((cell) => cell.trim()))
  const warnings = []
  if (!body.length) warnings.push({ severity: 'WARNING', code: 'BOM_EMPTY', message: 'BOM CSV contains no component rows.' })
  return { file, exists: true, rowCount: body.length, errors: [], warnings }
}

async function validateCpl(file) {
  if (!existsSync(file)) return { file, exists: false, rowCount: 0, errors: [{ severity: 'ERROR', code: 'CPL_MISSING', message: 'CPL/pick-and-place CSV has not been exported.' }], warnings: [] }
  const rows = parseCsv(await readFile(file, 'utf8'))
  const body = rows.slice(1).filter((row) => row.some((cell) => cell.trim()))
  const warnings = []
  if (!body.length) warnings.push({ severity: 'WARNING', code: 'CPL_EMPTY', message: 'CPL CSV contains no placement rows.' })
  return { file, exists: true, rowCount: body.length, errors: [], warnings }
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
