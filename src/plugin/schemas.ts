import { z } from 'zod'

export const pointSchema = z.object({
  x: z.number(),
  y: z.number(),
})

export const mountingHoleSchema = z.object({
  id: z.string(),
  x: z.number(),
  y: z.number(),
  diameterMm: z.number().positive(),
})

export const edgeCutSegmentSchema = z.object({
  type: z.literal('line'),
  start: pointSchema,
  end: pointSchema,
})

export const arcSegmentSchema = z.object({
  type: z.literal('arc'),
  start: pointSchema,
  mid: pointSchema,
  end: pointSchema,
})

export const cutoutSchema = z.object({
  id: z.string(),
  kind: z.enum(['usb_c_notch', 'rj45_clearance', 'mount_slot', 'custom']),
  segments: z.array(z.union([edgeCutSegmentSchema, arcSegmentSchema])),
})

export const boardOutlineSchema = z.object({
  id: z.string(),
  name: z.string(),
  units: z.enum(['mm', 'inch']),
  shapeType: z.enum(['rectangle', 'rounded_rectangle', 'circle', 'capsule', 'polygon', 'custom', 'drone_frame', 'sensor_board']),
  widthMm: z.number().positive().optional(),
  heightMm: z.number().positive().optional(),
  cornerRadiusMm: z.number().min(0).optional(),
  segments: z.array(z.union([edgeCutSegmentSchema, arcSegmentSchema])),
  mountingHoles: z.array(mountingHoleSchema),
  cutouts: z.array(cutoutSchema),
  notes: z.string().optional(),
})

export const pluginJobTypeSchema = z.enum([
  'create_outline_board',
  'create_kicad_project',
  'apply_edge_cuts',
  'apply_ai_edit',
  'scan_kicad_project',
  'find_missing_footprints',
  'assign_footprints',
  'link_3d_models',
  'place_components',
  'route_critical_nets',
  'run_erc',
  'run_drc',
  'export_gerbers',
  'export_drill_files',
  'export_bom',
  'export_cpl',
  'export_manufacturing_package',
  'package_jlcpcb',
  'summarize_project',
])

export const pluginJobSchema = z.object({
  id: z.string(),
  type: pluginJobTypeSchema,
  status: z.enum(['queued', 'approved', 'running', 'complete', 'failed', 'blocked']).default('queued'),
  projectId: z.string().optional(),
  boardId: z.string().optional(),
  createdAt: z.string(),
  startedAt: z.string().optional(),
  completedAt: z.string().optional(),
  pluginVersion: z.string().optional(),
  kicadVersion: z.string().optional(),
  workspace: z.string(),
  dryRun: z.boolean().default(true),
  allowOverwrite: z.boolean().default(false),
  input: z.record(z.string(), z.unknown()),
})

export const pluginResultSchema = z.object({
  id: z.string(),
  jobId: z.string(),
  status: z.enum(['complete', 'failed', 'blocked', 'not_implemented']),
  output: z.record(z.string(), z.unknown()).optional(),
  logs: z.array(z.string()).default([]),
  warnings: z.array(z.string()).default([]),
  errors: z.array(z.string()).default([]),
  generatedFiles: z.array(z.string()).default([]),
})

export type BoardOutline = z.infer<typeof boardOutlineSchema>
export type PluginJob = z.infer<typeof pluginJobSchema>
export type PluginResult = z.infer<typeof pluginResultSchema>
