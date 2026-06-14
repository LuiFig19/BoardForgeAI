import type { Board, BoardOutlinePoint, GenerationJob, GenerationRequest } from '../data/models'

export type KiCadCommand =
  | 'kicad-cli sch export bom'
  | 'kicad-cli pcb export gerbers'
  | 'kicad-cli pcb export drill'
  | 'kicad-cli sch erc'
  | 'kicad-cli pcb drc'
  | 'kicad-cli pcb export pos'

export const allowedKiCadCommands: KiCadCommand[] = [
  'kicad-cli sch export bom',
  'kicad-cli pcb export gerbers',
  'kicad-cli pcb export drill',
  'kicad-cli sch erc',
  'kicad-cli pcb drc',
  'kicad-cli pcb export pos',
]

export const sanitizeProjectName = (name: string) =>
  name
    .trim()
    .replace(/[^a-zA-Z0-9-_ ]/g, '')
    .replace(/\s+/g, '-')
    .slice(0, 60)
    .toLowerCase()

export class KiCadProjectService {
  createProjectDirectory(request: GenerationRequest) {
    return {
      safeName: sanitizeProjectName(request.projectName),
      relativeRoot: `generated/${sanitizeProjectName(request.projectName)}`,
      policy: 'controlled-output-directory-only',
    }
  }

  writeProjectSkeleton(request: GenerationRequest) {
    const directory = this.createProjectDirectory(request)
    return {
      directory,
      files: [
        `${directory.relativeRoot}/${directory.safeName}.kicad_pro`,
        `${directory.relativeRoot}/${directory.safeName}.kicad_sch`,
        `${directory.relativeRoot}/${directory.safeName}.kicad_pcb`,
        `${directory.relativeRoot}/README-human-review.md`,
      ],
    }
  }
}

const toMmPoint = (point: BoardOutlinePoint, board: Board) => ({
  x: Number((point.x * board.width).toFixed(3)),
  y: Number((point.y * board.height).toFixed(3)),
})

const lineSegment = (start: { x: number; y: number }, end: { x: number; y: number }) =>
  `  (gr_line (start ${start.x} ${start.y}) (end ${end.x} ${end.y})\n    (stroke (width 0.1) (type solid)) (layer "Edge.Cuts") (uuid "${crypto.randomUUID()}"))`

const circleSegment = (x: number, y: number, radius: number, layer = 'Edge.Cuts') =>
  `  (gr_circle (center ${x} ${y}) (end ${Number((x + radius).toFixed(3))} ${y})\n    (stroke (width 0.1) (type solid)) (fill none) (layer "${layer}") (uuid "${crypto.randomUUID()}"))`

export class KiCadBoardOutlineService {
  getProjectFiles(board: Board) {
    const safeName = sanitizeProjectName(board.name || 'board-outline')
    const relativeRoot = `generated/boards/${safeName}`
    return {
      safeName,
      relativeRoot,
      files: [
        `${relativeRoot}/${safeName}.kicad_pro`,
        `${relativeRoot}/${safeName}.kicad_sch`,
        `${relativeRoot}/${safeName}.kicad_pcb`,
        `${relativeRoot}/README.md`,
      ],
    }
  }

  createProjectBundle(board: Board) {
    const { safeName } = this.getProjectFiles(board)
    return [
      { path: `${safeName}.kicad_pro`, content: this.createProjectFile(board) },
      { path: `${safeName}.kicad_sch`, content: this.createSchematicFile(board) },
      { path: `${safeName}.kicad_pcb`, content: this.createPcbFile(board) },
      { path: 'README.md', content: this.createReadme(board) },
    ]
  }

