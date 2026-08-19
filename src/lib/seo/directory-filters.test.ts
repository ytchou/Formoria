import { describe, expect, it } from 'vitest'

import { parseDirectoryViewFilters } from './directory-filters'
import { MATERIALS } from '@/lib/taxonomy/ontology'

/**
 * `?material=` speaks slugs. The gate is exact-match-or-drop against the
 * ontology — deliberately with no alias layer, so a display label like the
 * zh-TW `陶瓷` is dropped exactly as `xyz` is rather than quietly resolving.
 */

/** No category is valid here: the material axis is orthogonal to the taxonomy. */
const NO_CATEGORIES: ReadonlySet<string> = new Set<string>()

function materialsFor(material: string): string[] {
  return parseDirectoryViewFilters({ material }, NO_CATEGORIES).filters.materials ?? []
}

const ALL_SLUGS = MATERIALS.map((material) => material.slug)

describe('parseDirectoryViewFilters — material', () => {
  it('unknown_material_terms_are_dropped', () => {
    // A term outside the closed vocabulary never reaches the filters, so the
    // sidebar renders no chip for it and the search RPC is never asked to
    // filter on a value no row can carry.
    expect(materialsFor('陶瓷')).toEqual([])
    expect(materialsFor('xyz')).toEqual([])

    // The control: without it, a gate that drops EVERY term passes the two
    // assertions above while silencing the whole facet.
    expect(materialsFor('ceramic')).toEqual(['ceramic'])
    expect(materialsFor('ceramic,xyz,陶瓷,wood')).toEqual(['ceramic', 'wood'])

    // The gate reads the ontology rather than a copy of it, so a slug added to
    // `MATERIALS` is reachable from the URL on the same commit. Twelve slugs is
    // also exactly the RPC's `cardinality > 12` ceiling.
    expect(materialsFor(ALL_SLUGS.join(','))).toEqual([...ALL_SLUGS])

    // Deduped, not just validated: repeating one term cannot inflate the array
    // past that ceiling, which would raise 22023 and render an empty page with
    // the chip still shown.
    expect(materialsFor('ceramic,ceramic,ceramic')).toEqual(['ceramic'])
  })
})
