# ADR: React Hook Form + Zod for Multi-Step Form

Date: 2026-05-18

## Decision
Use React Hook Form with Zod resolver for the brand submission multi-step form.

## Context
The brand submission flow requires a 4-step wizard with per-step validation, dynamic field arrays (purchase links, retail locations), and file upload integration. No form infrastructure existed in the codebase.

## Alternatives Considered
- **Server Actions + useActionState**: React 19 native, zero dependencies. Rejected: multi-step state management is manual -- no built-in way to preserve form state across steps without lifting all state to a parent component.
- **Controlled state + Zod only**: useState/useReducer for form state, Zod for validation. Rejected: excessive boilerplate for field registration, error display, and dirty tracking across 15+ fields and dynamic arrays.

## Rationale
RHF provides built-in multi-step support via `trigger()` for per-step validation, `useFieldArray()` for dynamic rows, and `FormProvider` for shared state. Zod schemas serve as single source of truth for both client and server validation. Combined bundle ~14KB gzip is acceptable.

## Consequences
- Advantage: Clean integration with shadcn/ui form components, minimal boilerplate
- Advantage: Same Zod schemas validate on client (per-step) and server (full form)
- Disadvantage: Additional ~14KB in the /submit route bundle
