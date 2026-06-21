'use client'

import { useState } from 'react'
import {
  ArrowRight,
  CheckCircle2,
  CircuitBoard,
  Clipboard,
  Code2,
  Copy,
  FileArchive,
  FileCheck2,
  FolderKanban,
  Gauge,
  HardDrive,
  PackageCheck,
  Plug,
  Route,
  ShieldAlert,
  ShieldCheck,
  TerminalSquare,
  Workflow,
  X,
} from 'lucide-react'
import { StatusBadge, WarningBanner } from './Layout'

const heroChips = ['KiCad-native', 'Local tool server', 'ERC/DRC checks', 'Gerbers / BOM / CPL', 'JLCPCB package validation', 'Human review required']

const workflowSteps = ['Codex Prompt', 'BoardForge Plugin', 'Structured JSON Job', 'Local KiCad Tool Server', 'ERC/DRC', 'Gerbers/BOM/CPL']

const comparisonColumns = [
  {
    title: 'Raw Codex edits',
    tone: 'danger',
    items: ['edits KiCad files directly', 'can break syntax', 'can miss footprints', 'can create bad Edge.Cuts', 'can place parts off board', 'hard to audit'],
  },
  {
    title: 'BoardForge Plugin',
    tone: 'accent',
    items: ['schema-validated tool calls', 'whitelisted KiCad actions', 'board geometry checks', 'net class logic', 'placement/routing validation', 'repair plans'],
  },
  {
    title: 'Local KiCad source of truth',
    tone: 'safe',
    items: ['real project files', 'real local libraries', 'real footprints/3D models', 'real ERC/DRC', 'real Gerber/BOM/CPL exports', 'human review before fab'],
  },
]

const commandSteps = [
  ['Spec', 'Board type: USB-C sensor board', 'Layers: 4', 'Manufacturer: JLCPCB'],
  ['Board Outline', '50 mm x 25 mm rounded rectangle', 'Mounting: four M3 holes', 'Edge.Cuts: browser outline'],
  ['Plugin Job', 'create_kicad_project', 'write_edge_cuts', 'scan_footprints'],
  ['KiCad Validation', 'ERC: not run / demo', 'DRC: not run / demo', 'Fab rules: pending'],
  ['Export Package', 'Gerbers', 'Drill', 'BOM + CPL + review report'],
]

const previewCards = [
  {
    title: 'ESP32-S3 PoE air sensor',
    status: 'Spec + outline ready',
    cta: 'View example',
    copy: 'RJ45 edge connector, USB-C service port, ESP32 control region, sensor header, and mounting holes.',
    shape: 'wide',
  },
  {
    title: 'USB-C sensor board',
    status: 'Plugin-ready',
    cta: 'Use template',
    copy: 'Compact rounded board with USB-C, MCU, I2C sensor connector, and regulator section.',
    shape: 'compact',
  },
  {
    title: 'Robotics controller',
    status: 'Needs local KiCad validation',
    cta: 'View workflow',
    copy: 'Terminal blocks, power input, CAN/UART headers, MCU region, and motor/sensor connectors.',
    shape: 'robotics',
  },
  {
    title: 'Drone flight controller',
    status: 'Board preset',
    cta: 'Use preset',
    copy: 'Square board with 30.5 mm mounting pattern, USB-C edge, MCU/IMU region, and UART pads.',
    shape: 'square',
  },
]

const executionCards = [
  ['selected workspace only', HardDrive],
  ['whitelisted commands', ShieldCheck],
  ['KiCad CLI detection', TerminalSquare],
  ['library scanning', FolderKanban],
  ['snapshots before risky edits', FileArchive],
  ['audit log', FileCheck2],
] as const

