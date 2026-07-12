import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { promisify } from "node:util";
import { AppServerClient } from "./app-server-client.ts";
import type { InitializeResponse, McpServerStatusListResponse, PluginListResponse, PluginMarketplaceEntry, PluginSummary } from "./protocol.ts";

const execFileAsync = promisify(execFile);

export const DEFAULT_CODEX_APP_PATH = "/Applications/ChatGPT.app";
export const DEFAULT_BUNDLED_MARKETPLACE_ROOT = `${DEFAULT_CODEX_APP_PATH}/Contents/Resources/plugins/openai-bundled`;
export const DEFAULT_PLUGIN_NAME = "computer-use";
export const DEFAULT_MCP_SERVER_NAME = "node_repl";

export type ComputerUseStatusReason =
	| "ready"
	| "codex_missing"
	| "codex_app_missing"
	| "marketplace_missing"
	| "plugin_not_installed"
	| "plugin_disabled"
	| "mcp_missing"
	| "check_failed";

export interface ComputerUseStatus {
	reason: ComputerUseStatusReason;
	message: string;
	codexVersion?: string | undefined;
	appServer?: InitializeResponse | undefined;
	codexAppPath?: string | undefined;
	marketplace?: {
		name: string;
		path?: string | null | undefined;
	} | undefined;
	plugin?: PluginSummary | undefined;
	mcpServer?: {
		name: string;
		toolNames: string[];
	} | undefined;
	error?: string | undefined;
}

export interface StatusEvaluationInput {
	codexVersion?: string | undefined;
	codexAppExists: boolean;
	appServer: InitializeResponse;
	plugins: PluginListResponse;
	mcp: McpServerStatusListResponse;
}

export async function checkComputerUseStatus(_cwd: string): Promise<ComputerUseStatus> {
	let codexVersion: string | undefined;
	try {
		codexVersion = await getCodexVersion();
	} catch (error) {
		return {
			reason: "codex_missing",
			message: "Codex CLI was not found. Install Codex and ensure `codex` is on PATH.",
			error: error instanceof Error ? error.message : String(error),
		};
	}

	const codexAppExists = await pathExists(DEFAULT_CODEX_APP_PATH);

	const client = new AppServerClient({ requestTimeoutMs: 60_000 });
	try {
		const appServer = await client.request<InitializeResponse>("initialize", {
			clientInfo: { name: "pi-codex-computer-use", version: "0.1.0" },
			capabilities: { experimentalApi: true },
		});

		const plugins = await client.request<PluginListResponse>("plugin/list", {});
		const mcp = await client.request<McpServerStatusListResponse>("mcpServerStatus/list", {});
		return evaluateComputerUseStatus({ codexVersion, codexAppExists, appServer, plugins, mcp });
	} catch (error) {
		return {
			reason: "check_failed",
			message: "Computer Use status check failed while talking to Codex app-server.",
			codexVersion,
			codexAppPath: codexAppExists ? DEFAULT_CODEX_APP_PATH : undefined,
			error: error instanceof Error ? error.message : String(error),
		};
	} finally {
		await client.stop();
	}
}

export function evaluateComputerUseStatus(input: StatusEvaluationInput): ComputerUseStatus {
	const { codexVersion, codexAppExists, appServer, plugins, mcp } = input;
	const match = findPlugin(plugins, DEFAULT_PLUGIN_NAME);
	if (!match) {
		return {
			reason: codexAppExists ? "marketplace_missing" : "codex_app_missing",
			message: codexAppExists
				? `No Codex marketplace currently lists ${DEFAULT_PLUGIN_NAME}. Try /computer-use install later.`
				: `Codex app bundle was not found at ${DEFAULT_CODEX_APP_PATH}.`,
			codexVersion,
			appServer,
			codexAppPath: codexAppExists ? DEFAULT_CODEX_APP_PATH : undefined,
		};
	}

	if (!match.plugin.installed) {
		return {
			reason: "plugin_not_installed",
			message: `${DEFAULT_PLUGIN_NAME} is available in marketplace ${match.marketplace.name}, but is not installed.`,
			codexVersion,
			appServer,
			codexAppPath: codexAppExists ? DEFAULT_CODEX_APP_PATH : undefined,
			marketplace: { name: match.marketplace.name, path: match.marketplace.path },
			plugin: match.plugin,
		};
	}

	if (!match.plugin.enabled) {
		return {
			reason: "plugin_disabled",
			message: `${DEFAULT_PLUGIN_NAME} is installed but disabled.`,
			codexVersion,
			appServer,
			codexAppPath: codexAppExists ? DEFAULT_CODEX_APP_PATH : undefined,
			marketplace: { name: match.marketplace.name, path: match.marketplace.path },
			plugin: match.plugin,
		};
	}

	const server = mcp.data.find(
		(entry) => entry.name === DEFAULT_MCP_SERVER_NAME && typeof entry.tools.js === "object",
	);
	if (!server) {
		return {
			reason: "mcp_missing",
			message: `${DEFAULT_PLUGIN_NAME} is enabled, but the Node REPL bridge is not available.`,
			codexVersion,
			appServer,
			codexAppPath: codexAppExists ? DEFAULT_CODEX_APP_PATH : undefined,
			marketplace: { name: match.marketplace.name, path: match.marketplace.path },
			plugin: match.plugin,
		};
	}

	return {
		reason: "ready",
		message: "Codex Computer Use is installed, enabled, and available through the Node REPL bridge.",
		codexVersion,
		appServer,
		codexAppPath: codexAppExists ? DEFAULT_CODEX_APP_PATH : undefined,
		marketplace: { name: match.marketplace.name, path: match.marketplace.path },
		plugin: match.plugin,
		mcpServer: { name: server.name, toolNames: Object.keys(server.tools).sort() },
	};
}

