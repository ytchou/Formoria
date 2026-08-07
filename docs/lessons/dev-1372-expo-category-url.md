# DEV-1372 Creative Expo category URL

## Symptom

Opening the Creative Expo with `?category=crafts` did not select the Crafts & Art filter when event-linked brands stored the category as `工藝文創`. Interactive selection also wrote `category=工藝文創` into the URL instead of the canonical slug.

## Cause

Creative Expo URL parsing compared the requested slug directly with the event option values. The taxonomy already recognized slugs and localized labels, but that resolver was not used at the URL boundary, so the parser rejected the canonical slug and the serializer leaked the stored display value.

## Prevention

Treat URL categories as canonical product-type slugs while retaining the event's stored category value for filtering. Resolve both sides through the shared taxonomy lookup, preserve exact matches for unknown legacy values, and cover the real stored-value shape in a pure regression test.

## How to apply

When adding or changing event category URL state, pass the event's actual option values to the parser, resolve recognized slug/name/nameZh variants to the matching option, and serialize recognized stored values back to their slug. Run the focused Creative Expo and category-label tests before the scoped desktop journey.
