import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { evaluateReplacementCandidate, supplierApiConfig } from './part-availability.mjs'

const blockerRefs = ['Q14', 'Q16', 'D10', 'D11', 'C70', 'C71', 'J5']
const trustedSuppliers = ['Digi-Key', 'Mouser', 'Newark', 'element14', 'Arrow', 'Manufacturer Direct']

export async function extractCurrentMpnRecords({ projectDir, refs = blockerRefs } = {}) {
  const files = await readProjectTextFiles(projectDir)
  return refs.map((ref) => {
    const sources = files
      .map((file) => extractPropertiesForRef(file, ref))
      .filter(Boolean)
    const best = sources.find((item) => item.file.endsWith('.kicad_sch') && findMpn(item.properties))
      || sources.find((item) => findMpn(item.properties))
      || sources[0]
    const properties = best?.properties || {}
    const value = properties.Value || ''
    const description = properties.Description || ''
    return {
      ref,
      footprint: properties.Footprint || best?.footprint || '',
      currentMpn: findMpn(properties) || '',
      manufacturer: properties.Manufacturer_Name || properties.Manufacturer || '',
      value,
      datasheet: properties.Datasheet || '',
      ratingsFound: inferRatings({ ref, value, description, footprint: properties.Footprint || best?.footprint || '' }),
      sourceOfTruth: best ? sourceOfTruth(best.file, properties) : 'unknown',
      status: findMpn(properties) ? 'CURRENT_MPN_FOUND' : 'CURRENT_MPN_UNKNOWN_NEEDS_USER_OR_BOM',
    }
  })
}

export function classifyReplacementBlockers(records = []) {
  return records.map((record) => {
    const isFet = /^Q/i.test(record.ref) || /EPC|FET|Transistor/i.test(`${record.footprint} ${record.value} ${record.currentMpn}`)
    const isConnector = /^J/i.test(record.ref)
    const isSupportPassive = /^[CDR]/i.test(record.ref)
    let classification = 'NOT_REPLACEMENT_CANDIDATE'
    if (isFet || isConnector) classification = record.currentMpn ? 'ROUTING_BLOCKER_REPLACEMENT_USEFUL' : 'NEEDS_MPN_FIRST'
    else if (isSupportPassive) classification = 'ROUTING_BLOCKER_MOVE_ONLY'
    return {
      ref: record.ref,
      currentMpn: record.currentMpn,
      currentFootprint: record.footprint,
      classification,
      replacementCouldHelp: classification === 'ROUTING_BLOCKER_REPLACEMENT_USEFUL' || classification === 'NEEDS_MPN_FIRST',
      reason: replacementReason(record, classification),
    }
  })
}

export function generateReplacementShoppingItems(records = [], blockerAnalysis = []) {
  const byRef = new Map(blockerAnalysis.map((item) => [item.ref, item]))
  return records
    .filter((record) => byRef.get(record.ref)?.replacementCouldHelp)
    .map((record) => {
      const isConnector = /^J/i.test(record.ref)
      const isFet = /^Q/i.test(record.ref)
      return {
        ref: record.ref,
        currentMpn: record.currentMpn || 'CURRENT_MPN_UNKNOWN_NEEDS_USER_OR_BOM',
        currentFootprint: record.footprint,
        replacementGoal: isConnector
          ? 'same-current-or-better motor phase connector/terminal footprint that opens M2 phase corridor'
          : 'smaller or more routable same/equivalent power FET package that opens M2 phase corridor',
        requiredRatings: isFet
          ? {
              voltage: record.ratingsFound.voltage || 'same or better than current FET',
              current: record.ratingsFound.current || 'same or better than current FET',
              thermal: record.ratingsFound.thermal || 'same or better thermal performance',
              rdsOn: record.ratingsFound.rdsOn || 'same or lower RDS(on)',
            }
          : {
              voltage: 'same or better than current connector application',
              current: 'same or better motor phase current rating',
              thermal: 'connector temperature rise acceptable at ESC phase current',
              rdsOn: '',
            },
        pinoutRequirements: isConnector
          ? 'same pin count and net role; J5 pad 3 must remain /M2_C_SW and connector must remain usable inside fixed outline'
          : 'same transistor function and source/drain/gate pin mapping verified against schematic/footprint before use',
        footprintRequirements: 'package/footprint must improve /M2_C_SW corridor and pass geometry precheck; no via-in-pad required',
        supplierSearchTerms: buildSearchTerms(record, isConnector),
        mustBeInStock: true,
        minStockQty: 10,
        preferredSuppliers: trustedSuppliers.filter((item) => item !== 'Manufacturer Direct'),
      }
    })
}

export async function loadManualStockVerification({ projectDir } = {}) {
  const jsonPath = path.join(projectDir, 'boardforge-manual-stock-verification.json')
  const csvPath = path.join(projectDir, 'boardforge-manual-stock-verification.csv')
  if (await exists(jsonPath)) {
    const parsed = JSON.parse(await readFile(jsonPath, 'utf8'))
    return validateManualStockEntries(parsed.candidates || [], jsonPath)
  }
  if (await exists(csvPath)) {
    return validateManualStockEntries(parseCsv(await readFile(csvPath, 'utf8')), csvPath)
  }
  return { found: false, path: null, candidates: [], accepted: [], rejected: [] }
}

