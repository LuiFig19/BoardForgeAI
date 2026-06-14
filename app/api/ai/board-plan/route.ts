import { NextResponse } from 'next/server'
import { z } from 'zod'
import { generationRequestSchema } from '../../../../src/data/models'

export const runtime = 'nodejs'

const payloadSchema = z.object({
  provider: z.enum(['openrouter', 'gemini']).optional(),
  model: z.string().min(2).optional(),
  instruction: z.string().max(4000).optional(),
  request: generationRequestSchema,
})

const systemPrompt = [
  'You are BoardForge AI, a cautious PCB product architect and EDA planning agent.',
  'Return implementation-ready PCB planning guidance, not final manufacturing claims.',
  'Respect KiCad/JLCPCB constraints, real footprints, board shape, mounting holes, keepouts, connector edge placement, power tree, differential pairs, and human review requirements.',
  'If a placement would overlap, move it before describing the render or board plan.',
  'Use structured sections: requirements, board outline, parts, placement, routing, validation risks, next deterministic build steps.',
].join(' ')

function requestToPrompt(request: z.infer<typeof generationRequestSchema>, instruction?: string) {
  return [
    instruction ? `User instruction: ${instruction}` : 'User instruction: Generate a PCB architecture plan.',
    `Project: ${request.projectName}`,
    `Board type: ${request.boardType}`,
    `Board shape: ${request.boardShape}, ${request.boardWidthMm} mm x ${request.boardHeightMm} mm, ${request.mountingHoleCount} mounting holes`,
    `Layers: ${request.layerCount}, CAD: ${request.targetCad}, manufacturer: ${request.manufacturer}, assembly: ${request.assemblyTarget}`,
    `MCU: ${request.mcu || 'not specified'}`,
    `Sensors: ${request.sensors || 'not specified'}`,
    `Connectors: ${request.connectors || 'not specified'}`,
    `Power input: ${request.powerInput || 'not specified'}`,
    `Rails: ${request.outputRails || 'not specified'}`,
    `Interfaces: ${request.interfaces.join(', ') || 'none specified'}`,
    `Mechanical constraints: ${request.mechanicalConstraints || 'none specified'}`,
    `Keepouts: ${request.keepouts || 'none specified'}`,
    `High speed constraints: ${request.highSpeedConstraints || 'none specified'}`,
    `Outline notes: ${request.outlineNotes || 'none specified'}`,
    `Placement marks: ${JSON.stringify(request.placementMarks)}`,
    `Priority: ${request.priority}`,
    `Notes: ${request.notes}`,
  ].join('\n')
}

async function callOpenRouter(model: string, prompt: string) {
  const apiKey = process.env.OPENROUTER_API_KEY

  if (!apiKey) {
    return NextResponse.json({ error: 'Missing OPENROUTER_API_KEY on the server.' }, { status: 500 })
  }

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'HTTP-Referer': process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000',
      'X-Title': process.env.NEXT_PUBLIC_SITE_NAME || 'BoardForge AI',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt },
      ],
      temperature: 0.25,
    }),
  })

  const raw = await response.json().catch(() => null)

  if (!response.ok) {
    return NextResponse.json(
      { error: raw?.error?.message || 'OpenRouter request failed.', raw },
      { status: response.status },
    )
  }

  return NextResponse.json({
    provider: 'openrouter',
    model,
    content: raw?.choices?.[0]?.message?.content || '',
    raw,
  })
}

async function callGemini(model: string, prompt: string) {
  const apiKey = process.env.GEMINI_API_KEY

  if (!apiKey) {
    return NextResponse.json({ error: 'Missing GEMINI_API_KEY on the server.' }, { status: 500 })
  }

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.25 },
      }),
    },
  )

  const raw = await response.json().catch(() => null)

  if (!response.ok) {
    return NextResponse.json(
      { error: raw?.error?.message || 'Gemini request failed.', raw },
      { status: response.status },
    )
  }

  return NextResponse.json({
    provider: 'gemini',
    model,
    content: raw?.candidates?.[0]?.content?.parts?.map((part: { text?: string }) => part.text || '').join('\n') || '',
    raw,
  })
}

export async function POST(request: Request) {
  const json = await request.json().catch(() => null)
  const parsed = payloadSchema.safeParse(json)

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }

  const provider = parsed.data.provider || 'openrouter'
  const model =
    parsed.data.model ||
    (provider === 'gemini'
      ? process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite'
      : process.env.OPENROUTER_MODEL || 'deepseek/deepseek-chat-v3.1')
  const prompt = requestToPrompt(parsed.data.request, parsed.data.instruction)

  if (provider === 'gemini') {
    return callGemini(model, prompt)
  }

  return callOpenRouter(model, prompt)
}
