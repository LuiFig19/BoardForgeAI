import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

export const stateFileName = 'boardforge-project.json'

export function createProjectState({ job, board, mode, profile, components = [], library = null, componentBindings = null, review = null, generatedFiles = [] }) {
  const now = new Date().toISOString()
  return {
    schemaVersion: 1,
    projectId: job.id || `boardforge_${Date.now()}`,
    projectName: board.name,
    mode,
    status: review?.status || 'NEEDS_HUMAN_REVIEW',
    createdAt: now,
    updatedAt: now,
    source: {
      executor: 'boardforge-plugin',
      jobType: job.type,
      jobId: job.id || null,
      input: job.input || {},
    },
    manufacturerProfile: profile,
    requirements: extractRequirements(job.input || {}),
    board: normalizeBoard(board),
    components: normalizeComponents(components),
    designIntent: job.input?.designIntent || null,
    library,
    componentBindings,
    validation: {
      selfReview: review,
      outline: [],
      placement: [],
      erc: null,
      drc: null,
      gates: review?.qualityGates || [],
    },
    exports: {
      gerbers: null,
      drill: null,
      bom: null,
      cpl: null,
      jlcpcb: null,
    },
    generatedFiles,
    history: [
      {
        at: now,
        jobType: job.type,
        status: review?.status || 'CREATED',
        message: `${job.type} created or updated BoardForge project state.`,
      },
    ],
    humanReviewRequired: true,
  }
}

export async function writeProjectState(projectDir, state) {
  const next = { ...state, updatedAt: new Date().toISOString() }
  const file = path.join(projectDir, stateFileName)
  await writeFile(file, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
  return file
}

export async function readProjectState(projectDir) {
  const file = path.join(projectDir, stateFileName)
  if (!existsSync(file)) return null
  return JSON.parse(await readFile(file, 'utf8'))
}

export async function updateProjectState(projectDir, updater) {
  const current = await readProjectState(projectDir)
  if (!current) return null
  const next = await updater(current)
  return writeProjectState(projectDir, {
    ...next,
    history: [
      ...(next.history || []),
      {
        at: new Date().toISOString(),
        jobType: next.lastJobType || 'state_update',
        status: next.status || 'UPDATED',
        message: next.lastHistoryMessage || 'BoardForge project state updated.',
      },
    ],
  })
}

export function summarizeProjectState(state) {
  if (!state) return null
  return {
    projectName: state.projectName,
    mode: state.mode,
    status: state.status,
    board: {
      units: state.board.units,
      widthMm: state.board.widthMm,
      heightMm: state.board.heightMm,
      outlinePoints: state.board.outline.length,
      mountingHoles: state.board.mountingHoles.length,
    },
    components: {
      count: state.components.length,
      unresolvedAssets: state.components.filter((component) => component.libraryStatus !== 'resolved_needs_review').length,
    },
    validation: {
      erc: state.validation?.erc?.status || 'not_run',
      drc: state.validation?.drc?.status || 'not_run',
    },
    exports: Object.fromEntries(Object.entries(state.exports || {}).map(([key, value]) => [key, value?.status || 'not_generated'])),
    humanReviewRequired: true,
  }
}

function extractRequirements(input) {
  return {
    templateId: input.templateId || null,
    projectName: input.projectName || input.name || input.board?.name || null,
    layerCount: input.layerCount || input.board?.layerCount || null,
    manufacturer: input.manufacturer || input.manufacturerProfile || 'JLCPCB_STANDARD',
    interfaces: input.interfaces || [],
    nets: input.nets || [],
    notes: input.notes || input.board?.notes || '',
  }
}

function normalizeBoard(board) {
  return {
    name: board.name,
    units: board.units || 'mm',
    widthMm: board.widthMm || board.width || null,
    heightMm: board.heightMm || board.height || null,
    layerCount: board.layerCount || 2,
    outline: (board.outline || []).map((point, index) => ({ id: `P${index + 1}`, x: Number(point.x), y: Number(point.y) })),
    mountingHoles: (board.mountingHoles || []).map((hole, index) => ({ id: hole.id || `H${index + 1}`, x: Number(hole.x), y: Number(hole.y), diameterMm: Number(hole.diameterMm || 3) })),
    componentGroups: board.componentGroups || [],
  }
}

export function normalizeComponents(components) {
  return components.map((component) => ({
    ref: component.ref,
    group: component.group || null,
    value: component.value || null,
    x: Number(component.x || 0),
    y: Number(component.y || 0),
    rotation: Number(component.rotation || 0),
    width: Number(component.width || 0),
    height: Number(component.height || 0),
    symbol: component.symbol?.libId || component.symbol || null,
    footprint: component.footprint?.libId || component.footprint || null,
    model3d: component.model3d?.path || component.model3d || null,
    pinMap: component.pinMap || {},
    package: component.package || null,
    lcsc: component.lcsc || null,
    mpn: component.mpn || null,
    libraryStatus: component.footprint && component.symbol ? 'resolved_needs_review' : 'needs_review',
  }))
}
