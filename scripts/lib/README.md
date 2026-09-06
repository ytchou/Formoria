# scripts/lib/

# @formoria-script
# purpose: Library modules imported by other scripts; nothing here is run directly.
# class: shared
# invoke: not invoked directly; imported by scripts under scripts/
# target: none
# safety: read-only
# owner: engineering

Plain-Node helpers shared by the gates and the catalog.

| module | what it is |
|---|---|
| `script-header.mjs` | parser and walker for the `@formoria-script` block; the single source of the header rules for `check-script-registry.mjs` and `list-scripts.mjs` |
| `color.mjs` | colour maths for the contrast and design-token gates |
| `readonly-client.ts` | write-blocking Supabase client for checks that must not mutate the project they inspect |

This directory is represented in the registry by this README alone: its
contents are exempt from the one-header-per-file rule, because a library module
has no operator-facing entry point.
