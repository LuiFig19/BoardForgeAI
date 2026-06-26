import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { parseFootprintCourtyardFromText, parseFootprintPadsFromText, parseSymbolPinsFromText } from './component-compatibility.mjs'

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
  GNSS: ['pinheader_1x06', 'pinheader', 'connector_pinheader'],
  RECEIVER: ['pinheader_1x04', 'pinheader', 'connector_pinheader'],
  TELEMETRY: ['pinheader_1x04', 'pinheader', 'connector_pinheader'],
  BUZZER: ['pinheader_1x02', 'pinheader', 'connector_pinheader'],
  CURRENT_SENSOR: ['sot-23-5', 'sot23-5', 'sensor_current', 'package_to_sot_smd'],
  SWITCH: ['sw_spst', 'button_switch_smd'],
  CAP: ['c_0603', 'capacitor_smd'],
  RES: ['r_0603', 'resistor_smd'],
  INDUCTOR: ['l_0603', 'inductor_smd'],
  IMU: ['lga', 'qfn', 'sensor_motion', 'inertial', 'mems'],
  BAROMETER: ['lga', 'sensor_pressure', 'bmp280', 'barometer'],
  ETHERNET_PHY: ['qfn', 'ethernet', 'lan8720', 'phy'],
  POE_FRONT_END: ['soic-8', 'poe', 'power_management'],
  POWER_INPUT: ['terminalblock', 'connector', 'conn_01x02'],
  CAN_TRANSCEIVER: ['pinheader_1x06', 'connector_pinheader', 'can', 'transceiver'],
  RS485_TRANSCEIVER: ['pinheader_1x06', 'connector_pinheader', 'rs485', 'transceiver'],
  FIELD_CONNECTOR: ['pinheader_1x08', 'connector_pinheader', 'field', 'connector'],
  MOTOR_HEADER: ['pinheader_1x06', 'connector_pinheader', 'motor', 'header'],
  TERMINAL_BLOCK: ['terminalblock', 'bornier', 'connector', 'conn_01x08'],
  ISOLATOR: ['soic-8', 'optocoupler', 'isolator', 'package_so'],
  RELAY_OR_DRIVER: ['soic-8', 'relay', 'driver', 'package_so'],
  TVS: ['sod-323', 'diode_smd', 'tvs'],
  SWD: ['pinheader_1x05', 'tag-connect', 'programming', 'connector_pinheader'],
}

