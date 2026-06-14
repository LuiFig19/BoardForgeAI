---
name: boardforge-kicad-workflow
description: Use BoardForge-controlled local tools for KiCad project creation, outline generation, validation, export, and JLCPCB packaging from Codex.
---

# BoardForge KiCad Workflow

Use this skill when the user wants Codex to create, inspect, edit, validate, or export KiCad PCB projects with BoardForge.

BoardForge Plugin is the execution layer. Codex should produce structured JSON jobs and call the BoardForge local helper or MCP server. Codex must not freestyle edits to KiCad project files and must not run arbitrary shell commands.

## Architecture

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

## Allowed Workflows

- `create_outline_board`
- `validate_board_outline`
- `add_mounting_holes`
- `round_board_corners`
- `add_usb_c_edge_cutout`
- `add_rj45_edge_clearance`
- `create_kicad_project`
- `apply_edge_cuts`
- `scan_kicad_project`
- `sync_kicad_libraries`
- `search_library_assets`
- `resolve_component_assets`
- `find_missing_footprints`
- `link_3d_models`
- `create_net_classes`
- `assign_net_to_class`
- `validate_net_classes`
- `report_unclassified_nets`
- `generate_placement_plan`
- `apply_placement_plan`
- `validate_placement`
- `move_component`
- `fix_component_off_board`
- `fix_component_overlap`
- `fix_mounting_hole_conflicts`
- `generate_routing_plan`
- `route_critical_nets`
- `route_power_nets`
- `route_diff_pair`
- `route_signal_net`
- `add_ground_zone`
- `stitch_ground_vias`
- `validate_routes`
- `report_unrouted_nets`
- `fix_route_clearance_violations`
- `run_full_self_review`
- `run_kicad_drc`
- `run_kicad_erc`
- `export_gerbers`
- `export_drill_files`
- `export_bom`
- `export_cpl`
- `package_jlcpcb`
- `summarize_project`

## Safety Rules

- Use structured JSON jobs.
- Validate job fields before invoking local tools.
- Keep all writes inside the user-approved workspace.
- Do not allow path traversal.
- Do not run arbitrary shell commands.
- Download KiCad libraries only through the BoardForge allowlist. Do not clone arbitrary repos or install untrusted footprint libraries.
- Prefer installed KiCad libraries first. Use official KiCad GitLab library repos only when `downloadOfficial` and `allowNetwork` are explicitly true in the structured job.
- Do not overwrite existing project folders unless the job explicitly allows it.
- Prefer dry run before destructive edits.
- Snapshot existing projects before edits when supported.
- Treat all AI plans as proposals until validated.
- Require human review before manufacturing.
- Never claim `DRC pass`, `ERC pass`, `routed`, `JLCPCB ready`, or `manufacturable` unless the local tool result proves it.
- If KiCad CLI, footprints, 3D models, or export files are missing, report `BLOCKED_MISSING_ADAPTER`, `NEEDS_FIX`, or `NEEDS_HUMAN_REVIEW`.

## Required Workflow Pattern

1. Ask for missing required info such as board size, layer count, manufacturer, mounting pattern, MCU, power rails, interfaces, and constraints.
2. Build a structured JSON job.
3. Call the BoardForge local CLI or MCP server.
4. Inspect generated files and returned validation issues.
5. Run `run_full_self_review` after outline, placement, routing, or export operations.
6. Attempt safe fixes only through BoardForge commands.
7. Summarize what was created, what failed, what was auto-fixed, and what still needs human review.

## Current Real Capabilities

- `create_outline_board` writes real `.kicad_pro`, `.kicad_pcb`, `README.md`, and `boardforge-review.json`.
- `create_kicad_project` writes real `.kicad_pro`, `.kicad_sch`, `.kicad_pcb`, `README.md`, `boardforge-components.json`, and `boardforge-review.json`.
- `create_kicad_project` places real KiCad footprints from installed footprint libraries for template components.
- `sync_kicad_libraries` detects installed KiCad 10/9/8 library roots, optionally syncs allowlisted official KiCad symbol/footprint/3D repos, and writes `.boardforge/library-cache/boardforge-library-index.json`.
- `search_library_assets` searches indexed symbols, footprints, and 3D models.
- `resolve_component_assets` maps component refs/groups/values/MPNs to review-required symbol, footprint, and 3D model candidates.
- `find_missing_footprints` reports which component footprints cannot be found in the indexed allowlisted libraries.
- `link_3d_models` attaches available 3D model references from indexed KiCad footprints/packages.
- `validate_board_outline` checks outline area, self-intersections, mounting hole containment, and edge clearance.
- `create_net_classes`, `validate_net_classes`, and `report_unclassified_nets` use BoardForge net-class rules.
- `generate_placement_plan` creates deterministic placement plans and fails on off-board/overlap issues.
- `generate_routing_plan` creates a partial routing plan and reports unrouted nets. It does not claim full autorouting.
- `scan_kicad_project` parses existing `.kicad_pcb` projects for layers, nets, footprints, tracks, vias, zones, and mounting holes.
- `run_kicad_drc` and `run_kicad_erc` call local KiCad 10/9/8 `kicad-cli` when available and parse JSON reports.
- `export_gerbers`, `export_drill_files`, `export_cpl`, and `export_bom` use whitelisted KiCad CLI commands.
- If the schematic BOM is empty but placed components exist, `export_bom` writes a review-required BOM from `boardforge-components.json`.
- `package_jlcpcb` creates a ZIP only when required Gerber, drill, BOM, CPL, and report files exist.

## Explicitly Not Complete Yet

- Full schematic generation.
- Footprint assignment from live libraries.
- Real trace autorouting.
- Native KiCad API editing.
- Schematic-derived BOM rows until the schematic contains real symbols.
- Clean DRC on component projects until net assignment, clearances, and routing are solved.

These commands return blocked or not-implemented statuses until the safe adapters exist.

## CLI MVP

The local helper can be called as:

```bash
node plugins/boardforge-plugin/bin/boardforge-plugin.mjs --job path/to/job.json --workspace path/to/workspace
```

Current MVP implements outline generation, outline validation, net classes, placement planning, real KiCad footprint placement for templates, routing planning, self-review, KiCad project scanning, KiCad CLI DRC/ERC, Gerber/drill/CPL/BOM export, and gated JLCPCB packaging.

## Local Tool Server

The same safe dispatcher can run as a local HTTP server:

```bash
node plugins/boardforge-plugin/bin/boardforge-server.mjs --workspace path/to/workspace --port 47321
```

Supported endpoints:

- `GET /status`
- `GET /kicad/status`
- `GET /jobs/:id`
- `POST /jobs/create-outline`
- `POST /jobs/create-project`
- `POST /jobs/sync-libraries`
- `POST /jobs/search-library`
- `POST /jobs/resolve-assets`
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
