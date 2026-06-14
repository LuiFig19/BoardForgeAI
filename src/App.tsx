'use client'

import { useEffect, useMemo, useRef, useState, type Dispatch, type FormEvent, type KeyboardEvent, type MouseEvent, type PointerEvent, type SetStateAction, type WheelEvent } from 'react'
import { createPortal } from 'react-dom'
import { motion, useScroll, useTransform } from 'framer-motion'
import {
  ArrowRight,
  CheckCircle2,
  CircuitBoard,
  Copy,
  Database,
  Download,
  Factory,
  FileArchive,
  GitBranch,
  Layers3,
  Play,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  TerminalSquare,
  Upload,
  X,
} from 'lucide-react'
import { Layout, StatusBadge, WarningBanner } from './components/Layout'
import { PcbScene } from './components/PcbScene'
import { RealisticPcbViewer } from './components/RealisticPcbViewer'
import { emptyRequest, templates } from './data/fixtures'
import { demoBoardRoutes, demoBoardVias, demoPlacedFootprints, footprintPackages, packageById, resolvePlacedFootprints, type BoardRoute, type BoardVia, type PlacedFootprint } from './data/footprints'
import { type GenerationJob, type GenerationRequest } from './data/models'
import { useJobs } from './store/useJobs'
import { boardRuleEngine, promptModules } from './services/agents'
import { KiCadExportService, KiCadProjectService, KiCadValidationService, ProjectPackageService } from './services/kicad'

const interfaces = ['USB', 'Ethernet', 'CAN', 'UART', 'SPI', 'I2C', 'Wi-Fi', 'BLE', 'LoRa']
const routes = ['/', '/generate', '/dashboard', '/project', '/export', '/logs', '/pricing', '/docs', '/admin']
const wizardSteps = ['Requirements', 'Board shape', 'Placement intent', 'Generate']
const markKinds: GenerationRequest['placementMarks'][number]['kind'][] = ['MCU', 'connector', 'power', 'sensor', 'mounting hole', 'keepout', 'antenna', 'hot zone']

