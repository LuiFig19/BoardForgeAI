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
- `create_kicad_project`
- `apply_edge_cuts`
- `scan_kicad_project`
- `find_missing_footprints`
- `link_3d_models`
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
- Do not overwrite existing project folders unless the job explicitly allows it.
- Prefer dry run before destructive edits.
- Snapshot existing projects before edits when supported.
- Treat all AI plans as proposals until validated.
- Require human review before manufacturing.

## CLI MVP

The local helper can be called as:

```bash
node plugins/boardforge-plugin/bin/boardforge-plugin.mjs --job path/to/job.json --workspace path/to/workspace
```

Current MVP implements `create_outline_board`. Other workflows return a structured `not_implemented` result until their safe adapters are added.
