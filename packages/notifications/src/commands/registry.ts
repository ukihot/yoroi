import {
	handleFeedback,
	handleFlakySubcommand,
	handleQueue,
	handleRecheck,
	handleStatus,
	handleWhy
} from './handlers.ts';
import {
	type CommandContext,
	type CommandHandler,
	type CommandPorts,
	type CommandResult,
	isAuthorized,
	type SlashCommandSpec
} from './types.ts';

export type {
	AuditEventInput,
	CommandContext,
	CommandHandler,
	CommandPorts,
	CommandResult,
	FeedbackInput,
	FlakyConfidence,
	FlakyQuarantineProposalInput,
	FlakyReportInput,
	FlakyReportResult,
	GateSnapshot,
	QueueSnapshot,
	RepoPermission,
	SlashCommandSpec
} from './types.ts';
export { isAuthorized, PERMISSION_RANK } from './types.ts';

/**
 * design.md §15.1: regex parsing + fixed handler dispatch only — never
 * `eval`-style execution of PR body / comment text as shell, SQL, or
 * template expressions. `/yoroi <name> [args...]`, args space-split.
 */
const COMMAND_PATTERN = /^\/yoroi\s+([a-z-]+)(?:\s+(.*))?$/;

export function parseCommand(
	commentBody: string
): { readonly name: string; readonly args: string[] } | null {
	const match = COMMAND_PATTERN.exec(commentBody.trim());
	if (!match) return null;
	const name = match[1];
	if (!name) return null;
	return { name, args: (match[2] ?? '').split(/\s+/).filter(Boolean) };
}

// handleHelp lists COMMANDS, and COMMANDS includes the "help" entry itself —
// this closure reads COMMANDS via the outer binding, which is safe because
// help only ever *executes* after module evaluation has finished assigning
// COMMANDS (never during it).
const handleHelp: CommandHandler = (_ctx, _args, _ports) => {
	const lines = COMMANDS.map((c) => {
		const qualifier = c.allowPrAuthor ? `${c.minPermission} or PR author` : c.minPermission;
		return `- \`/yoroi ${c.name}\` (${qualifier})`;
	});
	return Promise.resolve({ kind: 'ok', markdown: lines.join('\n') });
};

/** design.md §9.9.1's registry, verbatim command set. `priority`, `pause`,
 * `freeze`, `break-glass`, and policy changes are deliberately absent —
 * those stay on the operator-only management API (design.md §16), never
 * exposed as general slash commands. */
export const COMMANDS: readonly SlashCommandSpec[] = [
	{
		name: 'status',
		minPermission: 'read',
		allowPrAuthor: false,
		sideEffecting: false,
		idempotent: true,
		rateLimitKey: (c) => `status:${c.actorStableId}`,
		handler: handleStatus
	},
	{
		name: 'why',
		minPermission: 'read',
		allowPrAuthor: false,
		sideEffecting: false,
		idempotent: true,
		rateLimitKey: (c) => `why:${c.actorStableId}`,
		handler: handleWhy
	},
	{
		name: 'recheck',
		minPermission: 'write',
		allowPrAuthor: true,
		sideEffecting: true,
		idempotent: true,
		rateLimitKey: (c) =>
			`recheck:${c.repo.repositoryId}:${c.pullRequestNumber}:${c.observedHeadSha}`,
		handler: handleRecheck
	},
	{
		name: 'queue',
		minPermission: 'write',
		allowPrAuthor: false,
		sideEffecting: false,
		idempotent: true,
		rateLimitKey: (c) => `queue:${c.actorStableId}`,
		handler: handleQueue
	},
	{
		name: 'flaky',
		// "report" is open to any CI-viewing contributor; "quarantine-request"
		// enforces write inside handleFlakySubcommand itself (see its comment).
		minPermission: 'read',
		allowPrAuthor: false,
		sideEffecting: true,
		idempotent: false,
		rateLimitKey: (c) => `flaky:${c.actorStableId}`,
		handler: handleFlakySubcommand
	},
	{
		name: 'feedback',
		minPermission: 'read',
		allowPrAuthor: false,
		sideEffecting: true,
		idempotent: false,
		rateLimitKey: (c) => `feedback:${c.actorStableId}`,
		handler: handleFeedback
	},
	{
		name: 'help',
		minPermission: 'read',
		allowPrAuthor: false,
		sideEffecting: false,
		idempotent: true,
		rateLimitKey: (c) => `help:${c.actorStableId}`,
		handler: handleHelp
	}
];

/** Parses, authorizes, and dispatches one PR comment to its command handler.
 * Never throws for user-input reasons (unparseable text, unknown command
 * name, insufficient permission) — those all come back as a typed
 * `CommandResult` variant instead. */
export function dispatchCommand(
	ctx: CommandContext,
	commentBody: string,
	ports: CommandPorts
): Promise<CommandResult> {
	const parsed = parseCommand(commentBody);
	if (!parsed) return Promise.resolve({ kind: 'unknown_command', attempted: commentBody });

	const spec = COMMANDS.find((c) => c.name === parsed.name);
	if (!spec) return Promise.resolve({ kind: 'unknown_command', attempted: parsed.name });

	if (!isAuthorized(ctx, spec)) {
		return Promise.resolve({
			kind: 'denied',
			reason: `/yoroi ${spec.name} には ${spec.minPermission} 権限が必要です`
		});
	}

	return spec.handler(ctx, parsed.args, ports);
}
