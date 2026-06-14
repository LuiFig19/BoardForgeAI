import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

test('local server exposes status, KiCad status, and create project job', async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'boardforge-server-test-'))
  const port = 48000 + Math.floor(Math.random() * 1000)
  const child = spawn(process.execPath, ['./plugins/boardforge-plugin/bin/boardforge-server.mjs', '--port', String(port), '--workspace', workspace], {
    cwd: process.cwd(),
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  try {
    await waitForServer(port)
    const status = await getJson(`http://127.0.0.1:${port}/status`)
    assert.equal(status.status, 'ok')
    const kicad = await getJson(`http://127.0.0.1:${port}/kicad/status`)
    assert.equal(typeof kicad.available, 'boolean')
    const created = await postJson(`http://127.0.0.1:${port}/jobs/create-project`, {
      id: 'server_project',
      input: { projectName: 'Server Project', templateId: 'ESP32_S3_SENSOR' },
    })
    assert.equal(created.status, 'KICAD_PROJECT_CREATED_NEEDS_REVIEW')
    assert.equal(created.generatedFiles.some((file) => file.endsWith('.kicad_pcb')), true)
    const fetched = await getJson(`http://127.0.0.1:${port}/jobs/server_project`)
    assert.equal(fetched.status, 'KICAD_PROJECT_CREATED_NEEDS_REVIEW')
  } finally {
    child.kill('SIGTERM')
    await rm(workspace, { recursive: true, force: true })
  }
})

async function waitForServer(port) {
  const started = Date.now()
  while (Date.now() - started < 10000) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/status`)
      if (response.ok) return
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  }
  throw new Error('server did not start')
}

async function getJson(url) {
  const response = await fetch(url)
  assert.equal(response.ok, true)
  return response.json()
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  assert.equal(response.ok, true)
  return response.json()
}
