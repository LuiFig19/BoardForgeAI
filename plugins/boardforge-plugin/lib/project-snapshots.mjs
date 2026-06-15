import { existsSync } from 'node:fs'
import { copyFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
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
