import { existsSync } from 'node:fs'
import { copyFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import crypto from 'node:crypto'
import path from 'node:path'

const snapshotRootName = '.boardforge'
const snapshotDirName = 'snapshots'
const snapshotFileGlobs = [
  /\.kicad_(pro|pcb|sch)$/i,
  /^boardforge-.*\.json$/i,
  /^README\.md$/i,
]

export async function createProjectSnapshot(projectDir, input = {}) {
  const root = safeResolve(projectDir, '.')
  if (!existsSync(root)) throw new Error(`Project directory does not exist: ${root}`)
  const id = safeSnapshotId(input.snapshotId || `${new Date().toISOString().replace(/[:.]/g, '-')}-${input.label || 'snapshot'}`)
  const target = safeResolve(root, path.join(snapshotRootName, snapshotDirName, id))
  const files = await collectSnapshotFiles(root)
  await mkdir(target, { recursive: true })
  for (const file of files) {
    const relative = path.relative(root, file)
    const destination = safeResolve(target, relative)
    await mkdir(path.dirname(destination), { recursive: true })
    await copyFile(file, destination)
  }
  const manifest = {
    id,
    label: String(input.label || 'BoardForge project snapshot').slice(0, 80),
    projectDir: root,
    createdAt: new Date().toISOString(),
    fileCount: files.length,
    files: files.map((file) => path.relative(root, file).replace(/\\/g, '/')),
    restorePolicy: 'Only files listed in this manifest are restored. Snapshot metadata is never copied over project files.',
  }
  await writeFile(path.join(target, 'snapshot.json'), JSON.stringify(manifest, null, 2), 'utf8')
  return { status: 'PROJECT_SNAPSHOT_CREATED', snapshot: manifest, snapshotPath: target }
}

export async function listProjectSnapshots(projectDir) {
  const root = safeResolve(projectDir, '.')
  const snapshotsRoot = safeResolve(root, path.join(snapshotRootName, snapshotDirName))
  if (!existsSync(snapshotsRoot)) return []
  const entries = await readdir(snapshotsRoot, { withFileTypes: true })
  const snapshots = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const manifestPath = safeResolve(snapshotsRoot, path.join(entry.name, 'snapshot.json'))
    try {
      snapshots.push(JSON.parse(await readFile(manifestPath, 'utf8')))
    } catch {
      snapshots.push({ id: entry.name, status: 'SNAPSHOT_MANIFEST_UNREADABLE' })
    }
  }
  return snapshots.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
}

export async function restoreProjectSnapshot(projectDir, snapshotId) {
  const root = safeResolve(projectDir, '.')
  const id = safeSnapshotId(snapshotId)
  const source = safeResolve(root, path.join(snapshotRootName, snapshotDirName, id))
  const manifestPath = safeResolve(source, 'snapshot.json')
  if (!existsSync(manifestPath)) throw new Error(`Snapshot not found: ${id}`)
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  const restored = []
  for (const relative of manifest.files || []) {
    const from = safeResolve(source, relative)
    const to = safeResolve(root, relative)
    if (!existsSync(from)) continue
    await mkdir(path.dirname(to), { recursive: true })
    await copyFile(from, to)
    restored.push(relative)
  }
  return {
    status: 'PROJECT_SNAPSHOT_RESTORED_NEEDS_REVIEW',
    snapshot: manifest,
    restoredFiles: restored,
    humanReviewRequired: true,
  }
}

