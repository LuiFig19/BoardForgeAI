import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

export const officialKiCadLibrarySources = {
  symbols: {
    name: 'kicad-symbols',
    url: 'https://gitlab.com/kicad/libraries/kicad-symbols.git',
    subdir: '',
  },
  footprints: {
    name: 'kicad-footprints',
    url: 'https://gitlab.com/kicad/libraries/kicad-footprints.git',
    subdir: '',
  },
  models3d: {
    name: 'kicad-packages3D',
    url: 'https://gitlab.com/kicad/libraries/kicad-packages3D.git',
    subdir: '',
  },
}

const defaultAliases = {
  MCU: ['qfn', 'tqfp', 'lqfp', 'mcu', 'package_dfn_qfn'],
  ESP32_S3: ['esp32-s3', 'esp32-s2', 'esp32', 'rf_module'],
  USB: ['usb_c', 'usb-c', 'receptacle', 'connector_usb'],
  RJ45: ['rj45', 'magjack', 'connector_rj'],
  REGULATOR: ['sot-23-5', 'sot23-5', 'regulator'],
  BLACKBOX: ['soic-8', 'wson', 'flash', 'package_so'],
  SENSOR_CONNECTOR: ['pinheader_1x04', 'pinheader', 'connector_pinheader'],
  ESC_CONNECTOR: ['pinheader_1x08', 'pinheader', 'connector_pinheader'],
  CAP: ['c_0603', 'capacitor_smd'],
  RES: ['r_0603', 'resistor_smd'],
  INDUCTOR: ['l_0603', 'inductor_smd'],
}

const preferredAssetIds = {
  USB: {
    symbols: ['Connector:USB_C_Receptacle', 'Connector:USB_C_Plug'],
    footprints: ['Connector_USB:USB_C_Receptacle_Amphenol_12401610E4-2A'],
  },
  RJ45: {
    symbols: ['Connector:8P8C_Shielded', 'Connector:RJ45'],
    footprints: ['Connector_RJ:RJ45_Amphenol_RJHSE538X'],
  },
  ESP32_S3: {
    symbols: ['MCU_Espressif:ESP32-S3', 'RF_Module:ESP32-S3-WROOM-1'],
    footprints: ['RF_Module:ESP32-S3-WROOM-1', 'RF_Module:ESP32-S2-MINI-1'],
  },
  REGULATOR: {
    symbols: ['Regulator_Linear:AMS1117-3.3', 'Regulator_Switching:AP63203WU'],
    footprints: ['Package_TO_SOT_SMD:SOT-23-5'],
  },
  RES: {
    symbols: ['Device:R', 'Device:R_Small'],
    footprints: ['Resistor_SMD:R_0603_1608Metric'],
  },
  CAP: {
    symbols: ['Device:C', 'Device:C_Small'],
    footprints: ['Capacitor_SMD:C_0603_1608Metric'],
  },
  INDUCTOR: {
    symbols: ['Device:L', 'Device:L_Small'],
    footprints: ['Inductor_SMD:L_0603_1608Metric'],
  },
  SENSOR_CONNECTOR: {
    symbols: ['Connector_Generic:Conn_01x04'],
    footprints: ['Connector_PinHeader_2.54mm:PinHeader_1x04_P2.54mm_Vertical'],
  },
  ESC_CONNECTOR: {
    symbols: ['Connector_Generic:Conn_01x08'],
    footprints: ['Connector_PinHeader_2.54mm:PinHeader_1x08_P2.54mm_Vertical'],
  },
}

export function detectKiCadLibraryRoots(input = {}) {
  const version = String(input.kicadMajorVersion || process.env.KICAD_VERSION_MAJOR || '10').replace(/[^\d]/g, '') || '10'
  const roots = {
    version,
    source: 'detected',
    symbols: firstExisting([
      input.symbolDir,
      process.env[`KICAD${version}_SYMBOL_DIR`],
      process.env.KICAD_SYMBOL_DIR,
      windowsKiCadShare(version, 'symbols'),
      path.join(os.homedir(), 'Documents', 'KiCad', version, 'symbols'),
    ]),
    footprints: firstExisting([
      input.footprintDir,
      process.env[`KICAD${version}_FOOTPRINT_DIR`],
      process.env.KICAD_FOOTPRINT_DIR,
      windowsKiCadShare(version, 'footprints'),
      path.join(os.homedir(), 'Documents', 'KiCad', version, 'footprints'),
    ]),
    models3d: firstExisting([
      input.models3dDir,
      process.env[`KICAD${version}_3DMODEL_DIR`],
      process.env.KICAD_3DMODEL_DIR,
      windowsKiCadShare(version, '3dmodels'),
      path.join(os.homedir(), 'Documents', 'KiCad', version, '3dmodels'),
    ]),
  }
  return roots
}