export function validateManualStockEntries(candidates = [], sourcePath = null) {
  const accepted = []
  const rejected = []
  for (const candidate of candidates) {
    const missing = ['ref', 'replacementPart', 'manufacturer', 'supplier', 'supplierSku', 'stockQty'].filter((field) => !hasValue(candidate[field]))
    if (!trustedSuppliers.includes(candidate.supplier)) missing.push('trustedSupplier')
    if (Number(candidate.stockQty || 0) <= 0) missing.push('stockQty>0')
    const normalized = {
      ...candidate,
      verifiedBy: candidate.verifiedBy || 'manual',
      manualStock: {
        stockQty: Number(candidate.stockQty || 0),
        supplierSku: candidate.supplierSku,
        unitPrice: candidate.unitPrice || null,
        lifecycleStatus: candidate.lifecycleStatus || 'unknown',
        datasheetUrl: candidate.datasheetUrl || null,
      },
      lifecycleStatus: candidate.lifecycleStatus || 'unknown',
    }
    if (missing.length) rejected.push({ ...normalized, status: 'MANUAL_STOCK_REJECTED_INCOMPLETE_DATA', missing })
    else accepted.push({ ...normalized, status: 'MANUAL_STOCK_VERIFIED' })
  }
  return { found: true, path: sourcePath, candidates, accepted, rejected }
}

export async function evaluateManualVerifiedReplacements({ manualVerification, candidateRequirements = [] } = {}) {
  const requirementsByRef = new Map(candidateRequirements.map((item) => [item.ref, item]))
  const evaluated = []
  for (const candidate of manualVerification.accepted || []) {
    const requirement = requirementsByRef.get(candidate.ref) || {}
    evaluated.push(await evaluateReplacementCandidate({
      ...candidate,
      currentPart: requirement.currentMpn || candidate.currentPart || '',
      currentFootprint: requirement.currentFootprint || candidate.currentFootprint || '',
      minimumRequiredQty: requirement.minStockQty || candidate.minimumRequiredQty || 10,
      sameFunction: candidate.sameFunction === true,
      sameOrBetterVoltageRating: candidate.sameOrBetterVoltageRating === true,
      sameOrBetterCurrentRating: candidate.sameOrBetterCurrentRating === true,
      sameOrBetterThermalRating: candidate.sameOrBetterThermalRating === true,
      pinoutVerified: candidate.pinoutVerified === true,
      footprintVerified: candidate.footprintVerified === true,
      manualStock: candidate.manualStock,
    }, { env: {} }))
  }
  return evaluated
}

export async function writeReplacementShoppingList({ projectDir, records = [], blockerAnalysis = [], manualVerification = null } = {}) {
  const items = generateReplacementShoppingItems(records, blockerAnalysis)
  await mkdir(projectDir, { recursive: true })
  const jsonPath = path.join(projectDir, 'boardforge-esc-replacement-shopping-list.json')
  const mdPath = path.join(projectDir, 'BoardForge_ESC_Replacement_Shopping_List.md')
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    apiKeysConfigured: supplierApiConfig(process.env),
    manualVerification: manualVerification ? {
      found: manualVerification.found,
      path: manualVerification.path,
      accepted: manualVerification.accepted.length,
      rejected: manualVerification.rejected.length,
    } : null,
    candidates: items,
    requiredUserManualData: [
      'exact manufacturer replacement MPN',
      'trusted supplier name',
      'supplier SKU',
      'stock quantity',
      'lifecycle status',
      'datasheet/source URL where available',
      'same/better voltage-current-thermal checks',
      'pinout compatibility confirmation',
      'footprint/package compatibility confirmation',
    ],
  }
  await writeFile(jsonPath, JSON.stringify(report, null, 2), 'utf8')
  await writeFile(mdPath, markdownShoppingList(report), 'utf8')
  return { ...report, outputFiles: { json: jsonPath, markdown: mdPath } }
}

async function readProjectTextFiles(projectDir) {
  const names = ['FN-ESC1.kicad_sch', 'FN-ESC1.kicad_pcb', 'boardforge-esc-replacement-sourcing.json', 'boardforge-esc-route-to-finish-sourcing-gate.json']
  const out = []
  for (const name of names) {
    const file = path.join(projectDir, name)
    if (await exists(file)) out.push({ file, text: await readFile(file, 'utf8') })
  }
  return out
}