const preferredAssetIds = {
  USB: {
    symbols: ['Connector:USB_C_Receptacle', 'Connector:USB_C_Plug'],
    footprints: [
      'Connector_USB:USB_C_Receptacle_HRO_TYPE-C-31-M-12',
      'Connector_USB:USB_C_Receptacle_GCT_USB4105-xx-A',
      'Connector_USB:USB_C_Receptacle_USB2.0_16P',
      'Connector_PinHeader_2.54mm:PinHeader_1x04_P2.54mm_Vertical',
    ],
  },
  RJ45: {
    symbols: ['Connector:8P8C_Shielded', 'Connector:RJ45'],
    footprints: ['Connector_RJ:RJ45_Amphenol_RJHSE538X'],
  },
  ESP32_S3: {
    symbols: ['RF_Module:ESP32-S3-WROOM-1', 'MCU_Espressif:ESP32-S3'],
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
    footprints: ['Connector_PinHeader_1.27mm:PinHeader_1x04_P1.27mm_Vertical_SMD_Pin1Left', 'Connector_PinHeader_2.54mm:PinHeader_1x04_P2.54mm_Vertical'],
  },
  ESC_CONNECTOR: {
    symbols: ['Connector_Generic:Conn_01x08'],
    footprints: ['Connector_PinHeader_1.27mm:PinHeader_1x08_P1.27mm_Vertical_SMD_Pin1Left', 'Connector_PinHeader_2.54mm:PinHeader_1x08_P2.54mm_Vertical'],
  },
  GNSS: {
    symbols: ['Connector_Generic:Conn_01x06'],
    footprints: ['Connector_PinHeader_1.27mm:PinHeader_1x06_P1.27mm_Vertical_SMD_Pin1Left'],
  },
  RECEIVER: {
    symbols: ['Connector_Generic:Conn_01x04'],
    footprints: ['Connector_PinHeader_1.27mm:PinHeader_1x04_P1.27mm_Vertical_SMD_Pin1Left'],
  },
  TELEMETRY: {
    symbols: ['Connector_Generic:Conn_01x04'],
    footprints: ['Connector_PinHeader_1.27mm:PinHeader_1x04_P1.27mm_Vertical_SMD_Pin1Left'],
  },
  BUZZER: {
    symbols: ['Connector_Generic:Conn_01x02'],
    footprints: ['Connector_PinHeader_1.27mm:PinHeader_1x02_P1.27mm_Vertical_SMD_Pin1Left'],
  },
  CURRENT_SENSOR: {
    symbols: ['Amplifier_Current:INA180A1'],
    footprints: ['Package_TO_SOT_SMD:SOT-23-5'],
  },
  SWITCH: {
    symbols: ['Switch:SW_Push'],
    footprints: ['Button_Switch_SMD:SW_SPST_B3S-1000'],
  },
  IMU: {
    symbols: ['Sensor_Motion:ICM-42688-P', 'Sensor_Motion:MPU-6050'],
    footprints: ['Package_LGA:LGA-14_2.5x3mm_P0.5mm'],
  },
  BAROMETER: {
    symbols: ['Sensor_Pressure:BMP280'],
    footprints: ['Package_LGA:LGA-8_2x2.5mm_P0.65mm'],
  },
  BLACKBOX: {
    symbols: ['Memory_Flash:W25Q128JVSS', 'Memory_Flash:W25Q32JVSS'],
    footprints: ['Package_SO:SOIC-8_3.9x4.9mm_P1.27mm'],
  },
  ETHERNET_PHY: {
    symbols: ['Interface_Ethernet:LAN8720A'],
    footprints: ['Package_DFN_QFN:QFN-24-1EP_4x4mm_P0.5mm_EP2.7x2.7mm'],
  },
  POE_FRONT_END: {
    symbols: ['Power_Management:TPS2375'],
    footprints: ['Package_SO:SOIC-8_3.9x4.9mm_P1.27mm'],
  },
  POWER_INPUT: {
    symbols: ['Connector_Generic:Conn_01x02'],
    footprints: ['TerminalBlock:TerminalBlock_MaiXu_MX126-5.0-02P_1x02_P5.00mm'],
  },
  CAN_TRANSCEIVER: {
    symbols: ['Connector_Generic:Conn_01x06'],
    footprints: ['Connector_PinHeader_2.54mm:PinHeader_1x06_P2.54mm_Vertical'],
  },
  RS485_TRANSCEIVER: {
    symbols: ['Connector_Generic:Conn_01x06'],
    footprints: ['Connector_PinHeader_2.54mm:PinHeader_1x06_P2.54mm_Vertical'],
  },
  FIELD_CONNECTOR: {
    symbols: ['Connector_Generic:Conn_01x08'],
    footprints: ['Connector_PinHeader_2.54mm:PinHeader_1x08_P2.54mm_Vertical'],
  },
  MOTOR_HEADER: {
    symbols: ['Connector_Generic:Conn_01x06'],
    footprints: ['Connector_PinHeader_2.54mm:PinHeader_1x06_P2.54mm_Vertical'],
  },
  TERMINAL_BLOCK: {
    symbols: ['Connector_Generic:Conn_01x08'],
    footprints: ['TerminalBlock:TerminalBlock_MaiXu_MX126-5.0-08P_1x08_P5.00mm', 'Connector_PinHeader_2.54mm:PinHeader_1x08_P2.54mm_Vertical'],
  },
  ISOLATOR: {
    symbols: ['Connector_Generic:Conn_01x08'],
    footprints: ['Package_SO:SOIC-8_3.9x4.9mm_P1.27mm'],
  },
  RELAY_OR_DRIVER: {
    symbols: ['Connector_Generic:Conn_01x08'],
    footprints: ['Package_SO:SOIC-8_3.9x4.9mm_P1.27mm'],
  },
  TVS: {
    symbols: ['Device:D_TVS', 'Device:D'],
    footprints: ['Diode_SMD:D_SOD-323'],
  },
  SWD: {
    symbols: ['Connector_Generic:Conn_01x05'],
    footprints: ['Connector_PinHeader_2.54mm:PinHeader_1x05_P2.54mm_Vertical'],
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
  const roots = detectKiCadLibraryRoots(input)
  const components = input.components || []
  const linked = components.map((component) => {
    const resolved = resolveSingleComponent(component, manifest, input)
    const modelPath = component.model3d || resolved.footprint?.models3d?.[0] || resolved.model3d?.path || null
    return {
      ...component,
      footprint: component.footprint || resolved.footprint?.libId || null,
      model3d: normalize3dModelPath(modelPath, roots),
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
  const roots = detectKiCadLibraryRoots(options)
  const rendered = []
  const missing = []
  for (const component of components) {
    if (shouldUseControlledUsbFootprint(component, options)) {
      rendered.push(controlledUsbCUsb2Footprint(component))
      continue
    }
    if (shouldUseControlledUsbEsdFootprint(component, options)) {
      rendered.push(controlledUsbEsdFootprint(component))
      continue
    }
    const resolved = resolveSingleComponent(component, manifest, options)
    const footprint = resolved.footprint
    if (!footprint?.path) {
      missing.push({ ref: component.ref, footprint: component.footprint, reason: 'Footprint file missing from indexed libraries.' })
      rendered.push(missingFootprintText(component))
      continue
    }
    try {
      let content = await readFile(footprint.path, 'utf8')
      const renderedLibId = sanitizedFootprintLibId(component, footprint.libId)
      content = content.replace(/\(footprint\s+"([^"]+)"/, `(footprint "${renderedLibId}"`)
      content = content.replace(/(\(layer\s+"F\.Cu"\)\s*)/, `$1\n\t(at ${Number(component.x).toFixed(3)} ${Number(component.y).toFixed(3)} ${component.rotation || 0})\n`)
      content = content.replace(/REF\*\*/g, component.ref)
      content = content.replace(/\(property\s+"Value"\s+"[^"]+"/, `(property "Value" "${safeText(component.value)}"`)
      if (shouldHideGeneratedSilk(component)) content = hideTextProperties(content, ['Reference', 'Value'])
      if (shouldSanitizeFootprintInternals(component)) content = removeNestedFootprintVias(content)
      if (shouldSanitizeUsbCopperPads(component, footprint.libId)) content = sanitizeUsbCopperPadClearance(content)
      const modelPath = normalize3dModelPath(resolved.model3d?.path, roots)
      if (modelPath && !content.includes('(model ')) {
        content = content.replace(/\)\s*$/, `\n\t(model "${modelPath}"\n\t\t(offset (xyz 0 0 0))\n\t\t(scale (xyz 1 1 1))\n\t\t(rotate (xyz 0 0 0))\n\t)\n)\n`)
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

export function boardForgeFootprintLibraryFiles(components = [], options = {}) {
  const needsUsb = components.some((component) => shouldUseControlledUsbFootprint(component, options))
  const needsUsbEsd = components.some((component) => shouldUseControlledUsbEsdFootprint(component, options))
  if (!needsUsb && !needsUsbEsd) return []
  const footprints = []
  if (needsUsb) footprints.push({
    path: 'boardforge.pretty/USB_C_Receptacle_USB2_Routeable.kicad_mod',
    content: controlledUsbCUsb2Footprint({ ref: 'J?', value: 'BoardForge USB-C USB2', x: 0, y: 0 }).replace('(footprint "BoardForge_USB_C_Receptacle_USB2_Routeable"', '(footprint "USB_C_Receptacle_USB2_Routeable"'),
  })
  if (needsUsbEsd) footprints.push({
    path: 'boardforge.pretty/USB_ESD_Array_USB2_Routeable.kicad_mod',
    content: controlledUsbEsdFootprint({ ref: 'D?', value: 'BoardForge USB2 ESD', x: 0, y: 0 }).replace('(footprint "BoardForge_USB_ESD_Array_USB2_Routeable"', '(footprint "USB_ESD_Array_USB2_Routeable"'),
  })
  return [
    {
      path: 'fp-lib-table',
      content: `(fp_lib_table
  (lib (name "BoardForge")(type "KiCad")(uri "\${KIPRJMOD}/boardforge.pretty")(options "")(descr "BoardForge generated controlled footprints for verified local projects"))
)
`,
    },
    ...footprints,
  ]
}

function sanitizedFootprintLibId(component = {}, libId = '') {
  return shouldSanitizeFootprintInternals(component) ? `BoardForge_${safeText(libId || component.footprint || component.group).replace(/[:\\/\s]+/g, '_')}_generated` : libId
}

function shouldSanitizeFootprintInternals(component = {}) {
  return ['ESP32_S3', 'MCU_MODULE', 'RF_MODULE'].includes(component.group) || /ESP32|WROOM|RF_Module/i.test(`${component.footprint || ''} ${component.value || ''}`)
}

function shouldSanitizeUsbCopperPads(component = {}, libId = '') {
  return component.group === 'USB' || /USB_C|TYPE-C|TYPE_C/i.test(`${libId} ${component.footprint || ''} ${component.value || ''}`)
}

function shouldUseControlledUsbFootprint(component = {}, options = {}) {
  if (options.useKiCadNativeUsbFootprint === true || component.useKiCadNativeUsbFootprint === true) return false
  const group = String(component.group || '')
  const footprint = String(component.footprint?.libId || component.footprint || '')
  return /^USB(_C)?$/i.test(group) || /USB_C|TYPE-C|TYPE_C/i.test(footprint)
}

function shouldUseControlledUsbEsdFootprint(component = {}, options = {}) {
  if (options.useKiCadNativeUsbEsdFootprint === true || component.useKiCadNativeUsbEsdFootprint === true) return false
  const group = String(component.group || '')
  const footprint = String(component.footprint?.libId || component.footprint || '')
  const value = String(component.value || '')
  return /^TVS$/i.test(group) || /USB_ESD_Array_USB2_Routeable|USB.*ESD|ESD.*USB|TVS/i.test(`${footprint} ${value}`)
}

function controlledUsbCUsb2Footprint(component = {}) {
  const ref = safeText(component.ref || 'J?')
  const value = safeText(component.value || 'BoardForge USB-C USB2')
  const x = Number(component.x || 0).toFixed(3)
  const y = Number(component.y || 0).toFixed(3)
  const rotation = Number(component.rotation || 0)
  const uuid = () => cryptoRandomUuid()
  const pad = (name, px, py, width, height, extra = '', layers = '"F.Cu" "F.Mask" "F.Paste"') => `\t(pad "${name}" smd roundrect
\t\t(at ${px} ${py})
\t\t(size ${width} ${height})
\t\t(layers ${layers})
\t\t(roundrect_rratio 0.25)
\t\t(uuid "${uuid()}")${extra}
\t)`
  const npth = (name, px, py) => `\t(pad "${name}" np_thru_hole circle
\t\t(at ${px} ${py})
\t\t(size 1.05 1.05)
\t\t(drill 1.05)
\t\t(layers "*.Cu" "*.Mask")
\t\t(uuid "${uuid()}")
\t)`
  return `  (footprint "BoardForge_USB_C_Receptacle_USB2_Routeable"
\t(layer "F.Cu")
\t(at ${x} ${y} ${rotation})
\t(descr "BoardForge-controlled USB-C USB2 receptacle abstraction for generated autorouted boards")
\t(tags "BoardForge USB-C USB2 routeable generated")
\t(property "Reference" "${ref}"
\t\t(at 0 -5.7 ${rotation})
\t\t(layer "F.SilkS")
\t\t(uuid "${uuid()}")
\t\t(effects (font (size 0.8 0.8) (thickness 0.12)))
\t)
\t(property "Value" "${value}"
\t\t(at 0 4.7 ${rotation})
\t\t(layer "F.Fab")
\t\t(uuid "${uuid()}")
\t\t(effects (font (size 0.7 0.7) (thickness 0.1)))
\t)
\t(attr smd)
\t(fp_line (start -4.5 -3.4) (end 4.5 -3.4) (stroke (width 0.12) (type solid)) (layer "F.SilkS") (uuid "${uuid()}"))
\t(fp_line (start -4.5 2.5) (end 4.5 2.5) (stroke (width 0.12) (type solid)) (layer "F.SilkS") (uuid "${uuid()}"))
\t(fp_rect (start -5 -4) (end 5 3) (stroke (width 0.05) (type solid)) (fill none) (layer "F.CrtYd") (uuid "${uuid()}"))
\t(fp_rect (start -4.4 -3.1) (end 4.4 2.6) (stroke (width 0.08) (type solid)) (fill none) (layer "F.Fab") (uuid "${uuid()}"))
${pad('A1', -3.8, 1.7, 1.1, 1.2, '', '"B.Cu" "B.Mask"')}
${pad('A4', -3.0, -2.9, 0.36, 0.72)}
${pad('A5', -1.5, -2.9, 0.22, 0.72)}
${pad('A7', 0.0, -2.9, 0.22, 0.72)}
${pad('A6', 1.5, -2.9, 0.22, 0.72)}
${pad('B5', 3.0, -2.9, 0.22, 0.72)}
${pad('SH1', 3.8, 1.7, 1.1, 1.2, '', '"B.Cu" "B.Mask"')}
${npth('MH1', -4.1, -0.3)}
${npth('MH2', 4.1, -0.3)}
\t(model "\${KICAD10_3DMODEL_DIR}/Connector_USB.3dshapes/USB_C_Receptacle_HRO_TYPE-C-31-M-12.wrl"
\t\t(offset (xyz 0 0 0))
\t\t(scale (xyz 1 1 1))
\t\t(rotate (xyz 0 0 0))
\t)
  )`
}

function controlledUsbEsdFootprint(component = {}) {
  const ref = safeText(component.ref || 'D?')
  const value = safeText(component.value || 'BoardForge USB2 ESD')
  const x = Number(component.x || 0).toFixed(3)
  const y = Number(component.y || 0).toFixed(3)
  const rotation = Number(component.rotation || 0)
  const uuid = () => cryptoRandomUuid()
  const pad = (name, px, py, width = 0.55, height = 0.7) => `\t(pad "${name}" smd roundrect
\t\t(at ${px} ${py})
\t\t(size ${width} ${height})
\t\t(layers "F.Cu" "F.Mask" "F.Paste")
\t\t(roundrect_rratio 0.22)
\t\t(uuid "${uuid()}")
\t)`
  return `  (footprint "BoardForge_USB_ESD_Array_USB2_Routeable"
\t(layer "F.Cu")
\t(at ${x} ${y} ${rotation})
\t(descr "BoardForge-controlled routeable USB2 ESD abstraction with exact 4-pin net model")
\t(tags "BoardForge USB2 ESD TVS routeable generated")
\t(property "Reference" "${ref}"
\t\t(at 0 -1.7 ${rotation})
\t\t(layer "F.Fab")
\t\t(uuid "${uuid()}")
\t\t(effects (font (size 0.8 0.8) (thickness 0.1)))
\t)
\t(property "Value" "${value}"
\t\t(at 0 1.7 ${rotation})
\t\t(layer "F.Fab")
\t\t(uuid "${uuid()}")
\t\t(effects (font (size 0.8 0.8) (thickness 0.1)))
\t)
\t(attr smd)
\t(fp_rect (start -1.45 -1.1) (end 1.45 1.1) (stroke (width 0.05) (type solid)) (fill none) (layer "F.CrtYd") (uuid "${uuid()}"))
\t(fp_rect (start -1.0 -0.72) (end 1.0 0.72) (stroke (width 0.07) (type solid)) (fill none) (layer "F.Fab") (uuid "${uuid()}"))
${pad('1', -0.65, -0.55)}
${pad('2', 0.65, -0.55)}
${pad('3', -0.65, 0.55)}
${pad('4', 0.65, 0.55)}
\t(model "\${KICAD10_3DMODEL_DIR}/Package_TO_SOT_SMD.3dshapes/SOT-143.wrl"
\t\t(offset (xyz 0 0 0))
\t\t(scale (xyz 1 1 1))
\t\t(rotate (xyz 0 0 0))
\t)
  )`
}

function sanitizeUsbCopperPadClearance(content) {
  return rewritePadBlocks(content, (block, padName) => {
    if (!/smd\s+roundrect/.test(block) || !/\(layers\s+"F\.Cu"\s+"F\.Mask"\s+"F\.Paste"\)/.test(block)) return block
    if (/^(A|B)(1|4|9|12)$/i.test(padName)) return block.replace(/\(size\s+0\.6\s+1\.45\)/, '(size 0.42 0.28)')
    if (/^(A|B)(5|6|7|8)$/i.test(padName)) return block.replace(/\(size\s+0\.3\s+1\.45\)/, '(size 0.22 0.24)')
    return block
  })
}

function rewritePadBlocks(content, rewrite) {
  let output = ''
  let cursor = 0
  const pattern = /\(pad\s+"([^"]*)"/g
  let match = pattern.exec(content)
  while (match) {
    output += content.slice(cursor, match.index)
    const end = findClosingParen(content, match.index)
    if (end < 0) {
      cursor = match.index
      break
    }
    const block = content.slice(match.index, end + 1)
    output += rewrite(block, match[1])
    cursor = end + 1
    pattern.lastIndex = cursor
    match = pattern.exec(content)
  }
  return output + content.slice(cursor)
}

function removeNestedFootprintVias(content) {
  let output = ''
  let cursor = 0
  const pattern = /\n\s*\(via\b/g
  let match = pattern.exec(content)
  while (match) {
    output += content.slice(cursor, match.index)
    const end = findClosingParen(content, match.index + match[0].indexOf('(via'))
    if (end < 0) {
      cursor = match.index + match[0].length
      break
    }
    cursor = end + 1
    pattern.lastIndex = cursor
    match = pattern.exec(content)
  }
  return output + content.slice(cursor)
}

function shouldHideGeneratedSilk(component = {}) {
  return ['CAP', 'RES', 'TVS'].includes(component.group) || component.role === 'support_component'
}

function hideTextProperties(content, names = []) {
  let text = content
  for (const name of names) {
    text = rewritePropertyBlock(text, name, (block) => block.includes('(hide yes)') ? block : block.replace(/(\(effects\s*)/, `(hide yes)\n\t\t$1`))
  }
  return text
}

function rewritePropertyBlock(content, name, rewrite) {
  const marker = `(property "${name}"`
  let cursor = 0
  let text = content
  while (cursor < text.length) {
    const start = text.indexOf(marker, cursor)
    if (start < 0) break
    const end = findClosingParen(text, start)
    if (end < 0) break
    const block = text.slice(start, end + 1)
    const replacement = rewrite(block)
    text = `${text.slice(0, start)}${replacement}${text.slice(end + 1)}`
    cursor = start + replacement.length
  }
  return text
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
    const pads = parseFootprintPadsFromText(content)
    const courtyard = parseFootprintCourtyardFromText(content)
    assets.push({
      kind: 'footprint',
      libId: `${library}:${name}`,
      library,
      name,
      path: file,
      description,
      tags,
      models3d,
      pads,
      padCount: pads.length,
      padNames: pads.map((pad) => pad.name),
      courtyard,
      widthMm: courtyard.width || footprintSizeFromPads(pads).widthMm,
      heightMm: courtyard.height || footprintSizeFromPads(pads).heightMm,
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
      const libId = `${library}:${name.includes(':') ? name.split(':').pop() : name}`
      const pins = parseSymbolPinsFromText(content, libId)
      assets.push({
        kind: 'symbol',
        libId,
        library,
        name: name.includes(':') ? name.split(':').pop() : name,
        path: file,
        pins,
        pinCount: pins.length,
        pinNumbers: pins.map((pin) => pin.number).filter(Boolean),
        pinNames: pins.map((pin) => pin.name).filter(Boolean),
        keywords: normalizeText(`${library} ${name}`).split(/\s+/).filter(Boolean),
      })
      if (assets.length >= maxAssets) return assets
    }
  }
  return assets
}

function footprintSizeFromPads(pads = []) {
  const useful = pads.filter((pad) => Number.isFinite(pad.x) && Number.isFinite(pad.y))
  if (!useful.length) return { widthMm: 0, heightMm: 0 }
  const xs = useful.flatMap((pad) => [pad.x - (pad.widthMm || 0) / 2, pad.x + (pad.widthMm || 0) / 2])
  const ys = useful.flatMap((pad) => [pad.y - (pad.heightMm || 0) / 2, pad.y + (pad.heightMm || 0) / 2])
  return {
    widthMm: Math.round((Math.max(...xs) - Math.min(...xs)) * 1000) / 1000,
    heightMm: Math.round((Math.max(...ys) - Math.min(...ys)) * 1000) / 1000,
  }
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
  const forcedFootprintId = assetId(component.footprint)
  const forcedSymbolId = assetId(component.symbol)
  const forced = forcedFootprintId ? manifest.footprints.find((asset) => asset.libId === forcedFootprintId) : null
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
  const symbol = forcedSymbolId ? manifest.symbols.find((asset) => asset.libId === forcedSymbolId) : firstByLibId(manifest.symbols, preferred.symbols) || rankAssets(manifest.symbols, terms)[0] || null
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

function assetId(asset) {
  if (!asset) return null
  return typeof asset === 'string' ? asset : asset.libId || asset.name || null
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

export function normalize3dModelPath(modelPath, roots = {}) {
  if (!modelPath) return null
  const raw = String(modelPath).replace(/\\/g, '/')
  if (/^\$\{KICAD\d*_3DMODEL_DIR\}\//.test(raw)) return raw
  const version = String(roots.version || process.env.KICAD_VERSION_MAJOR || '10').replace(/[^\d]/g, '') || '10'
  const root = roots.models3d ? path.resolve(roots.models3d).replace(/\\/g, '/') : null
  const absolute = path.isAbsolute(modelPath) ? path.resolve(modelPath).replace(/\\/g, '/') : null
  if (root && absolute && (absolute === root || absolute.startsWith(`${root}/`))) {
    return `\${KICAD${version}_3DMODEL_DIR}/${absolute.slice(root.length).replace(/^\/+/, '')}`
  }
  return raw
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