const capabilityGroups = [
  {
    title: 'Create',
    icon: CircuitBoard,
    items: ['Create KiCad projects', 'Generate board outlines', 'Write Edge.Cuts', 'Assign footprints'],
  },
  {
    title: 'Validate',
    icon: ShieldCheck,
    items: ['Check 3D models', 'Validate pin maps', 'Run ERC/DRC', 'Parse reports'],
  },
  {
    title: 'Route / Repair',
    icon: Route,
    items: ['Plan placement', 'Create net classes', 'Route/review copper', 'Plan safe repairs'],
  },
  {
    title: 'Export',
    icon: PackageCheck,
    items: ['Export Gerbers', 'Export drill files', 'Export BOM', 'Export CPL', 'Package JLCPCB files', 'Generate review reports'],
  },
]

const workflowGroups: Array<[string, string[]]> = [
  ['Embedded', ['ESP32 / IoT', 'USB devices', 'sensor boards', 'dev boards']],
  ['Connectivity', ['Ethernet', 'PoE', 'CAN', 'adapter boards']],
  ['Power / Control', ['motor controllers', 'LED controllers', 'battery/charger boards', 'robotics controllers']],
  ['Mechanical / Custom', ['custom-shaped PCBs', 'board outlines', 'test fixtures', 'drone flight controllers']],
]

const safetyCards = [
  ['Structured JSON commands', 'Every plugin job is schema-shaped before execution.', Code2],
  ['Whitelisted KiCad operations', 'Local actions stay limited to BoardForge/KiCad workflows.', ShieldCheck],
  ['Local workspace boundaries', 'The helper works inside approved project folders.', HardDrive],
  ['ERC/DRC parsing', 'KiCad reports become visible validation results.', FileCheck2],
  ['Fab-rule checks', 'Manufacturer profile checks are explicit review gates.', Gauge],
  ['Human review reports', 'BoardForge keeps final signoff with the engineer.', ShieldAlert],
] as const

const setupSteps = ['Install KiCad', 'Install Codex', 'Install BoardForge Plugin', 'Start local tool server', 'Select project folder', 'Run first BoardForge job']

const prompts = [
  ['Generate a board', 'Use BoardForge to create a 65mm x 40mm ESP32-S3 sensor board with USB-C, 3V3 regulator, I2C header, and four M3 mounting holes.'],
  ['Review a project', 'Use BoardForge to scan this KiCad project, find missing footprints, run DRC, and generate a manufacturing review.'],
  ['Route/review copper', 'Use BoardForge to route the critical nets first, create net classes, and report anything that fails DRC.'],
  ['Export for fab', 'Use BoardForge to package this project for JLCPCB with Gerbers, drill files, BOM, and CPL.'],
]

