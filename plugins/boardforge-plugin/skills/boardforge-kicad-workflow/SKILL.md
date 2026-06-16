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
- `snapshot_project`
- `list_project_snapshots`
- `diff_project_snapshot`
- `restore_project_snapshot`
- `run_project_preflight`
- `plan_requirements`
- `plan_stackup`
- `compare_manufacturers`
- `plan_complex_board`
- `sync_kicad_libraries`
- `search_library_assets`
- `resolve_component_assets`
- `sync_component_database`
- `resolve_bom_parts`
- `audit_component_library`
- `validate_component_bindings`
- `generate_netlist`
- `run_design_audit`
- `validate_manufacturing_readiness`
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
- `validate_routing_geometry`
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
- Restore only through `restore_project_snapshot`, then rerun scan, ERC, and DRC before export.
- Run `diff_project_snapshot` before restore or export when a snapshot exists so the user can review changed files.
- Run `run_project_preflight` before risky edits, routing, manufacturing export, package generation, or project handoff.
- Run `plan_requirements` when the user gives a hardware description and Codex needs a structured BOM/net/circuit plan before KiCad generation.
- Run `plan_stackup` before dense, high-speed, high-current, RF, or HDI boards so BoardForge can decide layer roles, blind/buried/microvia policy, impedance intent, copper strategy, and advanced fab blockers.
- Run `plan_complex_board` for serious boards before project generation or routing. Treat its output as the main engineering plan for requirements, stackup, keepouts, vias, copper pours, and export gates.
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
- `create_kicad_project` writes real `.kicad_pro`, `.kicad_sch`, `.kicad_pcb`, `README.md`, `boardforge-components.json`, `boardforge-bindings.json`, and `boardforge-review.json`.
- Project creation writes persistent `boardforge-project.json` state with requirements, board geometry, component/library decisions, validation results, exports, generated files, and history.
- `snapshot_project`, `list_project_snapshots`, and `restore_project_snapshot` provide controlled rollback for KiCad project files and BoardForge metadata before risky edits.
- `diff_project_snapshot` compares current project files to a saved snapshot and reports added, modified, deleted, and unchanged files with line-delta summaries.
- `run_project_preflight` writes `boardforge-preflight.json` and aggregates scan, component audit, binding validation, netlist, manufacturing readiness, and optional snapshot diff gates.
- `plan_requirements` writes or returns a requirements plan with reusable circuit blocks, components, nets, constraints, and assumptions for constrained board families.
- `plan_stackup` writes or returns a stackup plan with layer roles, manufacturer HDI capability, blind/buried/microvia rules, impedance intent, copper strategy, and thermal strategy.
- `plan_complex_board` writes or returns a combined complex-board plan with requirements, stackup, complexity score, placement/routing strategy, keepouts, copper pours, and manufacturing gates.
- `create_kicad_project` places real KiCad footprints from installed footprint libraries for template components.
- `sync_kicad_libraries` detects installed KiCad 10/9/8 library roots, optionally syncs allowlisted official KiCad symbol/footprint/3D repos, and writes `.boardforge/library-cache/boardforge-library-index.json`.
- `search_library_assets` searches indexed symbols, footprints, and 3D models.
- `resolve_component_assets` maps component refs/groups/values/MPNs to review-required symbol, footprint, and 3D model candidates.
- `find_missing_footprints` reports which component footprints cannot be found in the indexed allowlisted libraries.
- `link_3d_models` attaches available 3D model references from indexed KiCad footprints/packages and normalizes model paths to KiCad variables when possible.
- `resolve_component_assets` and `link_3d_models` update `boardforge-project.json` when `projectPath` is provided.
- `sync_component_database` and `resolve_bom_parts` enrich components with LCSC, MPN, package, pin-map, symbol, footprint, 3D model, and stock-risk candidates for common USB, MCU, IMU, barometer, flash, Ethernet, PoE, SWD, power, connector, passive, and inductor blocks.
- `audit_component_library` writes `boardforge-component-audit.json` and scores symbol, footprint, 3D model, pin-map, package, LCSC, and MPN coverage before schematic, placement, routing, or export work.
- `validate_component_bindings` parses KiCad symbol pins and footprint pads, compares them to BoardForge pin maps, and writes compatibility results to `boardforge-bindings.json` when `projectPath` is provided.
- `generate_netlist` writes `boardforge-netlist.json` from component pin maps so Codex can review schematic/PCB connectivity before routing.
- `run_design_audit` writes `boardforge-design-report.json`, combining netlist coverage, PCB pad-net audit, placement score, route prechecks, binding issues, and recommended next BoardForge actions.
- `validate_manufacturing_readiness` checks DRC/ERC reports plus BOM/CPL artifacts and reports blockers before export/package workflows.
- `generate_schematic` writes review-required KiCad schematic objects into `.kicad_sch`, including symbols, footprint properties, wires, labels, global labels, and symbol instances. Run ERC after it.
- `plan_drc_repairs` and `apply_safe_drc_repairs` create a DRC repair plan and apply only low-risk safe repairs; rerun DRC after any repair.
- `interactive_edit` parses plain-English edits such as resizing the board, rounding corners, moving USB to an edge, enforcing antenna keepout, or increasing power route width.
- `validate_board_outline` checks outline area, self-intersections, mounting hole containment, and edge clearance.
- `create_net_classes`, `validate_net_classes`, and `report_unclassified_nets` use BoardForge net-class rules.
- `generate_placement_plan` creates deterministic placement plans, scores density, edge connector intent, passive proximity, and ratsnest length, and fails on off-board/overlap issues.
- `generate_routing_plan` creates a partial routing plan from explicit route points or inferred component pin-map endpoints, emits route waypoints for reviewable 45/90-degree legs, and reports unrouted nets. It does not claim full autorouting.
- `validate_routing_geometry` prechecks route points, widths, via size/drill, via keepouts, mounting-hole clearance, differential-pair mates, copper-pour keepouts, and power-route width before copper is written.
- Routing tools return compact-board via policy, layer-change rules, copper pour plans, antenna keepouts, thermal keepouts, and sensitive analog/sensor regions.
- `add_ground_zone`, `stitch_ground_vias`, `route_critical_nets`, `route_power_nets`, `route_diff_pair`, `route_signal_net`, `validate_routes`, and `report_unrouted_nets` are controlled planning tools. They do not claim completed copper until a later KiCad route writer applies and validates geometry.
- `apply_routing_plan` can write review-required KiCad `segment`, `via`, and `zone` objects from a BoardForge routing plan, add PCB nets, and assign footprint pad nets from component pin maps. It runs routing geometry prechecks first and then requires `run_kicad_drc` before any export/manufacturing claim.
- `scan_kicad_project` parses existing `.kicad_pcb` projects for layers, nets, footprints, tracks, vias, zones, and mounting holes.
- `run_kicad_drc` and `run_kicad_erc` call local KiCad 10/9/8 `kicad-cli` when available and parse JSON reports.
- `export_gerbers`, `export_drill_files`, `export_cpl`, and `export_bom` use whitelisted KiCad CLI commands.
- Export jobs are validation-gated by default. Use `allowUnvalidatedExport: true` only for development artifacts that must not be called manufacturing-ready.
- Manufacturing readiness also checks BOM/CPL columns, refs, values, coordinates, and placement rows.
- If the schematic BOM is empty but placed components exist, `export_bom` writes a review-required BOM from `boardforge-components.json`.
- `package_jlcpcb` creates a ZIP only when required Gerber, drill, BOM, CPL, DRC, and ERC report files exist, and it blocks if DRC/ERC reports contain errors.

