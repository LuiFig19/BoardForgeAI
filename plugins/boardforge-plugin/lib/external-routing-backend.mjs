import { existsSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import path from 'node:path'

export function parseKiCadCliPcbHelp(text = '') {
  return {
    hasPcbExport: /\bexport\b/.test(text),
    hasPcbImport: /\bimport\b/.test(text),
    hasDsnExport: /\bdsn\b|specctra/i.test(text),
    hasSesImport: /\bses\b|specctra/i.test(text),
  }
}

export async function findFreeroutingJar(searchRoots = []) {
  const found = []
  for (const root of searchRoots.filter(Boolean)) {
    if (!existsSync(root)) continue
    found.push(...await findFilesShallow(root, /freerouting.*\.jar$/i, 4))
  }
  return found
}

async function findFilesShallow(root, pattern, maxDepth, depth = 0) {
  if (depth > maxDepth) return []
  let entries = []
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch {
    return []
  }
  const matches = []
  for (const entry of entries) {
    const full = path.join(root, entry.name)
    if (entry.isFile() && pattern.test(entry.name)) matches.push(full)
    else if (entry.isDirectory() && !/node_modules|\.git|AppData|Windows/i.test(full)) {
      matches.push(...await findFilesShallow(full, pattern, maxDepth, depth + 1))
    }
  }
  return matches
}

export function selectExternalRoutingBackend({ javaFound = false, freeroutingJar = null, freeroutingCommand = null, dsnExportAvailable = false, sesImportAvailable = false } = {}) {
  const freeRoutingRunnable = Boolean(javaFound && (freeroutingJar || freeroutingCommand) && dsnExportAvailable && sesImportAvailable)
  if (freeRoutingRunnable) {
    return {
      backend: 'freerouting_dsn_ses',
      available: true,
      reason: 'Java, FreeRouting, DSN export, and SES import are available.',
      commands: {
        exportDsn: 'KiCad PCB -> Specctra DSN export',
        autoroute: freeroutingCommand || `java -jar ${freeroutingJar}`,
        importSes: 'Specctra SES -> KiCad PCB import',
      },
    }
  }
  const missing = []
  if (!javaFound) missing.push('java_runtime')
  if (!freeroutingJar && !freeroutingCommand) missing.push('freerouting')
  if (!dsnExportAvailable) missing.push('dsn_export')
  if (!sesImportAvailable) missing.push('ses_import')
  return {
    backend: 'external_router_unavailable',
    available: false,
    reason: `Missing ${missing.join(', ')}.`,
    missing,
    commands: {},
  }
}

export function buildExternalRouterRuleGeneration({ boardType = 'ESC', layerCount = 8 } = {}) {
  return {
    boardType,
    layerCount,
    netClasses: {
      HIGH_CURRENT_POWER: { widthMm: 0.8, clearanceMm: 0.2, preferredLayers: ['In2.Cu', 'F.Cu', 'B.Cu'] },
      MOTOR_PHASE: { widthMm: 0.8, clearanceMm: 0.2, preferredLayers: ['F.Cu', 'B.Cu', 'In2.Cu'] },
      GATE_DRIVE: { widthMm: 0.152, clearanceMm: 0.15, preferredLayers: ['F.Cu', 'B.Cu'] },
      BOOTSTRAP: { widthMm: 0.152, clearanceMm: 0.15, preferredLayers: ['F.Cu', 'B.Cu'] },
      CURRENT_SENSE: { widthMm: 0.127, clearanceMm: 0.15, preferredLayers: ['In5.Cu', 'In3.Cu'] },
      CONTROL_SIGNAL: { widthMm: 0.127, clearanceMm: 0.15, preferredLayers: ['In3.Cu', 'In5.Cu', 'B.Cu', 'F.Cu'] },
      REGULATED_RAIL: { widthMm: 0.25, clearanceMm: 0.15, preferredLayers: ['In4.Cu', 'F.Cu', 'B.Cu'] },
    },
    viaPolicy: {
      allowed: ['through'],
      forbidden: ['blind', 'buried', 'microvia', 'via-in-pad'],
    },
  }
}

export function validateExternalRouterResult({ originalSpec = {}, before = {}, after = {}, forbiddenVias = [] } = {}) {
  const forbiddenChanges = [
    ['partsChanged', originalSpec.partsChanged],
    ['footprintsChanged', originalSpec.footprintsChanged],
    ['packagesChanged', originalSpec.packagesChanged],
    ['padsNetsChanged', originalSpec.padsNetsChanged],
    ['boardOutlineChanged', originalSpec.boardOutlineChanged],
    ['mountingHolesChanged', originalSpec.mountingHolesChanged],
  ].filter(([, value]) => value === true || Number(value) > 0).map(([key]) => key)
  const unconnectedImproved = Number(after.unconnected ?? Infinity) < Number(before.unconnected ?? Infinity)
  return {
    valid: forbiddenChanges.length === 0 && forbiddenVias.length === 0 && unconnectedImproved,
    forbiddenChanges,
    forbiddenVias,
    unconnectedImproved,
  }
}

export function scanForbiddenVias(vias = []) {
  return vias.filter((via) => /blind|buried|micro|pad/i.test(String(via.viaType || via.type || via.kind || 'through')))
}
