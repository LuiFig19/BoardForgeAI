'use client'

import { useEffect, useMemo, useRef, useState, type Dispatch, type FormEvent, type KeyboardEvent, type MouseEvent, type PointerEvent, type SetStateAction, type WheelEvent } from 'react'
import { createPortal } from 'react-dom'
import { motion, useScroll, useTransform } from 'framer-motion'
import JSZip from 'jszip'
import {
  ArrowRight,
  CheckCircle2,
  CircuitBoard,
  Copy,
  Database,
  Download,
  Factory,
  FileArchive,
  FileCheck2,
  FolderKanban,
  GitBranch,
  HardDrive,
  Layers3,
  PackageCheck,
  Play,
  Plug,
  RefreshCw,
  Server,
  ShieldCheck,
  ShieldAlert,
  Sparkles,
  TerminalSquare,
  Upload,
  Workflow,
  X,
} from 'lucide-react'
import { Layout, StatusBadge, WarningBanner } from './components/Layout'
import { PcbScene } from './components/PcbScene'
import { RealisticPcbViewer } from './components/RealisticPcbViewer'
import { emptyRequest, templates } from './data/fixtures'
import { demoBoardRoutes, demoBoardVias, demoPlacedFootprints, footprintPackages, packageById, resolvePlacedFootprints, type BoardRoute, type BoardVia, type PlacedFootprint } from './data/footprints'
import { boardShapeTypes, type Board, type BoardShapeType, type GenerationJob, type GenerationRequest } from './data/models'
import { useJobs } from './store/useJobs'
import { useBoards } from './store/useBoards'
import { boardRuleEngine, promptModules } from './services/agents'
import { KiCadBoardOutlineService, KiCadExportService, KiCadProjectService, KiCadValidationService, ProjectPackageService } from './services/kicad'

const interfaces = ['USB', 'Ethernet', 'CAN', 'UART', 'SPI', 'I2C', 'Wi-Fi', 'BLE', 'LoRa']
const routes = ['/', '/generate', '/dashboard', '/project', '/boards', '/plugin', '/export', '/logs', '/pricing', '/docs', '/admin']
const wizardSteps = ['Outline setup', 'Shape studio', 'Plugin handoff']
const markKinds: GenerationRequest['placementMarks'][number]['kind'][] = ['MCU', 'connector', 'power', 'sensor', 'mounting hole', 'keepout', 'antenna', 'hot zone']
const outlineService = new KiCadBoardOutlineService()
const defaultPluginStatus = {
  installed: false,
  connected: false,
  kicadDetected: false,
  kicadVersion: 'Not detected',
  cliAvailable: false,
  workspace: 'No local workspace approved',
  lastSync: 'Never',
  lastJob: 'No plugin jobs yet',
}
type PluginRuntimeStatus = typeof defaultPluginStatus
const outlinePresets = [
  {
    name: 'Rounded controller outline',
    shape: 'rounded rectangle' as BoardShapeType,
    width: 70,
    height: 45,
    holes: 4,
    notes: 'Compact controller board with four M3 mounting holes and softened corners.',
  },
  {
    name: 'Sensor tab outline',
    shape: 'sensor board' as BoardShapeType,
    width: 58,
    height: 32,
    holes: 2,
    notes: 'Small sensor board with a front connector tab and two mounting holes.',
  },
  {
    name: 'Drone frame outline',
    shape: 'drone frame' as BoardShapeType,
    width: 92,
    height: 70,
    holes: 4,
    notes: 'Symmetric drone-style outline with arm clearance and center electronics zone.',
  },
]
const generationModes = ['Board Outline Only', 'Full PCB Project', 'Improve Existing KiCad Project', 'Export/Package Existing Project'] as const
const pluginCommands = [
  'create_outline_board',
  'create_kicad_project',
  'apply_edge_cuts',
  'scan_kicad_project',
  'snapshot_project',
  'list_project_snapshots',
  'diff_project_snapshot',
  'restore_project_snapshot',
  'run_project_preflight',
  'list_board_categories',
  'plan_board_category',
  'validate_schematic_graph',
  'validate_schematic_readiness',
  'synthesize_schematic_design',
  'validate_schematic_pcb_sync',
  'apply_schematic_pcb_sync',
  'check_routing_readiness',
  'calculate_power_routing',
  'select_via_strategy',
  'build_noise_map',
  'summarize_manufacturer_rules',
  'generate_project_review_report',
  'build_workflow_preset',
  'run_boardforge_workflow',
  'plan_mission_requirements',
  'intake_user_bom',
  'audit_user_bom',
  'ingest_reference_design',
  'synthesize_circuit_blocks',
  'plan_production_pipeline',
  'build_verified_demo_recipe',
  'build_canonical_net_model',
  'audit_asset_resolution',
  'audit_placement_legality',
  'compile_routing_execution_strategy',
  'audit_release_export_gates',
  'run_production_readiness_suite',
  'classify_board_architecture',
  'plan_hdi_manufacturing_strategy',
  'audit_return_path_integrity',
  'audit_creepage_clearance',
  'plan_bringup_reliability_matrix',
  'run_advanced_board_suite',
  'autotrace_board',
  'autotrace_critical_nets',
  'autotrace_power',
  'autotrace_signals',
  'autotrace_diff_pairs',
  'autotrace_remaining_nets',
  'repair_routing',
  'reroute_failed_nets',
  'run_routing_drc',
  'calculate_trace_width',
  'validate_trace_width',
  'detect_power_neckdowns',
  'create_power_pour',
  'select_via_type',
  'validate_via_manufacturability',
  'plan_requirements',
  'plan_pin_assignments',
  'plan_power_tree',
  'plan_stackup',
  'plan_fanout',
  'plan_signal_integrity',
  'plan_test_strategy',
  'run_dfm_checks',
  'compare_manufacturers',
  'plan_complex_board',
  'generate_design_constraints',
  'generate_kicad_rules',
  'audit_component_library',
  'validate_component_bindings',
  'plan_pin_map_repairs',
  'apply_pin_map_repairs',
  'validate_3d_model_coverage',
  'audit_bom_sourcing',
  'generate_manufacturing_manifest',
  'generate_netlist',
  'run_design_audit',
  'generate_schematic',
  'find_missing_footprints',
  'link_3d_models',
  'classify_nets',
  'assign_net_classes',
  'autoroute_board',
  'autoroute_and_apply',
  'autoroute_drc_iteration',
  'plan_erc_repairs',
  'apply_safe_erc_repairs',
  'run_kicad_drc',
  'run_kicad_erc',
  'plan_copper_pours',
  'analyze_routing_congestion',
  'plan_escape_routing',
  'plan_diff_pair_tuning',
  'validate_power_integrity',
  'analyze_thermal_bottlenecks',
  'validate_assembly_orientation',
  'estimate_board_cost',
  'generate_engineering_questions',
  'score_production_readiness',
  'build_release_gate_report',
  'score_routing_quality',
  'generate_routing_report',
  'optimize_placement',
  'solve_placement',
  'apply_placement_plan',
  'plan_autoroute_repair_loop',
  'export_gerbers',
  'export_drill_files',
  'export_bom',
  'export_cpl',
  'validate_jlcpcb_package',
  'package_jlcpcb',
  'summarize_project',
]

function PluginConnectionBanner() {
  const pluginStatus = usePluginRuntimeStatus()
  return (
    <section className="plugin-banner">
      <div>
        <StatusBadge tone={pluginStatus.connected ? 'green' : 'amber'}>
          BoardForge Plugin: {pluginStatus.connected ? 'Connected' : 'Not Connected'}
        </StatusBadge>
        <h2>{pluginStatus.connected ? 'KiCad local execution is ready' : 'Install the Codex plugin to generate real KiCad files locally'}</h2>
        <p>
          The web app creates specs, board outlines, project plans, dashboards, and reports. BoardForge Codex Plugin plus the local helper is the execution engine that touches KiCad files, runs whitelisted KiCad CLI commands, and packages manufacturing outputs.
        </p>
      </div>
      <a className="primary-action" href="#/plugin"><Plug size={16} /> Get BoardForge Plugin</a>
    </section>
  )
}

