import { generationRequestSchema, type GenerationRequest } from '../data/models'
import { makeDemoJob } from '../data/fixtures'

export const promptModules = {
  systemRole: 'You are a cautious PCB design agent producing validation-ready structured outputs.',
  projectContext: 'BoardForge AI generates KiCad project folders, manufacturing files, and review reports.',
  hardwareConstraints: 'Respect board type rules, JLCPCB limits, component footprints, power integrity, and high-speed constraints.',
  outputSchema: 'All agent outputs must validate against typed JSON schemas before deterministic builders write files.',
  validationRules: 'Never claim guaranteed manufacturable. Require ERC, DRC, and human review.',
  previousErrors: 'Feed KiCad reports back into retry prompts as structured errors.',
  retryInstructions: 'Patch structured data first, validate, then rebuild staged KiCad files.',
}

export class AgentOrchestrator {
  createGenerationJob(input: GenerationRequest) {
    const request = generationRequestSchema.parse(input)
    return makeDemoJob(request)
  }
}

export const boardRuleEngine = {
  global: [
    'Decoupling capacitors close to IC power pins',
    'Crystals close to IC oscillator pins',
    'USB connector on board edge',
    'RJ45 connector on board edge',
    'Keep high-current loops short',
    'Add pin 1 indicators and polarity marks',
    'Add net classes for power, high speed, default, and differential pairs',
  ],
  'drone flight controller': [
    'IMU near board center',
    'USB-C on edge',
    'ESC connector accessible',
    'UARTs broken out',
    'Clean sensor power',
  ],
  'PoE device': [
    'Ethernet connector on edge',
    'PHY/controller close to magnetics/RJ45',
    'PoE high-voltage section separated',
    'Isolation boundary respected',
    'TVS/fuse/front-end placed logically',
  ],
}