  createSchematicFile(board: Board) {
    const escapedName = board.name.replace(/"/g, "'")
    return `(kicad_sch (version 20250114) (generator "BoardForge AI") (generator_version "outline-only")\n  (uuid "${crypto.randomUUID()}")\n  (paper "A4")\n  (title_block\n    (title "${escapedName}")\n    (comment 1 "Outline-only BoardForge project")\n    (comment 2 "No symbols, nets, footprints, BOM, or CPL generated in browser")\n  )\n  (lib_symbols)\n  (sheet_instances\n    (path "/" (page "1"))\n  )\n)\n`
  }

  createProjectFile(board: Board) {
    return JSON.stringify({
      meta: { version: 1 },
      board: { design_settings: { defaults: {}, rules: {} } },
      boards: [],
      cvpcb: {},
      libraries: {},
      net_settings: {},
      pcbnew: {},
      schematic: {},
      sheets: [],
      text_variables: { BOARD_NAME: board.name, BOARDFORGE_MODE: 'outline_only' },
    }, null, 2)
  }

  createPcbFile(board: Board) {
    const edgeCuts = this.createEdgeCuts(board)
    const holes = board.mountingHoles.map((hole) => {
      const x = Number((hole.x * board.width).toFixed(3))
      const y = Number((hole.y * board.height).toFixed(3))
      return [
        circleSegment(x, y, Number((hole.diameterMm / 2).toFixed(3)), 'Edge.Cuts'),
        `  (gr_text "M${hole.diameterMm}" (at ${x} ${Number((y + hole.diameterMm + 1.2).toFixed(3))} 0) (layer "Cmts.User")\n    (effects (font (size 1 1) (thickness 0.12))) (uuid "${crypto.randomUUID()}"))`,
      ].join('\n')
    })

    return `(kicad_pcb (version 20240108) (generator "BoardForge AI")\n  (general (thickness 1.6))\n  (paper "A4")\n  (layers\n    (0 "F.Cu" signal)\n    (31 "B.Cu" signal)\n    (32 "B.Adhes" user)\n    (33 "F.Adhes" user)\n    (34 "B.Paste" user)\n    (35 "F.Paste" user)\n    (36 "B.SilkS" user)\n    (37 "F.SilkS" user)\n    (38 "B.Mask" user)\n    (39 "F.Mask" user)\n    (44 "Edge.Cuts" user)\n    (45 "Margin" user)\n    (46 "B.CrtYd" user)\n    (47 "F.CrtYd" user)\n    (48 "B.Fab" user)\n    (49 "F.Fab" user)\n  )\n  (setup\n    (pad_to_mask_clearance 0)\n    (pcbplotparams (layerselection 0x00010fc_ffffffff) (plot_on_all_layers_selection 0x0000000_00000000) (disableapertmacros false) (usegerberextensions false) (usegerberattributes true) (usegerberadvancedattributes true) (creategerberjobfile true) (dashed_line_dash_ratio 12.000000) (dashed_line_gap_ratio 3.000000) (svgprecision 4) (plotframeref false) (viasonmask false) (mode 1) (useauxorigin false) (hpglpennumber 1) (hpglpenspeed 20) (hpglpendiameter 15.000000) (pdf_front_fp_property_popups true) (pdf_back_fp_property_popups true) (dxfpolygonmode true) (dxfimperialunits true) (dxfusepcbnewfont true) (psnegative false) (psa4output false) (plot_black_and_white false) (plotinvisibletext false) (sketchpadsonfab false) (plotreference true) (plotvalue true) (plotpadnumbers false) (hidednponfab false) (sketchdnponfab true) (crossoutdnponfab true) (subtractmaskfromsilk false) (outputformat 1) (mirror false) (drillshape 1) (scaleselection 1) (outputdirectory ""))\n  )\n  ${edgeCuts.join('\n')}\n${holes.join('\n')}\n  (gr_text "BoardForge outline only: ${board.name.replace(/"/g, "'")}" (at 2 -3 0) (layer "Cmts.User")\n    (effects (font (size 1.2 1.2) (thickness 0.15))) (uuid "${crypto.randomUUID()}"))\n)\n`
  }

  createEdgeCuts(board: Board) {
    const points = board.outline.length >= 3 ? board.outline : this.defaultPointsForShape(board)
    const mmPoints = points.map((point) => toMmPoint(point, board))
    return mmPoints.map((point, index) => lineSegment(point, mmPoints[(index + 1) % mmPoints.length]))
  }

  defaultPointsForShape(board: Board): BoardOutlinePoint[] {
    if (board.shapeType === 'circle') {
      return Array.from({ length: 32 }, (_, index) => {
        const angle = (index / 32) * Math.PI * 2
        return { x: 0.5 + Math.cos(angle) * 0.46, y: 0.5 + Math.sin(angle) * 0.46 }
      })
    }
    if (board.shapeType === 'hexagon' || board.shapeType === 'octagon') {
      const sides = board.shapeType === 'hexagon' ? 6 : 8
      return Array.from({ length: sides }, (_, index) => {
        const angle = (index / sides) * Math.PI * 2 - Math.PI / 2
        return { x: 0.5 + Math.cos(angle) * 0.44, y: 0.5 + Math.sin(angle) * 0.44 }
      })
    }
    if (board.shapeType === 'drone frame') {
      return [
        { x: 0.14, y: 0.22 }, { x: 0.32, y: 0.08 }, { x: 0.68, y: 0.08 }, { x: 0.86, y: 0.22 },
        { x: 0.78, y: 0.5 }, { x: 0.86, y: 0.78 }, { x: 0.68, y: 0.92 }, { x: 0.32, y: 0.92 },
        { x: 0.14, y: 0.78 }, { x: 0.22, y: 0.5 },
      ]
    }
    if (board.shapeType === 'sensor board') {
      return [
        { x: 0.08, y: 0.16 }, { x: 0.76, y: 0.16 }, { x: 0.92, y: 0.34 },
        { x: 0.92, y: 0.84 }, { x: 0.08, y: 0.84 },
      ]
    }
    return [
      { x: 0.06, y: 0.08 },
      { x: 0.94, y: 0.08 },
      { x: 0.94, y: 0.92 },
      { x: 0.06, y: 0.92 },
    ]
  }

  createReadme(board: Board) {
    return `# ${board.name}\n\nBoardForge AI outline-only KiCad project.\n\n- Type: ${board.type}\n- Shape: ${board.shapeType}\n- Size: ${board.width} ${board.units} x ${board.height} ${board.units}\n- Corner radius: ${board.cornerRadiusMm} mm\n- Mounting holes: ${board.mountingHoles.length}\n- Source prompt: ${board.sourcePrompt || 'none'}\n\nThis package contains a KiCad project file, an empty schematic scaffold, and PCB mechanical Edge.Cuts geometry. No symbols, footprints, BOM, CPL, copper routing, or manufacturing package has been generated in the browser.\n`
  }
}

export class KiCadExportService {
  getPlannedCommands(job: GenerationJob) {
    const root = `generated/${sanitizeProjectName(job.request.projectName)}`
    return [
      { command: 'kicad-cli sch erc' as const, args: [`${root}/${root}.kicad_sch`, '--output', `${root}/reports/erc.rpt`] },
      { command: 'kicad-cli pcb drc' as const, args: [`${root}/${root}.kicad_pcb`, '--output', `${root}/reports/drc.rpt`] },
      { command: 'kicad-cli pcb export gerbers' as const, args: ['--output', `${root}/fab/gerbers`, `${root}/${root}.kicad_pcb`] },
      { command: 'kicad-cli pcb export drill' as const, args: ['--output', `${root}/fab/drill`, `${root}/${root}.kicad_pcb`] },
      { command: 'kicad-cli sch export bom' as const, args: ['--output', `${root}/fab/bom.csv`, `${root}/${root}.kicad_sch`] },
      { command: 'kicad-cli pcb export pos' as const, args: ['--output', `${root}/fab/cpl.csv`, `${root}/${root}.kicad_pcb`] },
    ].filter((item) => allowedKiCadCommands.includes(item.command))
  }
}

export class KiCadValidationService {
  checkRuntime() {
    return {
      available: false,
      reason:
        'The browser client cannot execute local kicad-cli. Connect this interface to a server-side runner to perform ERC, DRC, Gerber, drill, BOM, and CPL exports.',
    }
  }
}

export class ProjectPackageService {
  getPackageLayout(projectName: string) {
    const safeName = sanitizeProjectName(projectName)
    return [
      `generated/${safeName}/${safeName}.kicad_pro`,
      `generated/${safeName}/${safeName}.kicad_sch`,
      `generated/${safeName}/${safeName}.kicad_pcb`,
      `generated/${safeName}/fab/gerbers.zip`,
      `generated/${safeName}/fab/drill/`,
      `generated/${safeName}/fab/bom.csv`,
      `generated/${safeName}/fab/cpl.csv`,
      `generated/${safeName}/reports/erc.rpt`,
      `generated/${safeName}/reports/drc.rpt`,
      `generated/${safeName}/README-human-review.md`,
    ]
  }
}

export class JlcpcbExportService {
  getChecklist() {
    return [
      'Gerbers ZIP',
      'Drill files',
      'BOM',
      'CPL / pick-and-place',
      'Component rotations checked',
      'Board outline present',
      'Layer stack confirmed',
      'Minimum trace/space confirmed',
      'Via sizes confirmed',
      'Silkscreen checked',
      'Polarity markers checked',
      'Assembly notes generated',
      'Human review required before ordering',
    ]
  }
}

export class ComponentLibraryService {
  supportedSources = ['JLCPCB/LCSC', 'Digi-Key', 'Mouser', 'custom library'] as const
}