export async function syncKiCadLibraries({ workspace, input = {} }) {
  const roots = detectKiCadLibraryRoots(input)
  const warnings = []
  const cacheRoot = resolveCachePath(workspace, input.cacheDir || '.boardforge/library-cache')
  await mkdir(cacheRoot, { recursive: true })

  const onlineRoots = {}
  if (input.downloadOfficial) {
    if (!input.allowNetwork) {
      warnings.push({ severity: 'WARNING', code: 'NETWORK_NOT_ALLOWED', message: 'downloadOfficial was requested, but allowNetwork was not true. No online libraries were downloaded.' })
    } else {
      const selected = input.sources || ['symbols', 'footprints', input.include3dModels ? 'models3d' : null].filter(Boolean)
      for (const sourceKey of selected) {
        const source = officialKiCadLibrarySources[sourceKey]
        if (!source) {
          warnings.push({ severity: 'WARNING', code: 'SOURCE_NOT_ALLOWLISTED', message: `Ignored non-allowlisted source: ${sourceKey}` })
          continue
        }
        const target = path.join(cacheRoot, source.name)
        const cloned = await cloneOrUpdateAllowlistedRepo(source, target, input.ref || 'master')
        onlineRoots[sourceKey] = target
        if (cloned.warning) warnings.push(cloned.warning)
      }
    }
  }

  const indexRoots = {
    symbols: onlineRoots.symbols || roots.symbols,
    footprints: onlineRoots.footprints || roots.footprints,
    models3d: onlineRoots.models3d || roots.models3d,
  }
  const manifest = await buildLibraryManifest(indexRoots, input)
  const manifestPath = path.join(cacheRoot, 'boardforge-library-index.json')
  await writeFile(manifestPath, JSON.stringify({ ...manifest, roots, onlineRoots, generatedAt: new Date().toISOString(), officialKiCadLibrarySources }, null, 2), 'utf8')
  return {
    status: manifest.footprints.length || manifest.symbols.length ? 'LIBRARY_SYNCED_NEEDS_REVIEW' : 'LIBRARY_SYNC_INCOMPLETE',
    roots,
    onlineRoots,
    manifestPath,
    counts: {
      symbols: manifest.symbols.length,
      footprints: manifest.footprints.length,
      models3d: manifest.models3d.length,
    },
    warnings,
    samples: {
      symbols: manifest.symbols.slice(0, 10),
      footprints: manifest.footprints.slice(0, 10),
      models3d: manifest.models3d.slice(0, 10),
    },
    manifest: input.includeManifest ? manifest : undefined,
    humanReviewRequired: true,
  }
}

export async function searchLibraryAssets({ workspace, input = {} }) {
  const manifest = await loadOrBuildManifest(workspace, input)
  const query = normalizeText([input.query, input.component?.value, input.component?.group, input.component?.mpn].filter(Boolean).join(' '))
  const terms = query.split(/\s+/).filter(Boolean)
  return {
    status: 'LIBRARY_SEARCH_COMPLETE_NEEDS_REVIEW',
    query,
    symbols: rankAssets(manifest.symbols, terms).slice(0, input.limit || 20),
    footprints: rankAssets(manifest.footprints, terms).slice(0, input.limit || 20),
    models3d: rankAssets(manifest.models3d, terms).slice(0, input.limit || 20),
    humanReviewRequired: true,
  }
}

export async function resolveComponentAssets({ workspace, input = {} }) {
  const manifest = await loadOrBuildManifest(workspace, input)
  const components = input.components || []
  const resolved = components.map((component) => resolveSingleComponent(component, manifest, input))
  const unresolved = resolved.filter((item) => !item.footprint || !item.symbol)
  return {
    status: unresolved.length ? 'COMPONENT_ASSETS_NEED_REVIEW' : 'COMPONENT_ASSETS_RESOLVED_NEEDS_REVIEW',
    components: resolved,
    unresolvedCount: unresolved.length,
    warnings: unresolved.map((item) => ({ severity: 'WARNING', code: 'COMPONENT_LIBRARY_MATCH_INCOMPLETE', message: `${item.ref || item.value || item.group} is missing a symbol or footprint match.` })),
    humanReviewRequired: true,
  }
}

