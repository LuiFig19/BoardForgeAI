import { access, copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

export async function auditOriginalEscSpec({ derivativeDir, originalDir, restore = false } = {}) {
  if (!derivativeDir) throw new Error('derivativeDir is required')
  const referenceDir = originalDir || await findOriginalReferenceDir(derivativeDir)
  if (!referenceDir) {
    return {
      status: 'ORIGINAL_REFERENCE_MISSING',
      derivativePath: derivativeDir,
      originalReferencePath: null,
      restorationPerformed: false,
      finalOriginalSpecStatus: 'blocked_missing_original_reference',
      blockers: ['Original ESC reference project or earliest untouched derivative backup was not found.'],
    }
  }

  const derivative = await loadProjectSpec(derivativeDir)
  const original = await loadProjectSpec(referenceDir)
  const comparison = compareSpecs(original, derivative)
  const needsRestore = hasSpecChanges(comparison)
  const restored = []
  let backup = null

  if (restore && needsRestore) {
    backup = await backupDerivativeSpecFiles(derivativeDir)
    if (comparison.symbolsChanged.length || comparison.mpnsChanged.length) {
      await copyIfExists(path.join(referenceDir, 'FN-ESC1.kicad_sch'), path.join(derivativeDir, 'FN-ESC1.kicad_sch'))
      restored.push('schematic_symbols_and_bom_identity')
    }
    const pcbIdentityChanged = Boolean(
      comparison.partsAdded.length ||
      comparison.partsDeleted.length ||
      comparison.footprintsChanged.length ||
      comparison.padsNetsChanged.length ||
      comparison.connectorsChanged.length ||
      comparison.mountingHolesChanged
    )
    if (
      pcbIdentityChanged
    ) {
      await copyIfExists(path.join(referenceDir, 'FN-ESC1.kicad_pcb'), path.join(derivativeDir, 'FN-ESC1.kicad_pcb'))
      restored.push('pcb_parts_footprints_pads_nets_outline_mounting_holes')
    }
  }

  const finalStatus = needsRestore
    ? restore
      ? 'Original spec restored before routing.'
      : 'Original spec differs; restoration required before routing.'
    : 'Original spec verified. No parts, footprints, packages, pads, nets, or required components were changed.'

  return {
    status: needsRestore ? (restore ? 'ORIGINAL_SPEC_RESTORED' : 'ORIGINAL_SPEC_RESTORE_REQUIRED') : 'ORIGINAL_SPEC_VERIFIED',
    derivativePath: derivativeDir,
    originalReferencePath: referenceDir,
    backupUsed: backup,
    partsAdded: comparison.partsAdded,
    partsDeleted: comparison.partsDeleted,
    footprintsChanged: comparison.footprintsChanged,
    symbolsChanged: comparison.symbolsChanged,
    mpnsChanged: comparison.mpnsChanged,
    padsNetsChanged: comparison.padsNetsChanged,
    connectorsChanged: comparison.connectorsChanged,
    boardOutlineChanged: comparison.boardOutlineChanged,
    mountingHolesChanged: comparison.mountingHolesChanged,
    restorationPerformed: restored,
    finalOriginalSpecStatus: finalStatus,
    counts: {
      originalRefs: original.footprints.size,
      derivativeRefs: derivative.footprints.size,
      originalSymbols: original.symbols.size,
      derivativeSymbols: derivative.symbols.size,
    },
  }
}

export async function writeOriginalSpecAuditReport({ projectDir, audit } = {}) {
  await mkdir(projectDir, { recursive: true })
  const jsonPath = path.join(projectDir, 'boardforge-esc-original-spec-audit.json')
  const mdPath = path.join(projectDir, 'BoardForge_ESC_Original_Spec_Audit.md')
  await writeFile(jsonPath, JSON.stringify(audit, null, 2), 'utf8')
  await writeFile(mdPath, markdownAudit(audit), 'utf8')
  return { json: jsonPath, markdown: mdPath }
}

async function findOriginalReferenceDir(derivativeDir) {
  const candidates = [
    path.resolve(derivativeDir, '..', '..', 'FN-ESC1'),
    path.resolve(derivativeDir, '..', '..', 'BoardForge_ESC_Working_Copy_20260621_214837', 'FN-ESC1'),
  ]
  for (const candidate of candidates) {
    if (candidate === derivativeDir) continue
    if (await exists(path.join(candidate, 'FN-ESC1.kicad_pcb'))) return candidate
  }
  return null
}

async function loadProjectSpec(projectDir) {
  const pcbText = await readMaybe(path.join(projectDir, 'FN-ESC1.kicad_pcb'))
  const schText = await readMaybe(path.join(projectDir, 'FN-ESC1.kicad_sch'))
  return {
    projectDir,
    footprints: parseFootprints(pcbText),
    symbols: parseSymbols(schText),
    boardOutline: parseEdgeCuts(pcbText),
    mountingHoles: parseMountingHoles(pcbText),
  }
}

function compareSpecs(original, derivative) {
  const originalRefs = new Set(original.footprints.keys())
  const derivativeRefs = new Set(derivative.footprints.keys())
  const partsAdded = [...derivativeRefs].filter((ref) => !originalRefs.has(ref)).sort()
  const partsDeleted = [...originalRefs].filter((ref) => !derivativeRefs.has(ref)).sort()
  const footprintsChanged = []
  const padsNetsChanged = []
  const connectorsChanged = []

  for (const ref of originalRefs) {
    const before = original.footprints.get(ref)
    const after = derivative.footprints.get(ref)
    if (!after) continue
    if (before.footprint !== after.footprint) {
      const change = { ref, original: before.footprint, derivative: after.footprint }
      footprintsChanged.push(change)
      if (/^J/i.test(ref)) connectorsChanged.push(change)
    }
    if (JSON.stringify(before.pads) !== JSON.stringify(after.pads)) {
      padsNetsChanged.push({ ref, originalPadCount: before.pads.length, derivativePadCount: after.pads.length })
    }
  }

  const symbolsChanged = []
  const mpnsChanged = []
  for (const [ref, before] of original.symbols) {
    const after = derivative.symbols.get(ref)
    if (!after) continue
    if (before.libId !== after.libId || before.footprint !== after.footprint) {
      symbolsChanged.push({ ref, originalLibId: before.libId, derivativeLibId: after.libId, originalFootprint: before.footprint, derivativeFootprint: after.footprint })
    }
    if (before.mpn !== after.mpn) {
      mpnsChanged.push({ ref, original: before.mpn, derivative: after.mpn })
    }
  }

  return {
    partsAdded,
    partsDeleted,
    footprintsChanged,
    symbolsChanged,
    mpnsChanged,
    padsNetsChanged,
    connectorsChanged,
    boardOutlineChanged: JSON.stringify(original.boardOutline) !== JSON.stringify(derivative.boardOutline),
    mountingHolesChanged: JSON.stringify(original.mountingHoles) !== JSON.stringify(derivative.mountingHoles),
  }
}

function hasSpecChanges(comparison) {
  return Boolean(
    comparison.partsAdded.length ||
    comparison.partsDeleted.length ||
    comparison.footprintsChanged.length ||
    comparison.symbolsChanged.length ||
    comparison.mpnsChanged.length ||
    comparison.padsNetsChanged.length ||
    comparison.connectorsChanged.length ||
    comparison.boardOutlineChanged ||
    comparison.mountingHolesChanged
  )
}

function parseFootprints(text) {
  const out = new Map()
  for (const block of blocksFor(text, 'footprint')) {
    const ref = property(block.text, 'Reference')
    if (!ref) continue
    out.set(ref, {
      ref,
      footprint: block.head,
      value: property(block.text, 'Value'),
      pads: parsePads(block.text),
    })
  }
  return out
}

function parseSymbols(text) {
  const out = new Map()
  for (const block of blocksFor(text, 'symbol')) {
    const ref = property(block.text, 'Reference')
    if (!ref) continue
    out.set(ref, {
      ref,
      libId: block.head,
      value: property(block.text, 'Value'),
      footprint: property(block.text, 'Footprint'),
      mpn: property(block.text, 'Manufacturer_Part_Number') || property(block.text, 'MPN') || property(block.text, 'PartNumber') || property(block.text, 'Part Number'),
    })
  }
  return out
}

function parsePads(blockText) {
  return [...blockText.matchAll(/\(pad\s+"([^"]+)"[\s\S]*?(?:\(net\s+\d+\s+"([^"]*)"\))?/g)]
    .map((match) => ({ pad: match[1], net: match[2] || '' }))
    .sort((a, b) => `${a.pad}:${a.net}`.localeCompare(`${b.pad}:${b.net}`))
}

