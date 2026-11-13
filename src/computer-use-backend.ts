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
		const normalized = normalizeToolArgs(args);
		return this.queue.enqueue(async () => {
			logDebug("computer-use.tool.start", { tool, argKeys: Object.keys(normalized) });
			try {
				return await this.callToolOnce(cwd, tool, normalized);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				if (!/thread not found|invalid thread id/i.test(message)) throw error;

				logDebug("computer-use.tool.retry-thread", { tool });
				this.threads.reset();
				return this.callToolOnce(cwd, tool, normalized);
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
						code: buildNodeReplCode(tool, args),
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

function buildNodeReplCode(tool: string, args: Record<string, unknown>): string {
	if (!COMPUTER_USE_TOOLS[tool]) throw new Error(`Unsupported Computer Use tool: ${tool}`);

	// Current macOS plugins document a bundled @oai/sky import, not a wrapper file.
	const bootstrap = 'if (!globalThis.sky) globalThis.sky = (await import("@oai/sky")).sky;';
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

	// The app-server intermittently loses its window handle (-10005
	// noWindowsAvailable / cgWindowNotFound) even for an app whose state was
	// just read; one get_app_state refresh re-resolves the window, so retry
	// the action once after a refresh before surfacing the error.
	const appOnlyArgs = JSON.stringify({ app: args.app });
	return [
		bootstrap,
		"{",
		"  try {",
		`    await sky.${tool}(${serializedArgs});`,
		"  } catch (error) {",
		"    if (!/noWindowsAvailable|cgWindowNotFound/.test(String(error))) throw error;",
		`    await sky.get_app_state(${appOnlyArgs});`,
		`    await sky.${tool}(${serializedArgs});`,
		"  }",
		'  nodeRepl.write("ok");',
		"}",
	].join("\n");
}

function normalizeToolArgs(args: Record<string, unknown>): Record<string, unknown> {
	const raw = args.element_index;
	if (typeof raw !== "string") return args;
	const trimmed = raw.trim();
	// Codex validates element indexes as integers, but harness schemas send
	// strings; coerce digit strings and leave other identifiers untouched.
	if (!/^\d+$/.test(trimmed)) return args;
	return { ...args, element_index: Number.parseInt(trimmed, 10) };
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
