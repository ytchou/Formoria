import * as React from 'react'
import { render } from '@react-email/render'
import { Section } from '@react-email/components'
import { EmailDivider, EmailHeading, EmailText, Layout } from '@emails/components'
import {
  BG_WARM_WHITE,
  BG_WHITE,
  BORDER,
  BRAND_GREEN,
  FONT_STACK,
  FROM_ADDRESS,
  TERRACOTTA,
  TEXT_PRIMARY,
  TEXT_SECONDARY,
} from '@emails/styles'
import type { EmailMessage } from '@emails/types'

export type DigestIssue = {
  title: string
  url: string
  eventCount: number
  severity: 'critical' | 'moderate' | 'trivial' | 'noise'
  isNew: boolean
  seerAnalysis: string
  recommendedAction: string
}

export type DigestSummary = {
  total: number
  critical: number
  moderate: number
  trivial: number
  noise: number
}

export type SentryTriageDigestEmailProps = {
  dateRange: string
  summary: DigestSummary
  issues: DigestIssue[]
  isIncidentMode: boolean
  phase: string
}

const severityColors = {
  critical: '#DC2626',
  moderate: '#D97706',
  trivial: '#2563EB',
  noise: '#6B7280',
}

const severityLabels = {
  critical: 'Critical',
  moderate: 'Moderate',
  trivial: 'Trivial',
  noise: 'Noise',
}

export function SentryTriageDigestEmail({
  dateRange,
  summary,
  issues,
  isIncidentMode,
  phase,
}: SentryTriageDigestEmailProps) {
  return (
    <Layout previewText={`Sentry triage digest — ${dateRange}`}>
      {isIncidentMode ? (
        <Section style={incidentBanner}>
          <p style={incidentTitle}>Incident mode active</p>
          <p style={incidentText}>
            Critical issues require immediate triage before routine review.
          </p>
        </Section>
      ) : null}

      <Section style={intro}>
        <EmailHeading>Sentry Triage Digest</EmailHeading>
        <EmailText>{dateRange}</EmailText>
      </Section>

      <Section style={summarySection}>
        <p style={summaryTitle}>Summary</p>
        <div style={summaryGrid}>
          <SummaryStat label="Total" value={summary.total} color={BRAND_GREEN} />
          <SummaryStat
            label="Critical"
            value={summary.critical}
            color={severityColors.critical}
          />
          <SummaryStat
            label="Moderate"
            value={summary.moderate}
            color={severityColors.moderate}
          />
          <SummaryStat
            label="Trivial"
            value={summary.trivial}
            color={severityColors.trivial}
          />
          <SummaryStat label="Noise" value={summary.noise} color={TEXT_SECONDARY} />
        </div>
      </Section>

      <EmailDivider />

      {issues.length === 0 ? (
        <Section style={allClearSection}>
          <p style={allClearTitle}>All clear</p>
          <p style={bodyText}>
            No Sentry issues matched this digest window. Continue routine
            monitoring.
          </p>
        </Section>
      ) : (
        <Section style={issueList}>
          {issues.map((issue, index) => (
            <React.Fragment key={`${issue.url}-${issue.title}`}>
              {index > 0 ? <EmailDivider /> : null}
              <IssueCard issue={issue} />
            </React.Fragment>
          ))}
        </Section>
      )}

      <Section style={phaseFooter}>
        <p style={phaseLabel}>Triage phase</p>
        <p style={phaseText}>{phase}</p>
      </Section>
    </Layout>
  )
}

function SummaryStat({
  label,
  value,
  color,
}: {
  label: string
  value: number
  color: string
}) {
  return (
    <div style={summaryItem}>
      <p style={{ ...summaryValue, color }}>{value}</p>
      <p style={summaryLabel}>{label}</p>
    </div>
  )
}

function IssueCard({ issue }: { issue: DigestIssue }) {
  return (
    <div style={issueCard}>
      <div style={issueMeta}>
        <span
          style={{
            ...severityBadge,
            backgroundColor: severityColors[issue.severity],
          }}
        >
          {severityLabels[issue.severity]}
        </span>
        <span style={eventCount}>{issue.eventCount} events</span>
        {issue.isNew ? <span style={newBadge}>NEW</span> : null}
      </div>

      <a href={issue.url} style={issueTitle}>
        {issue.title}
      </a>

      <div style={analysisBlock}>
        <p style={blockLabel}>Seer analysis</p>
        <p style={bodyText}>{issue.seerAnalysis}</p>
      </div>

      <div style={actionBlock}>
        <p style={blockLabel}>Recommended action</p>
        <p style={bodyText}>{issue.recommendedAction}</p>
      </div>
    </div>
  )
}

export default SentryTriageDigestEmail

export async function buildSentryTriageDigestEmail(
  params: SentryTriageDigestEmailProps & { to: string },
): Promise<EmailMessage> {
  const html = await render(<SentryTriageDigestEmail {...params} />)

  return {
    to: params.to,
    from: FROM_ADDRESS,
    subject: 'Sentry Triage Digest — ' + params.dateRange,
    html,
    replyTo: 'ops@formoria.com',
  }
}

const intro = {
  margin: '0 0 24px',
}