export async function diffProjectSnapshot(projectDir, snapshotId, input = {}) {
  const root = safeResolve(projectDir, '.')
  const id = safeSnapshotId(snapshotId)
  const source = safeResolve(root, path.join(snapshotRootName, snapshotDirName, id))
  const manifestPath = safeResolve(source, 'snapshot.json')
  if (!existsSync(manifestPath)) throw new Error(`Snapshot not found: ${id}`)
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  const maxPreviewLines = Number(input.maxPreviewLines || 80)
  const fileDiffs = []
  for (const relative of manifest.files || []) {
    const beforePath = safeResolve(source, relative)
    const afterPath = safeResolve(root, relative)
    const before = existsSync(beforePath) ? await readFile(beforePath, 'utf8') : ''
    const after = existsSync(afterPath) ? await readFile(afterPath, 'utf8') : ''
    const beforeHash = sha256(before)
    const afterHash = existsSync(afterPath) ? sha256(after) : null
    const status = !existsSync(afterPath) ? 'deleted' : beforeHash === afterHash ? 'unchanged' : 'modified'
    fileDiffs.push({
      path: relative,
      status,
      beforeHash,
      afterHash,
      beforeLines: lineCount(before),
      afterLines: existsSync(afterPath) ? lineCount(after) : 0,
      summary: summarizeLineDelta(before, after),
      preview: status === 'modified' ? diffPreview(before, after, maxPreviewLines) : [],
    })
  }
  const currentFiles = await collectSnapshotFiles(root)
  const manifestSet = new Set((manifest.files || []).map((file) => file.replace(/\\/g, '/')))
  for (const file of currentFiles) {
    const relative = path.relative(root, file).replace(/\\/g, '/')
    if (manifestSet.has(relative)) continue
    const after = await readFile(file, 'utf8')
    fileDiffs.push({
      path: relative,
      status: 'added',
      beforeHash: null,
      afterHash: sha256(after),
      beforeLines: 0,
      afterLines: lineCount(after),
      summary: { addedLines: lineCount(after), removedLines: 0, changed: true },
      preview: after.split(/\r?\n/).slice(0, maxPreviewLines).map((line) => `+ ${line}`),
    })
  }
  const changedFiles = fileDiffs.filter((file) => file.status !== 'unchanged')
  return {
    status: changedFiles.length ? 'PROJECT_DIFF_HAS_CHANGES_NEEDS_REVIEW' : 'PROJECT_DIFF_NO_CHANGES',
    snapshot: manifest,
    changedFiles: changedFiles.length,
    files: fileDiffs,
    totals: {
      added: fileDiffs.filter((file) => file.status === 'added').length,
      modified: fileDiffs.filter((file) => file.status === 'modified').length,
      deleted: fileDiffs.filter((file) => file.status === 'deleted').length,
      unchanged: fileDiffs.filter((file) => file.status === 'unchanged').length,
      addedLines: fileDiffs.reduce((sum, file) => sum + file.summary.addedLines, 0),
      removedLines: fileDiffs.reduce((sum, file) => sum + file.summary.removedLines, 0),
    },
    humanReviewRequired: changedFiles.length > 0,
  }
}

async function collectSnapshotFiles(root) {
  const entries = await readdir(root, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    if (entry.name === snapshotRootName) continue
    const full = safeResolve(root, entry.name)
    if (entry.isDirectory()) continue
    if (snapshotFileGlobs.some((pattern) => pattern.test(entry.name))) files.push(full)
  }
  return files
}

function safeResolve(root, target) {
  const base = path.resolve(root)
  const resolved = path.resolve(base, target)
  if (resolved !== base && !resolved.startsWith(base + path.sep)) throw new Error(`Refusing snapshot path outside project: ${target}`)
  return resolved
}

function safeSnapshotId(value) {
  const id = String(value || '').trim().replace(/[^a-zA-Z0-9_.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 96)
  if (!id || id === '.' || id === '..') throw new Error('Snapshot id is empty or unsafe.')
  return id
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function lineCount(value) {
  if (!value) return 0
  return value.split(/\r?\n/).length
}

function summarizeLineDelta(before, after) {
  const beforeLines = before.split(/\r?\n/)
  const afterLines = after.split(/\r?\n/)
  const beforeCounts = countLines(beforeLines)
  const afterCounts = countLines(afterLines)
  let addedLines = 0
  let removedLines = 0
  for (const [line, count] of afterCounts) addedLines += Math.max(0, count - (beforeCounts.get(line) || 0))
  for (const [line, count] of beforeCounts) removedLines += Math.max(0, count - (afterCounts.get(line) || 0))
  return { addedLines, removedLines, changed: addedLines > 0 || removedLines > 0 }
}

function countLines(lines) {
  const counts = new Map()
  for (const line of lines) counts.set(line, (counts.get(line) || 0) + 1)
  return counts
}

function diffPreview(before, after, maxLines) {
  const beforeLines = before.split(/\r?\n/)
  const afterLines = after.split(/\r?\n/)
  const max = Math.max(beforeLines.length, afterLines.length)
  const preview = []
  for (let index = 0; index < max && preview.length < maxLines; index += 1) {
    if (beforeLines[index] === afterLines[index]) continue
    if (beforeLines[index] !== undefined) preview.push(`- ${beforeLines[index]}`)
    if (afterLines[index] !== undefined && preview.length < maxLines) preview.push(`+ ${afterLines[index]}`)
  }
  return preview
}
