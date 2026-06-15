import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

test('MCP server exposes BoardForge tools and runs controlled jobs', async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'boardforge-mcp-test-'))
  const child = spawn(process.execPath, ['./plugins/boardforge-plugin/bin/boardforge-mcp.mjs', '--workspace', workspace], {
    cwd: process.cwd(),
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  const client = createJsonRpcClient(child)
  try {
    const initialized = await client.request('initialize', {})
    assert.equal(initialized.serverInfo.name, 'boardforge-plugin')
    assert.equal(initialized.capabilities.tools instanceof Object, true)

    const listed = await client.request('tools/list', {})
    assert.equal(listed.tools.some((tool) => tool.name === 'create_outline_board'), true)
    assert.equal(listed.tools.some((tool) => tool.name === 'resolve_component_assets'), true)
    assert.equal(listed.tools.some((tool) => tool.name === 'generate_schematic'), true)
    assert.equal(listed.tools.some((tool) => tool.name === 'interactive_edit'), true)
    assert.equal(listed.tools.some((tool) => tool.name === 'audit_component_library'), true)
    assert.equal(listed.tools.some((tool) => tool.name === 'run_project_preflight'), true)
    assert.equal(listed.tools.some((tool) => tool.name === 'add_ground_zone'), true)
    assert.equal(listed.tools.some((tool) => tool.name === 'apply_routing_plan'), true)
    assert.equal(listed.tools.some((tool) => tool.name === 'snapshot_project'), true)

    const status = await client.request('tools/call', { name: 'status', arguments: {} })
    const statusPayload = JSON.parse(status.content[0].text)
    assert.equal(statusPayload.status, 'ok')
    assert.equal(statusPayload.workspace, workspace)

    const outline = await client.request('tools/call', {
      name: 'create_outline_board',
      arguments: {
        id: 'mcp_outline',
        input: { projectName: 'MCP Outline', widthMm: 42, heightMm: 28, shape: 'rounded_rectangle' },
      },
    })
    const outlinePayload = JSON.parse(outline.content[0].text)
    assert.equal(outlinePayload.status, 'OUTLINE_GENERATED_NEEDS_REVIEW')
    assert.equal(outlinePayload.generatedFiles.some((file) => file.endsWith('.kicad_pcb')), true)
    const snapshot = await client.request('tools/call', {
      name: 'snapshot_project',
      arguments: { id: 'mcp_snapshot', input: { projectPath: 'mcp-outline', label: 'mcp-smoke' } },
    })
    const snapshotPayload = JSON.parse(snapshot.content[0].text)
    assert.equal(snapshotPayload.status, 'PROJECT_SNAPSHOT_CREATED')
    const diff = await client.request('tools/call', {
      name: 'diff_project_snapshot',
      arguments: { id: 'mcp_diff', input: { projectPath: 'mcp-outline', snapshotId: snapshotPayload.snapshot.id } },
    })
    const diffPayload = JSON.parse(diff.content[0].text)
    assert.equal(diffPayload.status, 'PROJECT_DIFF_NO_CHANGES')
  } finally {
    child.kill('SIGTERM')
    await rm(workspace, { recursive: true, force: true })
  }
})

function createJsonRpcClient(child) {
  let nextId = 1
  let buffer = ''
  const pending = new Map()
  const stderr = []

  child.stderr.on('data', (chunk) => stderr.push(chunk.toString()))
  child.stdout.on('data', (chunk) => {
    buffer += chunk.toString()
    let newline = buffer.indexOf('\n')
    while (newline !== -1) {
      const line = buffer.slice(0, newline).trim()
      buffer = buffer.slice(newline + 1)
      if (line) resolveLine(line, pending)
      newline = buffer.indexOf('\n')
    }
  })
  child.on('exit', (code) => {
    for (const { reject } of pending.values()) reject(new Error(`MCP process exited ${code}: ${stderr.join('')}`))
    pending.clear()
  })

  return {
    request(method, params) {
      const id = nextId++
      const payload = { jsonrpc: '2.0', id, method, params }
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject })
        child.stdin.write(`${JSON.stringify(payload)}\n`)
        setTimeout(() => {
          if (!pending.has(id)) return
          pending.delete(id)
          reject(new Error(`Timed out waiting for MCP response to ${method}: ${stderr.join('')}`))
        }, 10000).unref()
      })
    },
  }
}

function resolveLine(line, pending) {
  const message = JSON.parse(line)
  const waiter = pending.get(message.id)
  if (!waiter) return
  pending.delete(message.id)
  if (message.error) waiter.reject(new Error(message.error.message))
  else waiter.resolve(message.result)
}
