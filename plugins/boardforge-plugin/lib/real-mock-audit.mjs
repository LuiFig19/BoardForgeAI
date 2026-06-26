import { existsSync } from 'node:fs'
import { readdir, readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'

const auditPatterns = [
  { pattern: /\bmock\b/i, risk: 'mock behavior can be mistaken for real PCB evidence' },
  { pattern: /\bfake\b/i, risk: 'fake success/data must never drive readiness' },
  { pattern: /\bplaceholder\b/i, risk: 'placeholder engineering data may hide missing schematic or asset work' },
  { pattern: /\bstub\b/i, risk: 'stub implementation may not produce manufacturable output' },
  { pattern: /\bTODO\b/i, risk: 'unfinished implementation path' },
  { pattern: /diagnosticAllowIncomplete/i, risk: 'diagnostic bypass can allow incomplete generated artifacts' },
  { pattern: /continueOnBlocked/i, risk: 'blocked workflows can continue for evidence gathering only' },
]

const ignoredDirs = new Set(['node_modules', '.git', '.next', 'tmp', 'dist', 'build'])
const scannedExtensions = new Set(['.mjs', '.js', '.ts', '.tsx', '.json', '.md'])

export async function runRealVsMockAudit({ rootDir, outputDir }) {
  const findings = []
  await walk(rootDir, findings)
  const classified = findings.map(classifyFinding)
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    rootDir,
    findingCount: classified.length,
    highRiskCount: classified.filter((item) => item.severity === 'HIGH').length,
    mediumRiskCount: classified.filter((item) => item.severity === 'MEDIUM').length,
    lowRiskCount: classified.filter((item) => item.severity === 'LOW').length,
    findings: classified,
  }
  const mdFile = path.join(outputDir, 'BoardForge Real vs Mock Audit.md')
  const jsonFile = path.join(outputDir, 'boardforge-real-vs-mock-audit.json')
  await writeFile(mdFile, markdownAudit(report), 'utf8')
  await writeFile(jsonFile, JSON.stringify(report, null, 2), 'utf8')
  return { report, files: { mdFile, jsonFile } }
}

async function walk(dir, findings) {
  if (!existsSync(dir)) return
  for (const name of await readdir(dir)) {
    if (ignoredDirs.has(name)) continue
    const file = path.join(dir, name)
    const info = await stat(file)
    if (info.isDirectory()) {
      await walk(file, findings)
      continue
    }
    if (!scannedExtensions.has(path.extname(name))) continue
    const content = await readFile(file, 'utf8')
    const lines = content.split(/\r?\n/)
    lines.forEach((line, index) => {
      const match = auditPatterns.find((entry) => entry.pattern.test(line))
      if (match) findings.push({ file, line: index + 1, text: line.trim().slice(0, 240), risk: match.risk })
    })
  }
}

function classifyFinding(finding) {
  const text = finding.text.toLowerCase()
  const file = finding.file.toLowerCase()
  let severity = 'LOW'
  let fixApplied = 'Not automatically changed; surfaced for readiness/reporting so it cannot be treated as proof.'
  let remainingTodo = 'Review whether this is test-only, report-only, or needs replacement with real implementation.'
  if (/fake|diagnosticallowincomplete|continueonblocked/.test(text)) severity = 'HIGH'
  else if (/placeholder|stub|mock/.test(text)) severity = 'MEDIUM'
  if (/test|fixture|report|audit/.test(file)) {
    severity = severity === 'HIGH' ? 'MEDIUM' : 'LOW'
    remainingTodo = 'Keep if this is explicitly test/report language; otherwise replace with real execution evidence.'
  }
  if (/components\.mjs/.test(file) && /placeholder/.test(text)) {
    severity = 'HIGH'
    remainingTodo = 'Replace category placeholder components with real symbol/footprint-backed component definitions.'
  }
  return { ...finding, severity, fixApplied, remainingTodo }
}

function markdownAudit(report) {
  const lines = [
    '# BoardForge Real vs Mock Audit',
    '',
    `Generated: ${report.generatedAt}`,
    `Findings: ${report.findingCount}`,
    `High risk: ${report.highRiskCount}`,
    `Medium risk: ${report.mediumRiskCount}`,
    `Low risk: ${report.lowRiskCount}`,
    '',
    '## Findings',
    '',
    '| Severity | File | Line | Mocked / scaffolded behavior | Risk | Fix applied | Remaining TODO |',
    '| --- | --- | ---: | --- | --- | --- | --- |',
  ]
  for (const item of report.findings) {
    lines.push(`| ${item.severity} | ${escapeMd(item.file)} | ${item.line} | ${escapeMd(item.text)} | ${escapeMd(item.risk)} | ${escapeMd(item.fixApplied)} | ${escapeMd(item.remainingTodo)} |`)
  }
  if (!report.findings.length) lines.push('| INFO | n/a | 0 | No suspicious mock/scaffold terms found. | n/a | n/a | n/a |')
  return `${lines.join('\n')}\n`
}

function escapeMd(value) {
  return String(value ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ')
}
