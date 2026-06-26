import { copyFile, cp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'

export function diagnoseMissingKiCadLibraries({ pcbText = '', schematicText = '', drcReport = null } = {}) {
  const footprintRefs = [...pcbText.matchAll(/\(footprint\s+"([^":]+):([^"]+)"[\s\S]*?\(property\s+"Reference"\s+"([^"]+)"/g)]
    .map((match) => ({ library: match[1], footprint: match[2], ref: match[3] }))
  const symbolRefs = [...schematicText.matchAll(/\(lib_id\s+"([^":]+):([^"]+)"/g)]
    .map((match) => ({ library: match[1], symbol: match[2] }))
  const drcLibraryIssues = reportIssues(drcReport).filter((issue) => /does not include the footprint library|library/i.test(issue.description || issue.message || ''))
  const missingFootprintLibraries = unique([
    ...drcLibraryIssues.map((issue) => issue.description?.match(/footprint library '([^']+)'/)?.[1]).filter(Boolean),
  ])
  const libraries = unique([...missingFootprintLibraries, ...footprintRefs.map((item) => item.library)])
  return libraries.map((library) => {
    const footprints = footprintRefs.filter((item) => item.library === library)
    const symbols = symbolRefs.filter((item) => item.library === library)
    const missing = missingFootprintLibraries.includes(library)
    return {
      library,
      type: missing ? 'missing_or_unresolved' : 'referenced',
      affectedFootprints: footprints.length,
      footprintNames: unique(footprints.map((item) => item.footprint)),
      affectedRefs: unique(footprints.map((item) => item.ref)),
      affectedSymbols: symbols.length,
      symbolNames: unique(symbols.map((item) => item.symbol)),
      blocksDrc: missing,
      blocksExport: missing,
    }
  }).filter((item) => item.affectedFootprints || item.affectedSymbols || item.blocksDrc)
}

export async function searchLocalKiCadLibraries({ roots = [], missingLibraries = [], requiredFootprints = [] }) {
  const candidates = []
  for (const root of roots.filter(Boolean)) {
    if (!existsSync(root)) continue
    await walk(root, async (entry) => {
      if (skipPath(entry)) return 'skip'
      if (/\.pretty$/i.test(entry)) {
        const footprintNames = await footprintNamesInLibrary(entry)
        const matchedFootprints = requiredFootprints.filter((name) => footprintNames.includes(name))
        const basename = path.basename(entry, '.pretty')
        const matchedNickname = missingLibraries.includes(basename)
        candidates.push({
          path: entry,
          type: 'footprint_library',
          nickname: basename,
          footprintCount: footprintNames.length,
          matchedFootprints,
          matchScore: matchedFootprints.length * 10 + (matchedNickname ? 100 : 0),
          why: [matchedNickname ? 'nickname_match' : null, matchedFootprints.length ? 'footprint_name_match' : null].filter(Boolean),
        })
      } else if (/\.kicad_sym$/i.test(entry)) {
        const text = await readFile(entry, 'utf8').catch(() => '')
        candidates.push({
          path: entry,
          type: 'symbol_library',
          symbolCount: [...text.matchAll(/\(symbol\s+"([^"]+)"/g)].length,
          matchedFootprints: [],
          matchScore: /AstraRMM|ESC|FN-ESC/i.test(entry) ? 20 : 0,
          why: /AstraRMM|ESC|FN-ESC/i.test(entry) ? ['project_symbol_candidate'] : [],
        })
      } else if (/\.(step|stp|wrl)$/i.test(entry)) {
        candidates.push({
          path: entry,
          type: '3d_model',
          matchScore: /EPC2367|ABM3B|BZT52|ESC/i.test(entry) ? 10 : 1,
          why: ['model_file'],
        })
      } else if (/^(fp-lib-table|sym-lib-table)$/i.test(path.basename(entry))) {
        candidates.push({
          path: entry,
          type: 'library_table',
          matchScore: /AstraRMM/i.test(await readFile(entry, 'utf8').catch(() => '')) ? 30 : 1,
          why: ['library_table'],
        })
      }
    })
  }
  return candidates.sort((a, b) => b.matchScore - a.matchScore || String(a.path).localeCompare(String(b.path)))
}

export function selectBestFootprintLibraryCandidate(candidates = [], requiredFootprints = []) {
  const footprintCandidates = candidates.filter((item) => item.type === 'footprint_library')
  return footprintCandidates.sort((a, b) => {
    const aMissing = requiredFootprints.filter((name) => !(a.matchedFootprints || []).includes(name)).length
    const bMissing = requiredFootprints.filter((name) => !(b.matchedFootprints || []).includes(name)).length
    return b.matchScore - a.matchScore || aMissing - bMissing
  })[0] || null
}

export async function copyLibrariesToProject({ projectDir, footprintCandidate = null, symbolCandidate = null, modelFiles = [], nickname }) {
  const localRoot = path.join(projectDir, 'boardforge-local-libs')
  const footprintDestRoot = path.join(localRoot, 'footprints')
  const symbolDestRoot = path.join(localRoot, 'symbols')
  const modelDestRoot = path.join(localRoot, '3dmodels')
  await mkdir(footprintDestRoot, { recursive: true })
  await mkdir(symbolDestRoot, { recursive: true })
  await mkdir(modelDestRoot, { recursive: true })
  const copied = { footprints: null, symbol: null, models: [] }
  if (footprintCandidate) {
    const destination = path.join(footprintDestRoot, `${nickname}.pretty`)
    await cp(footprintCandidate.path, destination, { recursive: true, force: true })
    copied.footprints = destination
  }
  if (symbolCandidate) {
    const destination = path.join(symbolDestRoot, `${nickname}.kicad_sym`)
    await copyFile(symbolCandidate.path, destination)
    copied.symbol = destination
  }
  for (const model of modelFiles) {
    const destination = path.join(modelDestRoot, path.basename(model.path || model))
    await copyFile(model.path || model, destination).catch(() => null)
    if (existsSync(destination)) copied.models.push(destination)
  }
  return copied
}

export async function updateFpLibTable({ projectDir, nickname, relativePrettyPath }) {
  const tableFile = path.join(projectDir, 'fp-lib-table')
  const entry = `(lib (name "${nickname}") (type "KiCad") (uri "\${KIPRJMOD}/${relativePrettyPath.replace(/\\/g, '/')}") (options "") (descr "BoardForge copied ${nickname} footprint library"))`
  const text = existsSync(tableFile) ? await readFile(tableFile, 'utf8') : '(fp_lib_table\n)\n'
  const next = upsertTableEntry(text, nickname, entry, 'fp_lib_table')
  const changed = next !== text
  if (changed) await writeFile(tableFile, next, 'utf8')
  return { tableFile, changed, entry }
}

export async function updateSymLibTable({ projectDir, nickname, relativeSymbolPath }) {
  const tableFile = path.join(projectDir, 'sym-lib-table')
  const entry = `(lib (name "${nickname}") (type "KiCad") (uri "\${KIPRJMOD}/${relativeSymbolPath.replace(/\\/g, '/')}") (options "") (descr "BoardForge copied ${nickname} symbol library"))`
  const text = existsSync(tableFile) ? await readFile(tableFile, 'utf8') : '(sym_lib_table\n)\n'
  const next = upsertTableEntry(text, nickname, entry, 'sym_lib_table')
  const changed = next !== text
  if (changed) await writeFile(tableFile, next, 'utf8')
  return { tableFile, changed, entry }
}

export async function validateLibraryResolution({ projectDir, nickname, requiredFootprints = [] }) {
  const fpTable = await readFile(path.join(projectDir, 'fp-lib-table'), 'utf8').catch(() => '')
  const uri = fpTable.match(new RegExp(`\\(lib \\(name "${escapeRegex(nickname)}"\\)[\\s\\S]*?\\(uri "([^"]+)"\\)`))?.[1] || null
  const resolvedPath = uri?.replace('${KIPRJMOD}', projectDir).replace(/\//g, path.sep)
  const presentFootprints = resolvedPath && existsSync(resolvedPath) ? await footprintNamesInLibrary(resolvedPath) : []
  const missingFootprints = requiredFootprints.filter((name) => !presentFootprints.includes(name))
  return {
    status: uri && existsSync(resolvedPath) && missingFootprints.length === 0 ? 'KICAD_LIBRARY_RESOLUTION_READY' : 'KICAD_LIBRARY_RESOLUTION_NEEDS_REVIEW',
    nickname,
    uri,
    resolvedPath,
    requiredFootprints,
    presentFootprintCount: presentFootprints.length,
    missingFootprints,
  }
}

async function footprintNamesInLibrary(dir) {
  if (!existsSync(dir)) return []
  const names = []
  await walk(dir, async (entry) => {
    if (/\.kicad_mod$/i.test(entry)) names.push(path.basename(entry, '.kicad_mod'))
  }, { recursive: false })
  return unique(names)
}

function upsertTableEntry(text, nickname, entry, tableHead) {
  const withoutExisting = text.replace(new RegExp(`\\n\\s*\\(lib \\(name "${escapeRegex(nickname)}"\\)[\\s\\S]*?\\n\\s*\\)`, 'g'), '')
  if (new RegExp(`^\\s*\\(${tableHead}\\s*\\)\\s*$`, 's').test(withoutExisting)) return `(${tableHead}\n  ${entry}\n)\n`
  return withoutExisting.replace(/\n\s*\)\s*$/, `\n  ${entry}\n)\n`)
}

async function walk(root, visit, options = {}) {
  const entries = await import('node:fs/promises').then(({ readdir }) => readdir(root, { withFileTypes: true }).catch(() => []))
  for (const entry of entries) {
    const full = path.join(root, entry.name)
    if (entry.isDirectory()) {
      const action = await visit(full)
      if (action === 'skip') continue
      if (options.recursive !== false) await walk(full, visit, options)
    } else {
      await visit(full)
    }
  }
}

function reportIssues(report) {
  if (!report) return []
  return [...(report.violations || []), ...(report.unconnected_items || [])]
}

function skipPath(entry) {
  return /\\(node_modules|\.next|tmp\\targeted-repair|tmp\\regression|\.git)(\\|$)/i.test(entry)
}

function unique(values) {
  return [...new Set(values.filter(Boolean))]
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
