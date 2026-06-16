import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { round } from './geometry.mjs'
import { findKiCadProjectFiles } from './kicad-cli.mjs'

export async function applyPlacementPlanToPcb(projectDir, components = [], options = {}) {
  const files = await findKiCadProjectFiles(projectDir)
  if (!files.pcbFile) {
    return {
      status: 'PLACEMENT_APPLY_BLOCKED',
      warnings: [],
      errors: [{ severity: 'ERROR', code: 'PCB_FILE_MISSING', message: 'No .kicad_pcb file was found for placement application.' }],
      updatedRefs: [],
      missingRefs: components.map((component) => component.ref).filter(Boolean),
      humanReviewRequired: true,
    }
  }
  const before = await readFile(files.pcbFile, 'utf8')
  let text = before
  const updatedRefs = []
  const missingRefs = []
  for (const component of components.filter((item) => item.ref)) {
    const updated = updateFootprintPlacement(text, component)
    if (updated.changed) {
      text = updated.text
      updatedRefs.push(component.ref)
    } else {
      missingRefs.push(component.ref)
    }
  }
  const warnings = [
    ...(missingRefs.length ? [{ severity: 'WARNING', code: 'PLACEMENT_REFS_NOT_FOUND', message: `${missingRefs.length} components were not found in the PCB file.`, details: { refs: missingRefs } }] : []),
    { severity: 'WARNING', code: 'PLACEMENT_REQUIRES_DRC', message: 'Footprint positions were updated; run KiCad DRC before routing or export.' },
  ]
  if (options.dryRun) {
    return { status: updatedRefs.length ? 'PLACEMENT_APPLY_DRY_RUN' : 'PLACEMENT_APPLY_NO_MATCHES', warnings, errors: [], pcbFile: files.pcbFile, updatedRefs, missingRefs, humanReviewRequired: true }
  }
  if (updatedRefs.length) await writeFile(files.pcbFile, text, 'utf8')
  return {
    status: updatedRefs.length ? 'PLACEMENT_APPLIED_NEEDS_DRC' : 'PLACEMENT_APPLY_NO_MATCHES',
    warnings,
    errors: [],
    pcbFile: files.pcbFile,
    updatedRefs,
    missingRefs,
    generatedFiles: updatedRefs.length ? [files.pcbFile, path.join(projectDir, 'boardforge-components.json')] : [],
    humanReviewRequired: true,
  }
}

function updateFootprintPlacement(text, component) {
  const blocks = findFootprintBlocks(text)
  const block = blocks.find((item) => footprintRef(item.text) === component.ref)
  if (!block) return { changed: false, text }
  const replacement = replaceAt(block.text, component)
  if (replacement === block.text) return { changed: false, text }
  return { changed: true, text: `${text.slice(0, block.start)}${replacement}${text.slice(block.end)}` }
}

function findFootprintBlocks(text) {
  const blocks = []
  const pattern = /\(footprint\s+"[^"]+"/g
  let match = pattern.exec(text)
  while (match) {
    const start = match.index
    const close = findClosingParen(text, start)
    if (close < 0) break
    blocks.push({ start, end: close + 1, text: text.slice(start, close + 1) })
    pattern.lastIndex = close + 1
    match = pattern.exec(text)
  }
  return blocks
}

function footprintRef(block) {
  return block.match(/\(property\s+"Reference"\s+"([^"]+)"/)?.[1] || null
}

function replaceAt(block, component) {
  const at = `(at ${round(component.x)} ${round(component.y)} ${round(component.rotation || 0)})`
  if (/\(at\s+[-\d.]+\s+[-\d.]+(?:\s+[-\d.]+)?\)/.test(block)) return block.replace(/\(at\s+[-\d.]+\s+[-\d.]+(?:\s+[-\d.]+)?\)/, at)
  return block.replace(/(\(layer\s+"[FB]\.Cu"\)\s*)/, `$1\n\t${at}\n`)
}

function findClosingParen(text, start) {
  let depth = 0
  for (let index = start; index < text.length; index += 1) {
    if (text[index] === '(') depth += 1
    if (text[index] === ')') depth -= 1
    if (depth === 0) return index
  }
  return -1
}
