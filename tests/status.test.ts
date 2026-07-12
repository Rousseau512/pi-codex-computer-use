import { describe, expect, it } from "vitest";
import { evaluateComputerUseStatus, findPlugin } from "../src/status.ts";
import type { InitializeResponse, McpServerStatusListResponse, PluginListResponse, PluginSummary } from "../src/protocol.ts";

const appServer: InitializeResponse = {
	userAgent: "test/0",
	codexHome: "/tmp/codex",
	platformFamily: "unix",
	platformOs: "macos",
};

function plugin(overrides: Partial<PluginSummary> = {}): PluginSummary {
	return {
		id: "computer-use@openai-bundled",
		name: "computer-use",
		installed: true,
		enabled: true,
		installPolicy: "AVAILABLE",
		authPolicy: "ON_INSTALL",
		localVersion: "1.0.0",
		...overrides,
	};
}

function plugins(entries: Array<{ name: string; path?: string | null; plugin?: PluginSummary }>): PluginListResponse {
	return {
		marketplaces: entries.map((entry) => ({
			name: entry.name,
			path: entry.path ?? null,
			plugins: entry.plugin ? [entry.plugin] : [],
		})),
	};
}

function mcp(toolNames: string[] = ["js"]): McpServerStatusListResponse {
	return {
		data: [
			{
				name: "node_repl",
				authStatus: "unsupported",
				resources: [],
				resourceTemplates: [],
				tools: Object.fromEntries(toolNames.map((name) => [name, { name, inputSchema: {} }])),
			},
		],
	};
}

describe("evaluateComputerUseStatus", () => {
	it("reports codex_app_missing when app bundle missing and no marketplace has plugin", () => {
		const status = evaluateComputerUseStatus({
			codexAppExists: false,
			appServer,
			plugins: plugins([{ name: "empty" }]),
			mcp: mcp(),
		});
		expect(status.reason).toBe("codex_app_missing");
	});

	it("reports marketplace_missing when ChatGPT.app exists but plugin is absent", () => {
		const status = evaluateComputerUseStatus({
			codexAppExists: true,
			appServer,
			plugins: plugins([{ name: "empty" }]),
			mcp: mcp(),
		});
		expect(status.reason).toBe("marketplace_missing");
	});

	it("reports plugin_not_installed", () => {
		const status = evaluateComputerUseStatus({
			codexAppExists: true,
			appServer,
			plugins: plugins([{ name: "openai-bundled", plugin: plugin({ installed: false }) }]),
			mcp: mcp(),
		});
		expect(status.reason).toBe("plugin_not_installed");
	});

	it("reports plugin_disabled", () => {
		const status = evaluateComputerUseStatus({
			codexAppExists: true,
			appServer,
			plugins: plugins([{ name: "openai-bundled", plugin: plugin({ enabled: false }) }]),
			mcp: mcp(),
		});
		expect(status.reason).toBe("plugin_disabled");
	});

	it("reports mcp_missing when the Node REPL bridge is absent", () => {
		const status = evaluateComputerUseStatus({
			codexAppExists: true,
			appServer,
			plugins: plugins([{ name: "openai-bundled", plugin: plugin() }]),
			mcp: { data: [] },
		});
		expect(status.reason).toBe("mcp_missing");
	});

	it("reports ready with the Node REPL bridge", () => {
		const status = evaluateComputerUseStatus({
			codexAppExists: true,
			appServer,
			plugins: plugins([{ name: "openai-bundled", plugin: plugin() }]),
			mcp: mcp(),
		});
		expect(status.reason).toBe("ready");
		expect(status.mcpServer?.toolNames).toEqual(["js"]);
	});
});

describe("findPlugin", () => {
	it("prefers openai-bundled over other marketplaces", () => {
		const bundled = plugin({ id: "bundled" });
		const curated = plugin({ id: "curated" });
		const match = findPlugin(plugins([
			{ name: "openai-curated", plugin: curated },
			{ name: "openai-bundled", plugin: bundled },
		]), "computer-use");

		expect(match?.plugin.id).toBe("bundled");
	});
});
