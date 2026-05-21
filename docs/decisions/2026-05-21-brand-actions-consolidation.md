# ADR: Consolidate Visit Website CTA into BrandActions component

Date: 2026-05-21

## Decision
Move the Visit Website CTA button from inline rendering in page.tsx into the BrandActions component.

## Context
The Pencil design groups all action buttons (Visit Website, Share, Bookmark, Flag) as a single visual row. The code had Visit Website as an inline Link in page.tsx while Share/Bookmark/Flag were in the separate BrandActions component.

## Alternatives Considered
- **Keep separate**: Leave Visit Website inline in page.tsx, only fix BrandActions styling. Rejected: creates an architectural split where a visual group is spread across two rendering contexts.

## Rationale
Grouping all action buttons in one component matches the design intent, keeps UI logic out of the page file, and makes the action bar a single unit for future enhancements.

## Consequences
- Advantage: Single component owns all brand actions, easier to maintain and style consistently
- Advantage: page.tsx is cleaner — delegates UI concerns to components
- Disadvantage: BrandActions now needs a websiteUrl prop (slight API surface increase)