## Explicitly Not Complete Yet

- Fully automatic DRC-clean repair for all geometry classes.
- Full DRC-clean trace autorouting and route repair.
- Native KiCad API editing.
- Full KiCad-symbol-library fidelity for every possible component family.
- Clean DRC on component projects until clearances, placement, routing, and KiCad validation are solved.

These commands return blocked or not-implemented statuses until the safe adapters exist.

## CLI MVP

The local helper can be called as:

```bash
node plugins/boardforge-plugin/bin/boardforge-plugin.mjs --job path/to/job.json --workspace path/to/workspace
```

Current MVP implements outline generation, outline validation, schematic object generation, net classes, placement planning, real KiCad footprint placement for templates, component pin-map net assignment, routing planning, review-required copper writing, self-review, KiCad project scanning, KiCad CLI DRC/ERC, Gerber/drill/CPL/BOM export, and gated JLCPCB packaging.

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
- `POST /jobs/snapshot`
- `POST /jobs/list-snapshots`
- `POST /jobs/diff-snapshot`
- `POST /jobs/restore-snapshot`
- `POST /jobs/preflight`
- `POST /jobs/plan-requirements`
- `POST /jobs/plan-stackup`
- `POST /jobs/compare-manufacturers`
- `POST /jobs/plan-complex-board`
- `POST /jobs/sync-libraries`
- `POST /jobs/search-library`
- `POST /jobs/resolve-assets`
- `POST /jobs/audit-component-library`
- `POST /jobs/validate-bindings`
- `POST /jobs/validate-manufacturing`
- `POST /jobs/generate-netlist`
- `POST /jobs/design-audit`
- `POST /jobs/validate-routing`
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

## Codex MCP Server

When the plugin is installed in Codex, Codex should call the BoardForge MCP tools directly instead of invoking shell commands by hand.

Local test command:

```bash
node plugins/boardforge-plugin/bin/boardforge-mcp.mjs --workspace path/to/workspace
```

The MCP server exposes controlled tools for status, KiCad detection, outline/project creation, library sync/search/resolve, DRC/ERC, Gerbers, drill, BOM, CPL, JLCPCB packaging, and project summaries. Each tool accepts structured JSON and returns a review-required result object as text content.

Use `status` first, then `kicad_status`, then the specific BoardForge job tool. Do not bypass these tools for direct KiCad file edits.
