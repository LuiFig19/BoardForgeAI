import { existsSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'

export async function validate3dModelCoverage(projectDir, components = [], options = {}) {
  const checked = components.filter((component) => component.ref && !component.dnp)
  const results = checked.map((component) => {
    const model = component.model3d?.path || component.model3d || null
    const variableModel = typeof model === 'string' && /^\$\{KICAD\d*_3DMODEL_DIR\}\//.test(model)
    const absoluteExists = typeof model === 'string' && !variableModel && existsSync(model)
    const linked = Boolean(model)
    return {
      ref: component.ref,
      group: component.group,
      footprint: component.footprint?.libId || component.footprint || null,
      model3d: model,
      status: !linked ? 'missing' : variableModel || absoluteExists ? 'linked' : 'linked_path_unverified',
    }
  })
  const errors = results.filter((item) => !item.footprint).map((item) => issue('ERROR', 'FOOTPRINT_MISSING_FOR_3D_REVIEW', `${item.ref} has no footprint, so 3D coverage cannot be trusted.`, { ref: item.ref }))
  const warnings = [
    ...results.filter((item) => item.status === 'missing').map((item) => issue('WARNING', 'MODEL_3D_MISSING', `${item.ref} has no 3D model linked.`, { ref: item.ref, footprint: item.footprint })),
    ...results.filter((item) => item.status === 'linked_path_unverified').map((item) => issue('WARNING', 'MODEL_3D_PATH_UNVERIFIED', `${item.ref} has a 3D model path that could not be verified locally.`, { ref: item.ref, model3d: item.model3d })),
  ]
  const report = {
    status: errors.length ? 'MODEL_3D_COVERAGE_BLOCKED' : warnings.length ? 'MODEL_3D_COVERAGE_NEEDS_REVIEW' : 'MODEL_3D_COVERAGE_READY',
    projectDir,
    checked: checked.length,
    linked: results.filter((item) => item.status === 'linked').length,
    missing: results.filter((item) => item.status === 'missing').length,
    unverified: results.filter((item) => item.status === 'linked_path_unverified').length,
    results,
    errors,
    warnings,
    actions: warnings.length || errors.length ? [{ command: 'link_3d_models', reason: 'Resolve missing or unverified KiCad 3D model references before visual review.' }] : [],
    humanReviewRequired: true,
  }
  if (options.write !== false) {
    const outputFile = path.join(projectDir, 'boardforge-3d-model-coverage.json')
    await writeFile(outputFile, JSON.stringify(report, null, 2), 'utf8')
    return { ...report, outputFile }
  }
  return report
}

function issue(severity, code, message, details = {}) {
  return { severity, code, message, details }
}
