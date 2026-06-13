import type { Metadata } from 'next'
import '../src/index.css'
import '../src/App.css'

export const metadata: Metadata = {
  title: 'BoardForge AI',
  description: 'KiCad-first AI PCB generation cockpit.',
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
