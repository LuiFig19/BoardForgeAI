import { Cpu, FileArchive, FolderKanban, Gauge, Home, Lock, Plug, ScrollText, Settings, TerminalSquare, WandSparkles } from 'lucide-react'
import clsx from 'clsx'

const nav = [
  { hash: '#/', label: 'Landing', icon: Home },
  { hash: '#/generate', label: 'Generator', icon: WandSparkles },
  { hash: '#/boards', label: 'Boards', icon: FolderKanban },
  { hash: '#/project', label: 'Projects', icon: Cpu },
  { hash: '#/plugin', label: 'Plugin', icon: Plug },
  { hash: '#/dashboard', label: 'Dashboard', icon: Gauge },
  { hash: '#/export', label: 'Export', icon: FileArchive },
  { hash: '#/logs', label: 'Run Log', icon: TerminalSquare },
  { hash: '#/pricing', label: 'Pricing', icon: Lock },
  { hash: '#/docs', label: 'Docs', icon: ScrollText },
  { hash: '#/admin', label: 'Admin', icon: Settings },
]

export function Layout({ route, children }: { route: string; children: React.ReactNode }) {
  return (
    <div className="app-shell">
      <header className="topbar">
        <a href="#/" className="brand" aria-label="BoardForge AI home">
          <span className="brand-mark">BF</span>
          <span>
            <strong>BoardForge AI</strong>
            <small>Codex + KiCad command center</small>
          </span>
        </a>
        <nav className="nav-rail" aria-label="Primary navigation">
          {nav.map((item) => {
            const Icon = item.icon
            return (
              <a key={item.hash} className={clsx('nav-item', route === item.hash.replace('#', '') && 'active')} href={item.hash} title={item.label}>
                <Icon size={16} />
                <span>{item.label}</span>
              </a>
            )
          })}
        </nav>
      </header>
      {children}
    </div>
  )
}

export function WarningBanner() {
  return (
    <div className="warning-banner">
      AI-generated hardware must be reviewed by a qualified human before manufacturing or safety-critical use.
    </div>
  )
}

export function StatusBadge({ children, tone = 'cyan' }: { children: React.ReactNode; tone?: 'cyan' | 'amber' | 'red' | 'green' | 'muted' }) {
  return <span className={`status-badge ${tone}`}>{children}</span>
}
