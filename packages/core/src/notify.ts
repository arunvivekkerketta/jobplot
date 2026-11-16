/**
 * The one shape a "a human is needed" notification may take (I5/I7).
 *
 * Only the posting, the portal and the reason code may travel: never an answer,
 * a resume paragraph, an email address or a phone number.
 */
export interface NotifyMessage {
  title: string;
  body: string;
}

export interface NotifyInput {
  title: string;
  company?: string;
  portal: string;
  reason: string;
}

export function formatHumanNeeded(input: NotifyInput): NotifyMessage {
  const posting = input.company ? `${input.title} at ${input.company}` : input.title;
  return {
    title: `JobPilot needs you (${input.reason})`,
    body: `${posting} on ${input.portal} stopped: ${input.reason}. Open JobPilot to continue.`,
  };
}