function MiniBoard({ shape }: { shape: string }) {
  const isSquare = shape === 'square'
  const viewBox = isSquare ? '0 0 220 220' : '0 0 300 190'
  return (
    <svg className={`premium-board ${shape}`} viewBox={viewBox} role="img" aria-label={`${shape} PCB preview`}>
      {shape === 'wide' && (
        <>
          <path className="board-body" d="M34 38 Q34 22 50 22 H250 Q268 22 268 40 V150 Q268 168 250 168 H50 Q34 168 34 150 Z" />
          <rect className="metal" x="220" y="70" width="34" height="48" rx="4" />
          <rect className="metal" x="42" y="82" width="38" height="30" rx="4" />
          <rect className="chip" x="124" y="70" width="62" height="44" rx="5" />
          <rect className="part" x="94" y="122" width="42" height="18" rx="3" />
          <polyline points="80,96 124,92 155,92 220,94" />
          <polyline points="155,114 178,136 220,134" />
        </>
      )}
      {shape === 'compact' && (
        <>
          <path className="board-body" d="M42 56 Q42 36 62 36 H232 Q254 36 254 58 V132 Q254 154 232 154 H62 Q42 154 42 132 Z" />
          <rect className="metal" x="50" y="78" width="40" height="34" rx="5" />
          <rect className="chip" x="122" y="72" width="54" height="46" rx="5" />
          <rect className="part" x="196" y="68" width="32" height="22" rx="3" />
          <rect className="part" x="198" y="112" width="28" height="18" rx="3" />
          <polyline points="90,96 122,95 176,95 196,80" />
          <polyline points="176,112 198,121 228,121" />
        </>
      )}
      {shape === 'robotics' && (
        <>
          <path className="board-body" d="M28 34 Q28 22 40 22 H262 Q274 22 274 34 V154 Q274 166 262 166 H40 Q28 166 28 154 Z" />
          <rect className="terminal" x="222" y="42" width="34" height="76" rx="3" />
          <rect className="terminal" x="42" y="124" width="74" height="24" rx="3" />
          <rect className="chip" x="120" y="70" width="58" height="50" rx="5" />
          <rect className="part" x="70" y="50" width="44" height="24" rx="3" />
          <rect className="part" x="188" y="130" width="44" height="18" rx="3" />
          <polyline points="114,62 140,88 222,76" />
          <polyline points="148,120 188,139 232,139" />
        </>
      )}
      {shape === 'square' && (
        <>
          <path className="board-body" d="M44 28 Q44 20 52 20 H168 Q176 20 176 28 V192 Q176 200 168 200 H52 Q44 200 44 192 Z" />
          <rect className="metal" x="84" y="174" width="52" height="18" rx="4" />
          <rect className="chip" x="82" y="88" width="56" height="50" rx="5" />
          <rect className="part" x="92" y="54" width="36" height="26" rx="3" />
          <rect className="part" x="66" y="150" width="88" height="10" rx="3" />
          <polyline points="110,80 110,88 136,112 154,150" />
          <polyline points="84,150 92,128 82,112" />
        </>
      )}
      {(isSquare ? [[62, 38], [158, 38], [62, 182], [158, 182]] : [[54, 46], [246, 46], [54, 144], [246, 144]]).map(([cx, cy]) => (
        <circle className="hole" key={`${cx}-${cy}`} cx={cx} cy={cy} r="7" />
      ))}
    </svg>
  )
}

