import fs from 'node:fs';
import crypto from 'node:crypto';

const COPPER_LAYERS = new Set(['F.Cu', 'In1.Cu', 'In2.Cu', 'In3.Cu', 'In4.Cu', 'In5.Cu', 'In6.Cu', 'B.Cu']);

function tokenizeSpecctra(text) {
  const tokens = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }
    if (ch === '(' || ch === ')') {
      tokens.push(ch);
      i += 1;
      continue;
    }
    if (ch === '"') {
      let s = '';
      i += 1;
      while (i < text.length) {
        if (text[i] === '\\') {
          s += text[i + 1] ?? '';
          i += 2;
          continue;
        }
        if (text[i] === '"') {
          i += 1;
          break;
        }
        s += text[i];
        i += 1;
      }
      tokens.push(s);
      continue;
    }
    let s = '';
    while (i < text.length && !/\s|\(|\)/.test(text[i])) {
      s += text[i];
      i += 1;
    }
    tokens.push(s);
  }
  return tokens;
}

function parseExpr(tokens) {
  let i = 0;
  function read() {
    const tok = tokens[i++];
    if (tok !== '(') return tok;
    const list = [];
    while (i < tokens.length && tokens[i] !== ')') list.push(read());
    if (tokens[i] !== ')') throw new Error('Unclosed Specctra expression');
    i += 1;
    return list;
  }
  return read();
}

function findChild(expr, name) {
  if (!Array.isArray(expr)) return null;
  return expr.find((child) => Array.isArray(child) && child[0] === name) ?? null;
}

function findDescendant(expr, name) {
  if (!Array.isArray(expr)) return null;
  if (expr[0] === name) return expr;
  for (const child of expr) {
    const found = findDescendant(child, name);
    if (found) return found;
  }
  return null;
}

function coordToMm(value) {
  return Number(value) / 10000;
}

function sesPointToKiCad(x, y) {
  return [coordToMm(x), -coordToMm(y)];
}

function fmt(n) {
  return Number(n).toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
}

function uuid() {
  return crypto.randomUUID();
}

function layerFromViaName(name) {
  if (!String(name).includes('[0-7]')) {
    throw new Error(`Unsupported non-through via type in SES: ${name}`);
  }
  return ['F.Cu', 'B.Cu'];
}

function viaSizeFromName(name) {
  const m = String(name).match(/_(\d+):(\d+)_um/);
  if (!m) return { size: 0.45, drill: 0.2 };
  return { size: Number(m[1]) / 1000, drill: Number(m[2]) / 1000 };
}

export function parseSesNetworkOut(sesText) {
  const ast = parseExpr(tokenizeSpecctra(sesText));
  const network = findDescendant(ast, 'network_out');
  if (!network) throw new Error('SES network_out section not found');

  const segments = [];
  const vias = [];
  for (const netExpr of network.slice(1)) {
    if (!Array.isArray(netExpr) || netExpr[0] !== 'net') continue;
    const net = String(netExpr[1]);
    for (const item of netExpr.slice(2)) {
      if (!Array.isArray(item)) continue;
      if (item[0] === 'wire') {
        const path = findChild(item, 'path');
        if (!path) continue;
        const layer = String(path[1]);
        if (!COPPER_LAYERS.has(layer)) throw new Error(`Unsupported SES layer: ${layer}`);
        const width = Number(path[2]) / 10000;
        const coords = path.slice(3).map(Number);
        if (coords.length < 4 || coords.length % 2 !== 0) continue;
        for (let i = 0; i < coords.length - 2; i += 2) {
          const [sx, sy] = sesPointToKiCad(coords[i], coords[i + 1]);
          const [ex, ey] = sesPointToKiCad(coords[i + 2], coords[i + 3]);
          if (sx === ex && sy === ey) continue;
          segments.push({ net, layer, width, start: [sx, sy], end: [ex, ey] });
        }
      }
      if (item[0] === 'via') {
        const viaName = String(item[1]);
        const [x, y] = sesPointToKiCad(item[2], item[3]);
        const { size, drill } = viaSizeFromName(viaName);
        const layers = layerFromViaName(viaName);
        vias.push({ net, at: [x, y], size, drill, layers });
      }
    }
  }
  return { segments, vias };
}

function buildKiCadItems({ segments, vias }) {
  const lines = [];
  for (const s of segments) {
    lines.push(`\t(segment`);
    lines.push(`\t\t(start ${fmt(s.start[0])} ${fmt(s.start[1])})`);
    lines.push(`\t\t(end ${fmt(s.end[0])} ${fmt(s.end[1])})`);
    lines.push(`\t\t(width ${fmt(s.width)})`);
    lines.push(`\t\t(layer "${s.layer}")`);
    lines.push(`\t\t(net "${s.net}")`);
    lines.push(`\t\t(uuid "${uuid()}")`);
    lines.push(`\t)`);
  }
  for (const v of vias) {
    lines.push(`\t(via`);
    lines.push(`\t\t(at ${fmt(v.at[0])} ${fmt(v.at[1])})`);
    lines.push(`\t\t(size ${fmt(v.size)})`);
    lines.push(`\t\t(drill ${fmt(v.drill)})`);
    lines.push(`\t\t(layers "${v.layers[0]}" "${v.layers[1]}")`);
    lines.push(`\t\t(net "${v.net}")`);
    lines.push(`\t\t(uuid "${uuid()}")`);
    lines.push(`\t)`);
  }
  return `${lines.join('\n')}\n`;
}

export function importSesToKiCad({ sesPath, pcbPath, outputPath }) {
  const sesText = fs.readFileSync(sesPath, 'utf8');
  const pcbText = fs.readFileSync(pcbPath, 'utf8');
  const parsed = parseSesNetworkOut(sesText);
  const items = buildKiCadItems(parsed);
  const markerMatch = [...pcbText.matchAll(/\n\s*\(embedded_fonts\b/g)].at(-1);
  const idx = markerMatch?.index ?? -1;
  if (idx < 0) throw new Error('KiCad insertion marker not found: embedded_fonts');
  const routedText = `${pcbText.slice(0, idx)}\n${items}${pcbText.slice(idx)}`;
  fs.writeFileSync(outputPath, routedText, 'utf8');
  return {
    outputPath,
    segmentsImported: parsed.segments.length,
    viasImported: parsed.vias.length,
  };
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))) {
  const [, , sesPath, pcbPath, outputPath] = process.argv;
  if (!sesPath || !pcbPath || !outputPath) {
    console.error('Usage: node ses-to-kicad-importer.mjs <input.ses> <base.kicad_pcb> <output.kicad_pcb>');
    process.exit(2);
  }
  console.log(JSON.stringify(importSesToKiCad({ sesPath, pcbPath, outputPath }), null, 2));
}