function usePluginRuntimeStatus(): PluginRuntimeStatus {
  const [status, setStatus] = useState<PluginRuntimeStatus>(defaultPluginStatus)

  useEffect(() => {
    let cancelled = false
    const probe = async () => {
      try {
        const [serverResponse, kicadResponse] = await Promise.all([
          fetch('http://127.0.0.1:47321/status'),
          fetch('http://127.0.0.1:47321/kicad/status'),
        ])
        if (!serverResponse.ok || !kicadResponse.ok) throw new Error('BoardForge local server unavailable')
        const server = await serverResponse.json()
        const kicad = await kicadResponse.json()
        if (!cancelled) {
          setStatus({
            installed: true,
            connected: true,
            kicadDetected: Boolean(kicad.available),
            kicadVersion: kicad.version || 'Not detected',
            cliAvailable: Boolean(kicad.available),
            workspace: server.workspace || 'Local workspace connected',
            lastSync: new Date().toLocaleTimeString(),
            lastJob: 'Local server online',
          })
        }
      } catch {
        if (!cancelled) setStatus(defaultPluginStatus)
      }
    }
    void probe()
    const timer = window.setInterval(probe, 10000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [])

  return status
}

const makeShapePoints = (shape: BoardShapeType): Array<{ x: number; y: number }> => {
  if (shape === 'circle') {
    return Array.from({ length: 36 }, (_, index) => {
      const angle = (index / 36) * Math.PI * 2
      return { x: 0.5 + Math.cos(angle) * 0.42, y: 0.5 + Math.sin(angle) * 0.42 }
    })
  }
  if (shape === 'hexagon' || shape === 'octagon') {
    const sides = shape === 'hexagon' ? 6 : 8
    return Array.from({ length: sides }, (_, index) => {
      const angle = (index / sides) * Math.PI * 2 - Math.PI / 2
      return { x: 0.5 + Math.cos(angle) * 0.42, y: 0.5 + Math.sin(angle) * 0.42 }
    })
  }
  if (shape === 'capsule') {
    return [
      { x: 0.2, y: 0.12 }, { x: 0.8, y: 0.12 }, { x: 0.94, y: 0.28 }, { x: 0.94, y: 0.72 },
      { x: 0.8, y: 0.88 }, { x: 0.2, y: 0.88 }, { x: 0.06, y: 0.72 }, { x: 0.06, y: 0.28 },
    ]
  }
  if (shape === 'drone frame') {
    return [
      { x: 0.15, y: 0.2 }, { x: 0.32, y: 0.08 }, { x: 0.68, y: 0.08 }, { x: 0.85, y: 0.2 },
      { x: 0.78, y: 0.5 }, { x: 0.85, y: 0.8 }, { x: 0.68, y: 0.92 }, { x: 0.32, y: 0.92 },
      { x: 0.15, y: 0.8 }, { x: 0.22, y: 0.5 },
    ]
  }
  if (shape === 'sensor board' || shape === 'image traced') {
    return [
      { x: 0.08, y: 0.18 }, { x: 0.74, y: 0.14 }, { x: 0.92, y: 0.32 },
      { x: 0.88, y: 0.84 }, { x: 0.12, y: 0.88 }, { x: 0.04, y: 0.44 },
    ]
  }
  return [
    { x: 0.08, y: 0.12 },
    { x: 0.92, y: 0.12 },
    { x: 0.92, y: 0.88 },
    { x: 0.08, y: 0.88 },
  ]
}

const roundedRectanglePoints = (radiusPercent = 8) => {
  const r = Math.min(18, Math.max(2, radiusPercent)) / 100
  return [
    { x: 0.08 + r, y: 0.1 }, { x: 0.92 - r, y: 0.1 }, { x: 0.92, y: 0.1 + r },
    { x: 0.92, y: 0.9 - r }, { x: 0.92 - r, y: 0.9 }, { x: 0.08 + r, y: 0.9 },
    { x: 0.08, y: 0.9 - r }, { x: 0.08, y: 0.1 + r },
  ]
}

const mountingHolesForRequest = (request: GenerationRequest, diameterMm = 3) => {
  const positions = [
    [0.12, 0.16],
    [0.88, 0.16],
    [0.12, 0.84],
    [0.88, 0.84],
    [0.5, 0.16],
    [0.5, 0.84],
    [0.12, 0.5],
    [0.88, 0.5],
  ]
  return Array.from({ length: request.mountingHoleCount }).map((_, index) => {
    const [x, y] = positions[index % positions.length]
    return { id: `hole_${index + 1}`, x, y, diameterMm }
  })
}

const downloadBoardBundle = async (board: Board) => {
  const files = outlineService.createProjectBundle(board)
  const zip = new JSZip()
  files.forEach((file) => zip.file(file.path, file.content))
  const blob = await zip.generateAsync({ type: 'blob' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${outlineService.getProjectFiles(board).safeName}-kicad-outline.zip`
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

const pointToMm = (point: { x: number; y: number }, board: Board) => ({
  x: Number((point.x * board.width).toFixed(3)),
  y: Number((point.y * board.height).toFixed(3)),
})

const buildCodexOutlinePrompt = (board: Board) => {
  const outlinePointsMm = board.outline.map((point, index) => ({ id: `P${index + 1}`, ...pointToMm(point, board) }))
  const mountingHolesMm = board.mountingHoles.map((hole, index) => ({ id: hole.id || `H${index + 1}`, ...pointToMm(hole, board), diameterMm: hole.diameterMm }))
  const payload = {
    tool: 'create_outline_board',
    projectName: board.name,
    units: board.units,
    intent: 'Create an outline-only KiCad project. Do not place components, route traces, or generate manufacturing files until the outline is reviewed.',
    board: {
      widthMm: board.width,
      heightMm: board.height,
      shapeType: board.shapeType,
      cornerRadiusMm: board.cornerRadiusMm,
      outlinePointsMm,
      outlinePointsNormalized: board.outline.map((point, index) => ({
        id: `P${index + 1}`,
        x: Number(point.x.toFixed(6)),
        y: Number(point.y.toFixed(6)),
      })),
      edgeCutsSegmentsMm: outlinePointsMm.map((point, index) => ({
        from: point.id,
        to: outlinePointsMm[(index + 1) % outlinePointsMm.length].id,
        start: { x: point.x, y: point.y },
        end: { x: outlinePointsMm[(index + 1) % outlinePointsMm.length].x, y: outlinePointsMm[(index + 1) % outlinePointsMm.length].y },
      })),
      mountingHolesMm,
    },
    requiredOutputs: [
      `${outlineService.getProjectFiles(board).safeName}.kicad_pro`,
      `${outlineService.getProjectFiles(board).safeName}.kicad_sch`,
      `${outlineService.getProjectFiles(board).safeName}.kicad_pcb with Edge.Cuts matching the exact points above`,
      'README with outline dimensions, holes, and human review warning',
    ],
    validation: [
      'Use the BoardForge Codex Plugin or local helper only.',
      'Run KiCad DRC if kicad-cli is available.',
      'Report any open outline, self-intersection, or invalid hole placement before export.',
      'Do not freestyle shell commands or manually edit KiCad files outside BoardForge tools.',
    ],
    sourceNotes: board.sourcePrompt || '',
  }

  return `Use the BoardForge Codex Plugin to create an outline-only KiCad project from this exact board outline. The Edge.Cuts geometry must match the point list exactly in millimeters.\n\n\`\`\`json\n${JSON.stringify(payload, null, 2)}\n\`\`\`\n\nAfter creation, summarize the generated files and any KiCad DRC/outline validation result.`
}

function useHashRoute() {
  const getHashRoute = () => (typeof window === 'undefined' ? '/' : window.location.hash.replace('#', '') || '/')
  const [route, setRoute] = useState(getHashRoute)
  useEffect(() => {
    const onHash = () => setRoute(getHashRoute())
    onHash()
    window.addEventListener('hashchange', onHash)
    window.addEventListener('popstate', onHash)
    return () => {
      window.removeEventListener('hashchange', onHash)
      window.removeEventListener('popstate', onHash)
    }
  }, [])
  return routes.includes(route) ? route : '/'
}

function LandingPage() {
  const { scrollYProgress } = useScroll()
  const sceneProgress = useTransform(scrollYProgress, [0, 0.72], [0.04, 1])
  const [progress, setProgress] = useState(0.06)

  useEffect(() => sceneProgress.on('change', setProgress), [sceneProgress])

  const workflow = [
    {
      title: 'prompt',
      body: 'The user describes a board in Codex or starts with a BoardForge saved outline. The website captures specs, board shapes, templates, and exact handoff prompts.',
      details: ['requirements intake', 'saved board outlines', 'exact JSON payloads'],
    },
    {
      title: 'Codex plugin',
      body: 'BoardForge Plugin turns Codex into the hardware engineering agent. Codex calls BoardForge tools with structured JSON instead of randomly editing KiCad files.',
      details: ['safe tool calls', 'schema-validated jobs', 'approved local workspace'],
    },
    {
      title: 'local helper',
      body: 'The local helper is the only layer allowed to write KiCad files and run KiCad CLI. It creates projects, applies Edge.Cuts, scans libraries, and logs every action.',
      details: ['create KiCad projects', 'apply Edge.Cuts', 'scan symbols/footprints/3D models'],
    },
    {
      title: 'validation',
      body: 'The plugin runs ERC, DRC, and export checks through whitelisted KiCad automation. No arbitrary shell commands, no hidden file writes, and no fake browser-only manufacturing claims.',
      details: ['kicad-cli erc/drc', 'safe command whitelist', 'human review required'],
    },
    {
      title: 'package',
      body: 'After local validation, BoardForge packages real KiCad outputs only when the files exist: Gerbers, drill, BOM, CPL, reports, README, and JLCPCB ZIPs.',
      details: ['Gerbers and drill', 'BOM/CPL', 'JLCPCB package'],
    },
    {
      title: 'dashboard',
      body: 'Results return to BoardForge AI for dashboards, reports, saved boards, export history, team review, and pricing/account workflows.',
      details: ['run logs', 'project library', 'generated reports'],
    },
  ]

  return (
    <main>
      <section className="hero-section">
        <div className="hero-copy">
          <StatusBadge tone="cyan">Codex plugin first</StatusBadge>
          <h1>The Codex extension workflow for serious KiCad PCB engineering.</h1>
          <p>
            BoardForge AI is the command center for specs, reports, outlines, onboarding, and dashboards. Real PCB execution happens through the BoardForge Codex Plugin and a local KiCad helper on the user's machine.
          </p>
          <div className="action-row">
            <a className="secondary-action" href="#/plugin">
              <Plug size={18} /> Get BoardForge Plugin
            </a>
            <a className="primary-action" href="#/generate">
              <Play size={18} /> Create board outline
            </a>
            <a className="secondary-action" href="#/docs">
              View demo workflow <ArrowRight size={18} />
            </a>
          </div>
        </div>
        <div className="hero-visual" aria-label="3D PCB assembly animation">
          <PcbScene progress={progress} />
        </div>
      </section>

      <section className="architecture-band">
        {[
          ['1', 'Codex prompt', 'Use natural language in Codex or a saved BoardForge spec.'],
          ['2', 'Plugin job', 'Codex calls BoardForge-controlled commands with validated JSON.'],
          ['3', 'Local KiCad', 'The helper creates and edits real KiCad projects on disk.'],
          ['4', 'Validation gate', 'ERC/DRC/export checks must run before fab packaging.'],
        ].map(([number, title, body]) => (
          <article key={title}>
            <span>{number}</span>
            <strong>{title}</strong>
            <p>{body}</p>
          </article>
        ))}
      </section>

      <section className="render-gallery-section">
        <div className="section-heading">
          <StatusBadge tone="green">realistic KiCad-style previews</StatusBadge>
          <h2>Premium previews on the web; real KiCad work through the plugin.</h2>
          <p>These renders communicate the intended engineering quality. Local plugin jobs create, validate, and export the actual KiCad project files.</p>
        </div>
        <div className="render-gallery-grid">
          {templates.slice(0, 4).map((template, index) => (
            <article className="render-card" key={template.name}>
              <RealisticPcbViewer request={{ ...emptyRequest, ...template.defaults, projectName: template.name, boardType: template.boardType }} />
              <strong>{template.name}</strong>
              <span>{index === 0 ? 'plugin-ready project intent' : index === 1 ? 'local KiCad execution model' : index === 2 ? 'saved spec and report preview' : 'manufacturing package review'}</span>
            </article>
          ))}
        </div>
      </section>

      <section className="scroll-workflow">
        <div className="sticky-scene">
          <PcbScene progress={progress} compact />
        </div>
        <div className="workflow-steps">
          {workflow.map((item, index) => (
            <motion.article
              key={item.title}
              className="workflow-card"
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ margin: '-20% 0px -20% 0px' }}
            >
              <span>0{index + 1}</span>
              <h2>{item.title}</h2>
              <p>{item.body}</p>
              <ul>
                {item.details.map((detail) => <li key={detail}>{detail}</li>)}
              </ul>
            </motion.article>
          ))}
        </div>
      </section>
      <WarningBanner />
    </main>
  )
}

function OutlineGeneratorPage() {
  const saveBoard = useBoards((state) => state.saveBoard)
  const [form, setForm] = useState<GenerationRequest>({
    ...emptyRequest,
    projectName: 'Custom board outline',
    boardType: 'custom',
    notes: 'Outline-only website utility. Full PCB generation runs through the BoardForge Codex Plugin.',
    outlineNotes: 'User will create a custom Edge.Cuts board outline.',
  })
  const [step, setStep] = useState(0)
  const [customSketch, setCustomSketch] = useState<Array<{ x: number; y: number }>>([])
  const [aiShapePrompt, setAiShapePrompt] = useState('')
  const [roundedCorners, setRoundedCorners] = useState(false)
  const [cornerRadiusMm, setCornerRadiusMm] = useState(3)
  const [mountingHoleDiameterMm, setMountingHoleDiameterMm] = useState(3)
  const [savedBoard, setSavedBoard] = useState<Board | null>(null)
  const [copiedPrompt, setCopiedPrompt] = useState(false)
  const [draftBoardId] = useState(() => `board_${crypto.randomUUID()}`)

  const setField = <K extends keyof GenerationRequest>(key: K, value: GenerationRequest[K]) => setForm((current) => ({ ...current, [key]: value }))

  const buildOutlinePoints = () => {
    if (customSketch.length >= 3) return customSketch
    if (roundedCorners || form.boardShape === 'rounded rectangle') return roundedRectanglePoints((cornerRadiusMm / Math.max(form.boardWidthMm, form.boardHeightMm)) * 100)
    return makeShapePoints(form.boardShape)
  }

  const makeBoardFromForm = (status: Board['status'] = 'plugin_handoff', timestamp = new Date().toISOString()): Board => {
    const outline = buildOutlinePoints()
    const holes = mountingHolesForRequest(form, mountingHoleDiameterMm)
    const baseBoard: Board = {
      id: savedBoard?.id || draftBoardId,
      name: form.projectName || 'Custom Board Outline',
      type: 'outline_only',
      shapeType: roundedCorners && form.boardShape === 'rectangle' ? 'rounded rectangle' : form.boardShape,
      width: form.boardWidthMm,
      height: form.boardHeightMm,
      units: 'mm',
      cornerRadiusMm: roundedCorners || form.boardShape === 'rounded rectangle' ? cornerRadiusMm : 0,
      outline,
      mountingHoles: holes,
      generatedFiles: [],
      createdAt: savedBoard?.createdAt || timestamp,
      updatedAt: timestamp,
      status,
      sourcePrompt: [form.outlineNotes, form.mechanicalConstraints, form.referenceImageName ? `Reference image: ${form.referenceImageName}` : ''].filter(Boolean).join('\n'),
      editHistory: [...(savedBoard?.editHistory || []), `Saved outline: ${new Date(timestamp).toLocaleString()}`],
    }
    return { ...baseBoard, generatedFiles: outlineService.getProjectFiles(baseBoard).files }
  }

  const saveCurrentBoard = (status: Board['status'] = 'plugin_handoff') => {
    const board = saveBoard(makeBoardFromForm(status))
    setSavedBoard(board)
    return board
  }

  const applyPreset = (index: number) => {
    const preset = outlinePresets[index]
    setForm((current) => ({
      ...current,
      projectName: preset.name,
      boardType: 'custom',
      boardShape: preset.shape,
      boardWidthMm: preset.width,
      boardHeightMm: preset.height,
      boardSize: `${preset.width} mm x ${preset.height} mm`,
      mountingHoleCount: preset.holes,
      outlineNotes: preset.notes,
    }))
    setRoundedCorners(preset.shape === 'rounded rectangle')
    setCustomSketch(preset.shape === 'rounded rectangle' ? roundedRectanglePoints((cornerRadiusMm / Math.max(preset.width, preset.height)) * 100) : makeShapePoints(preset.shape))
    setStep(1)
  }

  const applyShapeEdit = (prompt: string) => {
    const lower = prompt.toLowerCase()
    let nextPoints = customSketch.length >= 3 ? customSketch : buildOutlinePoints()
    if (lower.includes('bigger') || lower.includes('larger') || lower.includes('wider')) {
      setField('boardWidthMm', Math.min(600, Math.round(form.boardWidthMm * 1.15)))
      if (!lower.includes('wider')) setField('boardHeightMm', Math.min(600, Math.round(form.boardHeightMm * 1.15)))
    }
    if (lower.includes('round')) {
      setRoundedCorners(true)
      setField('boardShape', 'rounded rectangle')
      nextPoints = roundedRectanglePoints((cornerRadiusMm / Math.max(form.boardWidthMm, form.boardHeightMm)) * 100)
    }
    if (lower.includes('circle')) {
      setRoundedCorners(false)
      setField('boardShape', 'circle')
      nextPoints = makeShapePoints('circle')
    }
    if (lower.includes('hex')) {
      setField('boardShape', 'hexagon')
      nextPoints = makeShapePoints('hexagon')
    }
    if (lower.includes('oct')) {
      setField('boardShape', 'octagon')
      nextPoints = makeShapePoints('octagon')
    }
    if (lower.includes('drone')) {
      setField('boardShape', 'drone frame')
      nextPoints = makeShapePoints('drone frame')
    }
    if (lower.includes('sensor')) {
      setField('boardShape', 'sensor board')
      nextPoints = makeShapePoints('sensor board')
    }
    if (lower.includes('hole') || lower.includes('m3')) {
      setField('mountingHoleCount', Math.max(form.mountingHoleCount, 4))
      setMountingHoleDiameterMm(lower.includes('m3') ? 3 : mountingHoleDiameterMm)
    }
    if (lower.includes('usb')) {
      setField('outlineNotes', `${form.outlineNotes || ''}\nAI edit: reserve a USB edge/notch instruction for the plugin handoff.`.trim())
    }
    setCustomSketch(nextPoints)
    setField('outlineNotes', `${form.outlineNotes || ''}\nAI shape edit: ${prompt}`.trim())
    setAiShapePrompt('')
  }

  const generateOutline = () => {
    if (customSketch.length < 3) setCustomSketch(buildOutlinePoints())
    saveCurrentBoard('plugin_handoff')
    setStep(2)
  }

  const currentBoard = savedBoard || makeBoardFromForm('plugin_handoff', '1970-01-01T00:00:00.000Z')
  const codexPrompt = buildCodexOutlinePrompt(currentBoard)

  const copyPrompt = async () => {
    const board = saveCurrentBoard('plugin_handoff')
    await navigator.clipboard.writeText(buildCodexOutlinePrompt(board))
    setCopiedPrompt(true)
    window.setTimeout(() => setCopiedPrompt(false), 1800)
  }

  const downloadPrompt = () => {
    const board = saveCurrentBoard('plugin_handoff')
    const blob = new Blob([buildCodexOutlinePrompt(board)], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${outlineService.getProjectFiles(board).safeName}-codex-plugin-prompt.txt`
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
  }

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault()
    await downloadBoardBundle(saveCurrentBoard('plugin_handoff'))
  }

  return (
    <main className="page-grid">
      <section className="page-head">
        <StatusBadge tone="green">Board outline only</StatusBadge>
        <h1>Board Outline Studio</h1>
        <p>The website creates saved board shapes, exact Codex plugin prompts, and outline-only KiCad ZIPs. Full PCB generation, placement, routing, validation, and exports belong to the BoardForge Codex Plugin.</p>
      </section>
      <PluginConnectionBanner />
      <section className="mode-grid">
        {outlinePresets.map((preset, index) => (
          <button key={preset.name} type="button" onClick={() => applyPreset(index)}>
            <strong>{preset.name}</strong>
            <span>{preset.width} mm x {preset.height} mm, {preset.shape}, {preset.holes} mounting holes</span>
          </button>
        ))}
      </section>
      <nav className="wizard-tabs" aria-label="Board outline steps">
        {wizardSteps.map((item, index) => (
          <button className={step === index ? 'active' : ''} key={item} type="button" onClick={() => setStep(index)}>
            <span>{index + 1}</span>
            {item}
          </button>
        ))}
      </nav>
      <form className="generator-form" onSubmit={onSubmit}>
        {step === 0 && (
          <>
            <label>
              Board outline name
              <input value={form.projectName} onChange={(event) => setField('projectName', event.target.value)} />
            </label>
            <label>
              Board shape
              <select value={form.boardShape} onChange={(event) => setField('boardShape', event.target.value as GenerationRequest['boardShape'])}>
                {boardShapeTypes.map((shape) => <option key={shape}>{shape}</option>)}
              </select>
            </label>
            <label>
              Width in mm
              <input type="number" min="5" max="600" value={form.boardWidthMm} onChange={(event) => setField('boardWidthMm', Number(event.target.value))} />
            </label>
            <label>
              Height in mm
              <input type="number" min="5" max="600" value={form.boardHeightMm} onChange={(event) => setField('boardHeightMm', Number(event.target.value))} />
            </label>
            <label>
              Mounting hole count
              <input type="number" min="0" max="24" value={form.mountingHoleCount} onChange={(event) => setField('mountingHoleCount', Number(event.target.value))} />
            </label>
            <label>
              Mounting hole diameter
              <input type="number" min="0.5" max="12" step="0.1" value={mountingHoleDiameterMm} onChange={(event) => setMountingHoleDiameterMm(Number(event.target.value))} />
            </label>
            <label>
              Corner radius
              <input type="number" min="0" max="40" step="0.5" value={cornerRadiusMm} onChange={(event) => setCornerRadiusMm(Number(event.target.value))} />
            </label>
            <label className="toggle-row">
              <input type="checkbox" checked={roundedCorners} onChange={(event) => {
                setRoundedCorners(event.target.checked)
                if (event.target.checked) {
                  setField('boardShape', 'rounded rectangle')
                  setCustomSketch(roundedRectanglePoints((cornerRadiusMm / Math.max(form.boardWidthMm, form.boardHeightMm)) * 100))
                }
              }} />
              Rounded corners
            </label>
            <label className="upload-field">
              Reference image name for shape intent
              <span><Upload size={16} /> {form.referenceImageName || 'No image selected'}</span>
              <input type="file" accept="image/*" onChange={(event) => setField('referenceImageName', event.target.files?.[0]?.name || '')} />
            </label>
            <label className="full-span">
              Outline notes
              <textarea value={form.outlineNotes || ''} onChange={(event) => setField('outlineNotes', event.target.value)} />
            </label>
            <label className="full-span">
              Mechanical constraints
              <textarea value={form.mechanicalConstraints || ''} onChange={(event) => setField('mechanicalConstraints', event.target.value)} />
            </label>
          </>
        )}
        {step === 1 && (
          <div className="full-span">
            <CustomShapeStudio
              points={customSketch}
              setPoints={setCustomSketch}
              aiPrompt={aiShapePrompt}
              setAiPrompt={setAiShapePrompt}
              applyAiEdit={applyShapeEdit}
            />
            <div className="outline-actions">
              <button className="primary-action" type="button" onClick={generateOutline}><Sparkles size={16} /> Save outline and continue</button>
              <button className="secondary-action" type="button" onClick={() => saveCurrentBoard('saved')}><FolderKanban size={16} /> Save to Boards</button>
              <button className="secondary-action" type="button" onClick={() => setCustomSketch([])}>Clear outline</button>
            </div>
          </div>
        )}
        {step === 2 && (
          <div className="full-span generation-review outline-handoff">
            <Panel title="Exact outline handoff">
              <div className="prompt-grid">
                <div><strong>Shape</strong><span>{currentBoard.shapeType}</span></div>
                <div><strong>Dimensions</strong><span>{currentBoard.width} mm x {currentBoard.height} mm</span></div>
                <div><strong>Mounting holes</strong><span>{currentBoard.mountingHoles.length}</span></div>
                <div><strong>Outline points</strong><span>{currentBoard.outline.length}</span></div>
                <div><strong>Output</strong><span>empty schematic + Edge.Cuts only</span></div>
                <div><strong>Plugin path</strong><span>create_outline_board</span></div>
              </div>
            </Panel>
            <Panel title="Codex plugin prompt">
              <textarea className="prompt-output" readOnly value={codexPrompt} />
              <div className="outline-actions">
                <button className="primary-action" type="button" onClick={copyPrompt}><Copy size={16} /> {copiedPrompt ? 'Copied exact prompt' : 'Copy prompt for Codex'}</button>
                <button className="secondary-action" type="button" onClick={downloadPrompt}><Download size={16} /> Download prompt</button>
                <a className="secondary-action" href="#/plugin"><Plug size={16} /> Plugin setup</a>
              </div>
            </Panel>
            <Panel title="Outline-only KiCad package">
              <p>Download a browser-created KiCad package containing a project file, empty schematic, README, and PCB file with only Edge.Cuts plus mounting holes.</p>
              <div className="outline-actions">
                <button className="primary-action" type="submit"><Download size={16} /> Download KiCad outline ZIP</button>
                <button className="secondary-action" type="button" onClick={() => {
                  saveCurrentBoard('saved')
                  window.location.hash = '#/boards'
                }}><FolderKanban size={16} /> Save and view Boards</button>
              </div>
            </Panel>
          </div>
        )}
        <div className="wizard-actions full-span">
          <button className="secondary-action" type="button" disabled={step === 0} onClick={() => setStep((value) => Math.max(0, value - 1))}>Back</button>
          {step < wizardSteps.length - 1 && <button className="primary-action" type="button" onClick={() => {
            if (step === 1) generateOutline()
            else setStep((value) => Math.min(wizardSteps.length - 1, value + 1))
          }}>Continue</button>}
        </div>
      </form>
    </main>
  )
}

// Legacy web PCB generator is intentionally no longer routed; full PCB work moved to the Codex plugin.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function GeneratorPage() {
  const createJob = useJobs((state) => state.createJob)
  const saveBoard = useBoards((state) => state.saveBoard)
  const [form, setForm] = useState<GenerationRequest>(emptyRequest)
  const [created, setCreated] = useState<GenerationJob | null>(null)
  const [step, setStep] = useState(0)
  const [markKind, setMarkKind] = useState<GenerationRequest['placementMarks'][number]['kind']>('connector')
  const [customSketch, setCustomSketch] = useState<Array<{ x: number; y: number }>>([])
  const [aiShapePrompt, setAiShapePrompt] = useState('')
  const [outlineMode, setOutlineMode] = useState(true)
  const [roundedCorners, setRoundedCorners] = useState(false)
  const [cornerRadiusMm, setCornerRadiusMm] = useState(3)
  const [mountingHoleDiameterMm, setMountingHoleDiameterMm] = useState(3)
  const [savedBoard, setSavedBoard] = useState<Board | null>(null)
  const [generationMode, setGenerationMode] = useState<(typeof generationModes)[number]>('Board Outline Only')

  const setField = <K extends keyof GenerationRequest>(key: K, value: GenerationRequest[K]) => setForm((current) => ({ ...current, [key]: value }))

  const applyTemplate = (index: number) => {
    const template = templates[index]
    const isBlankCustom = template.name === 'Blank custom board'
    setForm((current) => ({
      ...(isBlankCustom ? emptyRequest : current),
      ...template.defaults,
      projectName: template.name,
      boardType: template.boardType,
      targetCad: 'KiCad',
      manufacturer: 'JLCPCB',
      assemblyTarget: isBlankCustom ? 'PCB assembly' : current.assemblyTarget,
      componentSource: isBlankCustom ? 'JLCPCB/LCSC' : current.componentSource,
      priority: isBlankCustom ? 'balanced' : current.priority,
      notes: template.defaults.notes || `${template.summary} Generate a validation-assisted KiCad starting point with clear human review warnings.`,
    }))
    if (isBlankCustom) {
      setCustomSketch([])
      setStep(1)
    }
  }

  const addPlacementMark = (x: number, y: number) => {
    const noteByKind: Record<GenerationRequest['placementMarks'][number]['kind'], string> = {
      MCU: 'Preferred MCU location',
      connector: 'Connector should sit on or near this edge',
      power: 'Power section preference',
      sensor: 'Sensor placement preference',
      'mounting hole': 'Mounting hole location',
      keepout: 'Keep components/routes out of this region',
      antenna: 'Antenna keepout or RF region',
      'hot zone': 'Thermal/noisy power area',
    }
    setField('placementMarks', [...form.placementMarks, { id: `mark_${Date.now()}`, x, y, kind: markKind, note: noteByKind[markKind] }])
  }

  const removePlacementMark = (id: string) => setField('placementMarks', form.placementMarks.filter((mark) => mark.id !== id))

  const buildOutlinePoints = () => {
    if (customSketch.length >= 3) return customSketch
    if (roundedCorners || form.boardShape === 'rounded rectangle') return roundedRectanglePoints((cornerRadiusMm / Math.max(form.boardWidthMm, form.boardHeightMm)) * 100)
    return makeShapePoints(form.boardShape)
  }

  const makeBoardFromForm = (status: Board['status'] = 'saved'): Board => {
    const now = new Date().toISOString()
    const board: Board = {
      id: savedBoard?.id || `board_${Date.now()}`,
      name: form.projectName || 'Blank Board Outline',
      type: 'outline_only',
      shapeType: roundedCorners && form.boardShape === 'rectangle' ? 'rounded rectangle' : form.boardShape,
      width: form.boardWidthMm,
      height: form.boardHeightMm,
      units: 'mm',
      cornerRadiusMm: roundedCorners || form.boardShape === 'rounded rectangle' ? cornerRadiusMm : 0,
      outline: buildOutlinePoints(),
      mountingHoles: mountingHolesForRequest(form, mountingHoleDiameterMm),
      generatedFiles: outlineService.getProjectFiles({
        id: savedBoard?.id || `board_${Date.now()}`,
        name: form.projectName || 'Blank Board Outline',
        type: 'outline_only',
        shapeType: form.boardShape,
        width: form.boardWidthMm,
        height: form.boardHeightMm,
        units: 'mm',
        cornerRadiusMm,
        outline: buildOutlinePoints(),
        mountingHoles: mountingHolesForRequest(form, mountingHoleDiameterMm),
        generatedFiles: [],
        createdAt: now,
        updatedAt: now,
        status,
        sourcePrompt: form.outlineNotes || form.notes,
        editHistory: [],
      }).files,
      createdAt: savedBoard?.createdAt || now,
      updatedAt: now,
      status,
      sourcePrompt: form.outlineNotes || form.notes,
      editHistory: [...(savedBoard?.editHistory || []), `Saved outline: ${new Date(now).toLocaleString()}`],
    }
    return board
  }

  const generateOutline = () => {
    if (customSketch.length < 3) setCustomSketch(buildOutlinePoints())
    const board = saveBoard(makeBoardFromForm('plugin_handoff'))
    setSavedBoard(board)
  }

  const saveCurrentBoard = () => {
    const board = saveBoard(makeBoardFromForm('saved'))
    setSavedBoard(board)
  }

  const applyShapeEdit = (prompt: string) => {
    const lower = prompt.toLowerCase()
    let nextPoints = customSketch.length >= 3 ? customSketch : buildOutlinePoints()
    if (lower.includes('bigger') || lower.includes('larger') || lower.includes('wider')) {
      setField('boardWidthMm', Math.min(600, Math.round(form.boardWidthMm * 1.15)))
      if (!lower.includes('wider')) setField('boardHeightMm', Math.min(600, Math.round(form.boardHeightMm * 1.15)))
    }
    if (lower.includes('round')) {
      setRoundedCorners(true)
      setField('boardShape', 'rounded rectangle')
      nextPoints = roundedRectanglePoints((cornerRadiusMm / Math.max(form.boardWidthMm, form.boardHeightMm)) * 100)
    }
    if (lower.includes('circle')) {
      setRoundedCorners(false)
      setField('boardShape', 'circle')
      nextPoints = makeShapePoints('circle')
    }
    if (lower.includes('hex')) {
      setField('boardShape', 'hexagon')
      nextPoints = makeShapePoints('hexagon')
    }
    if (lower.includes('oct')) {
      setField('boardShape', 'octagon')
      nextPoints = makeShapePoints('octagon')
    }
    if (lower.includes('drone')) {
      setField('boardShape', 'drone frame')
      nextPoints = makeShapePoints('drone frame')
    }
    if (lower.includes('sensor')) {
      setField('boardShape', 'sensor board')
      nextPoints = makeShapePoints('sensor board')
    }
    if (lower.includes('usb')) setField('placementMarks', [...form.placementMarks, { id: `mark_usb_${Date.now()}`, x: 0.12, y: 0.5, kind: 'connector', note: 'AI edit: USB connector on left edge' }])
    if (lower.includes('hole') || lower.includes('m3')) {
      setField('mountingHoleCount', Math.max(form.mountingHoleCount, 4))
      setMountingHoleDiameterMm(lower.includes('m3') ? 3 : mountingHoleDiameterMm)
    }
    setCustomSketch(nextPoints)
    setField('outlineNotes', `${form.outlineNotes || ''}\nAI shape edit: ${prompt}`.trim())
    setAiShapePrompt('')
  }

  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    if (outlineMode && form.boardType === 'custom') {
      const board = saveBoard(makeBoardFromForm('plugin_handoff'))
      setSavedBoard(board)
      window.location.hash = '#/boards'
      return
    }
    const job = createJob(form)
    setCreated(job)
    window.location.hash = '#/dashboard'
  }

  return (
    <main className="page-grid">
      <section className="page-head">
        <StatusBadge tone="green">Step-by-step PCB intake</StatusBadge>
        <h1>AI PCB Generator</h1>
        <p>Capture requirements, board outlines, image references, and placement guidance. The browser prepares specs; BoardForge Codex Plugin executes real KiCad work locally.</p>
      </section>
      <PluginConnectionBanner />
      <section className="mode-grid">
        {generationModes.map((mode) => (
          <button className={generationMode === mode ? 'active' : ''} key={mode} type="button" onClick={() => {
            setGenerationMode(mode)
            setOutlineMode(mode === 'Board Outline Only')
          }}>
            <strong>{mode}</strong>
            <span>{mode === 'Board Outline Only' ? 'Create Edge.Cuts-ready outline data in browser.' : mode === 'Full PCB Project' ? 'Create a structured job for the local plugin.' : mode === 'Improve Existing KiCad Project' ? 'Scan and patch a local KiCad project with plugin approval.' : 'Use the plugin to validate and package local project files.'}</span>
          </button>
        ))}
      </section>
      <nav className="wizard-tabs" aria-label="PCB generation steps">
        {wizardSteps.map((item, index) => (
          <button className={step === index ? 'active' : ''} key={item} type="button" onClick={() => setStep(index)}>
            <span>{index + 1}</span>
            {item}
          </button>
        ))}
      </nav>
      <section className="template-grid">
        {templates.map((template, index) => (
          <button key={template.name} className="template-card" type="button" onClick={() => applyTemplate(index)}>
            <CircuitBoard size={18} />
            <strong>{template.name}</strong>
            <span>{template.summary}</span>
          </button>
        ))}
      </section>
      <section className="component-library-strip">
        <div>
          <StatusBadge tone="cyan">Built-in package library</StatusBadge>
          <h2>Popular components for realistic preview</h2>
          <p>BoardForge should store footprint metadata, package dimensions, source fields, and STEP/WRL links so previews match KiCad’s physical 3D viewer.</p>
        </div>
        <div className="component-pill-grid">
          {footprintPackages.slice(0, 8).map((pkg) => (
            <span key={pkg.id}>
              <strong>{pkg.label}</strong>
              <small>{pkg.source} / {pkg.heightMm} mm</small>
            </span>
          ))}
        </div>
      </section>
      <form className="generator-form" onSubmit={onSubmit}>
        {step === 0 && (
          <>
            <label>
              Project name
              <input value={form.projectName} onChange={(event) => setField('projectName', event.target.value)} />
            </label>
            <label>
              Board type
              <select value={form.boardType} onChange={(event) => setField('boardType', event.target.value as GenerationRequest['boardType'])}>
                <option>drone flight controller</option>
                <option>IoT sensor</option>
                <option>PoE device</option>
                <option>robotics controller</option>
                <option>motor controller</option>
                <option>custom</option>
              </select>
            </label>
            <label>
              Layer count
              <select value={form.layerCount} onChange={(event) => setField('layerCount', event.target.value as GenerationRequest['layerCount'])}>
                <option>2</option>
                <option>4</option>
                <option>6</option>
                <option>8</option>
              </select>
            </label>
            <label>
              Assembly target
              <select value={form.assemblyTarget} onChange={(event) => setField('assemblyTarget', event.target.value as GenerationRequest['assemblyTarget'])}>
                <option>PCB only</option>
                <option>PCB assembly</option>
                <option>hand assembly</option>
              </select>
            </label>
            <label>
              Preferred component source
              <select value={form.componentSource} onChange={(event) => setField('componentSource', event.target.value as GenerationRequest['componentSource'])}>
                <option>JLCPCB/LCSC</option>
                <option>Digi-Key</option>
                <option>Mouser</option>
                <option>custom library</option>
              </select>
            </label>
            {[
              ['mcu', 'Required MCU / processor'],
              ['sensors', 'Required sensors'],
              ['connectors', 'Required connectors'],
              ['powerInput', 'Power input'],
              ['outputRails', 'Output rails'],
              ['highSpeedConstraints', 'High-speed constraints'],
            ].map(([key, label]) => (
              <label key={key}>
                {label}
                <input value={(form[key as keyof GenerationRequest] as string) || ''} onChange={(event) => setField(key as keyof GenerationRequest, event.target.value as never)} />
              </label>
            ))}
            <fieldset className="interface-field">
              <legend>Communication interfaces</legend>
              {interfaces.map((item) => (
                <label key={item} className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={form.interfaces.includes(item)}
                    onChange={(event) => setField('interfaces', event.target.checked ? [...form.interfaces, item] : form.interfaces.filter((value) => value !== item))}
                  />
                  {item}
                </label>
              ))}
            </fieldset>
            <label>
              Cost priority vs performance priority
              <select value={form.priority} onChange={(event) => setField('priority', event.target.value as GenerationRequest['priority'])}>
                <option value="cost">Cost</option>
                <option value="balanced">Balanced</option>
                <option value="performance">Performance</option>
              </select>
            </label>
            <label className="full-span">
              Notes / natural language project description
              <textarea value={form.notes} onChange={(event) => setField('notes', event.target.value)} />
            </label>
          </>
        )}
        {step === 1 && (
          <>
            <div className="outline-mode-card full-span">
              <div>
                <StatusBadge tone="cyan">AI Board Outline Only</StatusBadge>
              <h2>Blank Board Outline</h2>
              <p>Create a mechanical PCB outline first. Save it in Boards, export an outline ZIP, or send it to BoardForge Plugin to create real local Edge.Cuts in KiCad.</p>
              </div>
              <label className="toggle-row">
                <input type="checkbox" checked={outlineMode} onChange={(event) => setOutlineMode(event.target.checked)} />
                Outline-only KiCad project
              </label>
            </div>
            <label>
              Board shape
              <select value={form.boardShape} onChange={(event) => setField('boardShape', event.target.value as GenerationRequest['boardShape'])}>
                {boardShapeTypes.map((shape) => <option key={shape}>{shape}</option>)}
              </select>
            </label>
            <label>
              Width in mm
              <input type="number" min="5" max="600" value={form.boardWidthMm} onChange={(event) => setField('boardWidthMm', Number(event.target.value))} />
            </label>
            <label>
              Height in mm
              <input type="number" min="5" max="600" value={form.boardHeightMm} onChange={(event) => setField('boardHeightMm', Number(event.target.value))} />
            </label>
            <label>
              Mounting hole count
              <input type="number" min="0" max="24" value={form.mountingHoleCount} onChange={(event) => setField('mountingHoleCount', Number(event.target.value))} />
            </label>
            <label>
              Mounting hole diameter
              <input type="number" min="0.5" max="12" step="0.1" value={mountingHoleDiameterMm} onChange={(event) => setMountingHoleDiameterMm(Number(event.target.value))} />
            </label>
            <label>
              Corner radius
              <input type="number" min="0" max="40" step="0.5" value={cornerRadiusMm} onChange={(event) => setCornerRadiusMm(Number(event.target.value))} />
            </label>
            <label className="toggle-row">
              <input type="checkbox" checked={roundedCorners} onChange={(event) => {
                setRoundedCorners(event.target.checked)
                if (event.target.checked) {
                  setField('boardShape', 'rounded rectangle')
                  setCustomSketch(roundedRectanglePoints((cornerRadiusMm / Math.max(form.boardWidthMm, form.boardHeightMm)) * 100))
                }
              }} />
              Rounded corners
            </label>
            <label>
              Board size constraints
              <input value={form.boardSize} onChange={(event) => setField('boardSize', event.target.value)} />
            </label>
            <label className="upload-field">
              Reference image for AI shape tracing
              <span><Upload size={16} /> {form.referenceImageName || 'No image selected'}</span>
              <input type="file" accept="image/*" onChange={(event) => setField('referenceImageName', event.target.files?.[0]?.name || '')} />
            </label>
            <label className="full-span">
              Outline notes
              <textarea value={form.outlineNotes || ''} onChange={(event) => setField('outlineNotes', event.target.value)} />
            </label>
            <label className="full-span">
              Mechanical constraints
              <textarea value={form.mechanicalConstraints || ''} onChange={(event) => setField('mechanicalConstraints', event.target.value)} />
            </label>
            {form.boardType === 'custom' && (
              <div className="full-span">
                <CustomShapeStudio
                  points={customSketch}
                  setPoints={setCustomSketch}
                  aiPrompt={aiShapePrompt}
                  setAiPrompt={setAiShapePrompt}
                  applyAiEdit={applyShapeEdit}
                />
                <div className="outline-actions">
                  <button className="primary-action" type="button" onClick={generateOutline}><Sparkles size={16} /> Generate Outline</button>
                  <button className="secondary-action" type="button" onClick={saveCurrentBoard}><FolderKanban size={16} /> Save Board</button>
                  <button className="secondary-action" type="button" onClick={() => {
                    const board = saveBoard(makeBoardFromForm('plugin_handoff'))
                    setSavedBoard(board)
                    downloadBoardBundle(board)
                  }}><Download size={16} /> Download KiCad ZIP</button>
                  <a className="secondary-action" href="#/plugin"><Server size={16} /> Send to Plugin</a>
                  {savedBoard && <a className="secondary-action" href="#/boards">Open in Boards</a>}
                </div>
              </div>
            )}
          </>
        )}
        {step === 2 && (
          <div className="full-span shape-planner-wrap">
            <ShapePlanner request={form} markKind={markKind} setMarkKind={setMarkKind} addMark={addPlacementMark} removeMark={removePlacementMark} />
            <label>
              Keepout zones
              <textarea value={form.keepouts || ''} onChange={(event) => setField('keepouts', event.target.value)} />
            </label>
          </div>
        )}
        {step === 3 && (
          <div className="full-span generation-review">
            <div className="review-viewer">
              <RealisticPcbViewer request={form} />
            </div>
            <Panel title="Generation intake summary">
              <div className="prompt-grid">
                <div><strong>Use case</strong><span>{form.boardType}</span></div>
                <div><strong>Shape</strong><span>{form.boardShape}</span></div>
                <div><strong>Dimensions</strong><span>{form.boardWidthMm} mm x {form.boardHeightMm} mm</span></div>
                <div><strong>Mounting holes</strong><span>{form.mountingHoleCount}</span></div>
                <div><strong>Placement marks</strong><span>{form.placementMarks.length}</span></div>
                <div><strong>Reference image</strong><span>{form.referenceImageName || 'none'}</span></div>
              </div>
            </Panel>
            <Panel title="How the AI should use this">
              <p>
                BoardForge treats the outline, holes, uploaded image name, and placement marks as mechanical constraints. The AI proposes structured intent;
                deterministic KiCad builders convert that into board outline geometry, footprint regions, keepouts, and reviewable placement rules.
              </p>
            </Panel>
          </div>
        )}
        <div className="wizard-actions full-span">
          <button className="secondary-action" type="button" disabled={step === 0} onClick={() => setStep((value) => Math.max(0, value - 1))}>Back</button>
          {step < wizardSteps.length - 1 && <button className="primary-action" type="button" onClick={() => setStep((value) => Math.min(wizardSteps.length - 1, value + 1))}>Continue</button>}
          {step === wizardSteps.length - 1 && (
            <button className="primary-action" type="submit">
              <Sparkles size={18} /> {outlineMode && form.boardType === 'custom' ? 'Save outline board' : 'Create generation job'}
            </button>
          )}
        </div>
      </form>
      {created && <p className="inline-note">Created {created.id}. Opening dashboard.</p>}
    </main>
  )
}

function ShapePlanner({
  request,
  markKind,
  setMarkKind,
  addMark,
  removeMark,
}: {
  request: GenerationRequest
  markKind: GenerationRequest['placementMarks'][number]['kind']
  setMarkKind: (kind: GenerationRequest['placementMarks'][number]['kind']) => void
  addMark: (x: number, y: number) => void
  removeMark: (id: string) => void
}) {
  const onCanvasClick = (event: MouseEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    addMark((event.clientX - rect.left) / rect.width, (event.clientY - rect.top) / rect.height)
  }

  return (
    <Panel title="Board shape and placement planner">
      <div className="planner-layout">
        <div>
          <div className="planner-toolbar">
            <label>
              Mark type
              <select value={markKind} onChange={(event) => setMarkKind(event.target.value as GenerationRequest['placementMarks'][number]['kind'])}>
                {markKinds.map((kind) => <option key={kind}>{kind}</option>)}
              </select>
            </label>
            <p>Click the board to tell the AI where something should go. These become normalized placement constraints, not decorative notes.</p>
          </div>
          <div className="board-canvas" onClick={onCanvasClick} role="button" tabIndex={0}>
            <div className={`drawn-board ${request.boardShape.replace(/\s/g, '-')}`}>
              <span className="dimension width">{request.boardWidthMm} mm</span>
              <span className="dimension height">{request.boardHeightMm} mm</span>
              {Array.from({ length: request.mountingHoleCount }).map((_, index) => {
                const positions = [
                  [0.1, 0.12],
                  [0.9, 0.12],
                  [0.1, 0.88],
                  [0.9, 0.88],
                  [0.5, 0.12],
                  [0.5, 0.88],
                  [0.1, 0.5],
                  [0.9, 0.5],
                ]
                const [x, y] = positions[index % positions.length]
                return <span className="mount-hole" key={index} style={{ left: `${x * 100}%`, top: `${y * 100}%` }} />
              })}
              {request.placementMarks.map((mark) => (
                <button
                  className={`placement-mark ${mark.kind.replace(/\s/g, '-')}`}
                  key={mark.id}
                  type="button"
                  style={{ left: `${mark.x * 100}%`, top: `${mark.y * 100}%` }}
                  onClick={(event) => {
                    event.stopPropagation()
                    removeMark(mark.id)
                  }}
                  title={`${mark.kind}: ${mark.note}`}
                >
                  {mark.kind.slice(0, 2).toUpperCase()}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="mark-list">
          <h3>Captured AI constraints</h3>
          {request.placementMarks.length === 0 && <p>No placement marks yet.</p>}
          {request.placementMarks.map((mark) => (
            <button key={mark.id} type="button" onClick={() => removeMark(mark.id)}>
              <strong>{mark.kind}</strong>
              <span>{Math.round(mark.x * 100)}%, {Math.round(mark.y * 100)}%</span>
              <small>{mark.note}</small>
            </button>
          ))}
        </div>
      </div>
    </Panel>
  )
}

function CustomShapeStudio({
  points,
  setPoints,
  aiPrompt,
  setAiPrompt,
  applyAiEdit,
}: {
  points: Array<{ x: number; y: number }>
  setPoints: Dispatch<SetStateAction<Array<{ x: number; y: number }>>>
  aiPrompt: string
  setAiPrompt: (value: string) => void
  applyAiEdit: (prompt: string) => void
}) {
  const [shapeMode, setShapeMode] = useState<'point' | 'draw' | 'edit' | 'pan' | 'delete'>('point')
  const [isDrawing, setIsDrawing] = useState(false)
  const [shapeModalOpen, setShapeModalOpen] = useState(false)
  const [selectedPoint, setSelectedPoint] = useState<number | null>(null)
  const [hoveredPoint, setHoveredPoint] = useState<number | null>(null)
  const [draggingPoint, setDraggingPoint] = useState<number | null>(null)
  const [snapToGrid, setSnapToGrid] = useState(true)
  const [viewBox, setViewBox] = useState({ x: 0, y: 0, width: 100, height: 100 })
  const [cursorPoint, setCursorPoint] = useState<{ x: number; y: number } | null>(null)
  const [isPanning, setIsPanning] = useState(false)
  const [spaceDown, setSpaceDown] = useState(false)
  const svgRef = useRef<SVGSVGElement | null>(null)
  const panStartRef = useRef<{ clientX: number; clientY: number; viewBox: typeof viewBox } | null>(null)
  const dragMovedRef = useRef(false)

  const svgPoints = points.map((point) => `${point.x * 100},${point.y * 100}`).join(' ')
  const pointCountLabel = points.length === 0 ? 'Empty outline' : `${points.length} outline point${points.length === 1 ? '' : 's'}`
  const bounds = useMemo(() => {
    if (points.length === 0) return null
    const xs = points.map((point) => point.x * 100)
    const ys = points.map((point) => point.y * 100)
    return {
      minX: Math.min(...xs),
      maxX: Math.max(...xs),
      minY: Math.min(...ys),
      maxY: Math.max(...ys),
      width: Math.max(...xs) - Math.min(...xs),
      height: Math.max(...ys) - Math.min(...ys),
    }
  }, [points])

  const segmentLength = selectedPoint !== null && points.length > 1
    ? Math.hypot(
      (points[selectedPoint].x - points[(selectedPoint + points.length - 1) % points.length].x) * 100,
      (points[selectedPoint].y - points[(selectedPoint + points.length - 1) % points.length].y) * 100,
    )
    : null

  const snapPoint = (point: { x: number; y: number }) => {
    if (!snapToGrid) return point
    const grid = 1
    return {
      x: Math.round(point.x / grid) * grid,
      y: Math.round(point.y / grid) * grid,
    }
  }

  const pointFromEvent = (event: MouseEvent<SVGSVGElement> | PointerEvent<SVGSVGElement> | WheelEvent<SVGSVGElement>) => {
    const svg = svgRef.current
    if (!svg) return { x: 0, y: 0 }
    const rect = svg.getBoundingClientRect()
    const x = viewBox.x + ((event.clientX - rect.left) / rect.width) * viewBox.width
    const y = viewBox.y + ((event.clientY - rect.top) / rect.height) * viewBox.height
    return snapPoint({ x, y })
  }

  const setPointAt = (index: number, point: { x: number; y: number }) => {
    setPoints((currentPoints) => currentPoints.map((current, pointIndex) => (pointIndex === index ? { x: point.x / 100, y: point.y / 100 } : current)))
  }

  const addBoardPoint = (point: { x: number; y: number }) => {
    setSelectedPoint(points.length)
    setPoints((currentPoints) => [...currentPoints, { x: point.x / 100, y: point.y / 100 }])
  }

  const handleCanvasClick = (event: MouseEvent<SVGSVGElement>) => {
    event.preventDefault()
    event.stopPropagation()
    if (isPanning || draggingPoint !== null) return
    if (dragMovedRef.current && shapeMode !== 'point') return
    const point = pointFromEvent(event)
    if (shapeMode === 'point') addBoardPoint(point)
    if (shapeMode === 'edit') setSelectedPoint(null)
  }

  const startCanvasPointer = (event: PointerEvent<SVGSVGElement>) => {
    event.preventDefault()
    event.stopPropagation()
    dragMovedRef.current = false
    const shouldPan = shapeMode === 'pan' || spaceDown || event.button === 1
    if (shouldPan) {
      setIsPanning(true)
      panStartRef.current = { clientX: event.clientX, clientY: event.clientY, viewBox }
      return
    }
    if (shapeMode !== 'draw') return
    const point = pointFromEvent(event)
    setIsDrawing(true)
    const lastPoint = points[points.length - 1]
    const isContinuingFromEndpoint = lastPoint && Math.hypot(point.x / 100 - lastPoint.x, point.y / 100 - lastPoint.y) < 0.012
    if (!isContinuingFromEndpoint) addBoardPoint(point)
  }

  const moveCanvasPointer = (event: PointerEvent<SVGSVGElement>) => {
    event.preventDefault()
    event.stopPropagation()
    const point = pointFromEvent(event)
    setCursorPoint(point)
    if (isPanning && panStartRef.current) {
      const svg = svgRef.current
      if (!svg) return
      const rect = svg.getBoundingClientRect()
      const dx = ((event.clientX - panStartRef.current.clientX) / rect.width) * panStartRef.current.viewBox.width
      const dy = ((event.clientY - panStartRef.current.clientY) / rect.height) * panStartRef.current.viewBox.height
      setViewBox({ ...panStartRef.current.viewBox, x: panStartRef.current.viewBox.x - dx, y: panStartRef.current.viewBox.y - dy })
      dragMovedRef.current = true
      return
    }
    if (draggingPoint !== null) {
      setPointAt(draggingPoint, point)
      dragMovedRef.current = true
      return
    }
    if (shapeMode !== 'draw' || !isDrawing) return
    setPoints((currentPoints) => {
      const lastPoint = currentPoints[currentPoints.length - 1]
      const normalizedPoint = { x: point.x / 100, y: point.y / 100 }
      const hasMovedEnough = !lastPoint || Math.hypot(normalizedPoint.x - lastPoint.x, normalizedPoint.y - lastPoint.y) > 0.012
      if (hasMovedEnough) dragMovedRef.current = true
      return hasMovedEnough ? [...currentPoints, normalizedPoint] : currentPoints
    })
  }

  const stopCanvasPointer = (event: PointerEvent<SVGSVGElement>) => {
    event.preventDefault()
    event.stopPropagation()
    setIsDrawing(false)
    setIsPanning(false)
    setDraggingPoint(null)
    panStartRef.current = null
  }

  const handlePointPointerDown = (event: PointerEvent<SVGCircleElement>, index: number) => {
    if (shapeMode === 'point' || shapeMode === 'draw' || shapeMode === 'pan') return
    event.preventDefault()
    event.stopPropagation()
    setSelectedPoint(index)
    if (shapeMode === 'delete') {
      setPoints((currentPoints) => currentPoints.filter((_, pointIndex) => pointIndex !== index))
      setSelectedPoint(null)
      return
    }
    if (shapeMode === 'edit') setDraggingPoint(index)
  }

  const handleWheel = (event: WheelEvent<SVGSVGElement>) => {
    event.preventDefault()
    event.stopPropagation()
    const cursor = pointFromEvent(event)
    const zoomFactor = event.deltaY > 0 ? 1.12 : 0.88
    const nextWidth = Math.min(240, Math.max(12, viewBox.width * zoomFactor))
    const nextHeight = Math.min(240, Math.max(12, viewBox.height * zoomFactor))
    const cursorRatioX = (cursor.x - viewBox.x) / viewBox.width
    const cursorRatioY = (cursor.y - viewBox.y) / viewBox.height
    setViewBox({
      x: cursor.x - cursorRatioX * nextWidth,
      y: cursor.y - cursorRatioY * nextHeight,
      width: nextWidth,
      height: nextHeight,
    })
  }

  const fitToBoard = () => {
    if (!bounds) {
      setViewBox({ x: 0, y: 0, width: 100, height: 100 })
      return
    }
    const pad = Math.max(8, Math.max(bounds.width, bounds.height) * 0.18)
    setViewBox({
      x: bounds.minX - pad,
      y: bounds.minY - pad,
      width: Math.max(20, bounds.width + pad * 2),
      height: Math.max(20, bounds.height + pad * 2),
    })
  }

  const resetView = () => setViewBox({ x: 0, y: 0, width: 100, height: 100 })

  const resetOutline = () => {
    setPoints([])
    setSelectedPoint(null)
    setHoveredPoint(null)
    resetView()
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === ' ') {
      event.preventDefault()
      setSpaceDown(true)
    }
    if ((event.key === 'Backspace' || event.key === 'Delete') && selectedPoint !== null) {
      event.preventDefault()
      setPoints((currentPoints) => currentPoints.filter((_, pointIndex) => pointIndex !== selectedPoint))
      setSelectedPoint(null)
    }
  }

  const handleKeyUp = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === ' ') setSpaceDown(false)
  }

  const renderShapeSvg = (interactive: boolean) => (
    <svg
      ref={interactive ? svgRef : undefined}
      className="sketch-svg"
      viewBox={interactive ? `${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}` : '0 0 100 100'}
      preserveAspectRatio="none"
      aria-label="Custom board outline preview"
      onClick={interactive ? handleCanvasClick : undefined}
      onPointerDown={interactive ? startCanvasPointer : undefined}
      onPointerMove={interactive ? moveCanvasPointer : undefined}
      onPointerUp={interactive ? stopCanvasPointer : undefined}
      onPointerCancel={interactive ? stopCanvasPointer : undefined}
      onPointerLeave={interactive ? stopCanvasPointer : undefined}
      onWheel={interactive ? handleWheel : undefined}
    >
      {interactive && <rect className="sketch-hit-surface" x={viewBox.x} y={viewBox.y} width={viewBox.width} height={viewBox.height} />}
      {points.length > 1 && <polyline className="sketch-path-open" points={svgPoints} />}
      {points.length > 2 && <polygon className="sketch-polygon-live" points={svgPoints} />}
      {points.length === 1 && <line className="sketch-path-open" x1={points[0].x * 100} y1={points[0].y * 100} x2={points[0].x * 100} y2={points[0].y * 100} />}
      {interactive && cursorPoint && points.length > 0 && (shapeMode === 'point' || shapeMode === 'draw') && (
        <line className="sketch-preview-line" x1={points[points.length - 1].x * 100} y1={points[points.length - 1].y * 100} x2={cursorPoint.x} y2={cursorPoint.y} />
      )}
      {points.map((point, index) => (
        <circle
          key={`${point.x}-${point.y}-${index}`}
          className={`sketch-point${index === selectedPoint ? ' selected' : ''}${index === hoveredPoint ? ' hover' : ''}`}
          cx={point.x * 100}
          cy={point.y * 100}
          r={interactive ? Math.max(0.65, viewBox.width * 0.006) : 0.9}
          onPointerDown={interactive ? (event) => handlePointPointerDown(event, index) : undefined}
          onPointerEnter={interactive ? () => setHoveredPoint(index) : undefined}
          onPointerLeave={interactive ? () => setHoveredPoint(null) : undefined}
        />
      ))}
    </svg>
  )

  const shapePreview = renderShapeSvg(false)

  return (
    <Panel title="Custom board shape studio">
      <div className="custom-studio">
        <div className="shape-workbench">
          <div className="shape-preview-card">
            {shapePreview}
            <div className="shape-preview-footer">
              <span>{pointCountLabel}</span>
              <button className="primary-action" type="button" onClick={() => setShapeModalOpen(true)}>Open drawing studio</button>
            </div>
          </div>
        </div>
        <div className="ai-shape-chat">
          <h3>AI shape assistant</h3>
          <p>Use plain language to refine the outline before generation.</p>
          <div className="chat-suggestions">
            {['make it bigger', 'round the corners', 'add USB on the left edge', 'make it circular'].map((suggestion) => (
              <button key={suggestion} type="button" onClick={() => applyAiEdit(suggestion)}>{suggestion}</button>
            ))}
          </div>
          <textarea value={aiPrompt} onChange={(event) => setAiPrompt(event.target.value)} placeholder="Make it wider, move USB left, add a notch near the antenna..." />
          <button className="primary-action" type="button" onClick={() => aiPrompt.trim() && applyAiEdit(aiPrompt.trim())}>
            <Sparkles size={16} /> Apply AI edit
          </button>
          <button className="secondary-action" type="button" onClick={resetOutline}>Clear sketch</button>
        </div>
      </div>
      {shapeModalOpen && createPortal(
        <div className="shape-modal" role="dialog" aria-modal="true" aria-label="Custom board drawing studio" onClick={(event) => event.stopPropagation()}>
          <div className="shape-modal-panel" onClick={(event) => event.stopPropagation()}>
            <div className="shape-modal-head">
              <div>
                <h3>Draw custom board outline</h3>
                <p>{shapeMode === 'draw' ? 'Drag to append to the existing outline. Release anytime and continue later.' : 'Place, select, move, or delete outline points with CAD-style controls.'}</p>
              </div>
              <button className="icon-action" type="button" aria-label="Close drawing studio" onClick={() => setShapeModalOpen(false)}>
                <X size={18} />
              </button>
            </div>
            <div className="shape-modebar cad-modebar" aria-label="Shape input mode">
              <button className={shapeMode === 'point' ? 'active' : ''} type="button" onClick={() => setShapeMode('point')}>Click points</button>
              <button className={shapeMode === 'draw' ? 'active' : ''} type="button" onClick={() => setShapeMode('draw')}>Draw outline</button>
              <button className={shapeMode === 'edit' ? 'active' : ''} type="button" onClick={() => setShapeMode('edit')}>Edit points</button>
              <button className={shapeMode === 'pan' ? 'active' : ''} type="button" onClick={() => setShapeMode('pan')}>Pan</button>
              <button className={shapeMode === 'delete' ? 'active danger' : ''} type="button" onClick={() => setShapeMode('delete')}>Delete</button>
              <button className={snapToGrid ? 'active' : ''} type="button" onClick={() => setSnapToGrid((value) => !value)}>Snap grid</button>
              <span>{pointCountLabel}</span>
            </div>
            <div className="shape-viewbar" aria-label="Drawing view controls">
              <button type="button" onClick={fitToBoard}>Fit to screen</button>
              <button type="button" onClick={fitToBoard}>Zoom to board</button>
              <button type="button" onClick={resetView}>Reset view</button>
              <span>{cursorPoint ? `X ${cursorPoint.x.toFixed(1)} / Y ${cursorPoint.y.toFixed(1)}` : 'X -- / Y --'}</span>
              {bounds && <span>{`BBox ${bounds.width.toFixed(1)} x ${bounds.height.toFixed(1)}`}</span>}
              {segmentLength !== null && <span>{`Prev segment ${segmentLength.toFixed(1)}`}</span>}
            </div>
            <div
              className={`manual-sketch modal-canvas ${shapeMode}${spaceDown ? ' space-pan' : ''}`}
              role="application"
              tabIndex={0}
              onKeyDown={handleKeyDown}
              onKeyUp={handleKeyUp}
            >
              {renderShapeSvg(true)}
              <div className="sketch-hint">
                {shapeMode === 'draw'
                  ? 'Drag to add to the existing outline. Mouse wheel zooms at the cursor. Space + drag or middle mouse pans.'
                  : shapeMode === 'edit'
                    ? 'Select a point, then drag it. Selected points turn blue. Delete/Backspace removes the selected point.'
                    : shapeMode === 'delete'
                      ? 'Click a point to remove it. Reset outline clears all geometry.'
                      : shapeMode === 'pan'
                        ? 'Drag to pan the canvas. Mouse wheel zooms at the cursor.'
                        : 'Click exact vertices around the board. Existing points can be edited in Edit points mode.'}
              </div>
            </div>
            <div className="shape-modal-actions">
              <button className="secondary-action" type="button" onClick={() => setPoints(points.slice(0, -1))} disabled={points.length === 0}>Undo point</button>
              <button className="secondary-action" type="button" onClick={resetOutline}>Reset outline</button>
              <button className="primary-action" type="button" onClick={() => setShapeModalOpen(false)}>Use this outline</button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </Panel>
  )
}

function DashboardPage() {
  const job = useJobs((state) => state.getActiveJob())
  const pluginStatus = usePluginRuntimeStatus()
  const boardCount = useBoards((state) => state.boards.length)
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'auto' })
  }, [job.id])

  return (
    <main className="dashboard">
      <section className="dashboard-hero">
        <div>
          <StatusBadge tone={pluginStatus.connected ? 'green' : 'amber'}>{pluginStatus.connected ? 'Plugin connected' : 'Plugin not connected'}</StatusBadge>
          <h1>{job.request.projectName}</h1>
          <p>Track saved specs, board outlines, plugin jobs, validation reports, and exports. Local KiCad execution stays behind the BoardForge Codex Plugin and helper.</p>
          <div className="dashboard-setup-list">
            {[
              ['Local helper', pluginStatus.connected ? 'online' : 'not connected'],
              ['KiCad CLI', pluginStatus.cliAvailable ? 'available' : 'waiting for local probe'],
              ['Workspace', pluginStatus.workspace],
            ].map(([label, value]) => (
              <div key={label}><span>{label}</span><strong>{value}</strong></div>
            ))}
          </div>
        </div>
        <div className="dashboard-scene dashboard-live-viewer">
          <RealisticPcbViewer request={job.request} interactive={false} autoRotate />
        </div>
      </section>
      <section className="metric-grid">
        <Metric icon={<Layers3 />} label="Progress" value={`${job.progress}%`} />
        <Metric icon={<Database />} label="Saved outlines" value={String(boardCount)} />
        <Metric icon={<Factory />} label="Manufacturing readiness" value="Review required" />
        <Metric icon={<ShieldAlert />} label="Warnings / errors" value={`${job.warningsCount} / ${job.errorsCount}`} />
      </section>
      <section className="two-column">
        <Panel title="Animated agent timeline">
          <div className="timeline">
            {job.agentSteps.map((step) => (
              <div className={`timeline-row ${step.status}`} key={step.id}>
                <span />
                <div>
                  <strong>{step.name}</strong>
                  <small>{step.agent}</small>
                  {step.warning && <p>{step.warning}</p>}
                </div>
              </div>
            ))}
          </div>
        </Panel>
        <Panel title="PCB layer visualization">
          <div className="layer-stack">
            {['F.Cu signal + components', 'In1.Cu ground reference', 'In2.Cu power planes', 'B.Cu low-speed signals'].map((layer, index) => (
              <div key={layer} style={{ '--i': index } as React.CSSProperties}>
                <CircuitBoard size={18} />
                <span>{layer}</span>
              </div>
            ))}
          </div>
          <div className="net-card-grid">
            {job.nets.map((net) => (
              <div className="net-card" key={net.id}>
                <strong>{net.name}</strong>
                <span>{net.className}</span>
              </div>
            ))}
          </div>
        </Panel>
      </section>
      <WarningBanner />
    </main>
  )
}

function ProjectPage() {
  const job = useJobs((state) => state.getActiveJob())
  const boardFootprints = useMemo(() => resolvePlacedFootprints(demoPlacedFootprints), [])
  const boardRoutes = demoBoardRoutes
  const boardVias = demoBoardVias
  return (
    <main className="page-grid">
      <section className="page-head">
        <StatusBadge tone="amber">{job.architecture.riskLevel}</StatusBadge>
        <h1>Generated project detail</h1>
        <p>Structured board architecture, agent outputs, validation status, downloads, and regeneration controls.</p>
      </section>
      <section className="two-column">
        <Panel title="Project summary">
          <dl className="spec-list">
            <dt>Board type</dt>
            <dd>{job.request.boardType}</dd>
            <dt>Layer count</dt>
            <dd>{job.request.layerCount}</dd>
            <dt>Board size</dt>
            <dd>{job.request.boardSize}</dd>
            <dt>Outline</dt>
            <dd>{job.request.boardShape}</dd>
            <dt>Dimensions</dt>
            <dd>{job.request.boardWidthMm} mm x {job.request.boardHeightMm} mm</dd>
            <dt>Mounting holes</dt>
            <dd>{job.request.mountingHoleCount}</dd>
            <dt>Target CAD</dt>
            <dd>KiCad</dd>
            <dt>Manufacturer</dt>
            <dd>JLCPCB</dd>
          </dl>
        </Panel>
        <Panel title="Power tree and interfaces">
          <div className="chip-list">
            {job.architecture.powerTree.map((item) => (
              <span key={item}>{item}</span>
            ))}
          </div>
          <div className="chip-list">
            {job.architecture.interfaces.map((item) => (
              <span key={item}>{item}</span>
            ))}
          </div>
        </Panel>
      </section>
      <section className="project-cad-stage">
        <div>
          <StatusBadge tone="cyan">KiCad-style 3D review</StatusBadge>
          <h2>Physical board preview</h2>
          <p>Rendered from board constraints, placement marks, and built-in package geometry. Later this viewer should load exact KiCad footprint positions and STEP models.</p>
        </div>
        <RealisticPcbViewer request={job.request} footprints={boardFootprints} routes={boardRoutes} vias={boardVias} />
      </section>
      <Panel title="Mechanical and placement intent">
        <div className="planner-layout compact">
          <FootprintIntentMap footprints={boardFootprints} routes={boardRoutes} vias={boardVias} />
          <div className="mark-list">
            <h3>AI placement constraints</h3>
            {job.request.placementMarks.map((mark) => (
              <div key={mark.id}>
                <strong>{mark.kind}</strong>
                <span>{Math.round(mark.x * 100)}%, {Math.round(mark.y * 100)}%</span>
                <small>{mark.note}</small>
              </div>
            ))}
          </div>
        </div>
      </Panel>
      <Panel title="Main components">
        <div className="table">
          {boardFootprints.map((placed) => {
            const pkg = packageById(placed.packageId)
            const component = job.components.find((item) => item.reference === placed.ref)
            return (
            <div className="table-row" key={placed.id}>
              <strong>{placed.ref}</strong>
              <span>{component?.name || pkg.label}</span>
              <span>{component?.manufacturerPartNumber || pkg.label}</span>
              <span>{component?.footprint || `${pkg.source}:${pkg.id}`}</span>
              <StatusBadge tone={component?.lifecycleFlag === 'active' ? 'green' : 'amber'}>{component?.lifecycleFlag || 'preview'}</StatusBadge>
            </div>
            )
          })}
        </div>
      </Panel>
      <section className="action-row">
        <button className="secondary-action"><RefreshCw size={16} /> Regenerate placement</button>
        <button className="secondary-action"><GitBranch size={16} /> Regenerate routing</button>
        <a className="primary-action" href="#/export"><Download size={16} /> Export fab package</a>
        <button className="secondary-action"><Copy size={16} /> Clone project</button>
      </section>
    </main>
  )
}

function FootprintIntentMap({
  footprints,
  routes,
  vias,
}: {
  footprints: PlacedFootprint[]
  routes: BoardRoute[]
  vias: BoardVia[]
}) {
  return (
    <div className="footprint-map">
      <svg viewBox="0 0 100 100" role="img" aria-label="PCB footprint placement map">
        <rect x="4" y="8" width="92" height="76" rx="4" />
        {routes.map((route) => (
          <polyline
            key={route.id}
            className={route.width === 'power' ? 'power-route' : ''}
            points={route.points.map(([x, y]) => `${x * 100},${y * 100}`).join(' ')}
          />
        ))}
        {vias.map((via) => (
          <circle key={via.id} className="via" cx={via.x * 100} cy={via.y * 100} r="0.9" />
        ))}
        {footprints.map((placed) => {
          const pkg = packageById(placed.packageId)
          const [bodyX, bodyY] = pkg.body
          const width = bodyX * 9.8
          const height = bodyY * 9.8
          return (
            <g key={placed.id} transform={`translate(${placed.x * 100} ${placed.y * 100}) rotate(${placed.rotation})`}>
              <rect x={-width / 2} y={-height / 2} width={width} height={height} rx="1" className={`fp ${placed.packageId}`} />
              <text y="1.5">{placed.ref}</text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}

function BoardPreview({ board }: { board: Board }) {
  const points = board.outline.length >= 3 ? board.outline : makeShapePoints(board.shapeType)
  return (
    <div className="board-preview">
      <svg viewBox="0 0 100 100" role="img" aria-label={`${board.name} outline preview`} preserveAspectRatio="xMidYMid meet">
        <polygon points={points.map((point) => `${point.x * 100},${point.y * 100}`).join(' ')} />
        {board.mountingHoles.map((hole) => (
          <circle key={hole.id} cx={hole.x * 100} cy={hole.y * 100} r="2.2" />
        ))}
      </svg>
    </div>
  )
}

function BoardsPage() {
  const pluginStatus = usePluginRuntimeStatus()
  const boards = useBoards((state) => state.boards)
  const activeBoard = useBoards((state) => state.getActiveBoard())
  const setActiveBoard = useBoards((state) => state.setActiveBoard)
  const deleteBoard = useBoards((state) => state.deleteBoard)
  const duplicateBoard = useBoards((state) => state.duplicateBoard)
  const saveBoard = useBoards((state) => state.saveBoard)
  const jobs = useJobs((state) => state.jobs)
  const setActiveJob = useJobs((state) => state.setActiveJob)
  const [filter, setFilter] = useState<'all' | 'outline' | 'full' | 'recent' | 'plugin'>('all')
  const [recentCutoff] = useState(() => Date.now() - 1000 * 60 * 60 * 24 * 14)

  const filteredBoards = boards.filter((board) => {
    if (filter === 'outline') return board.type === 'outline_only'
    if (filter === 'plugin') return board.status === 'plugin_handoff' || board.status === 'outline_generated'
    if (filter === 'recent') return new Date(board.createdAt).getTime() >= recentCutoff
    return filter === 'all'
  })
  const showJobs = filter === 'all' || filter === 'full' || filter === 'recent'

  return (
    <main className="page-grid">
      <section className="page-head">
        <StatusBadge tone="green">Board library</StatusBadge>
        <h1>Boards</h1>
        <p>Saved board outlines, finished PCB projects, imported boards, and plugin-ready jobs live here. Outline-only boards can become local KiCad Edge.Cuts jobs through BoardForge Plugin.</p>
      </section>
      <div className="filter-row" role="toolbar" aria-label="Board filters">
        {[
          ['all', 'All'],
          ['outline', 'Outline Only'],
          ['full', 'Full Projects'],
          ['recent', 'Recently Created'],
          ['plugin', 'Plugin Handoff'],
        ].map(([key, label]) => (
          <button className={filter === key ? 'active' : ''} key={key} type="button" onClick={() => setFilter(key as typeof filter)}>{label}</button>
        ))}
      </div>
      <section className="boards-layout">
        <div className="board-card-grid">
          {filteredBoards.map((board) => (
            <article className="board-card" key={board.id}>
              <BoardPreview board={board} />
              <div>
                <StatusBadge tone={board.type === 'outline_only' ? 'cyan' : 'green'}>{board.type === 'outline_only' ? 'outline only' : 'full project'}</StatusBadge>
                <h2>{board.name}</h2>
                <p>{board.width} {board.units} x {board.height} {board.units} · {board.shapeType}</p>
                <small>{new Date(board.createdAt).toLocaleString()} · Plugin {pluginStatus.connected ? 'ready' : 'not connected'} · {board.status.replaceAll('_', ' ')}</small>
              </div>
              <div className="board-card-actions">
                <button type="button" onClick={() => setActiveBoard(board.id)}>Open</button>
                <a href="#/generate" onClick={() => setActiveBoard(board.id)}>Edit Outline</a>
                <a href="#/plugin" onClick={() => setActiveBoard(board.id)}>Send to Plugin</a>
                <button type="button" onClick={() => downloadBoardBundle(board)}>Download Spec ZIP</button>
                <button type="button" onClick={() => duplicateBoard(board.id)}>Duplicate</button>
                <button type="button" onClick={() => deleteBoard(board.id)}>Delete</button>
              </div>
            </article>
          ))}
          {showJobs && jobs.map((job) => (
            <article className="board-card" key={job.id}>
              <BoardPreview board={{
                id: job.id,
                name: job.request.projectName,
                type: 'full_project',
                shapeType: job.request.boardShape,
                width: job.request.boardWidthMm,
                height: job.request.boardHeightMm,
                units: 'mm',
                cornerRadiusMm: 0,
                outline: makeShapePoints(job.request.boardShape),
                mountingHoles: mountingHolesForRequest(job.request),
                generatedFiles: job.exportPackage.files.map((file) => file.path),
                createdAt: job.createdAt,
                updatedAt: job.completedAt || job.createdAt,
                status: 'plugin_handoff',
                sourcePrompt: job.request.notes,
                projectId: job.projectId,
                editHistory: [],
              }} />
              <div>
                <StatusBadge tone="green">full project</StatusBadge>
                <h2>{job.request.projectName}</h2>
                <p>{job.request.boardWidthMm} mm x {job.request.boardHeightMm} mm · {job.request.boardShape}</p>
                <small>{job.status.replaceAll('_', ' ')}</small>
              </div>
              <div className="board-card-actions">
                <a href="#/project" onClick={() => setActiveJob(job.id)}>Open</a>
                <a href="#/generate">Edit Outline</a>
                <a href="#/plugin" onClick={() => setActiveJob(job.id)}>Send to Plugin</a>
                <a href="#/export" onClick={() => setActiveJob(job.id)}>Prepare Plugin Export</a>
                <a href="#/export" onClick={() => setActiveJob(job.id)}>View Export Status</a>
                <button type="button">Duplicate</button>
                <button type="button">Delete</button>
              </div>
            </article>
          ))}
          {filteredBoards.length === 0 && !showJobs && <p className="inline-note">No boards match this filter yet.</p>}
        </div>
        <Panel title="Board detail">
          {activeBoard ? (
            <div className="board-detail">
              <BoardPreview board={activeBoard} />
              <dl className="spec-list">
                <dt>Name</dt><dd>{activeBoard.name}</dd>
                <dt>Type</dt><dd>{activeBoard.type.replaceAll('_', ' ')}</dd>
                <dt>Shape</dt><dd>{activeBoard.shapeType}</dd>
                <dt>Dimensions</dt><dd>{activeBoard.width} {activeBoard.units} x {activeBoard.height} {activeBoard.units}</dd>
                <dt>Outline points</dt><dd>{activeBoard.outline.length}</dd>
                <dt>Mounting holes</dt><dd>{activeBoard.mountingHoles.length}</dd>
                <dt>Source prompt</dt><dd>{activeBoard.sourcePrompt || 'none'}</dd>
              </dl>
              <div className="outline-actions">
                <button className="secondary-action" type="button" onClick={() => {
                  const updated = { ...activeBoard, shapeType: 'rounded rectangle' as const, cornerRadiusMm: Math.max(3, activeBoard.cornerRadiusMm), outline: roundedRectanglePoints(), editHistory: [...activeBoard.editHistory, 'Rounded corners from Boards detail'] }
                  saveBoard(updated)
                }}>Add Rounded Corners</button>
                <button className="primary-action" type="button" onClick={() => downloadBoardBundle(activeBoard)}>Download KiCad ZIP</button>
                <a className="secondary-action" href="#/generate">Convert to PCB Project</a>
              </div>
              <pre className="file-tree">{outlineService.getProjectFiles(activeBoard).files.join('\n')}</pre>
            </div>
          ) : (
            <p>No saved outline selected yet. Create one from the Blank Board generator.</p>
          )}
        </Panel>
      </section>
    </main>
  )
}

function PluginPage() {
  const pluginStatus = usePluginRuntimeStatus()
  const statusItems = [
    ['Installed', pluginStatus.installed ? 'Installed' : 'Not installed'],
    ['Connected', pluginStatus.connected ? 'Connected' : 'Not connected'],
    ['KiCad detected', pluginStatus.kicadDetected ? 'Detected' : 'Not detected'],
    ['KiCad version', pluginStatus.kicadVersion],
    ['kicad-cli', pluginStatus.cliAvailable ? 'Available' : 'Missing'],
    ['Workspace', pluginStatus.workspace],
    ['Last sync', pluginStatus.lastSync],
    ['Last job', pluginStatus.lastJob],
  ]
  const pluginCapabilities = [
    'Create KiCad projects',
    'Generate Edge.Cuts board outlines',
    'Assign footprints',
    'Link 3D models',
    'Audit symbol/footprint/3D coverage',
    'Run project preflight gates',
    'Generate reusable design constraints',
    'Generate manufacturing handoff manifests',
    'Plan requirements into circuits/BOM/nets',
    'Place components',
    'Apply placement into KiCad PCB',
    'Assist critical routing',
    'Run ERC/DRC',
    'Snapshot and diff KiCad projects',
    'Build guided workflow presets',
    'Export Gerbers',
    'Export drill files',
    'Export BOM',
    'Export CPL / pick-and-place',
    'Package JLCPCB exports',
  ]
  return (
    <main className="page-grid">
      <section className="plugin-hero">
        <div>
          <StatusBadge tone="cyan">Codex execution engine</StatusBadge>
          <h1>BoardForge Codex Plugin</h1>
          <p>
            Local KiCad automation for AI-assisted PCB projects. Install the BoardForge Codex Plugin to let Codex safely create, edit, validate, and export KiCad projects through BoardForge-controlled tools on your own machine.
          </p>
          <div className="action-row">
            <button className="primary-action" type="button"><Plug size={16} /> Plugin beta coming soon</button>
            <a className="secondary-action" href="#/docs"><FileCheck2 size={16} /> View install guide</a>
            <button className="secondary-action" type="button"><Server size={16} /> Connect local helper</button>
          </div>
        </div>
        <Panel title="Correct execution path">
          <pre className="terminal">User in Codex{'\n'}-&gt; BoardForge Codex Plugin{'\n'}-&gt; BoardForge local MCP/tool server or CLI helper{'\n'}-&gt; Whitelisted KiCad automation tools{'\n'}-&gt; Real local KiCad project files{'\n'}-&gt; DRC/ERC/export reports{'\n'}-&gt; Gerbers, BOM, CPL, KiCad ZIP, JLCPCB package</pre>
        </Panel>
      </section>
      <PluginConnectionBanner />
      <section className="install-grid">
        {[
          ['1', 'Install plugin', 'Add BoardForge to Codex so Codex sees safe PCB commands instead of editing files directly.', Plug],
          ['2', 'Start local helper', 'Run the BoardForge local helper beside KiCad. It owns file writes, snapshots, and kicad-cli calls.', Server],
          ['3', 'Approve workspace', 'Pick the local KiCad project folder. BoardForge refuses work outside the approved workspace.', HardDrive],
          ['4', 'Run gated jobs', 'Create outlines, scan libraries, generate files, run ERC/DRC, then export only after checks pass.', ShieldCheck],
        ].map(([number, title, body, Icon]) => {
          const SafeIcon = Icon as typeof Plug
          return (
            <article key={title as string}>
              <span>{number as string}</span>
              <SafeIcon size={20} />
              <strong>{title as string}</strong>
              <p>{body as string}</p>
            </article>
          )
        })}
      </section>
      <section className="two-column">
        <Panel title="Why local?">
          <div className="icon-list">
            {[
              ['KiCad files live on your machine', HardDrive],
              ['Footprints, symbols, and 3D models are local', CircuitBoard],
              ['DRC/ERC should run through real KiCad tools', ShieldCheck],
              ['Manufacturing exports use whitelisted commands', TerminalSquare],
              ['Codex sends structured jobs, not raw shell commands', Workflow],
            ].map(([label, Icon]) => {
              const SafeIcon = Icon as typeof HardDrive
              return <span key={label as string}><SafeIcon size={17} /> {label as string}</span>
            })}
          </div>
        </Panel>
        <Panel title="Plugin status">
          <div className="status-grid">
            {statusItems.map(([label, value]) => (
              <div key={label}>
                <span>{label}</span>
                <strong>{value}</strong>
              </div>
            ))}
          </div>
        </Panel>
      </section>
      <Panel title="What the plugin does">
        <div className="capability-grid">
          {pluginCapabilities.map((item) => <span key={item}><CheckCircle2 size={16} /> {item}</span>)}
        </div>
      </Panel>
      <section className="two-column">
        <Panel title="Codex tool commands">
          <div className="command-grid">
            {pluginCommands.map((command) => <code key={command}>{command}</code>)}
          </div>
        </Panel>
        <Panel title="Local security model">
          <div className="icon-list">
            {['No arbitrary shell execution', 'Whitelisted KiCad commands only', 'Workspace path sanitization', 'Dry-run before destructive edits', 'Snapshots before overwrite', 'Snapshot diffs before restore/export', 'Schema validation for every AI output', 'Full action logs and reports'].map((item) => (
              <span key={item}><ShieldCheck size={17} /> {item}</span>
            ))}
          </div>
        </Panel>
      </section>
      <Panel title="Supported outputs">
        <div className="package-contents">
          {['.kicad_pro', '.kicad_sch', '.kicad_pcb', 'Gerber ZIP', 'drill files', 'BOM CSV', 'CPL CSV', 'STEP/3D exports', 'ERC report', 'DRC report', 'README/manufacturing notes'].map((item) => (
            <span key={item}><PackageCheck size={16} /> {item}</span>
          ))}
        </div>
      </Panel>
      <Panel title="MVP phases">
        <div className="doc-steps">
          {['Codex Plugin + CLI', 'Local MCP tool server', 'KiCad CLI validation/export', 'localhost bridge', 'optional native KiCad plugin'].map((step, index) => (
            <div key={step}><span>{index + 1}</span>{step}</div>
          ))}
        </div>
      </Panel>
    </main>
  )
}

function ExportPage() {
  const pluginStatus = usePluginRuntimeStatus()
  const job = useJobs((state) => state.getActiveJob())
  const jobs = useJobs((state) => state.jobs)
  const setActiveJob = useJobs((state) => state.setActiveJob)
  const exportService = useMemo(() => new KiCadExportService(), [])
  const packageService = useMemo(() => new ProjectPackageService(), [])
  return (
    <main className="page-grid">
      <section className="export-hero">
        <div className="export-summary">
          <StatusBadge tone="amber">Export handoff</StatusBadge>
          <label>
            Current Project
            <select value={job.id} onChange={(event) => setActiveJob(event.target.value)}>
              {jobs.map((item) => <option key={item.id} value={item.id}>{item.request.projectName}</option>)}
            </select>
          </label>
          <h1>{job.request.projectName}</h1>
          <p>The web app can export specs, JSON plans, board outline data, and summaries. Manufacturing files require BoardForge Plugin connected to local KiCad.</p>
          <div className="export-meta-grid">
            <div><span>Board type</span><strong>{job.request.boardType}</strong></div>
            <div><span>Layers</span><strong>{job.request.layerCount}</strong></div>
            <div><span>Main MCU</span><strong>{job.request.mcu || 'TBD'}</strong></div>
            <div><span>Interfaces</span><strong>{job.request.interfaces.slice(0, 4).join(', ')}</strong></div>
            <div><span>Estimated cost</span><strong>${job.costEstimate.toFixed(2)}</strong></div>
            <div><span>Readiness</span><strong>Review required</strong></div>
            <div><span>Generated</span><strong>{new Date(job.createdAt).toLocaleDateString()}</strong></div>
            <div><span>Export state</span><strong>{pluginStatus.connected ? job.status : 'blocked_missing_plugin'}</strong></div>
          </div>
        </div>
        <RealisticPcbViewer request={job.request} />
      </section>
      <WarningBanner />
      <PluginConnectionBanner />
      <section className="download-dock">
        {['Download Spec JSON', 'Download Board Outline ZIP', 'Download Project Summary'].map((label) => (
          <button className="primary-action" key={label} type="button">
            <Download size={16} /> {label}
          </button>
        ))}
      </section>
      <section className="two-column">
        <Panel title="Plugin-generated manufacturing files">
          <p>Not generated in-browser. Install and connect BoardForge Plugin to create these from real local KiCad projects.</p>
          <div className="package-contents muted-outputs">
            {['KiCad project', 'Gerber ZIP', 'drill files', 'BOM CSV', 'CPL CSV', 'ERC report', 'DRC report', 'JLCPCB package'].map((item) => (
              <span key={item}><PackageCheck size={16} /> {item} unavailable</span>
            ))}
          </div>
        </Panel>
        <Panel title="Export workflow">
          <div className="export-flow">
            {['Web plan', 'Send to plugin', 'KiCad validate', 'Package'].map((stage, index) => (
              <div className={index < 2 ? 'complete' : index === 2 ? 'blocked' : ''} key={stage}>
                <span>{index + 1}</span>
                <strong>{stage}</strong>
                <small>{index > 1 ? 'Blocked until plugin connects' : 'Staged'}</small>
              </div>
            ))}
          </div>
        </Panel>
        <Panel title="Web-generated files">
          <div className="package-contents">
            {['Project spec JSON', 'Board outline data', 'Placement intent', 'Architecture summary', 'Human-review notes', 'Plugin job payload'].map((item) => (
              <span key={item}><CheckCircle2 size={16} /> {item}</span>
            ))}
          </div>
        </Panel>
      </section>
      <section className="two-column">
        <Panel title="JLCPCB export preflight checklist">
          <div className="check-grid">
            {job.exportPackage.checklist.map((item) => (
              <div className={`check-item ${item.status}`} key={item.label}>
                <CheckCircle2 size={18} />
                <span>{item.label}</span>
              </div>
            ))}
          </div>
        </Panel>
        <Panel title="Expected local package layout">
          <p>This is the expected plugin output layout, not proof those files exist yet.</p>
          <pre className="file-tree">{packageService.getPackageLayout(job.request.projectName).join('\n')}</pre>
        </Panel>
      </section>
      <Panel title="Whitelisted KiCad commands">
        <pre className="terminal">{exportService.getPlannedCommands(job).map((command) => `${command.command} ${command.args.join(' ')}`).join('\n')}</pre>
      </Panel>
    </main>
  )
}

function LogsPage() {
  const job = useJobs((state) => state.getActiveJob())
  return (
    <main className="page-grid">
      <section className="page-head">
        <StatusBadge tone="cyan">Agent run log</StatusBadge>
        <h1>Generation logs</h1>
        <p>Terminal-style output is limited to controlled service events and whitelisted command plans.</p>
      </section>
      <pre className="terminal large">{job.logs.join('\n')}</pre>
      <Panel title="Prompt modules">
        <div className="prompt-grid">
          {Object.entries(promptModules).map(([key, value]) => (
            <div key={key}>
              <strong>{key}</strong>
              <span>{value}</span>
            </div>
          ))}
        </div>
      </Panel>
    </main>
  )
}

function PricingPage() {
  const plans = [
    ['Free / Maker', '$0 beta', 'board outline studio, saved outline library, exact Codex plugin prompts, outline-only KiCad ZIP downloads'],
    ['Pro', '$49-$99/mo planned', 'plugin onboarding, project dashboards, run history, reports, saved specs, KiCad validation summaries, export handoff tracking'],
    ['Engineer', '$149-$249/mo planned', 'advanced plugin workflows, component library audits, manufacturability gates, release reports, larger project history'],
    ['Team / Lab', '$399+/mo planned', 'shared board libraries, team review, private templates, audit logs, local helper policy controls, priority support'],
    ['Enterprise', 'custom', 'private deployment, on-prem controls, approved vendor rules, security review, team permissions, custom integration'],
  ]
  return (
    <main className="page-grid">
      <section className="page-head">
        <StatusBadge tone="green">Pricing</StatusBadge>
        <h1>Plans for hardware teams</h1>
        <p>Plans combine the BoardForge AI web command center with BoardForge Plugin workflows. Manufacturing export still requires human review and local KiCad validation.</p>
      </section>
      <section className="pricing-grid pricing-grid-five">
        {plans.map(([name, price, details]) => (
          <article className="price-card" key={name}>
            <h2>{name}</h2>
            <strong>{price}</strong>
            <p>{details}</p>
          </article>
        ))}
      </section>
      <Panel title="Cost model">
        <p>The web product charges for accounts, storage, reports, and hosted AI features. Plugin execution runs locally through the user's Codex and KiCad setup; any model/API cost depends on the user's Codex/OpenRouter/OpenAI configuration, not hidden browser-side generation.</p>
      </Panel>
    </main>
  )
}

function DocsPage() {
  const faq = [
    ['Is this safe for production?', 'No design should be manufactured or used in safety-critical contexts without qualified human review.'],
    ['Why does BoardForge need a local plugin?', 'KiCad files, libraries, footprints, 3D models, kicad-cli, ERC/DRC, and manufacturing exports live locally. The plugin gives Codex safe local access.'],
    ['Can the web app generate PCBs without the plugin?', 'It can create specs, board outlines, JSON plans, previews, and outline ZIPs. Full local KiCad execution requires BoardForge Plugin.'],
    ['Does the plugin control KiCad?', 'The plugin calls BoardForge-controlled local tools and whitelisted KiCad CLI commands. It does not give AI arbitrary shell access.'],
    ['Is it safe?', 'The model is AI proposes, validators check, plugin executes, KiCad validates, human reviews. Paths and commands are constrained.'],
    ['Can it run arbitrary commands?', 'No. MVP commands are schema-validated and limited to BoardForge/KiCad operations.'],
    ['Does it support KiCad libraries?', 'That is the reason for the plugin: it can scan and use local symbols, footprints, and 3D model paths.'],
    ['Can it create Edge.Cuts outlines?', 'Yes. Outline-only boards are a first-class workflow and can become local plugin jobs.'],
    ['Can it generate Gerbers?', 'Yes, through the local plugin and kicad-cli when KiCad is installed and detected.'],
    ['Can it generate BOM/CPL files?', 'Yes, through the plugin export flow for projects with valid schematic/footprint data.'],
    ['Does it upload directly to JLCPCB?', 'Not in the MVP. BoardForge packages JLCPCB-ready files; direct upload should stay human-approved.'],
    ['Does it guarantee manufacturable designs?', 'No. It is manufacturing-assisted and review-required.'],
    ['Can it improve existing KiCad projects?', 'That is an MVP mode: scan an approved local workspace, summarize problems, and apply controlled plugin edits.'],
    ['What data stays local?', 'KiCad project files, libraries, footprints, 3D models, and local export artifacts stay on the user machine unless explicitly synced.'],
  ]
  return (
    <main className="page-grid">
      <section className="page-head">
        <StatusBadge tone="cyan">Codex plugin workflow docs</StatusBadge>
        <h1>BoardForge AI + BoardForge Plugin</h1>
      </section>
      <section className="doc-steps">
        {['Describe hardware in web app', 'Create structured JSON plan', 'Send job to Codex plugin', 'Plugin opens local workspace', 'Helper writes KiCad files', 'Run ERC/DRC', 'Export package', 'Human review', 'Upload to manufacturer'].map((step, index) => (
          <div key={step}><span>{index + 1}</span>{step}</div>
        ))}
      </section>
      <PluginConnectionBanner />
      <section className="two-column">
        <Panel title="Local setup checklist">
          <div className="icon-list">
            {[
              'Install KiCad and confirm kicad-cli is available',
              'Install the BoardForge Codex Plugin when beta is released',
              'Start the BoardForge local helper on localhost',
              'Approve one KiCad workspace folder',
              'Run /status and /kicad/status before project edits',
              'Snapshot projects before applying generated changes',
            ].map((item) => <span key={item}><CheckCircle2 size={17} /> {item}</span>)}
          </div>
        </Panel>
        <Panel title="Example Codex prompts">
          <div className="prompt-examples">
            <code>Use BoardForge to create an outline-only KiCad project from this exact Edge.Cuts JSON.</code>
            <code>Use BoardForge to scan this KiCad project, find missing footprints and 3D models, then summarize fixes.</code>
            <code>Use BoardForge to run ERC and DRC. Do not export Gerbers until both reports are reviewed.</code>
            <code>Use BoardForge to package this KiCad project for JLCPCB with BOM, CPL, drill, Gerbers, reports, and README.</code>
          </div>
        </Panel>
      </section>
      <Panel title="FAQ">
        <div className="faq-list">
          {faq.map(([question, answer]) => (
            <details key={question} open={question === 'Is this safe for production?'}>
              <summary>{question}</summary>
              <p>{answer}</p>
            </details>
          ))}
        </div>
      </Panel>
    </main>
  )
}

function AdminPage() {
  const pluginStatus = usePluginRuntimeStatus()
  const jobs = useJobs((state) => state.jobs)
  const boards = useBoards((state) => state.boards)
  const runtime = new KiCadValidationService().checkRuntime()
  const projectService = new KiCadProjectService()
  return (
    <main className="page-grid">
      <section className="page-head">
        <StatusBadge tone={runtime.available ? 'green' : 'red'}>KiCad CLI {runtime.available ? 'available' : 'not connected'}</StatusBadge>
        <h1>Admin monitor</h1>
        <p>Admin tracks web projects, board outlines, plugin jobs, connected plugin versions, validation errors, export attempts, AI model costs, and user activity. Empty states are shown until the local plugin bridge is connected.</p>
      </section>
      <section className="metric-grid">
        <Metric icon={<TerminalSquare />} label="Generation jobs" value={String(jobs.length)} />
        <Metric icon={<FolderKanban />} label="Saved board outlines" value={String(boards.length)} />
        <Metric icon={<Plug />} label="Plugin jobs" value="0" />
        <Metric icon={<ShieldAlert />} label="Validation errors" value={String(jobs.reduce((sum, job) => sum + job.errorsCount, 0))} />
        <Metric icon={<Database />} label="Plugin bridge" value={pluginStatus.connected ? 'connected' : 'not connected'} />
        <Metric icon={<FileArchive />} label="Export attempts" value="0 plugin exports" />
      </section>
      <Panel title="Recent generations">
        <div className="table">
          {jobs.map((job) => (
            <div className="table-row" key={job.id}>
              <strong>{job.request.projectName}</strong>
              <span>{job.status}</span>
              <span>${job.costEstimate.toFixed(2)} estimated</span>
              <span>{projectService.createProjectDirectory(job.request).relativeRoot}</span>
            </div>
          ))}
        </div>
      </Panel>
      <Panel title="Rule engine">
        <div className="chip-list">
          {[...boardRuleEngine.global, ...boardRuleEngine['PoE device']].map((rule) => <span key={rule}>{rule}</span>)}
        </div>
      </Panel>
      <Panel title="Plugin monitor">
        <div className="status-grid">
          <div><span>Connected versions</span><strong>0</strong></div>
          <div><span>Average job duration</span><strong>No plugin data</strong></div>
          <div><span>Failed plugin jobs</span><strong>0</strong></div>
          <div><span>Download attempts</span><strong>Not tracked yet</strong></div>
        </div>
      </Panel>
    </main>
  )
}

function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <article className="metric-card">
      {icon}
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  )
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="panel">
      <h2>{title}</h2>
      {children}
    </section>
  )
}

function App() {
  const route = useHashRoute()
  const page = {
    '/': <LandingPage />,
    '/generate': <OutlineGeneratorPage />,
    '/dashboard': <DashboardPage />,
    '/project': <ProjectPage />,
    '/boards': <BoardsPage />,
    '/plugin': <PluginPage />,
    '/export': <ExportPage />,
    '/logs': <LogsPage />,
    '/pricing': <PricingPage />,
    '/docs': <DocsPage />,
    '/admin': <AdminPage />,
  }[route]

  return <Layout route={route}>{page}</Layout>
}

export default App
