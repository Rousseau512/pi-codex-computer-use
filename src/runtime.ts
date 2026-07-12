import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { AppServerClient, type ServerRequestResponder } from "./app-server-client.ts";
import { ComputerUseBackend, type ComputerUseToolResult } from "./computer-use-backend.ts";
import { setComputerUseStatus } from "./footer-status.ts";
import { logDebug } from "./log.ts";
import type { AppServerRequest, InitializeResponse, PluginListResponse } from "./protocol.ts";
import { CodexThreadManager } from "./thread-manager.ts";

export class ComputerUseRuntime {
	readonly client = new AppServerClient({ requestTimeoutMs: 120_000 });
	readonly threads = new CodexThreadManager(this.client);
	readonly backend = new ComputerUseBackend(this.client, this.threads);

	private latestContext: ExtensionContext | undefined;
	private initializePromise: Promise<InitializeResponse> | undefined;
	private idleTimer: NodeJS.Timeout | undefined;

	constructor() {
		this.client.onServerRequest((request, responder) => this.handleServerRequest(request, responder));
	}

	setContext(ctx: ExtensionContext): void {
		this.latestContext = ctx;
	}

	resetSession(): void {
		this.threads.reset();
	}

	async shutdown(): Promise<void> {
		logDebug("runtime.shutdown");
		this.clearIdleTimer();
		this.initializePromise = undefined;
		this.threads.reset();
		await this.client.stop();
	}

	async initialize(): Promise<InitializeResponse> {
		if (!this.client.isRunning()) {
			this.initializePromise = undefined;
			this.threads.reset();
		}

		this.initializePromise ??= this.initializeBackend();
		return this.initializePromise;
	}

	async callTool(ctx: ExtensionContext, tool: string, args: Record<string, unknown>): Promise<ComputerUseToolResult> {
		this.setContext(ctx);
		this.clearIdleTimer();
		if (typeof args.app === "string") setComputerUseStatus(ctx, "working", args.app);
		else setComputerUseStatus(ctx, "working");

		try {
			await this.initialize();
			const result = await this.backend.callTool(ctx.cwd, tool, args);
			setComputerUseStatus(ctx, "ready");
			return result;
		} catch (error) {
			setComputerUseStatus(ctx, "error");
			throw error;
		} finally {
			this.scheduleIdleShutdown();
		}
	}

	private async handleServerRequest(request: AppServerRequest, responder: ServerRequestResponder): Promise<void> {
		if (request.method !== "mcpServer/elicitation/request") {
			responder.reject({ code: -32601, message: `Unsupported Codex app-server request: ${request.method}` });
			return;
		}

		const params = request.params as { message?: string; serverName?: string; _meta?: unknown } | undefined;
		const message = params?.message ?? "Codex Computer Use requests permission to continue.";
		setComputerUseStatus(this.latestContext, "permission");
		logDebug("elicitation.request", { serverName: params?.serverName, message });

		if (shouldDevAutoAccept(message)) {
			logDebug("elicitation.accept.dev");
			responder.accept({ action: "accept", content: {} });
			return;
		}

		const ctx = this.latestContext;
		if (!ctx?.hasUI) {
			logDebug("elicitation.decline.no-ui");
			responder.accept({ action: "decline", content: null });
			return;
		}

		const approved = await ctx.ui.confirm(
			"Codex Computer Use permission",
			message,
			ctx.signal ? { signal: ctx.signal } : undefined,
		);
		logDebug(approved ? "elicitation.accept.user" : "elicitation.decline.user");
		responder.accept({ action: approved ? "accept" : "decline", content: approved ? {} : null });
	}

	private clearIdleTimer(): void {
		if (!this.idleTimer) return;
		clearTimeout(this.idleTimer);
		this.idleTimer = undefined;
	}

	private scheduleIdleShutdown(): void {
		this.clearIdleTimer();
		const timeoutMs = Number.parseInt(process.env.PI_CUA_IDLE_TIMEOUT_MS ?? "600000", 10);
		if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return;

		this.idleTimer = setTimeout(() => {
			const ctx = this.latestContext;
			void this.shutdown().finally(() => setComputerUseStatus(ctx, "idle"));
		}, timeoutMs);
	}
	private async initializeBackend(): Promise<InitializeResponse> {
		const initialized = await this.client.request<InitializeResponse>("initialize", {
			clientInfo: { name: "pi-codex-computer-use", version: "0.1.0" },
			capabilities: { experimentalApi: true },
		});
		const plugins = await this.client.request<PluginListResponse>("plugin/list", {});
		const pluginRoot = findComputerUsePluginRoot(plugins);
		if (!pluginRoot) {
			throw new Error("Installed Computer Use plugin path was not reported by Codex app-server.");
		}
		this.backend.setComputerUsePluginRoot(pluginRoot);
		return initialized;
	}
}

function findComputerUsePluginRoot(plugins: PluginListResponse): string | undefined {
	for (const marketplace of plugins.marketplaces) {
		const plugin = marketplace.plugins.find((candidate) => candidate.name === "computer-use" && candidate.enabled);
		const source = plugin?.source;
		if (!source || typeof source !== "object" || !("path" in source)) continue;
		if (typeof source.path === "string" && source.path.length > 0) return source.path;
	}
	return undefined;
}

function shouldDevAutoAccept(message: string): boolean {
	const allowlist = process.env.PI_CUA_DEV_AUTO_ACCEPT_APPS;
	if (!allowlist) return false;

	const allowedApps = allowlist
		.split(",")
		.map((entry) => entry.trim())
		.filter(Boolean);
	if (allowedApps.length === 0) return false;

	const match = message.match(/Allow (?:Codex(?: Computer Use)?|Computer Use) to use (.+?)\?/i);
	const requestedApp = match?.[1]?.trim().replace(/^["'\u201c\u201d]+|["'\u201c\u201d]+$/g, "");
	if (!requestedApp) return false;

	return allowedApps.some((app) => app.toLocaleLowerCase() === requestedApp.toLocaleLowerCase());
}