const incidentBanner = {
  backgroundColor: '#FEF2F2',
  border: `1px solid ${severityColors.critical}`,
  borderRadius: '8px',
  margin: '0 0 24px',
  padding: '16px',
}

const incidentTitle = {
  color: severityColors.critical,
  fontFamily: FONT_STACK,
  fontSize: '16px',
  fontWeight: '700',
  lineHeight: '24px',
  margin: '0 0 4px',
}

const incidentText = {
  color: TEXT_PRIMARY,
  fontFamily: FONT_STACK,
  fontSize: '14px',
  lineHeight: '20px',
  margin: '0',
}

const summarySection = {
  backgroundColor: BG_WHITE,
  border: `1px solid ${BORDER}`,
  borderRadius: '8px',
  margin: '0 0 24px',
  padding: '20px',
}

const summaryTitle = {
  color: TEXT_PRIMARY,
  fontFamily: FONT_STACK,
  fontSize: '18px',
  fontWeight: '700',
  lineHeight: '26px',
  margin: '0 0 16px',
}

const summaryGrid = {
  display: 'grid',
  gap: '12px',
  gridTemplateColumns: 'repeat(5, 1fr)',
}

const summaryItem = {
  backgroundColor: BG_WARM_WHITE,
  border: `1px solid ${BORDER}`,
  borderRadius: '8px',
  padding: '12px 8px',
  textAlign: 'center' as const,
}

const summaryValue = {
  fontFamily: FONT_STACK,
  fontSize: '22px',
  fontWeight: '700',
  lineHeight: '28px',
  margin: '0',
}

const summaryLabel = {
  color: TEXT_SECONDARY,
  fontFamily: FONT_STACK,
  fontSize: '12px',
  fontWeight: '600',
  lineHeight: '16px',
  margin: '4px 0 0',
  textTransform: 'uppercase' as const,
}

const issueList = {
  margin: '0 0 24px',
}

const issueCard = {
  backgroundColor: BG_WHITE,
  border: `1px solid ${BORDER}`,
  borderRadius: '8px',
  padding: '20px',
}

const issueMeta = {
  margin: '0 0 12px',
}

const severityBadge = {
  borderRadius: '999px',
  color: BG_WHITE,
  display: 'inline-block',
  fontFamily: FONT_STACK,
  fontSize: '12px',
  fontWeight: '700',
  lineHeight: '16px',
  margin: '0 8px 8px 0',
  padding: '4px 8px',
  textTransform: 'uppercase' as const,
}

const eventCount = {
  color: TEXT_SECONDARY,
  display: 'inline-block',
  fontFamily: FONT_STACK,
  fontSize: '13px',
  fontWeight: '600',
  lineHeight: '18px',
  margin: '0 8px 8px 0',
}

const newBadge = {
  backgroundColor: BRAND_GREEN,
  borderRadius: '999px',
  color: BG_WHITE,
  display: 'inline-block',
  fontFamily: FONT_STACK,
  fontSize: '11px',
  fontWeight: '700',
  lineHeight: '15px',
  margin: '0 0 8px',
  padding: '3px 7px',
}

const issueTitle = {
  color: BRAND_GREEN,
  display: 'block',
  fontFamily: FONT_STACK,
  fontSize: '18px',
  fontWeight: '700',
  lineHeight: '26px',
  margin: '0 0 16px',
  textDecoration: 'none',
}

const analysisBlock = {
  backgroundColor: BG_WARM_WHITE,
  borderRadius: '8px',
  margin: '0 0 12px',
  padding: '14px',
}

const actionBlock = {
  backgroundColor: '#FFF7ED',
  borderLeft: `4px solid ${TERRACOTTA}`,
  borderRadius: '8px',
  margin: '0',
  padding: '14px',
}

const blockLabel = {
  color: TEXT_SECONDARY,
  fontFamily: FONT_STACK,
  fontSize: '12px',
  fontWeight: '700',
  letterSpacing: '0',
  lineHeight: '16px',
  margin: '0 0 6px',
  textTransform: 'uppercase' as const,
}

const bodyText = {
  color: TEXT_PRIMARY,
  fontFamily: FONT_STACK,
  fontSize: '14px',
  lineHeight: '21px',
  margin: '0',
}

const allClearSection = {
  backgroundColor: BG_WHITE,
  border: `1px solid ${BORDER}`,
  borderRadius: '8px',
  margin: '0 0 24px',
  padding: '24px 20px',
}

const allClearTitle = {
  color: BRAND_GREEN,
  fontFamily: FONT_STACK,
  fontSize: '20px',
  fontWeight: '700',
  lineHeight: '28px',
  margin: '0 0 8px',
}

const phaseFooter = {
  borderTop: `1px solid ${BORDER}`,
  margin: '24px 0 0',
  padding: '16px 0 0',
}

const phaseLabel = {
  color: TEXT_SECONDARY,
  fontFamily: FONT_STACK,
  fontSize: '12px',
  fontWeight: '700',
  lineHeight: '16px',
  margin: '0 0 4px',
  textTransform: 'uppercase' as const,
}

const phaseText = {
  color: TEXT_PRIMARY,
  fontFamily: FONT_STACK,
  fontSize: '14px',
  fontWeight: '600',
  lineHeight: '20px',
  margin: '0',
}
