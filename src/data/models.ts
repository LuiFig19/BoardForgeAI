import { z } from 'zod'

export const boardTypes = [
  'drone flight controller',
  'IoT sensor',
  'PoE device',
  'robotics controller',
  'motor controller',
  'custom',
] as const

export const boardShapeTypes = [
  'rectangle',
  'rounded rectangle',
  'circle',
  'capsule',
  'hexagon',
  'octagon',
  'drone frame',
  'sensor board',
  'custom drawn',
  'image traced',
] as const

export const jobStatuses = [
  'queued',
  'running',
  'needs_human_review',
  'blocked_missing_dependency',
  'failed',
  'package_ready',
] as const

export const agentStepNames = [
  'Requirements parsed',
  'Architecture planned',
  'Component candidates selected',
  'Schematic generated',
  'Footprints assigned',
  'Board outline generated',
  'Placement generated',
  'Critical routes generated',
  'ERC check',
  'DRC check',
  'Manufacturing files exported',
  'Package ready',
  'Needs human review',
] as const

export const generationRequestSchema = z.object({
  projectName: z.string().min(2).max(80),
  boardType: z.enum(boardTypes),
  targetCad: z.literal('KiCad'),
  boardSize: z.string().min(2),
  layerCount: z.enum(['2', '4', '6', '8']),
  manufacturer: z.literal('JLCPCB'),
  assemblyTarget: z.enum(['PCB only', 'PCB assembly', 'hand assembly']),
  componentSource: z.enum(['JLCPCB/LCSC', 'Digi-Key', 'Mouser', 'custom library']),
  mcu: z.string().optional(),
  sensors: z.string().optional(),
  connectors: z.string().optional(),
  powerInput: z.string().optional(),
  outputRails: z.string().optional(),
  interfaces: z.array(z.string()),
  mechanicalConstraints: z.string().optional(),
  keepouts: z.string().optional(),
  highSpeedConstraints: z.string().optional(),
  boardShape: z.enum(boardShapeTypes),
  boardWidthMm: z.coerce.number().min(5).max(600),
  boardHeightMm: z.coerce.number().min(5).max(600),
  mountingHoleCount: z.coerce.number().int().min(0).max(24),
  outlineNotes: z.string().optional(),
  referenceImageName: z.string().optional(),
  placementMarks: z.array(
    z.object({
      id: z.string(),
      x: z.number().min(0).max(1),
      y: z.number().min(0).max(1),
      kind: z.enum(['MCU', 'connector', 'power', 'sensor', 'mounting hole', 'keepout', 'antenna', 'hot zone']),
      note: z.string(),
    }),
  ),
  priority: z.enum(['cost', 'balanced', 'performance']),
  notes: z.string().min(10),
})

export type GenerationRequest = z.infer<typeof generationRequestSchema>
export type BoardShapeType = (typeof boardShapeTypes)[number]
export type JobStatus = (typeof jobStatuses)[number]
export type AgentStepName = (typeof agentStepNames)[number]

export type BoardOutlinePoint = {
  x: number
  y: number
}

export type BoardMountingHole = {
  id: string
  x: number
  y: number
  diameterMm: number
}

export type Board = {
  id: string
  name: string
  type: 'outline_only' | 'full_project'
  shapeType: BoardShapeType
  width: number
  height: number
  units: 'mm' | 'inch'
  cornerRadiusMm: number
  outline: BoardOutlinePoint[]
  mountingHoles: BoardMountingHole[]
  generatedFiles: string[]
  createdAt: string
  updatedAt: string
  status: 'draft' | 'saved' | 'ready_to_export' | 'exported'
  sourcePrompt: string
  projectId?: string
  editHistory: string[]
}

export type User = {
  id: string
  name: string
  email: string
  role: 'founder' | 'engineer' | 'admin'
}

export type Project = {
  id: string
  userId: string
  name: string
  boardType: GenerationRequest['boardType']
  createdAt: string
  updatedAt: string
  specs: {
    targetCad: 'KiCad'
    boardSize: string
    layerCount: number
    manufacturer: 'JLCPCB'
    assemblyTarget: string
  }
}

export type AgentStep = {
  id: string
  jobId: string
  name: AgentStepName
  agent:
    | 'Requirements Agent'
    | 'Architecture Agent'
    | 'Component Agent'
    | 'Schematic Agent'
    | 'Footprint Agent'
    | 'Placement Agent'
    | 'Routing Agent'
    | 'Verification Agent'
    | 'Export Agent'
    | 'Review Agent'
  status: 'pending' | 'running' | 'complete' | 'blocked' | 'demo'
  output?: unknown
  warning?: string
}

export type Component = {
  id: string
  projectId: string
  reference: string
  name: string
  manufacturerPartNumber: string
  footprint: string
  source: string
  costEstimate: number
  lifecycleFlag: 'active' | 'review' | 'unknown'
}

export type Net = {
  id: string
  projectId: string
  name: string
  className: 'power' | 'high speed' | 'default' | 'differential pair'
}

export type ValidationReport = {
  id: string
  projectId: string
  ercStatus: 'not_run' | 'passed' | 'warnings' | 'failed'
  drcStatus: 'not_run' | 'passed' | 'warnings' | 'failed'
  warnings: string[]
  errors: string[]
}

export type GeneratedFile = {
  id: string
  projectId: string
  path: string
  kind: 'kicad' | 'gerber' | 'drill' | 'bom' | 'cpl' | 'report' | 'readme' | 'zip'
  status: 'created' | 'pending_kicad_cli' | 'coming_soon'
}

export type ExportPackage = {
  id: string
  projectId: string
  files: GeneratedFile[]
  checklist: { label: string; status: 'ready' | 'needs_review' | 'blocked' }[]
}

export type GenerationJob = {
  id: string
  projectId: string
  status: JobStatus
  progress: number
  modelUsed: string
  tokenEstimate: number
  costEstimate: number
  createdAt: string
  completedAt?: string
  errorMessage?: string
  currentStep: AgentStepName
  downloadablePackageLink?: string
  warningsCount: number
  errorsCount: number
  request: GenerationRequest
  requirementsJson: Record<string, unknown>
  architecture: {
    blocks: string[]
    powerTree: string[]
    interfaces: string[]
    riskLevel: 'safe' | 'review required' | 'likely broken' | 'cannot manufacture yet'
  }
  agentSteps: AgentStep[]
  components: Component[]
  nets: Net[]
  validationReport: ValidationReport
  exportPackage: ExportPackage
  logs: string[]
}