export async function findMissingFootprints({ workspace, input = {} }) {
  const manifest = await loadOrBuildManifest(workspace, input)
  const components = input.components || []
  const missing = []
  for (const component of components) {
    if (component.footprint && manifest.footprints.some((asset) => asset.libId === component.footprint)) continue
    const resolved = resolveSingleComponent(component, manifest, input)
    if (!resolved.footprint) missing.push({ ...component, reason: 'No matching KiCad footprint found in indexed allowlisted libraries.' })
  }
  return {
    status: missing.length ? 'MISSING_FOOTPRINTS_FOUND' : 'FOOTPRINTS_AVAILABLE_NEEDS_REVIEW',
    missing,
    checked: components.length,
    humanReviewRequired: true,
  }
}

export async function link3dModels({ workspace, input = {} }) {
  const manifest = await loadOrBuildManifest(workspace, input)
  const components = input.components || []
  const linked = components.map((component) => {
    const resolved = resolveSingleComponent(component, manifest, input)
    return {
      ...component,
      footprint: component.footprint || resolved.footprint?.libId || null,
      model3d: component.model3d || resolved.footprint?.models3d?.[0] || resolved.model3d?.path || null,
      modelStatus: component.model3d || resolved.footprint?.models3d?.length || resolved.model3d ? 'linked_needs_review' : 'missing',
    }
  })
  return {
    status: linked.some((item) => item.modelStatus === 'missing') ? '3D_MODELS_PARTIAL_NEEDS_REVIEW' : '3D_MODELS_LINKED_NEEDS_REVIEW',
    components: linked,
    humanReviewRequired: true,
  }
}

