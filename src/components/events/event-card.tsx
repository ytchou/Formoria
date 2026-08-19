import { Link } from '@/i18n/navigation'
import { Badge } from '@/components/ui/badge'
import { surfaceCardStyles } from '@/components/ui/card'
import type { Event, EventPhase } from '@/lib/services/events'
import { formatEventDateRange } from './event-date'
import { routes } from '@/lib/routes'

/**
 * Exported (unlike the stories hub's local `StoryCard`) because the events hub
 * renders it from two sections — upcoming and past — and a second copy of the
 * card would be the thing that drifts.
 *
 * Deliberately label-in-props rather than `async` + `getTranslations`: the hub
 * already holds the `events` translator, and keeping this synchronous and
 * message-free means it renders the same way from any caller without dragging
 * a locale request scope along with it.
 */
type EventCardProps = {
  event: Event
  phase: EventPhase
  /** Already-localized phase label, e.g. `t('phase.ongoing')`. */
  phaseLabel: string
  /** Already-localized brand count, or `null` to omit the line entirely. */
  brandCountLabel?: string | null
  locale: string
  /** `2` in an untitled grid, `3` under a section heading. */
  headingLevel?: 2 | 3
}

/**
 * `ongoing` is the one state worth an accent: it is the only phase a reader can
 * act on today. `upcoming` uses the neutral outline and `past` the quiet fill,
 * so the section reads as a hierarchy of weight rather than a palette.
 *
 * Exported because the detail page badges the same phase — one definition, so
 * a card and the page it links to can never disagree about what "ongoing"
 * looks like.
 */
export const eventPhaseBadgeVariant: Record<
  EventPhase,
  'default' | 'outline' | 'secondary'
> = {
  ongoing: 'default',
  upcoming: 'outline',
  past: 'secondary',
}

export function EventCard({
  event,
  phase,
  phaseLabel,
  brandCountLabel = null,
  locale,
  headingLevel = 2,
}: EventCardProps) {
  const Heading = headingLevel === 3 ? 'h3' : 'h2'
  const isEnglish = locale === 'en'
  // English copy is optional per column, so each one falls back independently:
  // an event with an English name but no English summary should still show the
  // English name rather than dropping to zh-TW wholesale.
  const name = isEnglish ? (event.nameEn ?? event.name) : event.name
  const summary = isEnglish ? (event.summaryEn ?? event.summary) : event.summary
  const venue = isEnglish ? (event.venueNameEn ?? event.venueName) : event.venueName
  // `''` for an unparseable date column — the card drops the line rather than
  // rendering "Invalid Date" or throwing out of the hub.
  const dateLabel = formatEventDateRange(event.startsOn, event.endsOn)

  return (
    <Link
      href={routes.event(event.slug)}
      className={surfaceCardStyles({
        className: 'group block hover:bg-secondary',
        interactive: true,
      })}
    >
      {/*
        Full-width row rather than a grid cell: the hub lists these one per row,
        so the card splits into a prose column that takes the slack and a fixed
        metadata rail. Below `md` the rail drops under the prose, separated by a
        rule instead of a column border.

        No `md:items-start`: the rail must stretch to the card's height or its
        `md:border-l` stops partway down the card and reads as a stray tick.
      */}
      <div className="flex flex-col gap-4 md:flex-row md:gap-8">
        <div className="min-w-0 flex-1 space-y-3">
          <Badge variant={eventPhaseBadgeVariant[phase]}>{phaseLabel}</Badge>
          <div className="space-y-2">
            <Heading className="type-card-title group-hover:underline">{name}</Heading>
            <p className="type-body-sm line-clamp-3">{summary}</p>
          </div>
        </div>
        <div className="space-y-1 border-t border-border pt-4 md:w-56 md:shrink-0 md:border-t-0 md:border-l md:pt-0 md:pl-8">
          {dateLabel ? <p className="type-metadata">{dateLabel}</p> : null}
          <div className="flex flex-col gap-1 type-metadata">
            {venue ? <span>{venue}</span> : null}
            {brandCountLabel ? <span>{brandCountLabel}</span> : null}
          </div>
        </div>
      </div>
    </Link>
  )
}
