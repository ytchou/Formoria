# Contributing to Formoria

Thanks for taking the time. There are two different things you might want to report, and they take different paths.

## Something about a brand is wrong

Wrong category, dead purchase link, outdated description, an incorrect manufacturing-verification tier, or a brand that should not be listed at all.

**Open a [brand correction issue](https://github.com/ytchou/Formoria/issues/new?template=brand_correction.yml).** Include the brand's page URL and, where you can, a source — an official site, a product page, a company registration. Verification claims in particular need evidence; that is the whole point of the ladder.

Please do **not** send a pull request for brand data. Brand records live in the database, not in this repository, and every change goes through a review queue before it reaches the site. A data PR has nothing to modify.

## Something is broken in the app

A page that errors, a filter that returns nothing, a layout that breaks, a link that 404s.

**Open a [bug report](https://github.com/ytchou/Formoria/issues/new?template=bug_report.yml)** with the URL, what you expected, what happened, and your browser. A screenshot helps more than a paragraph.

## Code contributions

This is a small, actively developed product rather than a community project, so large unsolicited pull requests are unlikely to be merged. **Open an issue first** and we can talk about whether it fits before you spend time on it.

If you are sending a PR:

- Read the setup instructions in [README.md](README.md) first.
- `pnpm lint` and `pnpm test` must pass.
- One concern per PR. A focused diff gets reviewed; a mixed one stalls.
- Match the surrounding code — its naming, its patterns, its comment density.

## Security

Found something with security impact? **Do not open a public issue.** Report it privately through GitHub's [security advisories](https://github.com/ytchou/Formoria/security/advisories/new) so it can be fixed before it is described in public.

## License

The source is public to read, but all rights are reserved — see [README.md](README.md#license). By contributing you agree that your contribution may be used in the project under those terms.
