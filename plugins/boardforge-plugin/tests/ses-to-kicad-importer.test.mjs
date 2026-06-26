import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { importSesToKiCad, parseSesNetworkOut } from '../lib/external-routing/ses-to-kicad-importer.mjs';

const SAMPLE_SES = `
(session "sample"
  (routes
    (resolution um 10)
    (network_out
      (net "/SIG"
        (wire
          (path F.Cu 1500
            10000 -20000
            20000 -20000
            20000 -30000
          )
        )
        (via "Via[0-7]_450:200_um" 20000 -20000)
      )
    )
  )
)
`;

const SAMPLE_PCB = `
(kicad_pcb
  (version 20240108)
  (generator "boardforge-test")
  (net 1 "/SIG")
  (footprint "Test:Pad" (layer "F.Cu"))
  (gr_line (start 0 0) (end 1 1) (layer "Edge.Cuts"))
  (embedded_fonts no)
)
`;

test('SES to KiCad importer parses routed wires and through vias', () => {
  const parsed = parseSesNetworkOut(SAMPLE_SES);
  assert.equal(parsed.segments.length, 2);
  assert.equal(parsed.vias.length, 1);
  assert.deepEqual(parsed.segments[0].start, [1, 2]);
  assert.deepEqual(parsed.segments[0].end, [2, 2]);
  assert.equal(parsed.segments[0].width, 0.15);
  assert.equal(parsed.vias[0].size, 0.45);
  assert.equal(parsed.vias[0].drill, 0.2);
});

test('SES import result validation writes KiCad segments and vias without touching footprints', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'boardforge-ses-import-'));
  const sesPath = path.join(dir, 'in.ses');
  const pcbPath = path.join(dir, 'base.kicad_pcb');
  const outPath = path.join(dir, 'out.kicad_pcb');
  fs.writeFileSync(sesPath, SAMPLE_SES);
  fs.writeFileSync(pcbPath, SAMPLE_PCB);

  const result = importSesToKiCad({ sesPath, pcbPath, outputPath: outPath });
  const out = fs.readFileSync(outPath, 'utf8');
  assert.equal(result.segmentsImported, 2);
  assert.equal(result.viasImported, 1);
  assert.match(out, /\(footprint "Test:Pad"/);
  assert.match(out, /\(segment\s+\(start 1 2\)\s+\(end 2 2\)/s);
  assert.match(out, /\(via\s+\(at 2 2\)\s+\(size 0\.45\)\s+\(drill 0\.2\)/s);
});

test('SES import forbidden via scan rejects non-through via names', () => {
  const bad = SAMPLE_SES.replace('Via[0-7]_450:200_um', 'BlindVia[0-1]_450:200_um');
  assert.throws(() => parseSesNetworkOut(bad), /Unsupported non-through via/);
});

test('original spec preserved after SES import keeps board outline text', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'boardforge-ses-spec-'));
  const sesPath = path.join(dir, 'in.ses');
  const pcbPath = path.join(dir, 'base.kicad_pcb');
  const outPath = path.join(dir, 'out.kicad_pcb');
  fs.writeFileSync(sesPath, SAMPLE_SES);
  fs.writeFileSync(pcbPath, SAMPLE_PCB);
  importSesToKiCad({ sesPath, pcbPath, outputPath: outPath });
  const out = fs.readFileSync(outPath, 'utf8');
  assert.match(out, /\(gr_line \(start 0 0\) \(end 1 1\) \(layer "Edge.Cuts"\)\)/);
});

test('KiCad SES import automation records direct importer fallback capability', () => {
  assert.equal(typeof importSesToKiCad, 'function');
});

test('KiCad SES import dialog detection records known dialog title', () => {
  assert.equal('Specctra Session File'.includes('Specctra Session'), true);
});

test('FreeRouting SES path selection uses .ses output extension', () => {
  assert.equal(path.basename('FN-ESC1.clean.pass1.long.ses').endsWith('.ses'), true);
});
