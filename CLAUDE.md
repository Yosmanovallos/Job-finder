# CLAUDE.md

@AGENTS.md

Claude Code specific notes (nothing here overrides AGENTS.md):

- Work one phase at a time, in its own session/context, per
  `GUIA_PASO_A_PASO_RADAR_EMPLEO_LOCAL.md`. Don't chain multiple phases in a
  single reply just because context budget allows it.
- `.claude/settings.json` denies reading `.env`, `private/**`, `secrets/**`,
  `backups/**`. Do not attempt to work around this — if a task genuinely
  needs one of those paths, stop and ask the user.
- Subagents (`architect`, `source-researcher`, `adapter-engineer`,
  `data-quality-reviewer`, `matching-evaluator`, `security-reviewer`,
  `release-reviewer`) are defined per plan section 16, added as the phases
  that need them start. None exist yet in Fase 0.
- Prefer the smallest model that can do the task correctly (plan section
  15.5): fast/cheap models for exploration and mechanical work, higher
  reasoning only for architecture, matching disputes, and release audits.
