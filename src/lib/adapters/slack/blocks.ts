import { boundedSlackText } from "@/lib/adapters/slack/notification";

type SlackBlock = Record<string, unknown>;

type ProposalCardInput = {
  requestId: string;
  operatorSlackId: string;
  proposal: string;
  rationale: string;
  expiresAt: string;
};

type ResultCardInput = {
  proposal: string;
  result?: string;
  /** Human-readable outcome; shown under *Result* in place of `result`. */
  summary?: string;
  error?: string;
};

export function renderProposalCard(input: ProposalCardInput): SlackBlock[] {
  const { requestId, operatorSlackId, proposal, rationale, expiresAt } = input;

  return [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: "Ops Agent — Action Proposal",
        emoji: true,
      },
    },
    {
      type: "section",
      fields: [
        {
          type: "mrkdwn",
          text: boundedSlackText(`*Action*\n${proposal}`),
        },
        {
          type: "mrkdwn",
          text: boundedSlackText(`*Why*\n${rationale}`),
        },
        {
          type: "mrkdwn",
          text: boundedSlackText(`*Operator*\n<@${operatorSlackId}>`),
        },
        {
          type: "mrkdwn",
          text: boundedSlackText(`*Expires*\n${expiresAt}`),
        },
      ],
    },
    {
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "Confirm" },
          style: "primary",
          action_id: "ops_confirm",
          value: requestId,
        },
        {
          type: "button",
          text: { type: "plain_text", text: "Cancel" },
          style: "danger",
          action_id: "ops_cancel",
          value: requestId,
        },
      ],
    },
  ];
}

export function renderResultCard(input: ResultCardInput): SlackBlock[] {
  const { proposal, result, summary, error } = input;

  const body = error
    ? `*Error*\n${error}`
    : `*Result*\n${summary ?? result ?? "Done"}`;

  return [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: "Ops Agent — Result",
        emoji: true,
      },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: boundedSlackText(`*Action*\n${proposal}\n\n${body}`),
      },
    },
  ];
}

export function renderAnswer(text: string): SlackBlock[] {
  return [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: boundedSlackText(text),
      },
    },
  ];
}

type ThreadNoticeInput = {
  title: string;
  body: string;
  context?: string;
};

const HEADER_TEXT_LIMIT = 150;

function truncatePlain(text: string, limit: number): string {
  const characters = Array.from(text);
  if (characters.length <= limit) return text;
  return characters.slice(0, limit - 1).join("") + "…";
}

export function renderThreadNotice(input: ThreadNoticeInput): {
  text: string;
  blocks: SlackBlock[];
} {
  const { title, body, context } = input;

  const blocks: SlackBlock[] = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: truncatePlain(title, HEADER_TEXT_LIMIT),
        emoji: true,
      },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: boundedSlackText(body),
      },
    },
  ];
  if (context) {
    blocks.push({
      type: "context",
      elements: [{ type: "mrkdwn", text: boundedSlackText(context) }],
    });
  }

  return { text: `${title}\n${body}`, blocks };
}
