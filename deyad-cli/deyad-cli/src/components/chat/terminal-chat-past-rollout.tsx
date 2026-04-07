/**
 * Print a past Deyad CLI session rollout to the terminal.
 * Pure Node.js — no ink/React dependencies.
 */

export interface PastSession {
  version: string;
  id: string;
  model: string;
  timestamp: string;
  user: string;
}

export interface PastRolloutItem {
  role: string;
  content: string;
}

export function printPastRollout(
  session: PastSession,
  items: PastRolloutItem[],
): void {
  const cyan = '\x1b[36m';
  const blue = '\x1b[34m';
  const magenta = '\x1b[35m';
  const bold = '\x1b[1m';
  const dim = '\x1b[2m';
  const reset = '\x1b[0m';

  console.log(`${cyan}● Deyad CLI${reset} ${dim}v${session.version}${reset}`);
  console.log(`${magenta}●${reset} localhost ${dim}· session: ${magenta}${session.id}${reset}`);
  console.log(`  ${blue}↳${reset} ${dim}When / Who: ${bold}${session.timestamp}${reset} ${dim}/${reset} ${bold}${session.user}${reset}`);
  console.log(`  ${blue}↳${reset} ${dim}model: ${bold}${session.model}${reset}`);
  console.log('');

  for (const item of items) {
    const prefix = item.role === 'assistant' ? `${cyan}agent>${reset}` : `${bold}user>${reset}`;
    console.log(`${prefix} ${item.content}`);
  }
}