function useHashRoute() {
  const getHashRoute = () => (typeof window === 'undefined' ? '/' : window.location.hash.replace('#', '') || '/')
  const [route, setRoute] = useState(getHashRoute)
  useEffect(() => {
    const onHash = () => setRoute(getHashRoute())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
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
      title: 'outline',
      body: 'The mechanical outline is the first constraint, not decoration. BoardForge keeps connector edges, mounting holes, notches, and keepout regions visible before any electronics are placed.',
      details: ['custom shape or uploaded image', 'board size and hole count', 'edge and keepout intent'],
    },
    {
      title: 'layers',
      body: 'The viewer separates the physical stack so the design can be reviewed like a real KiCad board: solder mask, copper, reference planes, and silkscreen intent.',
      details: ['top copper and mask', 'inner ground and power planes', 'bottom copper planning'],
    },
    {
      title: 'placement',
      body: 'Components are placed with manufacturing space around them. Edge connectors stay on edges, MCUs get room for fanout, and passives sit near the pins they support.',
      details: ['MCU and regulator regions', 'USB/RJ45 edge placement', 'passive part clustering'],
    },
    {
      title: 'routing',
      body: 'Critical nets are routed first using sane paths: power width, USB/Ethernet constraints, sensor buses, vias, and short fanout routes around real package bodies.',
      details: ['power before signal', '45/90 degree route intent', 'via and test point planning'],
    },
    {
      title: 'validation',
      body: 'The design is treated as review-required until checks pass. ERC, DRC, spacing, part overlap, board-edge clearance, and assembly flags are tracked before export.',
      details: ['overlap prevention', 'clearance and edge checks', 'human review report'],
    },
    {
      title: 'package',
      body: 'Once reviewed, the project is packaged into the file set a fabricator expects: KiCad project files, Gerbers, drills, BOM, CPL, validation logs, and README.',
      details: ['KiCad source files', 'JLCPCB-ready BOM/CPL', 'manufacturing checklist'],
    },
  ]

  return (
    <main>
      <section className="hero-section">
        <div className="hero-copy">
          <StatusBadge tone="cyan">KiCad-first AI hardware generation</StatusBadge>
          <h1>AI PCB generation for KiCad, from idea to fab files.</h1>
          <p>
            Describe your embedded system, drone controller, sensor board, or robotics PCB. BoardForge AI plans the schematic, places
            components, prepares layout files, validates the design, and packages everything for manufacturing.
          </p>
          <div className="action-row">
            <a className="primary-action" href="#/generate">
              <Play size={18} /> Generate a board
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

function GeneratorPage() {
  const createJob = useJobs((state) => state.createJob)
  const [form, setForm] = useState<GenerationRequest>(emptyRequest)
  const [created, setCreated] = useState<GenerationJob | null>(null)
  const [step, setStep] = useState(0)
  const [markKind, setMarkKind] = useState<GenerationRequest['placementMarks'][number]['kind']>('connector')
  const [customSketch, setCustomSketch] = useState<Array<{ x: number; y: number }>>([])
  const [aiShapePrompt, setAiShapePrompt] = useState('')

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

  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    const job = createJob(form)
    setCreated(job)
    window.location.hash = '#/dashboard'
  }

  return (
    <main className="page-grid">
      <section className="page-head">
        <StatusBadge tone="green">Step-by-step PCB intake</StatusBadge>
        <h1>AI PCB Generator</h1>
        <p>Capture requirements, board outline, holes, image references, and placement guidance before starting the KiCad generation job.</p>
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
            <label>
              Board shape
              <select value={form.boardShape} onChange={(event) => setField('boardShape', event.target.value as GenerationRequest['boardShape'])}>
                <option>rectangle</option>
                <option>rounded rectangle</option>
                <option>circle</option>
                <option>custom drawn</option>
                <option>image traced</option>
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
                  applyAiEdit={(prompt) => {
                    const lower = prompt.toLowerCase()
                    if (lower.includes('bigger') || lower.includes('larger')) {
                      setField('boardWidthMm', Math.min(600, Math.round(form.boardWidthMm * 1.15)))
                      setField('boardHeightMm', Math.min(600, Math.round(form.boardHeightMm * 1.15)))
                    }
                    if (lower.includes('round')) setField('boardShape', 'rounded rectangle')
                    if (lower.includes('circle')) setField('boardShape', 'circle')
                    if (lower.includes('usb')) setField('placementMarks', [...form.placementMarks, { id: `mark_usb_${Date.now()}`, x: 0.12, y: 0.5, kind: 'connector', note: 'AI edit: USB connector on left edge' }])
                    setField('outlineNotes', `${form.outlineNotes || ''}\nAI shape edit: ${prompt}`.trim())
                    setAiShapePrompt('')
                  }}
                />
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
              <Sparkles size={18} /> Create generation job
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
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'auto' })
  }, [job.id])

  return (
    <main className="dashboard">
      <section className="dashboard-hero">
        <div>
          <StatusBadge tone="amber">Human review required</StatusBadge>
          <h1>{job.request.projectName}</h1>
          <p>Describe the hardware. Generate the KiCad project. Review, validate, and send to fab.</p>
        </div>
        <div className="dashboard-scene dashboard-live-viewer">
          <RealisticPcbViewer request={job.request} interactive={false} autoRotate />
        </div>
      </section>
      <section className="metric-grid">
        <Metric icon={<Layers3 />} label="Progress" value={`${job.progress}%`} />
        <Metric icon={<Database />} label="Token estimate" value={job.tokenEstimate.toLocaleString()} />
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

function ExportPage() {
  const job = useJobs((state) => state.getActiveJob())
  const jobs = useJobs((state) => state.jobs)
  const setActiveJob = useJobs((state) => state.setActiveJob)
  const exportService = useMemo(() => new KiCadExportService(), [])
  const packageService = useMemo(() => new ProjectPackageService(), [])
  return (
    <main className="page-grid">
      <section className="export-hero">
        <div className="export-summary">
          <StatusBadge tone="amber">Manufacturing package</StatusBadge>
          <label>
            Current Project
            <select value={job.id} onChange={(event) => setActiveJob(event.target.value)}>
              {jobs.map((item) => <option key={item.id} value={item.id}>{item.request.projectName}</option>)}
            </select>
          </label>
          <h1>{job.request.projectName}</h1>
          <p>This export contains the KiCad project, schematic, PCB, BOM, CPL, Gerbers, drill files, validation reports, and human-review README.</p>
          <div className="export-meta-grid">
            <div><span>Board type</span><strong>{job.request.boardType}</strong></div>
            <div><span>Layers</span><strong>{job.request.layerCount}</strong></div>
            <div><span>Main MCU</span><strong>{job.request.mcu || 'TBD'}</strong></div>
            <div><span>Interfaces</span><strong>{job.request.interfaces.slice(0, 4).join(', ')}</strong></div>
            <div><span>Estimated cost</span><strong>${job.costEstimate.toFixed(2)}</strong></div>
            <div><span>Readiness</span><strong>Review required</strong></div>
            <div><span>Generated</span><strong>{new Date(job.createdAt).toLocaleDateString()}</strong></div>
            <div><span>Package state</span><strong>{job.status}</strong></div>
          </div>
        </div>
        <RealisticPcbViewer request={job.request} />
      </section>
      <WarningBanner />
      <section className="download-dock">
        {['Download Full KiCad Project', 'Download Manufacturing Package', 'Download Gerbers Only', 'Download BOM', 'Download Pick And Place', 'Download Validation Report'].map((label, index) => (
          <button className={index < 2 ? 'primary-action' : 'secondary-action'} key={label} type="button">
            <Download size={16} /> {label}
          </button>
        ))}
      </section>
      <section className="two-column">
        <Panel title="Export workflow">
          <div className="export-flow">
            {['Generate', 'Validate', 'Export', 'Manufacture'].map((stage, index) => (
              <div className={index < 2 ? 'complete' : index === 2 ? 'blocked' : ''} key={stage}>
                <span>{index + 1}</span>
                <strong>{stage}</strong>
                <small>{index === 3 ? 'Human review before order' : index === 2 ? 'Blocked until KiCad CLI runner' : 'Staged'}</small>
              </div>
            ))}
          </div>
        </Panel>
        <Panel title="This project contains">
          <div className="package-contents">
            {['KiCad project', 'Schematic', 'PCB', 'BOM', 'CPL', 'Gerbers', 'Drill files', 'Validation reports'].map((item) => (
              <span key={item}><CheckCircle2 size={16} /> {item}</span>
            ))}
          </div>
        </Panel>
      </section>
      <section className="two-column">
        <Panel title="JLCPCB export checklist">
          <div className="check-grid">
            {job.exportPackage.checklist.map((item) => (
              <div className={`check-item ${item.status}`} key={item.label}>
                <CheckCircle2 size={18} />
                <span>{item.label}</span>
              </div>
            ))}
          </div>
        </Panel>
        <Panel title="Advanced file tree viewer">
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
    ['Starter', '$29/month', 'simple boards, limited generations, KiCad project export, community templates'],
    ['Pro', '$99/month', 'advanced boards, more generations, manufacturing export, validation reports, project history'],
    ['Lab', '$299/month', 'team projects, custom rules, private component libraries, higher generation limits, priority queue'],
    ['Enterprise / Defense', 'custom', 'on-prem option, private models, NDAA supply-chain workflows, audit logs, engineering review integration'],
  ]
  return (
    <main className="page-grid">
      <section className="page-head">
        <StatusBadge tone="green">Pricing</StatusBadge>
        <h1>Plans for hardware teams</h1>
        <p>Internal generation cost estimates are tracked for planning; they are not shown as guaranteed manufacturing cost.</p>
      </section>
      <section className="pricing-grid">
        {plans.map(([name, price, details]) => (
          <article className="price-card" key={name}>
            <h2>{name}</h2>
            <strong>{price}</strong>
            <p>{details}</p>
          </article>
        ))}
      </section>
      <Panel title="Internal pay-per-generation estimates">
        <p>Simple board: estimated $5-$25 AI/internal cost. Complex board: estimated $25-$150 AI/internal cost.</p>
      </Panel>
    </main>
  )
}

function DocsPage() {
  const faq = [
    ['Is this safe for production?', 'No design should be manufactured or used in safety-critical contexts without qualified human review.'],
    ['Does it replace electrical engineers?', 'No. It is engineering acceleration for KiCad starting points, validation assistance, and package preparation.'],
    ['Does it support JLCPCB?', 'The export flow is JLCPCB-focused, including BOM/CPL and checklist structure.'],
    ['Does it support Altium?', 'Coming soon. The current target CAD tool is KiCad.'],
    ['Can it route boards?', 'The MVP stages placement and partial routing strategy, starting with critical nets.'],
    ['Can it use my component library?', 'The architecture includes a ComponentLibraryService; uploaded executable scripts are not allowed.'],
    ['What files do I get?', 'KiCad project files, Gerbers, drill files, BOM, CPL, reports, PDFs when available, and human-review README.'],
  ]
  return (
    <main className="page-grid">
      <section className="page-head">
        <StatusBadge tone="cyan">Workflow docs</StatusBadge>
        <h1>Validation-assisted KiCad generation</h1>
      </section>
      <section className="doc-steps">
        {['Describe hardware', 'Select constraints', 'Generate architecture', 'Review components', 'Generate KiCad files', 'Validate ERC/DRC', 'Export fab package', 'Human review', 'Upload to JLCPCB'].map((step, index) => (
          <div key={step}><span>{index + 1}</span>{step}</div>
        ))}
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
  const jobs = useJobs((state) => state.jobs)
  const runtime = new KiCadValidationService().checkRuntime()
  const projectService = new KiCadProjectService()
  return (
    <main className="page-grid">
      <section className="page-head">
        <StatusBadge tone={runtime.available ? 'green' : 'red'}>KiCad CLI {runtime.available ? 'available' : 'not connected'}</StatusBadge>
        <h1>Admin monitor</h1>
        <p>{runtime.reason}</p>
      </section>
      <section className="metric-grid">
        <Metric icon={<TerminalSquare />} label="Generation jobs" value={String(jobs.length)} />
        <Metric icon={<ShieldAlert />} label="Failed jobs" value={String(jobs.filter((job) => job.status === 'failed').length)} />
        <Metric icon={<Database />} label="Queue status" value={jobs.length ? 'local persisted jobs' : 'empty'} />
        <Metric icon={<FileArchive />} label="Storage usage" value="server storage not connected" />
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
    '/generate': <GeneratorPage />,
    '/dashboard': <DashboardPage />,
    '/project': <ProjectPage />,
    '/export': <ExportPage />,
    '/logs': <LogsPage />,
    '/pricing': <PricingPage />,
    '/docs': <DocsPage />,
    '/admin': <AdminPage />,
  }[route]

  return <Layout route={route}>{page}</Layout>
}

export default App
