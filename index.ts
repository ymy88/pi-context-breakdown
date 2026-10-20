/**
 * /context — show what the current context window is made of.
 *
 * The total and percentage come from pi's ctx.getContextUsage() (last request's real usage
 * plus estimated trailing messages). The per-group split is estimated with pi's estimateTokens
 * and scaled onto that total, so the rows add up to the number pi shows in its footer.
 *
 * Usage: /context   (ctrl+o expands each group into its parts)
 */

import { estimateTokens, type ExtensionAPI, type ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";

const BAR_CELLS = 40;
const ENTRY_TYPE = "context-breakdown";

type Color = "accent" | "success" | "warning" | "mdCode" | "dim";

interface Row {
	label: string;
	tokens: number;
}

interface Group extends Row {
	color: Color;
	detail: Row[];
}

interface Breakdown {
	model: string;
	window: number;
	used: number;
	estimated: boolean;
	groups: Group[];
}

const safeJson = (value: unknown) => {
	try {
		return JSON.stringify(value) ?? "";
	} catch {
		return "";
	}
};

const estimateText = (text: string) => estimateTokens({ role: "user", content: text } as never);

interface Declaration {
	name: string;
	description?: string;
	parameters?: unknown;
}

/** Replay system messages on the active branch into the current prompt sections and tool declarations. */
function replaySystemMessages(messages: readonly { role?: string }[]) {
	const sections = new Map<string, string>();
	const declarations = new Map<string, Declaration>();

	for (const message of messages) {
		if (message.role !== "system") continue;
		const sys = message as {
			content?: unknown;
			sections?: Record<string, string | null>;
			toolsAdded?: Declaration[];
			toolsRemoved?: Declaration[];
		};
		if (typeof sys.content === "string" && sys.content.length > 0) sections.set("prompt", sys.content);
		for (const [name, text] of Object.entries(sys.sections ?? {})) {
			if (text === null) sections.delete(name);
			else if (text) sections.set(name, text);
		}
		for (const removed of sys.toolsRemoved ?? []) declarations.delete(removed.name);
		for (const added of sys.toolsAdded ?? []) declarations.set(added.name, added);
	}
	return { sections, declarations };
}

export function computeBreakdown(pi: ExtensionAPI, ctx: ExtensionCommandContext): Breakdown {
	const projection = ctx.sessionManager.buildSessionProjection();
	const { sections, declarations } = replaySystemMessages(projection.messages);

	// Before the first request the transcript has no system message yet: fall back to what pi would send.
	if (sections.size === 0) {
		const prompt = ctx.getSystemPrompt();
		if (prompt) sections.set("system prompt", prompt);
	}
	if (declarations.size === 0) {
		const active = new Set(pi.getActiveTools());
		for (const tool of pi.getAllTools()) if (active.has(tool.name)) declarations.set(tool.name, tool);
	}

	const promptDetail = [...sections]
		.map(([label, text]) => ({ label, tokens: estimateText(text) }))
		.sort((a, b) => b.tokens - a.tokens);

	const namespaces = new Map(pi.getAllTools().map((tool) => [tool.name, tool.namespace?.name]));
	const declared = [...declarations.values()].map((tool) => ({
		name: tool.name,
		server: namespaces.get(tool.name),
		tokens: estimateText(safeJson({ name: tool.name, description: tool.description, parameters: tool.parameters })),
	}));
	const builtin = declared
		.filter((tool) => !tool.server)
		.map(({ name, tokens }) => ({ label: name, tokens }))
		.sort((a, b) => b.tokens - a.tokens);
	const servers = new Map<string, { tokens: number; count: number }>();
	for (const tool of declared) {
		if (!tool.server) continue;
		const entry = servers.get(tool.server) ?? { tokens: 0, count: 0 };
		servers.set(tool.server, { tokens: entry.tokens + tool.tokens, count: entry.count + 1 });
	}
	const mcpDetail = [...servers]
		.sort((a, b) => b[1].tokens - a[1].tokens)
		.map(([server, { tokens, count }]) => ({ label: `${server.replace(/^mcp__/, "")} (${count} tools)`, tokens }));

	const byRole = new Map<string, number>();
	for (const message of projection.messages) {
		if (message.role === "system") continue;
		const label = message.role === "toolResult" ? "tool results" : `${message.role} messages`;
		byRole.set(label, (byRole.get(label) ?? 0) + estimateTokens(message as never));
	}
	const messageDetail = [...byRole].map(([label, tokens]) => ({ label, tokens })).sort((a, b) => b.tokens - a.tokens);

	const sum = (rows: Row[]) => rows.reduce((total, row) => total + row.tokens, 0);
	const groups: Group[] = [
		{ label: "System prompt", color: "accent", tokens: sum(promptDetail), detail: promptDetail },
		{ label: "System tools", color: "success", tokens: sum(builtin), detail: builtin },
		{ label: "MCP tools", color: "warning", tokens: sum(mcpDetail), detail: mcpDetail },
		{ label: "Messages", color: "mdCode", tokens: sum(messageDetail), detail: messageDetail },
	].filter((group) => group.tokens > 0);

	// Anchor the estimated split to the number pi reports; without one (fresh session, right
	// after compaction) the estimate is all we have.
	const reported = ctx.getContextUsage()?.tokens ?? null;
	const anchor = reported !== null && reported > 0 ? reported : null;
	const raw = sum(groups);
	const scale = anchor !== null && raw > 0 ? anchor / raw : 1;
	for (const group of groups) {
		group.tokens = Math.round(group.tokens * scale);
		for (const row of group.detail) row.tokens = Math.round(row.tokens * scale);
	}

	return {
		model: ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : "no model",
		window: ctx.getContextUsage()?.contextWindow ?? ctx.model?.contextWindow ?? 0,
		used: anchor ?? raw,
		estimated: anchor === null,
		groups,
	};
}

const fmt = (count: number) =>
	count >= 100000 ? `${Math.round(count / 1000)}k` : count >= 1000 ? `${(count / 1000).toFixed(1)}k` : `${count}`;

const pct = (part: number, whole: number) => {
	if (whole <= 0) return "-";
	const percent = (part / whole) * 100;
	return percent > 0 && percent < 0.1 ? "<0.1%" : `${percent.toFixed(1)}%`;
};

export function renderLines(data: Breakdown, theme: { fg: (color: string, text: string) => string }, expanded: boolean): string[] {
	const { window, used, groups } = data;
	const free = Math.max(window - used, 0);

	let left = groups.length > 0 ? BAR_CELLS : 0;
	const counts = groups.map((group) => {
		const cells = Math.min(Math.round((group.tokens / (window || 1)) * BAR_CELLS) || (group.tokens > 0 ? 1 : 0), left);
		left -= cells;
		return cells;
	});
	const bar = groups.map((group, index) => theme.fg(group.color, "■".repeat(counts[index]))).join("");
	const emptyBar = theme.fg("dim", "·".repeat(left));

	const header = `${data.model} · ${fmt(used)} / ${fmt(window)} tokens (${pct(used, window)})`;
	const lines = [
		`${theme.fg("accent", "Context usage")} ${theme.fg("dim", data.estimated ? `${header} — estimated` : header)}`,
		`${bar}${emptyBar}`,
		"",
	];

	for (const group of groups) {
		lines.push(`  ${theme.fg(group.color, "■")} ${group.label.padEnd(15)} ${fmt(group.tokens).padStart(7)}  ${pct(group.tokens, window)}`);
		if (!expanded) continue;
		for (const row of group.detail) {
			const label = row.label.length > 28 ? `${row.label.slice(0, 27)}…` : row.label;
			lines.push(theme.fg("dim", `        ${label.padEnd(28)} ${fmt(row.tokens).padStart(7)}`));
		}
	}
	lines.push(`  ${theme.fg("dim", "·")} ${"Free space".padEnd(15)} ${fmt(free).padStart(7)}  ${pct(free, window)}`);
	return lines;
}

function plainText(data: Breakdown): string {
	const lines = [`Context usage · ${data.model} · ${fmt(data.used)} / ${fmt(data.window)} tokens (${pct(data.used, data.window)})`];
	for (const group of data.groups) lines.push(`  ${group.label}: ${fmt(group.tokens)} (${pct(group.tokens, data.window)})`);
	lines.push(`  Free space: ${fmt(Math.max(data.window - data.used, 0))}`);
	return lines.join("\n");
}

export default function (pi: ExtensionAPI) {
	pi.registerEntryRenderer<Breakdown>(ENTRY_TYPE, (entry, options, theme) =>
		entry.data ? new Text(renderLines(entry.data, theme, options.expanded).join("\n"), 0, 0) : undefined,
	);

	pi.registerCommand("context", {
		description: "Show what the context window is made of",
		handler: async (_args, ctx) => {
			const data = computeBreakdown(pi, ctx);
			if (ctx.mode === "tui") pi.appendEntry(ENTRY_TYPE, data);
			else ctx.ui.notify(plainText(data), "info");
		},
	});
}
