import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { AgentOrchestrator } from '../services/agents'
import type { GenerationJob, GenerationRequest } from '../data/models'
import { emptyRequest, makeDemoJob } from '../data/fixtures'

type JobStore = {
  jobs: GenerationJob[]
  activeJobId: string
  setActiveJob: (id: string) => void
  createJob: (request: GenerationRequest) => GenerationJob
  getActiveJob: () => GenerationJob
}

const seedJob = makeDemoJob(emptyRequest)
const orchestrator = new AgentOrchestrator()

export const useJobs = create<JobStore>()(
  persist(
    (set, get) => ({
      jobs: [seedJob],
      activeJobId: seedJob.id,
      setActiveJob: (id) => set({ activeJobId: id }),
      createJob: (request) => {
        const job = orchestrator.createGenerationJob(request)
        set((state) => ({ jobs: [job, ...state.jobs], activeJobId: job.id }))
        return job
      },
      getActiveJob: () => {
        const state = get()
        return state.jobs.find((job) => job.id === state.activeJobId) || state.jobs[0] || seedJob
      },
    }),
    { name: 'boardforge-ai-jobs' },
  ),
)