export async function installComputerUse(): Promise<ComputerUseStatus> {
	const client = new AppServerClient({ requestTimeoutMs: 120_000 });
	try {
		await client.request<InitializeResponse>("initialize", {
			clientInfo: { name: "pi-codex-computer-use", version: "0.1.0" },
			capabilities: { experimentalApi: true },
		});

		let plugins = await client.request<PluginListResponse>("plugin/list", {});
		let match = findPlugin(plugins, DEFAULT_PLUGIN_NAME);

		if (!match && (await pathExists(DEFAULT_BUNDLED_MARKETPLACE_ROOT))) {
			await client.request("marketplace/add", { source: DEFAULT_BUNDLED_MARKETPLACE_ROOT });
			plugins = await client.request<PluginListResponse>("plugin/list", {});
			match = findPlugin(plugins, DEFAULT_PLUGIN_NAME);
		}

		if (!match) {
			return {
				reason: "marketplace_missing",
				message: `Could not find a Codex marketplace containing ${DEFAULT_PLUGIN_NAME}.`,
			};
		}

		await client.request("plugin/install", {
			pluginName: DEFAULT_PLUGIN_NAME,
			marketplacePath: match.marketplace.path ?? null,
			remoteMarketplaceName: match.marketplace.path ? null : match.marketplace.name,
		});
		await client.request("config/mcpServer/reload");
	} catch (error) {
		return {
			reason: "check_failed",
			message: "Computer Use install/re-enable failed.",
			error: error instanceof Error ? error.message : String(error),
		};
	} finally {
		await client.stop();
	}

	return checkComputerUseStatus(process.cwd());
}

export async function reloadComputerUseMcpServers(): Promise<ComputerUseStatus> {
	const client = new AppServerClient({ requestTimeoutMs: 120_000 });
	try {
		await client.request<InitializeResponse>("initialize", {
			clientInfo: { name: "pi-codex-computer-use", version: "0.1.0" },
			capabilities: { experimentalApi: true },
		});
		await client.request("config/mcpServer/reload");
	} catch (error) {
		return {
			reason: "check_failed",
			message: "Codex MCP server reload failed.",
			error: error instanceof Error ? error.message : String(error),
		};
	} finally {
		await client.stop();
	}

	return checkComputerUseStatus(process.cwd());
}

export function formatComputerUseStatus(status: ComputerUseStatus): string {
	const lines = [
		`Computer Use status: ${status.reason}`,
		status.message,
		"",
		`Codex CLI: ${status.codexVersion ?? "unknown"}`,
		`ChatGPT.app: ${status.codexAppPath ?? "not found at default path"}`,
	];

	if (status.appServer) {
		lines.push(`App-server: ${status.appServer.userAgent}`);
		lines.push(`Codex home: ${status.appServer.codexHome}`);
	}

	if (status.marketplace) {
		lines.push(`Marketplace: ${status.marketplace.name}${status.marketplace.path ? ` (${status.marketplace.path})` : ""}`);
	}

	if (status.plugin) {
		lines.push(
			`Plugin: ${status.plugin.name} installed=${status.plugin.installed} enabled=${status.plugin.enabled} version=${status.plugin.localVersion ?? "unknown"}`,
		);
	}

	if (status.mcpServer) {
		lines.push(`MCP server: ${status.mcpServer.name}`);
		lines.push(`MCP tools: ${status.mcpServer.toolNames.join(", ")}`);
	}

	if (status.error) lines.push(`Error: ${status.error}`);

	return lines.join("\n");
}

async function getCodexVersion(): Promise<string> {
	const result = await execFileAsync("codex", ["--version"], { timeout: 10_000 });
	return result.stdout.trim() || result.stderr.trim() || "codex found";
}

async function pathExists(path: string): Promise<boolean> {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}

export function findPlugin(
	response: PluginListResponse,
	pluginName: string,
): { marketplace: PluginMarketplaceEntry; plugin: PluginSummary } | undefined {
	const matches: Array<{ marketplace: PluginMarketplaceEntry; plugin: PluginSummary }> = [];
	for (const marketplace of response.marketplaces) {
		const plugin = marketplace.plugins.find((entry) => entry.name === pluginName);
		if (plugin) matches.push({ marketplace, plugin });
	}

	return (
		matches.find((match) => match.marketplace.name === "openai-bundled") ??
		matches.find((match) => match.marketplace.name === "openai-curated") ??
		matches[0]
	);
}
