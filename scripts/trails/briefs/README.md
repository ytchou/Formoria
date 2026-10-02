# Trail briefs

One JSON file per discovery trail, named `<slug>.json`, read by
`scripts/trails/shortlist.ts --trail <slug>`.

```json
{
  "slug": "quiet-evening",
  "sections": [
    {
      "key": "light",
      "title": "燈與光",
      "query": "柔和的床頭燈",
      "subcategories": ["lamps"]
    }
  ]
}
```

| Field | Meaning |
|---|---|
| `slug` | The trail slug. Must equal the `--trail` argument and the MDX file name in `content/trails/`. |
| `sections[].key` | The section key. Must match a `sections[].key` in the trail MDX frontmatter. Unique within the brief. |
| `sections[].title` | Shown as the section heading in the review sheet. |
| `sections[].query` | The zh-TW situation query sent to `searchProductsBySituation`. |
| `sections[].subcategories` | Non-empty list of taxonomy subcategory slugs the search is filtered to. |

The shortlist ranks candidates by retrieval position only, keeps
trail-eligible products, keeps one product per brand per section (D5), and
writes `<slug>.html` and `<slug>.candidates.json` under `--out`.
