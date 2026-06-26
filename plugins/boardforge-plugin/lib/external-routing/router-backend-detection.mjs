import { existsSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import path from 'node:path'

export function detectJavaRuntime(candidates = []) {
  const found = candidates.find((candidate) => candidate?.path && existsSync(candidate.path))
  return found ? { found: true, ...found } : { found: false, path: null, version: null }
}

export function detectFreerouting(candidates = []) {
  const found = candidates.find((candidate) => candidate?.path && existsSync(candidate.path))
  return found ? { found: true, ...found } : { found: false, path: null, version: null }
}

export async function findFilesByName(searchRoots = [], patterns = [], { maxDepth = 4 } = {}) {
  const matches = []
  for (const root of searchRoots.filter(Boolean)) {
    matches.push(...await walk(root, patterns, maxDepth))
  }
  return matches
}

async function walk(root, patterns, maxDepth, depth = 0) {
  if (depth > maxDepth || !existsSync(root)) return []
  let entries = []
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch {
    return []
  }
  const out = []
  for (const entry of entries) {
    const full = path.join(root, entry.name)
    if (entry.isFile() && patterns.some((pattern) => pattern.test(entry.name))) out.push(full)
    if (entry.isDirectory() && !/node_modules|\.git|AppData|Windows/i.test(full)) out.push(...await walk(full, patterns, maxDepth, depth + 1))
  }
  return out
}

export function summarizeBackendDetection({ java = {}, freerouting = {}, workflow = {} } = {}) {
  const runnable = Boolean(java.found && freerouting.found && workflow.selectedWorkflow)
  return {
    runnable,
    javaFound: Boolean(java.found),
    freeroutingFound: Boolean(freerouting.found),
    selectedWorkflow: workflow.selectedWorkflow || null,
    missing: [
      !java.found && 'java',
      !freerouting.found && 'freerouting',
      !workflow.selectedWorkflow && 'dsn_ses_workflow',
    ].filter(Boolean),
  }
}
