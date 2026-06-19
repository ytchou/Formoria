'use client'

import { Check, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type { NewsletterSubscriber, SubscriberStats } from '@/lib/services/newsletter'

type NewsletterSubscribersListProps = {
  subscribers: Pick<
    NewsletterSubscriber,
    'id' | 'email' | 'interests' | 'confirmed_at' | 'subscribed_at' | 'unsubscribed_at'
  >[]
  stats: SubscriberStats
}

const INTEREST_LABELS: Record<string, string> = {
  'brand-stories': 'Brand stories',
  'new-brands': 'New brands',
  'curated-picks': 'Curated picks',
  'mit-trends': 'MIT trends',
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function formatInterest(interest: string) {
  return INTEREST_LABELS[interest] ?? interest
}

export function NewsletterSubscribersList({
  subscribers,
  stats,
}: NewsletterSubscribersListProps) {
  const statCards = [
    {
      label: 'Total subscribers',
      value: stats.total,
      description: 'All newsletter signups',
    },
    {
      label: 'Confirmed',
      value: stats.confirmed,
      description: 'Subscribers with confirmed email',
    },
    {
      label: 'Unsubscribed',
      value: stats.unsubscribed,
      description: 'Subscribers who opted out',
    },
  ]

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-3">
        {statCards.map((stat) => (
          <Card key={stat.label}>
            <CardHeader>
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {stat.label}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="font-heading text-4xl font-bold">{stat.value}</p>
              <p className="mt-2 text-sm text-muted-foreground">
                {stat.description}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="rounded-lg border bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Email</TableHead>
              <TableHead>Interests</TableHead>
              <TableHead>Confirmed</TableHead>
              <TableHead>Subscribed Date</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {subscribers.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="py-8 text-center text-[#7C7570]">
                  No newsletter subscribers yet.
                </TableCell>
              </TableRow>
            ) : (
              subscribers.map((subscriber) => (
                <TableRow key={subscriber.id}>
                  <TableCell className="font-medium">{subscriber.email}</TableCell>
                  <TableCell>
                    {subscriber.interests && subscriber.interests.length > 0 ? (
                      <div className="flex flex-wrap gap-1.5">
                        {subscriber.interests.map((interest) => (
                          <Badge
                            key={interest}
                            variant="outline"
                            className="bg-[#FAF8F3] text-[#7C7570]"
                          >
                            {formatInterest(interest)}
                          </Badge>
                        ))}
                      </div>
                    ) : (
                      <span className="text-muted-foreground">None</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {subscriber.confirmed_at ? (
                      <Check
                        className="size-4 text-green-600"
                        aria-label="Confirmed"
                      />
                    ) : (
                      <X
                        className="size-4 text-muted-foreground"
                        aria-label="Not confirmed"
                      />
                    )}
                  </TableCell>
                  <TableCell>{formatDate(subscriber.subscribed_at)}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
