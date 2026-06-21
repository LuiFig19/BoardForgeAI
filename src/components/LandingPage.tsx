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
  Layers3,
  Network,
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

const workflowSteps = ['Prompt', 'Plugin', 'JSON Job', 'Local KiCad', 'ERC/DRC', 'Export']

const comparisonColumns = [
  {
    title: 'Raw Codex edits',
    tone: 'danger',
    summary: 'Flexible, but too easy to damage a PCB project.',
    items: ['edits KiCad files directly', 'can break syntax', 'can miss footprints', 'can create bad Edge.Cuts', 'hard to audit'],
  },
  {
    title: 'BoardForge Plugin',
    tone: 'accent',
    summary: 'Codex gets constrained PCB tools instead of raw file access.',
    items: ['schema-validated tool calls', 'whitelisted KiCad actions', 'board geometry checks', 'net class logic', 'repair plans'],
  },
  {
    title: 'Local KiCad source of truth',
    tone: 'safe',
    summary: 'Your machine, libraries, checks, and review gate stay in control.',
    items: ['real project files', 'real libraries and 3D models', 'real ERC/DRC', 'real Gerber/BOM/CPL exports', 'human review before fab'],
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
    copy: 'RJ45 edge connector, PoE power region, ESP32 control region, sensor header, and mounting holes.',
    variant: 'poe',
    tags: ['RJ45', 'PoE', 'ESP32-S3'],
  },
  {
    title: 'USB-C sensor board',
    status: 'Plugin-ready',
    cta: 'Use template',
    copy: 'Compact rounded board with USB-C, MCU, I2C sensor connector, and regulator section.',
    variant: 'usb',
    tags: ['USB-C', 'I2C', '3V3'],
  },
  {
    title: 'Robotics controller',
    status: 'Needs local KiCad validation',
    cta: 'View workflow',
    copy: 'Terminal blocks, power input, CAN/UART headers, MCU region, and motor/sensor connectors.',
    variant: 'robotics',
    tags: ['VIN', 'CAN', 'MOTOR/SENSOR'],
  },
  {
    title: 'Drone flight controller',
    status: 'Board preset',
    cta: 'Use preset',
    copy: 'Square board with 30.5 mm mounting pattern, USB-C edge, MCU/IMU region, and UART pads.',
    variant: 'drone',
    tags: ['30.5 mm', 'IMU', 'UART'],
  },
] as const

type PcbExampleVariant = (typeof previewCards)[number]['variant']

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
    description: 'Turn specs and outlines into controlled KiCad starting points.',
    items: ['Create KiCad projects', 'Generate board outlines', 'Write Edge.Cuts', 'Assign footprints'],
  },
  {
    title: 'Validate',
    icon: ShieldCheck,
    description: 'Check project structure before trusting any AI-suggested work.',
    items: ['Check 3D models', 'Validate pin maps', 'Run ERC/DRC', 'Parse reports'],
  },
  {
    title: 'Route / Repair',
    icon: Route,
    description: 'Plan layout changes, net classes, and safe repair passes.',
    items: ['Plan placement', 'Create net classes', 'Route/review copper', 'Plan safe repairs'],
  },
  {
    title: 'Export',
    icon: PackageCheck,
    description: 'Create manufacturing outputs only after local checks and review.',
    items: ['Export Gerbers', 'Export drill files', 'Export BOM', 'Export CPL', 'Package JLCPCB files', 'Generate review reports'],
  },
]

