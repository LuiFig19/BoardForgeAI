import { existsSync } from 'node:fs'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { validateManufacturingReadiness } from './manufacturing-readiness.mjs'

export async function validateJlcpcbPackage(projectDir, options = {}) {
  const readiness = await validateManufacturingReadiness(projectDir, options)
  const fabDir = path.join(projectDir, 'fab')
  const gerbers = await collectFiles(path.join(fabDir, 'gerbers'))
  const drills = await collectFiles(path.join(fabDir, 'drill'))
  const bom = await readCsv(path.join(fabDir, 'bom.csv'))
  const cpl = await readCsv(path.join(fabDir, 'cpl.csv'))
  const components = await readJson(path.join(projectDir, 'boardforge-components.json')) || []
  const errors = [
    ...readiness.errors,
    ...validateGerbers(gerbers),
    ...validateDrills(drills),
    ...validateAssemblyTables({ bom, cpl, components }),
  ]
  const warnings = [
    ...readiness.warnings,
    ...gerberWarnings(gerbers),
    ...drillWarnings(drills),
    ...assemblyWarnings({ bom, cpl, components }),
  ]
  const report = {
    status: errors.length ? 'JLCPCB_PACKAGE_BLOCKED' : warnings.length ? 'JLCPCB_PACKAGE_NEEDS_REVIEW' : 'JLCPCB_PACKAGE_READY_NEEDS_FINAL_HUMAN_REVIEW',
    projectDir,
    generatedAt: new Date().toISOString(),
    readiness,
    files: {
      gerbers: gerbers.map(fileSummary),
      drill: drills.map(fileSummary),
      bom: { path: bom.path, exists: bom.exists, rows: bom.body.length, headers: bom.header },
      cpl: { path: cpl.path, exists: cpl.exists, rows: cpl.body.length, headers: cpl.header },
    },
    assembly: {
      componentRefs: components.map((component) => component.ref).filter(Boolean).sort(),
      bomRefs: refsFromBom(bom).sort(),
      cplRefs: refsFromCpl(cpl).sort(),
      readinessScore: assemblyReadinessScore({ bom, cpl, components, errors, warnings }),
    },
    errors,
    warnings,
    gates: {
      requiresCleanDrc: true,
      requiresCleanErc: true,
      requiresGerbers: true,
      requiresDrill: true,
      requiresBom: true,
      requiresCpl: true,
      requiresBomCplRefMatch: true,
      requiresFinalHumanReview: true,
    },
    humanReviewRequired: true,
  }
  if (options.write !== false) {
    const outputFile = path.join(projectDir, 'boardforge-jlcpcb-package-validation.json')
    await writeFile(outputFile, JSON.stringify(report, null, 2), 'utf8')
    return { ...report, outputFile }
  }
  return report
}

function validateGerbers(files) {
  const errors = []
  if (!files.length) errors.push(issue('ERROR', 'GERBERS_MISSING', 'No Gerber files were found in fab/gerbers.'))
  const names = files.map((file) => path.basename(file).toLowerCase())
  for (const required of ['edge', 'f_cu']) {
    if (!names.some((name) => name.includes(required) || name.includes(required.replace('_', '.')))) {
      errors.push(issue('ERROR', 'GERBER_REQUIRED_LAYER_MISSING', `Gerber layer ${required} was not detected.`))
    }
  }
  return errors
}

function gerberWarnings(files) {
  const names = files.map((file) => path.basename(file).toLowerCase())
  return [
    ...(['b_cu', 'f_mask', 'b_mask', 'f_silk'].filter((required) => !names.some((name) => name.includes(required) || name.includes(required.replace('_', '.')))).map((layer) => issue('WARNING', 'GERBER_LAYER_NOT_DETECTED', `Gerber layer ${layer} was not detected; verify export layer set.`))),
  ]
}

function validateDrills(files) {
  if (!files.length) return [issue('ERROR', 'DRILL_FILES_MISSING', 'No drill files were found in fab/drill.')]
  if (!files.some((file) => /\.(drl|xln|txt)$/i.test(file))) return [issue('ERROR', 'EXCELLON_DRILL_NOT_DETECTED', 'No Excellon drill file was detected.')]
  return []
}

function drillWarnings(files) {
  return files.some((file) => /report|rpt/i.test(path.basename(file))) ? [] : [issue('WARNING', 'DRILL_REPORT_NOT_DETECTED', 'No drill report was detected; verify holes before ordering.')]
}

