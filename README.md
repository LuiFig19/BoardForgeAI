# BoardForge AI

BoardForge AI is the web command center for AI-assisted KiCad hardware design. The product is now explicitly plugin-first:

```text
User in Codex
↓
BoardForge Codex Plugin
↓
BoardForge local MCP/tool server or CLI helper
↓
Whitelisted KiCad automation tools
↓
Real local KiCad project files
↓
DRC/ERC/export reports
↓
Gerbers, BOM, CPL, KiCad ZIP, JLCPCB package
```

The website handles marketing, accounts, project libraries, board templates, saved specs, plugin onboarding, dashboards, reports, pricing, docs, and board/outline libraries. The BoardForge Codex Plugin and local helper are the execution engine for real KiCad file edits and manufacturing exports.

## Local Development

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Environment Variables

Copy `.env.example` to `.env.local` for local development, then add your own rotated keys:

```bash
OPENROUTER_API_KEY=
OPENROUTER_MODEL=deepseek/deepseek-chat-v3.1

GEMINI_API_KEY=
GEMINI_MODEL=gemini-2.5-flash-lite

NEXT_PUBLIC_SITE_URL=http://localhost:3000
NEXT_PUBLIC_SITE_NAME=BoardForge AI
```

Never commit `.env.local` or raw API keys. Keys must be configured in Vercel as environment variables for production.

## AI API

The app exposes a server-only route at:

```text
POST /api/ai/board-plan
```

The browser sends project requirements to this route. The route calls either OpenRouter or Gemini from the server so provider API keys never ship to the client.

Default provider/model:

- OpenRouter: `deepseek/deepseek-chat-v3.1`
- Gemini fallback/intake: `gemini-2.5-flash-lite`

## BoardForge Plugin MVP

The Codex plugin source lives in:

```text
plugins/boardforge-plugin
```

The CLI MVP accepts structured JSON jobs. It now includes real engineering scaffolding for:

- outline-only KiCad project generation
- KiCad project scaffolds with `.kicad_sch`, `.kicad_pcb`, and `.kicad_pro`
- persistent `boardforge-project.json` state for requirements, board outline, components, library matches, validation reports, exports, generated files, and job history
- controlled project snapshots, snapshot listing, and restore-before-review rollback for generated KiCad work
- snapshot diff reports that show added/modified/deleted KiCad and BoardForge files before restore/export decisions
- project preflight reports that aggregate scan, component audit, binding validation, netlist, manufacturing readiness, and optional snapshot diff gates
- workflow presets that give Codex ordered BoardForge-controlled steps for common ESP32, PoE, and drone controller boards
- manufacturing manifest generation that collects required KiCad, BoardForge, validation, BOM, CPL, and fab artifacts before handoff
- requirements planner that expands constrained prompts into reusable circuit blocks, BOM components, nets, and design constraints
- stackup and complex-board planner for 2/4/6/8+ layer boards, HDI review, blind/buried/microvia policy, impedance intent, copper strategy, and thermal/RF keepouts
- deterministic placement of real KiCad footprints from installed libraries
- KiCad library indexing for installed KiCad symbols, footprints, and 3D models
- component asset resolution for symbols, footprints, and 3D model candidates
- richer built-in component database defaults for ESP32, USB-C, RJ45, IMU, barometer, SPI flash, Ethernet PHY, PoE front end, power input, SWD, ESC headers, passives, inductors, packages, LCSC/MPN candidates, and pin-map intent
- component procurement intelligence with footprint-confidence, selection score, lifecycle/assembly risk, and substitution candidates
- component library audit reports for symbol, footprint, 3D model, pin-map, and supplier coverage before schematic/placement/export workflows
- symbol/footprint/pin-map compatibility validation from parsed KiCad symbol pins and footprint pads
- BoardForge netlist generation from component pin maps for schematic/PCB sync review
- portable 3D model linking from indexed KiCad footprint/model libraries with KiCad environment-variable model paths where possible
- review-required BOM generation from the placed component manifest when the schematic BOM is empty
- Edge.Cuts geometry validation
- mounting-hole inside/edge-clearance checks
- JLCPCB/PCBWay manufacturer profiles
- manufacturer capability comparison including standard vs advanced HDI review profiles
- PCB net-class profiles and net classification
- deterministic placement planning with off-board/overlap checks
- placement scoring for density, edge connector intent, passive proximity, and estimated ratsnest length
- placement optimization proposals that move edge connectors/RF modules, reduce overlaps, and report fixed error counts before routing
- apply-placement writer that updates real `.kicad_pcb` footprint coordinates from controlled placement plans
- reusable `boardforge-constraints.json` artifacts for placement, routing, fab gates, net classes, keepouts, HDI, and manufacturing review
- partial routing plans that report unrouted nets
- native KiCad schematic object generation for symbols, wires, labels, global labels, and symbol instances
- PCB net synchronization from component pin maps to footprint pads
- routing endpoint inference from component connectivity instead of manual-only coordinates
- explicit route waypoint generation so written copper is split into reviewable 45/90-degree legs
- route geometry prechecks for off-board routes, bad vias, keepout violations, hole clearance, differential-pair mates, and power-route width review
- blind/buried/microvia layer-pair validation and advanced fab approval gates
- manufacturing readiness validation that gates exports on DRC/ERC reports by default
- BOM/CPL sanity checks for required columns, refs, coordinates, values, and placement rows
- design-audit report generation that combines netlist, PCB pad-net audit, placement score, routing prechecks, and recommended next actions
- self-review quality gates
- existing `.kicad_pcb` project scanning
- KiCad 10 CLI detection on Windows common install paths
- DRC/ERC execution with KiCad JSON reports when project files exist
- Gerber, drill, CPL, and BOM export through whitelisted KiCad commands
- JLCPCB ZIP packaging only when required files already exist
- JLCPCB ZIP blocking when DRC/ERC reports are missing or contain errors
- honest blocked statuses when schematic/project/export files are missing
- local HTTP tool server for Codex/web handoff
- local MCP server for Codex plugin tool calls