function parseEdgeCuts(text) {
  return [...graphicBlocks(text)]
    .filter((block) => /\(layer\s+"Edge\.Cuts"\)/.test(block))
    .map((block) => normalizeGeometryBlock(block))
    .sort()
}

function* graphicBlocks(text) {
  const pattern = /\(gr_(?:line|arc|circle|rect|poly)\b/g
  let match
  while ((match = pattern.exec(text))) {
    let depth = 0
    let end = match.index
    for (let index = match.index; index < text.length; index += 1) {
      if (text[index] === '(') depth += 1
      else if (text[index] === ')') {
        depth -= 1
        if (depth === 0) {
          end = index + 1
          break
        }
      }
    }
    yield text.slice(match.index, end)
  }
}

function parseMountingHoles(text) {
  const holes = []
  for (const block of blocksFor(text, 'footprint')) {
    const ref = property(block.text, 'Reference')
    if (!ref || !/^(H|MH|MOUNT)/i.test(ref) && !/mount/i.test(block.head)) continue
    const at = block.text.match(/\(at\s+([-\d.]+)\s+([-\d.]+)/)
    holes.push({ ref, footprint: block.head, x: at ? Number(at[1]) : null, y: at ? Number(at[2]) : null })
  }
  return holes.sort((a, b) => a.ref.localeCompare(b.ref))
}

function* blocksFor(text, kind) {
  const pattern = kind === 'symbol' ? /\(symbol\s+\(lib_id\s+"([^"]+)"/g : new RegExp(`\\(${kind}\\s+"([^"]+)"`, 'g')
  let match
  while ((match = pattern.exec(text))) {
    let depth = 0
    let end = match.index
    for (let index = match.index; index < text.length; index += 1) {
      if (text[index] === '(') depth += 1
      else if (text[index] === ')') {
        depth -= 1
        if (depth === 0) {
          end = index + 1
          break
        }
      }
    }
    yield { head: match[1], text: text.slice(match.index, end) }
  }
}

function property(text, name) {
  return text.match(new RegExp(`\\(property\\s+"${escapeRegex(name)}"\\s+"([^"]*)"`))?.[1] || ''
}

function normalizeGeometryBlock(text) {
  const kind = text.match(/^\(gr_([a-z]+)/)?.[1] || 'graphic'
  const points = [...text.matchAll(/\((?:start|end|mid|center|xy)\s+([-\d.]+)\s+([-\d.]+)/g)]
    .map((match) => `${roundCoord(match[1])},${roundCoord(match[2])}`)
  return `${kind}:${points.join(';')}`
}

function roundCoord(value) {
  return Number(value).toFixed(3)
}

function escapeRegex(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

async function backupDerivativeSpecFiles(projectDir) {
  const stamp = new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14)
  const backups = []
  for (const name of ['FN-ESC1.kicad_pcb', 'FN-ESC1.kicad_sch']) {
    const src = path.join(projectDir, name)
    const dst = path.join(projectDir, `${name}.bf_original_spec_restore_${stamp}.bak`)
    if (await exists(src)) {
      await copyFile(src, dst)
      backups.push(dst)
    }
  }
  return backups
}

async function copyIfExists(src, dst) {
  if (await exists(src)) await copyFile(src, dst)
}

async function readMaybe(file) {
  try {
    return await readFile(file, 'utf8')
  } catch {
    return ''
  }
}

async function exists(file) {
  try {
    await access(file)
    return true
  } catch {
    return false
  }
}

function markdownAudit(audit) {
  return [
    '# BoardForge ESC Original Spec Audit',
    '',
    `ESC derivative path: ${audit.derivativePath}`,
    `Original reference path: ${audit.originalReferencePath || 'not found'}`,
    `Backup used: ${Array.isArray(audit.backupUsed) ? audit.backupUsed.join(', ') : audit.backupUsed || 'none'}`,
    `Parts added: ${audit.partsAdded?.length || 0}`,
    `Parts deleted: ${audit.partsDeleted?.length || 0}`,
    `Footprints changed: ${audit.footprintsChanged?.length || 0}`,
    `Symbols changed: ${audit.symbolsChanged?.length || 0}`,
    `MPNs changed: ${audit.mpnsChanged?.length || 0}`,
    `Pads/nets changed: ${audit.padsNetsChanged?.length || 0}`,
    `Connectors changed: ${audit.connectorsChanged?.length || 0}`,
    `Board outline changed: ${Boolean(audit.boardOutlineChanged)}`,
    `Mounting holes changed: ${Boolean(audit.mountingHolesChanged)}`,
    `Restoration performed: ${audit.restorationPerformed?.length ? audit.restorationPerformed.join(', ') : 'none'}`,
    `Final status: ${audit.finalOriginalSpecStatus}`,
    '',
  ].join('\n')
}
