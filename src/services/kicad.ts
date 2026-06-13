import type { GenerationJob, GenerationRequest } from '../data/models'

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