function validateAssemblyTables({ bom, cpl, components }) {
  const errors = []
  if (!bom.exists) errors.push(issue('ERROR', 'BOM_MISSING', 'BOM CSV is missing.'))
  if (!cpl.exists) errors.push(issue('ERROR', 'CPL_MISSING', 'CPL CSV is missing.'))
  if (bom.exists && !bom.body.length) errors.push(issue('ERROR', 'BOM_EMPTY_FOR_ASSEMBLY', 'BOM has no component rows.'))
  if (cpl.exists && !cpl.body.length) errors.push(issue('ERROR', 'CPL_EMPTY_FOR_ASSEMBLY', 'CPL has no placement rows.'))
  const bomRefs = new Set(refsFromBom(bom))
  const cplRefs = new Set(refsFromCpl(cpl))
  const placedRefs = components.filter((component) => isAssemblyComponent(component)).map((component) => component.ref).filter(Boolean)
  const missingInBom = placedRefs.filter((ref) => !bomRefs.has(ref))
  const missingInCpl = placedRefs.filter((ref) => !cplRefs.has(ref))
  const bomOnlyRefs = [...bomRefs].filter((ref) => !cplRefs.has(ref) && isAssemblyRef(ref))
  const cplOnlyRefs = [...cplRefs].filter((ref) => !bomRefs.has(ref) && isAssemblyRef(ref))
  if (missingInBom.length) errors.push(issue('ERROR', 'ASSEMBLY_REFS_MISSING_FROM_BOM', `${missingInBom.length} placed refs are missing from BOM.`, { refs: missingInBom }))
  if (missingInCpl.length) errors.push(issue('ERROR', 'ASSEMBLY_REFS_MISSING_FROM_CPL', `${missingInCpl.length} placed refs are missing from CPL.`, { refs: missingInCpl }))
  if (bomOnlyRefs.length) errors.push(issue('ERROR', 'BOM_REFS_MISSING_FROM_CPL', `${bomOnlyRefs.length} BOM refs are missing from CPL placement rows.`, { refs: bomOnlyRefs }))
  if (cplOnlyRefs.length) errors.push(issue('ERROR', 'CPL_REFS_MISSING_FROM_BOM', `${cplOnlyRefs.length} CPL refs are missing from BOM sourcing rows.`, { refs: cplOnlyRefs }))
  return errors
}

function assemblyWarnings({ bom, cpl, components }) {
  const warnings = []
  const cplRefs = new Set(refsFromCpl(cpl))
  for (const component of components.filter((item) => isAssemblyComponent(item))) {
    if (!component.footprint) warnings.push(issue('WARNING', 'COMPONENT_FOOTPRINT_MISSING', `${component.ref} has no footprint in BoardForge component manifest.`, { ref: component.ref }))
    if (!component.model3d) warnings.push(issue('WARNING', 'COMPONENT_3D_MODEL_MISSING', `${component.ref} has no linked 3D model.`, { ref: component.ref }))
    if (cplRefs.has(component.ref) && !Number.isFinite(Number(component.x))) warnings.push(issue('WARNING', 'COMPONENT_POSITION_NOT_IN_STATE', `${component.ref} appears in CPL but has no state x coordinate.`, { ref: component.ref }))
  }
  if (bom.exists && !findHeader(bom.header, ['LCSC', 'JLCPCB Part #', 'MPN'])) warnings.push(issue('WARNING', 'BOM_SOURCE_COLUMN_MISSING', 'BOM has no LCSC/JLCPCB/MPN sourcing column.'))
  return warnings
}

function refsFromBom(csv) {
  const index = findHeader(csv.header, ['Refs', 'Ref', 'Designator'])
  if (index < 0) return []
  return csv.body.flatMap((row) => splitRefs(row[index]))
}

function refsFromCpl(csv) {
  const index = findHeader(csv.header, ['Ref', 'Refs', 'Designator'])
  if (index < 0) return []
  return csv.body.flatMap((row) => splitRefs(row[index]))
}

function splitRefs(value) {
  return String(value || '').split(/[,\s]+/).map((ref) => ref.trim()).filter(Boolean)
}

function isAssemblyComponent(component) {
  return component?.ref && !component.dnp && !/^TP/i.test(component.ref) && !/MOUNT|HOLE|FIDUCIAL/i.test(`${component.group || ''} ${component.value || ''}`)
}

function isAssemblyRef(ref) {
  return ref && !/^TP/i.test(ref) && !/^(MH|H|FID)/i.test(ref)
}

function assemblyReadinessScore({ bom, cpl, components, errors, warnings }) {
  let score = 100
  if (!bom.exists) score -= 25
  if (!cpl.exists) score -= 25
  score -= errors.filter((item) => /BOM|CPL|ASSEMBLY/.test(item.code)).length * 15
  score -= warnings.filter((item) => /BOM|CPL|COMPONENT/.test(item.code)).length * 5
  const assemblyCount = components.filter((component) => isAssemblyComponent(component)).length
  if (assemblyCount && bom.exists && cpl.exists) {
    const bomRefs = new Set(refsFromBom(bom))
    const cplRefs = new Set(refsFromCpl(cpl))
    const matched = components.filter((component) => isAssemblyComponent(component) && bomRefs.has(component.ref) && cplRefs.has(component.ref)).length
    score -= Math.round((1 - matched / assemblyCount) * 30)
  }
  return Math.max(0, Math.min(100, score))
}

async function collectFiles(directory) {
  try {
    const entries = await readdir(directory, { withFileTypes: true })
    const files = []
    for (const entry of entries) {
      const full = path.join(directory, entry.name)
      if (entry.isDirectory()) files.push(...await collectFiles(full))
      else files.push(full)
    }
    return files
  } catch {
    return []
  }
}

async function readCsv(file) {
  if (!existsSync(file)) return { path: file, exists: false, header: [], body: [] }
  const rows = parseCsv(await readFile(file, 'utf8'))
  return { path: file, exists: true, header: rows[0] || [], body: rows.slice(1).filter((row) => row.some((cell) => String(cell).trim())) }
}

async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'))
  } catch {
    return null
  }
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
      } else if (char === '"') quoted = !quoted
      else if (char === ',' && !quoted) {
        cells.push(current)
        current = ''
      } else current += char
    }
    cells.push(current)
    return cells
  })
}

function fileSummary(file) {
  return { path: file, name: path.basename(file) }
}

function issue(severity, code, message, details = {}) {
  return { severity, code, message, details }
}