```bash
node plugins/boardforge-plugin/bin/boardforge-plugin.mjs \
  --job plugins/boardforge-plugin/examples/outline-job.json \
  --workspace plugins/boardforge-plugin/tmp
```

Run the local tool server:

```bash
node plugins/boardforge-plugin/bin/boardforge-server.mjs --workspace ./boardforge-workspace --port 47321
```

Run the Codex MCP server directly:

```bash
npm run mcp:plugin
```

Endpoints:

- `GET /status`
- `GET /kicad/status`
- `GET /jobs/:id`
- `POST /jobs/create-outline`
- `POST /jobs/create-project`
- `POST /jobs/snapshot`
- `POST /jobs/list-snapshots`
- `POST /jobs/diff-snapshot`
- `POST /jobs/restore-snapshot`
- `POST /jobs/preflight`
- `POST /jobs/workflow-preset`
- `POST /jobs/plan-requirements`
- `POST /jobs/plan-stackup`
- `POST /jobs/compare-manufacturers`
- `POST /jobs/plan-complex-board`
- `POST /jobs/design-constraints`
- `POST /jobs/sync-libraries`
- `POST /jobs/search-library`
- `POST /jobs/resolve-assets`
- `POST /jobs/audit-component-library`
- `POST /jobs/validate-bindings`
- `POST /jobs/validate-manufacturing`
- `POST /jobs/manufacturing-manifest`
- `POST /jobs/generate-netlist`
- `POST /jobs/design-audit`
- `POST /jobs/validate-routing`
- `POST /jobs/apply-placement`
- `POST /jobs/find-missing-footprints`
- `POST /jobs/link-3d-models`
- `POST /jobs/validate`
- `POST /jobs/run-drc`
- `POST /jobs/run-erc`
- `POST /jobs/export-gerbers`
- `POST /jobs/export-drill`
- `POST /jobs/export-bom`
- `POST /jobs/export-cpl`
- `POST /jobs/export`
- `POST /jobs/scan`

This writes:

- `.kicad_pro`
- `.kicad_sch` for project scaffolds
- `.kicad_pcb`
- `boardforge-project.json`
- `.boardforge/snapshots/*` when snapshot jobs are run
- `boardforge-components.json` for project scaffolds
- `boardforge-library.json` for project scaffolds
- `boardforge-schematic-model.json` for generated schematic intent
- `boardforge-component-audit.json` when component coverage audit runs
- `boardforge-preflight.json` when project preflight runs
- `boardforge-workflow-preset.json` when workflow preset planning runs inside an existing project
- `boardforge-manufacturing-manifest.json` when the manufacturing handoff manifest runs
- `boardforge-requirements-plan.json` when requirement planning runs
- `boardforge-stackup-plan.json` when stackup planning runs
- `boardforge-assembly-plan.json` for component-side, connector-access, service-access, and panelization hints
- `boardforge-constraints.json` for reusable placement/routing/manufacturing constraints
- `boardforge-complex-board-plan.json` when complex-board planning runs
- `boardforge-bindings.json` for project scaffolds and binding validation
- `boardforge-netlist.json` when project scaffolding or the netlist job runs
- `boardforge-design-report.json` when the design audit job runs
- `boardforge-review.json`
- `README.md`

It does not claim routed copper, clean DRC, or JLCPCB readiness unless KiCad validation/export results prove it. Generated project scaffolds remain review-required.

Safety rules:

