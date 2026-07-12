import { pathToFileURL } from "node:url";
import { convertCodexContentToPiContent, type PiContentBlock } from "./content.ts";
import { logDebug } from "./log.ts";
import { SerialQueue } from "./queue.ts";
export interface ComputerUseClient {
	request<T>(method: string, params: unknown): Promise<T>;
}

export interface ComputerUseThreads {
	getThreadId(cwd: string): Promise<string>;
	reset(): void;
}

export interface ComputerUseBackendOptions {
	mcpServerName?: string;
	computerUsePluginRoot?: string;
}

export interface ComputerUseToolResult {
	content: PiContentBlock[];
	structuredContent?: unknown | undefined;
	meta?: unknown | undefined;
}

interface RawMcpToolCallResponse {
	content: unknown;
	structuredContent?: unknown;
	_meta?: unknown;
	isError?: boolean | null;
}

export class ComputerUseBackend {
	private readonly queue = new SerialQueue();
	private readonly mcpServerName: string;
	private computerUsePluginRoot: string | undefined;

	constructor(
		private readonly client: ComputerUseClient,
		private readonly threads: ComputerUseThreads,
		options: ComputerUseBackendOptions = {},
	) {
		this.mcpServerName = options.mcpServerName ?? "computer-use";
		this.computerUsePluginRoot = options.computerUsePluginRoot;
	}

	setComputerUsePluginRoot(pluginRoot: string): void {
		this.computerUsePluginRoot = pluginRoot;
	}

	async callTool(cwd: string, tool: string, args: Record<string, unknown>): Promise<ComputerUseToolResult> {
		return this.queue.enqueue(async () => {
			logDebug("computer-use.tool.start", { tool, argKeys: Object.keys(args) });
			try {
				return await this.callToolOnce(cwd, tool, args);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				if (!/thread not found|invalid thread id/i.test(message)) throw error;

				logDebug("computer-use.tool.retry-thread", { tool });
				this.threads.reset();
				return this.callToolOnce(cwd, tool, args);
			}
		});
	}

	private async callToolOnce(cwd: string, tool: string, args: Record<string, unknown>): Promise<ComputerUseToolResult> {
		const threadId = await this.threads.getThreadId(cwd);
		const pluginRoot = this.computerUsePluginRoot;
		const request = pluginRoot
			? {
					server: "node_repl",
					threadId,
					tool: "js",
					arguments: {
						code: buildNodeReplCode(pluginRoot, tool, args),
						timeout_ms: 120_000,
						title: toolTitle(tool),
					},
				}
			: {
					server: this.mcpServerName,
					threadId,
					tool,
					arguments: args,
				};
		const response = await this.client.request<RawMcpToolCallResponse>("mcpServer/tool/call", request);

		if (response.isError) {
			logDebug("computer-use.tool.error", { tool });
			const text = convertCodexContentToPiContent(response.content)
				.filter((block) => block.type === "text")
				.map((block) => block.text)
				.join("\n");
			throw new Error(text || `${this.mcpServerName}.${tool} failed`);
		}

		const content = convertCodexContentToPiContent(response.content);
		logDebug("computer-use.tool.end", {
			tool,
			contentTypes: content.map((block) => block.type).join(","),
		});

		return {
			content,
			structuredContent: response.structuredContent,
			meta: response._meta,
		};
	}
}

function buildNodeReplCode(pluginRoot: string, tool: string, args: Record<string, unknown>): string {
	if (!COMPUTER_USE_TOOLS[tool]) throw new Error(`Unsupported Computer Use tool: ${tool}`);

	const clientUrl = pathToFileURL(`${pluginRoot}/scripts/computer-use-client.mjs`).href;
	const bootstrap = [
		"if (!globalThis.sky) {",
		"  // Runtime-selected installed plugin path cannot use a static import.",
		`  const { setupComputerUseRuntime } = await import(${JSON.stringify(clientUrl)});`,
		"  await setupComputerUseRuntime({ globals: globalThis });",
		"}",
	].join("\n");
	const serializedArgs = JSON.stringify(args);

	if (tool === "list_apps") {
		return `${bootstrap}\n{\n  const result = await sky.list_apps();\n  nodeRepl.write(JSON.stringify(result));\n}`;
	}
	if (tool === "get_app_state") {
		return [
			bootstrap,
			"{",
			`  const state = await sky.get_app_state(${serializedArgs});`,
			"  nodeRepl.write(state.text);",
			"  if (state.screenshot) {",
			"    // REPL code cannot declare static imports.",
			'    const { readFile } = await import("node:fs/promises");',
			'    const { fileURLToPath } = await import("node:url");',
			"    const bytes = await readFile(fileURLToPath(state.screenshot.url));",
			"    // Codex may write JPEG or PNG; sniff magic bytes so the declared type is truthful.",
			'    const mimeType = bytes[0] === 0xff && bytes[1] === 0xd8 ? "image/jpeg" : "image/png";',
			"    await nodeRepl.emitImage({ bytes, mimeType });",
			"  }",
			"}",
		].join("\n");
	}

	return `${bootstrap}\n{\n  await sky.${tool}(${serializedArgs});\n  nodeRepl.write("ok");\n}`;
}

function toolTitle(tool: string): string {
	return TOOL_TITLES[tool] ?? "Use desktop app";
}

const COMPUTER_USE_TOOLS: Record<string, true> = {
	list_apps: true,
	get_app_state: true,
	click: true,
	perform_secondary_action: true,
	set_value: true,
	select_text: true,
	scroll: true,
	drag: true,
	press_key: true,
	type_text: true,
};

const TOOL_TITLES: Record<string, string> = {
	list_apps: "List desktop apps",
	get_app_state: "Inspect desktop app",
	click: "Click desktop app",
	perform_secondary_action: "Use app action",
	set_value: "Set app value",
	select_text: "Select app text",
	scroll: "Scroll desktop app",
	drag: "Drag in desktop app",
	press_key: "Press app key",
	type_text: "Type in desktop app",
};
