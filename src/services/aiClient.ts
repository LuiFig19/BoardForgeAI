import { generationRequestSchema, type GenerationRequest } from '../data/models'

export type AiProvider = 'openrouter' | 'gemini'

export type BoardForgeAiRequest = {
  provider?: AiProvider
  model?: string
  request: GenerationRequest
  instruction?: string
}

export type BoardForgeAiResponse = {
  provider: AiProvider
  model: string
  content: string
  raw?: unknown
}

export async function generateBoardPlan(input: BoardForgeAiRequest): Promise<BoardForgeAiResponse> {
  const parsedRequest = generationRequestSchema.parse(input.request)
  const response = await fetch('/api/ai/board-plan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...input,
      request: parsedRequest,
    }),
  })

  const payload = await response.json().catch(() => null)

  if (!response.ok) {
    const message = payload?.error || 'AI generation failed'
    throw new Error(message)
  }

  return payload as BoardForgeAiResponse
}