function extractPropertiesForRef({ file, text }, ref) {
  const blocks = [...blocksFor(text, file.endsWith('.kicad_sch') ? 'symbol' : 'footprint')]
  for (const block of blocks) {
    const properties = Object.fromEntries([...block.text.matchAll(/\(property\s+"([^"]+)"\s+"([^"]*)"/g)].map((match) => [match[1], match[2]]))
    if (properties.Reference === ref) {
      return {
        file,
        properties,
        footprint: file.endsWith('.kicad_pcb') ? block.headValue : properties.Footprint,
      }
    }
  }
  return null
}

function* blocksFor(text, kind) {
  const pattern = kind === 'symbol' ? /\(symbol\b/g : new RegExp(`\\(${kind}\\s+"([^"]+)"`, 'g')
  let match
  while ((match = pattern.exec(text))) {
    let depth = 0
    let end = match.index
    for (; end < text.length; end += 1) {
      if (text[end] === '(') depth += 1
      else if (text[end] === ')') {
        depth -= 1
        if (depth === 0) {
          end += 1
          break
        }
      }
    }
    const blockText = text.slice(match.index, end)
    const headValue = match[1] || blockText.match(/\(lib_id\s+"([^"]+)"/)?.[1] || ''
    yield { text: blockText, headValue }
  }
}

function findMpn(properties = {}) {
  return properties.Manufacturer_Part_Number || properties.MPN || properties.mpn || properties.PartNumber || properties['Part Number'] || ''
}

function sourceOfTruth(file, properties) {
  if (findMpn(properties)) return file.endsWith('.kicad_sch') ? 'schematic field' : 'footprint/KiCad property'
  if (properties.Value) return file.endsWith('.kicad_sch') ? 'schematic value field' : 'footprint value field'
  return 'unknown'
}

function inferRatings({ ref, value = '', description = '', footprint = '' } = {}) {
  const text = `${value} ${description} ${footprint}`
  return {
    voltage: firstMatch(text, /(\d+(?:\.\d+)?)\s*V\b/i),
    current: firstMatch(text, /(?:I\s*D|current|,)\s*[, ]*(\d+(?:\.\d+)?)\s*A\b/i),
    power: firstMatch(text, /(\d+(?:\.\d+)?)\s*W\b/i),
    thermal: '',
    rdsOn: firstMatch(text, /RDS\(on\)\s*,?\s*(\d+(?:\.\d+)?)\s*m/i),
    capacitance: /^C/i.test(ref) ? firstMatch(text, /(\d+(?:\.\d+)?)\s*(?:µF|uF|nF|pF)/i, true) : '',
    package: footprint.split(':').at(-1) || '',
  }
}

function firstMatch(text, regex, includeUnit = false) {
  const match = text.match(regex)
  if (!match) return ''
  return includeUnit ? match[0] : match[1]
}

function replacementReason(record, classification) {
  if (classification === 'ROUTING_BLOCKER_REPLACEMENT_USEFUL') return 'Package/footprint change may improve the M2 phase corridor, but only after sourcing and compatibility are verified.'
  if (classification === 'NEEDS_MPN_FIRST') return 'Current exact MPN is missing; replacement cannot be selected until source part identity is known.'
  if (classification === 'ROUTING_BLOCKER_MOVE_ONLY') return 'Support component movement is preferred; replacement is not currently justified as the main M2 blocker.'
  return 'Not a useful replacement candidate for the current M2 blocker.'
}

function buildSearchTerms(record, isConnector) {
  if (isConnector) return [
    `${record.value || 'motor phase connector'} high current 3 pin connector`,
    `${record.footprint} replacement high current motor output`,
  ]
  return [
    `${record.currentMpn || record.value} equivalent lower footprint power transistor`,
    `${record.manufacturer || ''} ${record.currentMpn || record.value} alternative package`,
    `${record.ratingsFound.voltage || ''}V ${record.ratingsFound.current || ''}A low RDSon GaN FET`,
  ].filter((item) => item.trim())
}

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter((line) => line.trim())
  if (!lines.length) return []
  const headers = splitCsvLine(lines[0])
  return lines.slice(1).map((line) => Object.fromEntries(splitCsvLine(line).map((value, index) => [headers[index], value])))
}

function splitCsvLine(line) {
  const out = []
  let current = ''
  let quoted = false
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i]
    if (char === '"') quoted = !quoted
    else if (char === ',' && !quoted) {
      out.push(current.trim())
      current = ''
    } else current += char
  }
  out.push(current.trim())
  return out
}

function markdownShoppingList(report) {
  const lines = [
    '# BoardForge ESC Replacement Shopping List',
    '',
    `Generated: ${report.generatedAt}`,
    '',
    '## Manual verification fields required',
    ...report.requiredUserManualData.map((item) => `- ${item}`),
    '',
    '## Candidates',
  ]
  for (const item of report.candidates) {
    lines.push('', `### ${item.ref}`, `- Current MPN: ${item.currentMpn}`, `- Current footprint: ${item.currentFootprint}`, `- Goal: ${item.replacementGoal}`, `- Min stock qty: ${item.minStockQty}`, `- Search terms: ${item.supplierSearchTerms.join('; ')}`)
  }
  return `${lines.join('\n')}\n`
}

function hasValue(value) {
  return value !== undefined && value !== null && String(value).trim() !== ''
}

async function exists(file) {
  try {
    await access(file)
    return true
  } catch {
    return false
  }
}
