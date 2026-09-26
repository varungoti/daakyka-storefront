# Release Audit & "Ultimate UX" Plan (2026-09-19) — relocated

This document used to live at this path. Per audit finding **F-303** ("the public repo publishes
the store's internal security audit, including still-open vulnerabilities, and its production
infrastructure runbooks"), it has been moved out of the tracked, publicly-served repo path
alongside the security audit it links to.

It now lives at `docs/internal/AUDIT_AND_UX_PLAN_2026-09-19.md`, a path listed in `.gitignore` and
therefore not part of the public GitHub repository. If you need it and don't have a local copy,
ask whoever ran the F-303 relocation.

Whether this repository should be made **private** (which would remove the need for this kind of
per-file relocation entirely) is a separate, owner-only decision — see `docs/LAUNCH_STATUS.md` and
the release audit's `owner_actions` list.

Relocating this file does **not** scrub it from git history: anyone with an existing clone or fork
still has the original content in earlier commits. That requires a deliberate history rewrite,
which is out of scope for this fix.