const workflowGroups = [
  { group: 'Embedded', description: 'Small controllers, sensors, and dev hardware.', icon: CircuitBoard, items: ['ESP32 / IoT', 'USB devices', 'sensor boards', 'dev boards'] },
  { group: 'Connectivity', description: 'Boards where interfaces and connectors matter.', icon: Network, items: ['Ethernet', 'PoE', 'CAN', 'adapter boards'] },
  { group: 'Power / Control', description: 'Layouts with power domains, loads, and IO.', icon: Gauge, items: ['motor controllers', 'LED controllers', 'battery/charger boards', 'robotics controllers'] },
  { group: 'Mechanical / Custom', description: 'Outlines, fixtures, and shape-constrained PCBs.', icon: Layers3, items: ['custom-shaped PCBs', 'board outlines', 'test fixtures', 'drone flight controllers'] },
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

function PcbLabel({ x, y, children }: { x: number; y: number; children: string }) {
  return <text className="pcb-silk" x={x} y={y}>{children}</text>
}

function ViaRow({ points, r = 2.2 }: { points: Array<[number, number]>; r?: number }) {
  return (
    <>
      {points.map(([cx, cy]) => <circle className="pcb-via" key={`${cx}-${cy}`} cx={cx} cy={cy} r={r} />)}
    </>
  )
}

function PinRow({ x, y, count, dx = 8, dy = 0, r = 2.6 }: { x: number; y: number; count: number; dx?: number; dy?: number; r?: number }) {
  return (
    <>
      {Array.from({ length: count }, (_, index) => (
        <circle className="pcb-pad" key={`${x}-${y}-${index}`} cx={x + index * dx} cy={y + index * dy} r={r} />
      ))}
    </>
  )
}

function PassiveBank({ x, y, columns = 3, rows = 2 }: { x: number; y: number; columns?: number; rows?: number }) {
  return (
    <g className="pcb-passives">
      {Array.from({ length: rows }, (_, row) => (
        Array.from({ length: columns }, (__, column) => (
          <rect key={`${row}-${column}`} x={x + column * 13} y={y + row * 12} width="8" height="4" rx="1" />
        ))
      ))}
    </g>
  )
}

function PoeSensorPreview() {
  return (
    <svg className="pcb-example-svg poe-board" viewBox="0 0 360 230" role="img" aria-label="ESP32-S3 PoE air sensor PCB preview">
      <path className="pcb-board" d="M34 39 Q34 22 51 22 H309 Q326 22 326 39 V190 Q326 208 309 208 H51 Q34 208 34 190 Z" />
      <path className="pcb-zone power-zone" d="M208 42 H305 V150 H228 Q218 124 205 112 Z" />
      <path className="pcb-zone control-zone" d="M62 54 H188 V174 H62 Z" />
      <rect className="pcb-rj45" x="282" y="72" width="41" height="72" rx="5" />
      <rect className="pcb-metal-shell" x="296" y="83" width="22" height="50" rx="3" />
      <PinRow x={286} y={154} count={8} dx={4.5} r={1.8} />
      <rect className="pcb-usbc" x="34" y="95" width="31" height="38" rx="4" />
      <rect className="pcb-metal-shell" x="38" y="104" width="23" height="20" rx="3" />
      <rect className="pcb-module" x="77" y="70" width="83" height="64" rx="5" />
      <rect className="pcb-antenna" x="87" y="78" width="63" height="12" rx="2" />
      <rect className="pcb-chip" x="99" y="102" width="39" height="24" rx="3" />
      <rect className="pcb-chip" x="205" y="82" width="39" height="32" rx="4" />
      <rect className="pcb-chip small" x="222" y="135" width="42" height="23" rx="3" />
      <rect className="pcb-inductor" x="258" y="46" width="28" height="22" rx="4" />
      <rect className="pcb-connector" x="82" y="154" width="72" height="18" rx="3" />
      <PinRow x={91} y={163} count={5} dx={12} r={2.2} />
      <PassiveBank x={170} y={76} columns={2} rows={4} />
      <PassiveBank x={250} y={87} columns={2} rows={3} />
      <polyline className="pcb-trace diff" points="280,97 256,96 244,94" />
      <polyline className="pcb-trace diff" points="280,106 256,108 244,109" />
      <polyline className="pcb-trace thick" points="283,139 265,147 244,147" />
      <polyline className="pcb-trace" points="205,99 184,99 160,110" />
      <polyline className="pcb-trace" points="138,134 132,154" />
      <polyline className="pcb-trace" points="65,114 77,114 99,112" />
      <ViaRow points={[[199, 122], [214, 121], [230, 121], [172, 128], [178, 140], [165, 144], [250, 170], [268, 170]]} />
      {[[57, 45], [303, 45], [57, 185], [303, 185]].map(([cx, cy]) => <circle className="pcb-hole" key={`${cx}-${cy}`} cx={cx} cy={cy} r="8" />)}
      <PcbLabel x={284} y={66}>RJ45</PcbLabel>
      <PcbLabel x={81} y={64}>ESP32-S3</PcbLabel>
      <PcbLabel x={216} y={77}>PoE</PcbLabel>
      <PcbLabel x={222} y={174}>3V3</PcbLabel>
      <PcbLabel x={85} y={150}>SENSOR</PcbLabel>
    </svg>
  )
}

function UsbSensorPreview() {
  return (
    <svg className="pcb-example-svg usb-board" viewBox="0 0 360 230" role="img" aria-label="USB-C sensor board PCB preview">
      <path className="pcb-board" d="M69 55 Q69 33 91 33 H273 Q296 33 296 56 V174 Q296 197 273 197 H91 Q69 197 69 174 Z" />
      <rect className="pcb-usbc" x="69" y="98" width="34" height="36" rx="4" />
      <rect className="pcb-metal-shell" x="74" y="107" width="25" height="18" rx="3" />
      <rect className="pcb-chip mcu" x="147" y="87" width="58" height="50" rx="5" />
      <PinRow x={154} y={83} count={6} dx={8} r={1.6} />
      <PinRow x={154} y={141} count={6} dx={8} r={1.6} />
      <rect className="pcb-chip small" x="229" y="76" width="33" height="24" rx="3" />
      <rect className="pcb-connector" x="220" y="151" width="48" height="18" rx="3" />
      <PinRow x={230} y={160} count={4} dx={10} r={2.2} />
      <rect className="pcb-chip small" x="117" y="152" width="28" height="18" rx="3" />
      <circle className="pcb-button" cx="118" cy="70" r="8" />
      <circle className="pcb-button" cx="270" cy="70" r="8" />
      <PassiveBank x={212} y={105} columns={3} rows={2} />
      <PassiveBank x={111} y={95} columns={2} rows={3} />
      <polyline className="pcb-trace diff" points="103,111 126,108 147,106" />
      <polyline className="pcb-trace diff" points="103,121 126,123 147,121" />
      <polyline className="pcb-trace" points="205,112 229,92" />
      <polyline className="pcb-trace" points="203,130 220,158" />
      <polyline className="pcb-trace thick" points="145,161 180,170 226,166" />
      <ViaRow points={[[129, 131], [136, 77], [214, 88], [213, 142], [257, 133], [91, 154]]} />
      {[[93, 57], [272, 57], [93, 174], [272, 174]].map(([cx, cy]) => <circle className="pcb-hole" key={`${cx}-${cy}`} cx={cx} cy={cy} r="6.5" />)}
      <PcbLabel x={76} y={94}>USB-C</PcbLabel>
      <PcbLabel x={160} y={82}>MCU</PcbLabel>
      <PcbLabel x={223} y={74}>SENSOR</PcbLabel>
      <PcbLabel x={115} y={149}>3V3</PcbLabel>
      <PcbLabel x={224} y={147}>I2C</PcbLabel>
    </svg>
  )
}

function RoboticsControllerPreview() {
  return (
    <svg className="pcb-example-svg robotics-board" viewBox="0 0 360 230" role="img" aria-label="Robotics controller PCB preview">
      <path className="pcb-board" d="M25 43 Q25 29 39 29 H322 Q336 29 336 43 V187 Q336 201 322 201 H39 Q25 201 25 187 Z" />
      <path className="pcb-zone power-zone" d="M39 43 H115 V187 H39 Z" />
      <rect className="pcb-terminal" x="42" y="64" width="56" height="42" rx="4" />
      <rect className="pcb-terminal" x="42" y="119" width="56" height="42" rx="4" />
      <line className="pcb-screw-slot" x1="52" y1="85" x2="87" y2="85" />
      <line className="pcb-screw-slot" x1="52" y1="140" x2="87" y2="140" />
      <rect className="pcb-chip mcu" x="155" y="82" width="58" height="52" rx="5" />
      <rect className="pcb-chip small" x="126" y="151" width="39" height="24" rx="3" />
      <rect className="pcb-inductor" x="109" y="69" width="27" height="24" rx="4" />
      <rect className="pcb-can" x="230" y="62" width="42" height="24" rx="3" />
      <rect className="pcb-connector" x="245" y="154" width="72" height="20" rx="3" />
      <PinRow x={255} y={164} count={6} dx={10} r={2.1} />
      <rect className="pcb-header" x="293" y="58" width="20" height="72" rx="3" />
      <PinRow x={303} y={69} count={5} dy={12} dx={0} r={2.3} />
      <rect className="pcb-header" x="123" y="43" width="84" height="17" rx="3" />
      <PinRow x={134} y={52} count={7} dx={10} r={2.1} />
      <PassiveBank x={220} y={99} columns={3} rows={3} />
      <PassiveBank x={139} y={66} columns={2} rows={2} />
      <polyline className="pcb-trace thick" points="97,84 116,82 136,88 155,100" />
      <polyline className="pcb-trace thick" points="97,140 128,151 164,162 245,164" />
      <polyline className="pcb-trace diff" points="213,100 230,77 272,76" />
      <polyline className="pcb-trace diff" points="213,111 232,88 272,88" />
      <polyline className="pcb-trace" points="184,82 176,60" />
      <polyline className="pcb-trace" points="213,126 246,154" />
      <ViaRow points={[[119, 111], [134, 117], [223, 133], [239, 134], [278, 137], [222, 57], [132, 185], [301, 184]]} />
      {[[48, 49], [314, 49], [48, 181], [314, 181]].map(([cx, cy]) => <circle className="pcb-hole" key={`${cx}-${cy}`} cx={cx} cy={cy} r="7.5" />)}
      <PcbLabel x={51} y={60}>VIN</PcbLabel>
      <PcbLabel x={235} y={58}>CAN</PcbLabel>
      <PcbLabel x={169} y={78}>MCU</PcbLabel>
      <PcbLabel x={247} y={150}>MOTOR/SENSOR</PcbLabel>
      <PcbLabel x={112} y={66}>5V</PcbLabel>
      <PcbLabel x={125} y={148}>3V3</PcbLabel>
    </svg>
  )
}

function DroneFlightControllerPreview() {
  return (
    <svg className="pcb-example-svg drone-board" viewBox="0 0 360 230" role="img" aria-label="Drone flight controller PCB preview">
      <path className="pcb-board" d="M93 28 Q93 19 102 19 H258 Q267 19 267 28 V184 Q267 193 258 193 H102 Q93 193 93 184 Z" />
      <path className="pcb-zone control-zone" d="M125 56 H236 V153 H125 Z" />
      <rect className="pcb-usbc" x="154" y="176" width="52" height="20" rx="4" />
      <rect className="pcb-metal-shell" x="165" y="180" width="30" height="12" rx="2" />
      <rect className="pcb-chip mcu" x="143" y="80" width="52" height="48" rx="5" />
      <rect className="pcb-chip imu" x="199" y="91" width="27" height="27" rx="3" />
      <rect className="pcb-chip small" x="127" y="136" width="34" height="20" rx="3" />
      <rect className="pcb-chip small" x="205" y="134" width="35" height="19" rx="3" />
      <rect className="pcb-esc-pads" x="108" y="69" width="14" height="73" rx="3" />
      <rect className="pcb-esc-pads" x="239" y="69" width="14" height="73" rx="3" />
      <PinRow x={115} y={80} count={5} dy={13} dx={0} r={2.2} />
      <PinRow x={246} y={80} count={5} dy={13} dx={0} r={2.2} />
      <PinRow x={123} y={44} count={6} dx={14} r={2.1} />
      <PinRow x={123} y={167} count={6} dx={14} r={2.1} />
      <circle className="pcb-button" cx="135" cy="62" r="7" />
      <circle className="pcb-button" cx="225" cy="62" r="7" />
      <PassiveBank x={126} y={103} columns={2} rows={2} />
      <PassiveBank x={202} y={66} columns={3} rows={2} />
      <polyline className="pcb-trace" points="195,104 199,104" />
      <polyline className="pcb-trace" points="169,128 158,136" />
      <polyline className="pcb-trace" points="194,126 215,134" />
      <polyline className="pcb-trace diff" points="177,176 176,149 170,128" />
      <polyline className="pcb-trace diff" points="187,176 188,149 190,128" />
      <polyline className="pcb-trace thick" points="118,128 143,120" />
      <polyline className="pcb-trace thick" points="239,128 226,116" />
      <ViaRow points={[[135, 76], [223, 78], [132, 128], [232, 128], [178, 62], [180, 151], [207, 123], [155, 158]]} />
      {[[116, 42], [244, 42], [116, 170], [244, 170]].map(([cx, cy]) => <circle className="pcb-hole" key={`${cx}-${cy}`} cx={cx} cy={cy} r="8" />)}
      <PcbLabel x={159} y={77}>MCU</PcbLabel>
      <PcbLabel x={202} y={88}>IMU</PcbLabel>
      <PcbLabel x={122} y={40}>UART</PcbLabel>
      <PcbLabel x={160} y={173}>USB-C</PcbLabel>
      <PcbLabel x={208} y={131}>5V</PcbLabel>
      <PcbLabel x={127} y={133}>GND</PcbLabel>
    </svg>
  )
}

function PcbExamplePreview({ variant }: { variant: PcbExampleVariant }) {
  if (variant === 'poe') return <PoeSensorPreview />
  if (variant === 'usb') return <UsbSensorPreview />
  if (variant === 'robotics') return <RoboticsControllerPreview />
  return <DroneFlightControllerPreview />
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
        <span>Codex reasons. BoardForge executes controlled KiCad actions. KiCad remains the source of truth.</span>
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

function TopBetaCTA() {
  return (
    <section className="top-beta-cta" aria-label="Plugin beta call to action">
      <strong>BoardForge Plugin Beta is opening soon.</strong>
      <div>
        <a className="primary-action" href="#/plugin"><Plug size={16} /> Join Plugin Beta</a>
        <a className="secondary-action" href="#/docs"><FileCheck2 size={16} /> Read Install Guide</a>
        <a className="secondary-action" href="#/generate"><CircuitBoard size={16} /> Open Board Builder</a>
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
            <p>{column.summary}</p>
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
            <div className="pcb-example-frame">
              <PcbExamplePreview variant={card.variant} />
            </div>
            <div className="premium-preview-copy">
              <span className="preview-status">{card.status}</span>
              <h3>{card.title}</h3>
              <p>{card.copy}</p>
              <div className="preview-tag-row">
                {card.tags.map((tag) => <span key={tag}>{tag}</span>)}
              </div>
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
        <small className="builder-caption">Board outlines are saved as first-class assets and can become KiCad Edge.Cuts through the plugin.</small>
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
            <span key={node}><ShieldCheck size={15} /> {node}</span>
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
              <p>{group.description}</p>
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
        {workflowGroups.map((workflow) => {
          const Icon = workflow.icon
          return (
          <article key={workflow.group}>
            <h3><Icon size={17} /> {workflow.group}</h3>
            <p>{workflow.description}</p>
            {workflow.items.map((item) => <span key={item}>{item}</span>)}
          </article>
          )
        })}
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
      <TopBetaCTA />
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
