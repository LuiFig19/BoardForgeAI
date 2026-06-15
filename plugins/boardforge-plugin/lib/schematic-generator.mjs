import crypto from 'node:crypto'
import { assignNetsToClasses } from './net-classes.mjs'

export function generateSchematicModel(board, components = [], input = {}) {
  const nets = assignNetsToClasses(normalizeNets(input.nets, components))
  const symbols = components.map((component, index) => ({
    ref: component.ref,
    value: component.value || component.group || 'component',
    symbol: component.symbol?.libId || component.symbol || null,
    footprint: component.footprint?.libId || component.footprint || null,
    at: { x: 25 + (index % 3) * 45, y: 35 + Math.floor(index / 3) * 32 },
    pinMap: component.pinMap || {},
    uuid: crypto.randomUUID(),
  }))
  return {
    status: symbols.every((item) => item.symbol && item.footprint) ? 'SCHEMATIC_MODEL_READY_NEEDS_ERC' : 'SCHEMATIC_MODEL_NEEDS_ASSET_REVIEW',
    boardName: board.name,
    symbols,
    nets,
    powerSymbols: [...new Set(nets.filter((net) => /^(GND|3V3|5V|VIN|VBAT|VUSB)$/i.test(net.name)).map((net) => net.name))],
    warnings: ['Native KiCad symbol placement is still review-required; run ERC after generation.'],
    humanReviewRequired: true,
  }
}

export function kicadSchematicFromModel(board, schematicModel) {
  const symbolText = schematicModel.symbols.map((symbol) => [
    `\t(text "${safe(`${symbol.ref} ${symbol.value}`)}"`,
    `\t\t(at ${symbol.at.x} ${symbol.at.y} 0)`,
    '\t\t(effects (font (size 1.27 1.27)) (justify left bottom))',
    `\t\t(uuid "${symbol.uuid}")`,
    '\t)',
    `\t(text "${safe(`SYM ${symbol.symbol || 'MISSING'} | FP ${symbol.footprint || 'MISSING'}`)}"`,
    `\t\t(at ${symbol.at.x} ${symbol.at.y + 4} 0)`,
    '\t\t(effects (font (size 0.9 0.9)) (justify left bottom))',
    `\t\t(uuid "${crypto.randomUUID()}")`,
    '\t)',
  ].join('\n')).join('\n')
  const netText = schematicModel.nets.map((net, index) => `\t(text "${safe(`NET ${net.name} -> ${net.className}`)}"\n\t\t(at 25 ${160 + index * 4} 0)\n\t\t(effects (font (size 0.9 0.9)) (justify left bottom))\n\t\t(uuid "${crypto.randomUUID()}")\n\t)`).join('\n')
  return `(kicad_sch
\t(version 20250114)
\t(generator "BoardForge Plugin CLI")
\t(generator_version "0.1.0")
\t(uuid "${crypto.randomUUID()}")
\t(paper "A4")
\t(title_block
\t\t(title "${safe(board.name)}")
\t\t(company "BoardForge AI")
\t\t(comment 1 "BoardForge schematic model. ERC and human review required.")
\t)
\t(lib_symbols)
${symbolText}
${netText}
\t(sheet_instances
\t\t(path "/" (page "1"))
\t)
\t(embedded_fonts no)
)
`
}

function normalizeNets(nets = [], components = []) {
  const fromPins = components.flatMap((component) => Object.values(component.pinMap || {}).filter(Boolean).map((name) => ({ name })))
  const base = nets.length ? nets : fromPins
  return [...new Map(base.map((net) => [net.name, net])).values()]
}

function safe(value) {
  return String(value || '').replace(/"/g, "'")
}