- no arbitrary shell commands from AI
- writes stay inside the approved workspace
- job input is structured JSON
- generated projects are marked as review-required
- manufacturing packaging requires existing Gerber, drill, BOM, CPL, DRC, and ERC artifacts
- human review is required before manufacturing

### Current Real vs Not Real

Real today:

- outline-only KiCad project creation
- board shape templates for ESP32 sensor, PoE sensor, drone FC, whoop/AIO, robotics, and ESC concept boards
- outline geometry checks
- net class creation and classification
- placement/routing plan validation
- scan summaries for existing KiCad PCB files
- installed KiCad library indexing and component asset matching
- parsed symbol/footprint compatibility reports written to `boardforge-bindings.json`
- local MCP tool calls for Codex
- project state tracking across create, resolve, link, validate, export, and package jobs
- project snapshots and restore jobs for safe rollback before/after AI-assisted edits
- project snapshot diffs for approval and audit trails before restore/export
- complex-board routing policy with standard/blind/buried/microvia rules, layer-change logic, copper pour planning, antenna keepouts, thermal keepouts, sensitive analog/sensor regions, and advanced fab gates
- controlled `apply_routing_plan` writer for review-required KiCad `segment`, `via`, and `zone` objects
- BoardForge component database enrichment with LCSC/MPN/package/pin-map candidates
- component library coverage auditing for symbol, footprint, 3D model, pin-map, and supplier readiness
- project preflight gate reports before risky edits, routing, restore, export, or JLCPCB packaging
- requirements-to-circuit planning for USB-C, ESP32-S3 core, 3V3 regulation, I2C headers, SWD, PoE/Ethernet, and drone FC core blocks
- schematic object generation with symbols, wires, labels, power/global labels, component footprint properties, and symbol instances written into `.kicad_sch`
- schematic-to-PCB net propagation that writes net declarations and assigns component pad nets from BoardForge pin maps
- routing endpoint inference from matching component pins so route plans start from actual component connectivity
- placement scoring with ratsnest, edge-connector, passive-proximity, and density metrics
- optimize-placement proposals that repair overlap, edge-access, and RF-edge constraint problems before routing is attempted
- real apply-placement updates into KiCad PCB footprint `(at x y rotation)` fields with DRC-required status
- route waypoint generation for sane review-required copper legs before DRC
- DRC repair planning plus safe repair application for low-risk cleanup actions
- plain-English interactive edit parsing for board resize, rounded corners, edge placement, keepouts, and route-width intents
- test coverage for geometry, net classes, placement, routing-plan honesty, outline generation, library resolution, MCP calls, KiCad CLI validation/export, and blocked packaging

Not complete yet:

- automatic multi-pass DRC-clean repair for all violation types
- complete autorouting and DRC-clean route repair
- clean DRC on component projects until nets/clearances/routing are solved
- native KiCad plugin UI

Future phases add richer DRC/ERC repair loops, placement edits inside existing KiCad projects, full KiCad-symbol-library fidelity, and native KiCad plugin UI.

### KiCad 10 Adapter

BoardForge auto-detects:

```text
C:\Program Files\KiCad\10.0\bin\kicad-cli.exe
```

You can override it with:

```powershell
$env:BOARDFORGE_KICAD_CLI="C:\Program Files\KiCad\10.0\bin\kicad-cli.exe"
```

Real KiCad-backed commands now include:

- `create_kicad_project`
- `run_kicad_drc`
- `run_kicad_erc`
- `export_gerbers`
- `export_drill_files`
- `export_cpl`
- `export_bom`
- `package_jlcpcb`

For a scaffolded project, BoardForge can now create schematic objects, place real KiCad footprints, assign PCB pad nets from component pin maps, infer route endpoints from connectivity, write review-required copper, run ERC/DRC, export fabrication files, generate a review-required BOM from placed components when needed, and block JLCPCB packaging when DRC errors remain. The output stays review-required until KiCad ERC/DRC reports prove it is clean.

## Vercel

Import `LuiFig19/BoardForgeAI` into Vercel as a Next.js project.

Use:

- Install command: `npm install`
- Build command: `npm run build`
- Output directory: leave blank

Set production environment variables in Vercel:

- `OPENROUTER_API_KEY`
- `OPENROUTER_MODEL`
- `GEMINI_API_KEY`
- `GEMINI_MODEL`
- `NEXT_PUBLIC_SITE_URL=https://boardforge-ai.com`
- `NEXT_PUBLIC_SITE_NAME=BoardForge AI`

Then add the domains:

- `boardforge-ai.com`
- `www.boardforge-ai.com`

Vercel will show the exact DNS records to place in Porkbun.

## Commands

Complex-board Codex prompt examples live in `plugins/boardforge-plugin/examples/complex-board-prompts.md`.

```bash
npm run lint
npm run build
npm run test:plugin
npm run smoke:plugin
```