function LandingHero() {
  return (
    <section className="premium-hero">
      <div className="premium-hero-copy">
        <StatusBadge tone="cyan">CODEX PLUGIN FIRST</StatusBadge>
        <h1>Turn Codex into a KiCad PCB engineer.</h1>
        <p>BoardForge gives Codex safe local tools to create, inspect, route, validate, and export real KiCad PCB projects - without random file edits.</p>
        <div className="action-row">
          <a className="primary-action" href="#/plugin"><Plug size={18} /> Join Plugin Beta</a>
          <a className="secondary-action" href="#/generate"><CircuitBoard size={18} /> Open Board Builder</a>
          <a className="secondary-action" href="#workflow"><Workflow size={18} /> View Workflow</a>
        </div>
        <div className="hero-chip-row premium-chip-row">
          {heroChips.map((chip) => <span key={chip}>{chip}</span>)}
        </div>
      </div>
      <div className="hero-product-visual" aria-label="BoardForge product workflow preview">
        <div className="visual-window-bar"><span /> <span /> <span /><strong>BoardForge job preview</strong></div>
        <div className="hero-flow-grid">
          <div className="command-panel">
            <small>Codex prompt</small>
            <code>Use BoardForge to create a USB-C sensor board with four M3 holes...</code>
            <span className="terminal-cursor" />
          </div>
          <div className="json-panel">
            <small>BoardForge Plugin tool call</small>
            <pre>{`{
  "tool": "create_kicad_project",
  "board": "usb_sensor",
  "validation": ["erc", "drc", "fab_rules"]
}`}</pre>
          </div>
          <div className="kicad-preview-panel">
            <div className="preview-status-row">
              <span>Plugin job</span>
              <span>DRC queued</span>
              <span>Edge.Cuts valid</span>
            </div>
            <MiniBoard shape="compact" />
            <div className="validation-mini">
              <strong>KiCad DRC: pending</strong>
              <span>Export: Gerbers / BOM / CPL</span>
              <span>Human review: required</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

function WorkflowStrip() {
  return (
    <section className="workflow-strip" id="workflow">
      <div>
        <strong>From prompt to KiCad project - safely.</strong>
        <span>Codex stays expressive. BoardForge keeps execution structured.</span>
      </div>
      <div className="workflow-nodes">
        {workflowSteps.map((step, index) => (
          <span key={step} className="workflow-node">
            <small>{index + 1}</small>
            {step}
          </span>
        ))}
      </div>
    </section>
  )
}

function WhyBoardForgeSection() {
  return (
    <section className="premium-section why-section">
      <div className="premium-section-head">
        <StatusBadge tone="amber">why BoardForge exists</StatusBadge>
        <h2>AI can write files. PCB engineering needs controlled execution.</h2>
        <p>Codex is powerful, but PCB design needs schemas, rules, layout constraints, KiCad checks, and manufacturing validation.</p>
      </div>
      <div className="premium-comparison">
        {comparisonColumns.map((column) => (
          <article className={`comparison-column ${column.tone}`} key={column.title}>
            <h3>{column.title}</h3>
            {column.items.map((item) => (
              <span key={item}>{column.tone === 'danger' ? <X size={15} /> : <CheckCircle2 size={15} />} {item}</span>
            ))}
          </article>
        ))}
      </div>
    </section>
  )
}

function ProductPreviewSection() {
  return (
    <section className="premium-section product-preview-section">
      <div className="premium-section-head">
        <StatusBadge tone="green">command center demo</StatusBadge>
        <h2>The website plans and previews. The plugin executes locally.</h2>
        <p>A stable product preview of the BoardForge command center: spec, outline, plugin job, validation, and export package. Demo statuses are labeled honestly.</p>
      </div>
      <div className="command-center-mockup">
        <aside className="workflow-panel">
          {commandSteps.map(([title, ...items], index) => (
            <div className={index === 2 ? 'active' : ''} key={title}>
              <small>0{index + 1}</small>
              <strong>{title}</strong>
              {items.map((item) => <span key={item}>{item}</span>)}
            </div>
          ))}
        </aside>
        <div className="project-preview-panel">
          <div className="mockup-tabs">
            {['Spec', 'Board Outline', 'Plugin Job', 'KiCad Validation', 'Export Package'].map((tab) => <span key={tab}>{tab}</span>)}
          </div>
          <div className="project-preview-grid">
            <div className="board-cad-window">
              <div className="visual-window-bar"><span /> <span /> <span /><strong>usb-sensor.kicad_pcb</strong></div>
              <MiniBoard shape="compact" />
            </div>
            <div className="job-stack">
              <pre>{`tool: create_kicad_project
workspace: selected folder only
actions:
  - write_edge_cuts
  - scan_footprints
  - run_drc
  - package_jlcpcb`}</pre>
              <div className="validation-report-card">
                <small>Example report preview</small>
                <strong>Validation summary</strong>
                <span>ERC: not run / demo</span>
                <span>DRC: not run / demo</span>
                <span>Fab rules: pending</span>
                <span>Human review: required</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

function PreviewExamplesSection() {
  return (
    <section className="premium-section examples-section">
      <div className="premium-section-head compact">
        <StatusBadge tone="cyan">project examples</StatusBadge>
        <h2>Preview real workflow shapes, not generic boards.</h2>
      </div>
      <div className="premium-preview-grid">
        {previewCards.map((card) => (
          <article className="premium-preview-card" key={card.title}>
            <MiniBoard shape={card.shape} />
            <div>
              <span className="preview-status">{card.status}</span>
              <h3>{card.title}</h3>
              <p>{card.copy}</p>
              <a href="#/generate">{card.cta} <ArrowRight size={15} /></a>
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}

function BoardBuilderSection() {
  return (
    <section className="premium-section board-builder-premium">
      <div className="builder-copy">
        <StatusBadge tone="green">browser board builder</StatusBadge>
        <h2>Start with the board shape.</h2>
        <p>Create custom outlines in the browser, save them to your board library, then send them to BoardForge Plugin to generate KiCad Edge.Cuts.</p>
        <div className="builder-flow">
          {['Draw outline', 'Save board', 'Send to plugin'].map((step, index) => <span key={step}><small>{index + 1}</small>{step}</span>)}
        </div>
        <div className="action-row">
          <a className="primary-action" href="#/generate"><CircuitBoard size={18} /> Open Board Builder</a>
          <a className="secondary-action" href="#/boards"><FolderKanban size={18} /> View Saved Boards</a>
          <a className="secondary-action" href="#/generate"><FileArchive size={18} /> Export KiCad Outline</a>
        </div>
      </div>
      <div className="builder-product-panel">
        <div className="builder-toolbar">
          <span>custom outline</span>
          <button type="button">Export KiCad Outline</button>
        </div>
        <svg viewBox="0 0 360 220" role="img" aria-label="Board builder outline preview">
          <path d="M56 50 Q56 28 78 28 H284 Q308 28 308 52 V160 Q308 190 278 190 H86 Q56 190 56 160 Z" />
          <circle cx="88" cy="64" r="10" />
          <circle cx="276" cy="64" r="10" />
          <circle cx="88" cy="160" r="10" />
          <circle cx="276" cy="160" r="10" />
          <rect x="126" y="86" width="80" height="52" rx="5" />
          <rect x="230" y="84" width="42" height="26" rx="4" />
          <path className="keepout" d="M92 92 H118 V124 H92 Z" />
          <polyline points="92,106 126,104 166,104 230,96" />
          <polyline points="166,138 216,160 276,160" />
          <text x="86" y="44">mounting holes</text>
          <text x="212" y="28">Edge.Cuts</text>
          <text x="92" y="86">keepout</text>
        </svg>
      </div>
    </section>
  )
}

function PluginExecutionSection() {
  return (
    <section className="premium-section execution-section">
      <div className="premium-section-head">
        <StatusBadge tone="cyan">local execution model</StatusBadge>
        <h2>Real KiCad work happens locally.</h2>
        <p>BoardForge Plugin calls a local tool server that works inside your selected project folder using your KiCad installation, libraries, footprints, and 3D models.</p>
      </div>
      <div className="execution-layout">
        <div className="execution-diagram">
          {['Codex', 'BoardForge Plugin', 'localhost tool server', 'selected KiCad workspace', '.kicad_pro / .kicad_sch / .kicad_pcb'].map((node) => (
            <span key={node}>{node}</span>
          ))}
        </div>
        <div className="execution-card-grid">
          {executionCards.map(([label, Icon]) => <span key={label}><Icon size={17} /> {label}</span>)}
        </div>
      </div>
    </section>
  )
}

function CapabilitiesGroupedSection() {
  return (
    <section className="premium-section capabilities-grouped">
      <div className="premium-section-head compact">
        <StatusBadge tone="green">capabilities</StatusBadge>
        <h2>One plugin. Real PCB workflows.</h2>
      </div>
      <div className="capability-group-grid">
        {capabilityGroups.map((group) => {
          const Icon = group.icon
          return (
            <details key={group.title} open>
              <summary><Icon size={18} /> {group.title}</summary>
              {group.items.map((item) => <span key={item}><CheckCircle2 size={15} /> {item}</span>)}
            </details>
          )
        })}
      </div>
    </section>
  )
}

function SupportedWorkflowsSection() {
  return (
    <section className="premium-section supported-workflows-section">
      <div className="premium-section-head compact">
        <StatusBadge tone="cyan">supported workflows</StatusBadge>
        <h2>Built for all PCB engineers, not one niche.</h2>
      </div>
      <div className="workflow-group-grid">
        {workflowGroups.map(([group, items]) => (
          <article key={group}>
            <h3>{group}</h3>
            {(items as string[]).map((item) => <span key={item}>{item}</span>)}
          </article>
        ))}
      </div>
    </section>
  )
}

function ValidationSafetySection() {
  return (
    <section className="premium-section validation-premium-section">
      <div className="premium-section-head">
        <StatusBadge tone="amber">validation and safety</StatusBadge>
        <h2>AI actions gated by KiCad checks.</h2>
        <p>BoardForge does not let Codex randomly mutate PCB files. It uses structured JSON commands, local workspace rules, whitelisted KiCad actions, ERC/DRC checks, and manufacturer profiles.</p>
      </div>
      <div className="validation-layout">
        <div className="safety-card-grid">
          {safetyCards.map(([title, body, Icon]) => (
            <article key={title}>
              <Icon size={18} />
              <strong>{title}</strong>
              <p>{body}</p>
            </article>
          ))}
        </div>
        <div className="validation-summary">
          <small>Example report preview</small>
          <strong>Validation summary</strong>
          <span>ERC: pending</span>
          <span>DRC: pending</span>
          <span>Fab rules: pending</span>
          <span>Human review: required</span>
        </div>
      </div>
      <WarningBanner />
    </section>
  )
}

function InstallBetaSection() {
  return (
    <section className="premium-section install-beta-section">
      <div className="install-card">
        <div>
          <StatusBadge tone="green">plugin beta</StatusBadge>
          <h2>Install the plugin. Point it at KiCad. Start prompting.</h2>
        </div>
        <div className="setup-grid premium-setup-grid">
          {setupSteps.map((step, index) => <article key={step}><span>{index + 1}</span><strong>{step}</strong></article>)}
        </div>
        <div className="action-row">
          <a className="primary-action" href="#/plugin"><Plug size={18} /> Join Plugin Beta</a>
          <a className="secondary-action" href="#/docs"><FileCheck2 size={18} /> Read Install Guide</a>
          <a className="secondary-action" href="#prompts"><TerminalSquare size={18} /> View Example Prompts</a>
        </div>
      </div>
    </section>
  )
}

function ExamplePromptsSection() {
  const [copied, setCopied] = useState<string | null>(null)
  const copyPrompt = async (label: string, prompt: string) => {
    await navigator.clipboard.writeText(prompt)
    setCopied(label)
    window.setTimeout(() => setCopied(null), 1600)
  }

  return (
    <section className="premium-section prompt-command-section" id="prompts">
      <div className="premium-section-head compact">
        <StatusBadge tone="cyan">example prompts</StatusBadge>
        <h2>Say it like a command palette.</h2>
      </div>
      <div className="prompt-command-grid">
        {prompts.map(([label, prompt]) => (
          <article key={label}>
            <div>
              <span>{label}</span>
              <button type="button" onClick={() => copyPrompt(label, prompt)}><Copy size={15} /> {copied === label ? 'Copied' : 'Copy'}</button>
            </div>
            <code>{prompt}</code>
          </article>
        ))}
      </div>
    </section>
  )
}

function FinalCTASection() {
  return (
    <section className="premium-final-cta">
      <StatusBadge tone="green">structured KiCad execution</StatusBadge>
      <h2>Build PCB projects with Codex - without letting AI freestyle your board files.</h2>
      <p>BoardForge turns AI prompting into structured KiCad execution, validation, repair planning, and manufacturing export workflows.</p>
      <div className="action-row">
        <a className="primary-action" href="#/plugin"><Plug size={18} /> Join Plugin Beta</a>
        <a className="secondary-action" href="#/generate"><CircuitBoard size={18} /> Open Board Builder</a>
        <a className="secondary-action" href="#/docs"><Clipboard size={18} /> Read Docs</a>
      </div>
      <small>Human review required before manufacturing.</small>
    </section>
  )
}

export function LandingPage() {
  return (
    <main className="premium-landing-page">
      <LandingHero />
      <WorkflowStrip />
      <WhyBoardForgeSection />
      <ProductPreviewSection />
      <PreviewExamplesSection />
      <BoardBuilderSection />
      <InstallBetaSection />
      <PluginExecutionSection />
      <CapabilitiesGroupedSection />
      <SupportedWorkflowsSection />
      <ValidationSafetySection />
      <ExamplePromptsSection />
      <FinalCTASection />
    </main>
  )
}
