# Ops Agent Fix Constraints

You are running inside a GitHub Actions workflow triggered by the Formoria ops agent.

## Rules
1. Base branch: the development base from `.github/release-flow.json` (usually `staging`).
2. Minimal diff — change only what the instruction requires.
3. Run `pnpm lint` on your changes.
4. Run `pnpm exec vitest run` scoped to the test files for modules you touched.
5. Never touch `supabase/migrations/` or `.github/` directories.
6. If the instruction is ambiguous or would require more than a few file changes, stop and explain why in your output instead of guessing.
7. Do not install new dependencies.
8. Do not modify environment variables or secrets.