export async function renderPlacedFootprintsFromLibraries(components = [], options = {}) {
  const workspace = options.workspace || process.cwd()
  const manifest = await loadOrBuildManifest(workspace, options)
  const rendered = []
  const missing = []
  for (const component of components) {
    const resolved = resolveSingleComponent(component, manifest, options)
    const footprint = resolved.footprint
    if (!footprint?.path) {
      missing.push({ ref: component.ref, footprint: component.footprint, reason: 'Footprint file missing from indexed libraries.' })
      rendered.push(missingFootprintText(component))
      continue
    }
    try {
      let content = await readFile(footprint.path, 'utf8')
      content = content.replace(/\(footprint\s+"([^"]+)"/, `(footprint "${footprint.libId}"`)
      content = content.replace(/(\(layer\s+"F\.Cu"\)\s*)/, `$1\n\t(at ${Number(component.x).toFixed(3)} ${Number(component.y).toFixed(3)} ${component.rotation || 0})\n`)
      content = content.replace(/REF\*\*/g, component.ref)
      content = content.replace(/\(property\s+"Value"\s+"[^"]+"/, `(property "Value" "${safeText(component.value)}"`)
      if (resolved.model3d?.path && !content.includes('(model ')) {
        content = content.replace(/\)\s*$/, `\n\t(model "${resolved.model3d.path.replace(/\\/g, '/')}"\n\t\t(offset (xyz 0 0 0))\n\t\t(scale (xyz 1 1 1))\n\t\t(rotate (xyz 0 0 0))\n\t)\n)\n`)
      }
      content = content.replace(/\(uuid\s+"[^"]+"\)/g, () => `(uuid "${cryptoRandomUuid()}")`)
      rendered.push(content)
    } catch (error) {
      missing.push({ ref: component.ref, footprint: footprint.libId, reason: error.message })
      rendered.push(missingFootprintText(component))
    }
  }
  return { rendered, missing }
}

async function loadOrBuildManifest(workspace, input = {}) {
  const cacheRoot = resolveCachePath(workspace, input.cacheDir || '.boardforge/library-cache')
  const manifestPath = input.manifestPath || path.join(cacheRoot, 'boardforge-library-index.json')
  if (existsSync(manifestPath) && !input.refresh) {
    const raw = JSON.parse(await readFile(manifestPath, 'utf8'))
    return raw.manifest || raw
  }
  const synced = await syncKiCadLibraries({ workspace, input })
  if (synced.manifest) return synced.manifest
  const raw = JSON.parse(await readFile(synced.manifestPath, 'utf8'))
  return raw.manifest || raw
}

async function buildLibraryManifest(roots, input = {}) {
  const maxAssets = Number(input.maxAssets || 20000)
  const [symbols, footprints, models3d] = await Promise.all([
    indexSymbols(roots.symbols, maxAssets),
    indexFootprints(roots.footprints, maxAssets),
    index3dModels(roots.models3d, maxAssets),
  ])
  const modelsByStem = new Map(models3d.map((model) => [normalizeText(model.stem), model]))
  const enrichedFootprints = footprints.map((footprint) => ({
    ...footprint,
    models3d: [...new Set([
      ...footprint.models3d,
      modelsByStem.get(normalizeText(footprint.name))?.path,
      modelsByStem.get(normalizeText(footprint.library))?.path,
    ].filter(Boolean))],
  }))
  return { symbols, footprints: enrichedFootprints, models3d }
}

async function indexFootprints(root, maxAssets) {
  if (!root || !existsSync(root)) return []
  const files = await collectFiles(root, (file) => file.endsWith('.kicad_mod'), maxAssets)
  const assets = []
  for (const file of files) {
    const library = path.basename(path.dirname(file)).replace(/\.pretty$/i, '')
    const name = path.basename(file, '.kicad_mod')
    let content = ''
    try {
      content = await readFile(file, 'utf8')
    } catch {
      content = ''
    }
    const description = content.match(/\(descr\s+"([^"]+)"/)?.[1] || ''
    const tags = content.match(/\(tags\s+"([^"]+)"/)?.[1] || ''
    const models3d = [...content.matchAll(/\(model\s+"([^"]+)"/g)].map((match) => match[1])
    assets.push({
      kind: 'footprint',
      libId: `${library}:${name}`,
      library,
      name,
      path: file,
      description,
      tags,
      models3d,
      keywords: normalizeText(`${library} ${name} ${description} ${tags}`).split(/\s+/).filter(Boolean),
    })
  }
  return assets
}

async function indexSymbols(root, maxAssets) {
  if (!root || !existsSync(root)) return []
  const files = await collectFiles(root, (file) => file.endsWith('.kicad_sym'), maxAssets)
  const assets = []
  for (const file of files) {
    const library = path.basename(file, '.kicad_sym')
    let content = ''
    try {
      content = await readFile(file, 'utf8')
    } catch {
      content = ''
    }
    const names = [...content.matchAll(/\(symbol\s+"([^":]+(?::[^"]+)?)"/g)]
      .map((match) => match[1])
      .filter((name) => !name.includes('_0_') && !name.includes('_1_') && !name.includes('_2_'))
      .slice(0, 500)
    for (const name of names) {
      assets.push({
        kind: 'symbol',
        libId: `${library}:${name.includes(':') ? name.split(':').pop() : name}`,
        library,
        name: name.includes(':') ? name.split(':').pop() : name,
        path: file,
        keywords: normalizeText(`${library} ${name}`).split(/\s+/).filter(Boolean),
      })
      if (assets.length >= maxAssets) return assets
    }
  }
  return assets
}

async function index3dModels(root, maxAssets) {
  if (!root || !existsSync(root)) return []
  const files = await collectFiles(root, (file) => /\.(wrl|step|stp)$/i.test(file), maxAssets)
  return files.map((file) => ({
    kind: '3d_model',
    name: path.basename(file),
    stem: path.basename(file).replace(/\.(wrl|step|stp)$/i, ''),
    library: path.basename(path.dirname(file)),
    path: file,
    keywords: normalizeText(file).split(/\s+/).filter(Boolean),
  }))
}

function resolveSingleComponent(component, manifest, input = {}) {
  const forced = component.footprint ? manifest.footprints.find((asset) => asset.libId === component.footprint) : null
  const searchText = normalizeText([
    component.ref,
    component.group,
    component.value,
    component.mpn,
    component.package,
    ...(defaultAliases[component.group] || []),
  ].filter(Boolean).join(' '))
  const terms = searchText.split(/\s+/).filter(Boolean)
  const preferred = preferredAssetIds[component.group] || {}
  const footprint = forced || firstByLibId(manifest.footprints, preferred.footprints) || rankAssets(manifest.footprints, terms)[0] || null
  const symbol = component.symbol ? manifest.symbols.find((asset) => asset.libId === component.symbol) : firstByLibId(manifest.symbols, preferred.symbols) || rankAssets(manifest.symbols, terms)[0] || null
  const model3d = footprint?.models3d?.length
    ? manifest.models3d.find((asset) => footprint.models3d.some((model) => normalizeText(model).includes(normalizeText(asset.stem)))) || { path: footprint.models3d[0] }
    : rankAssets(manifest.models3d, terms)[0] || null
  return {
    ...component,
    symbol,
    footprint,
    model3d,
    confidence: scoreConfidence({ component, symbol, footprint, model3d, terms, strict: input.strict }),
  }
}

function firstByLibId(assets = [], ids = []) {
  for (const id of ids || []) {
    const exact = assets.find((asset) => asset.libId === id)
    if (exact) return { ...exact, score: 100 }
  }
  return null
}

function rankAssets(assets = [], terms = []) {
  return assets
    .map((asset) => ({ ...asset, score: scoreAsset(asset, terms) }))
    .filter((asset) => asset.score > 0)
    .sort((a, b) => b.score - a.score || a.libId?.localeCompare(b.libId || '') || 0)
}

function scoreAsset(asset, terms) {
  const haystack = normalizeText([asset.libId, asset.name, asset.library, asset.description, asset.tags, asset.path].filter(Boolean).join(' '))
  let score = 0
  for (const term of terms) {
    if (!term) continue
    if (haystack === term) score += 20
    else if (haystack.includes(term)) score += term.length >= 4 ? 5 : 1
    if (normalizeText(asset.name || '') === term) score += 10
    if (normalizeText(asset.libId || '').includes(term)) score += 4
  }
  return score
}

function scoreConfidence({ symbol, footprint, model3d, strict }) {
  let score = 0
  if (symbol) score += 0.34
  if (footprint) score += 0.46
  if (model3d) score += 0.2
  if (strict && score < 1) return 'needs_review'
  if (score >= 0.95) return 'high_needs_review'
  if (score >= 0.5) return 'medium_needs_review'
  return 'low_needs_review'
}

async function collectFiles(root, predicate, maxAssets, collected = []) {
  if (!root || !existsSync(root) || collected.length >= maxAssets) return collected
  let entries = []
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch {
    return collected
  }
  for (const entry of entries) {
    if (collected.length >= maxAssets) break
    const full = path.join(root, entry.name)
    if (entry.isDirectory()) await collectFiles(full, predicate, maxAssets, collected)
    else if (predicate(full)) collected.push(full)
  }
  return collected
}

async function cloneOrUpdateAllowlistedRepo(source, target, ref) {
  if (!Object.values(officialKiCadLibrarySources).some((item) => item.url === source.url)) {
    return { warning: { severity: 'WARNING', code: 'SOURCE_NOT_ALLOWLISTED', message: `Refused non-allowlisted repo ${source.url}` } }
  }
  const gitDir = path.join(target, '.git')
  const args = existsSync(gitDir)
    ? ['-C', target, 'pull', '--ff-only']
    : ['clone', '--depth', '1', '--branch', ref, source.url, target]
  const output = await runCommand('git', args)
  if (output.exitCode !== 0) {
    return { warning: { severity: 'WARNING', code: 'LIBRARY_DOWNLOAD_FAILED', message: `Could not sync ${source.name}: ${output.stderr || output.stdout}` } }
  }
  return { ok: true }
}

function runCommand(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { windowsHide: true })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => { stdout += chunk.toString() })
    child.stderr.on('data', (chunk) => { stderr += chunk.toString() })
    child.on('error', (error) => resolve({ exitCode: 1, stdout, stderr: error.message }))
    child.on('close', (exitCode) => resolve({ exitCode, stdout, stderr }))
  })
}

function firstExisting(values) {
  return values.filter(Boolean).map((value) => path.resolve(String(value))).find((value) => existsSync(value)) || null
}

function windowsKiCadShare(version, child) {
  return path.join(process.env.ProgramFiles || 'C:\\Program Files', 'KiCad', `${version}.0`, 'share', 'kicad', child)
}

function resolveCachePath(workspace, target) {
  const root = path.resolve(workspace)
  const resolved = path.resolve(root, target)
  if (resolved !== root && !resolved.startsWith(root + path.sep)) throw new Error(`Refusing library cache path outside workspace: ${target}`)
  return resolved
}

function normalizeText(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9_+.-]+/g, ' ').trim()
}

function safeText(value) {
  return String(value || '').replace(/"/g, "'")
}

function cryptoRandomUuid() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`
}

function missingFootprintText(component) {
  return `  (gr_text "${safeText(component.ref)} library asset missing: ${safeText(component.footprint || component.group || component.value)}" (at ${component.x || 0} ${component.y || 0} 0) (layer "Cmts.User")\n    (effects (font (size 1 1) (thickness 0.12))))`
}
