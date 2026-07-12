import { describe, expect, it } from "vitest";
import {
	ComputerUseBackend,
	type ComputerUseClient,
	type ComputerUseThreads,
} from "../src/computer-use-backend.ts";

class FakeClient implements ComputerUseClient {
	calls: Array<{ method: string; params: unknown }> = [];
	responses: Array<unknown | Error> = [];

	async request<T>(method: string, params: unknown): Promise<T> {
		this.calls.push({ method, params });
		const response = this.responses.shift();
		if (response instanceof Error) throw response;
		return response as T;
	}
}

class FakeThreads implements ComputerUseThreads {
	ids = ["thread-1"];
	resetCount = 0;

	async getThreadId(): Promise<string> {
		return this.ids[0] ?? "thread-fallback";
	}

	reset(): void {
		this.resetCount++;
		this.ids.shift();
	}
}

describe("ComputerUseBackend", () => {
	it("maps successful tool content", async () => {
		const client = new FakeClient();
		client.responses.push({ content: [{ type: "text", text: "apps" }] });
		const backend = new ComputerUseBackend(client, new FakeThreads());

		const result = await backend.callTool("/tmp", "list_apps", {});

		expect(result.content).toEqual([{ type: "text", text: "apps" }]);
		expect(client.calls[0]?.params).toMatchObject({ server: "computer-use", threadId: "thread-1", tool: "list_apps" });
	});

	it("routes current ChatGPT Computer Use through the Node REPL", async () => {
		const client = new FakeClient();
		client.responses.push({ content: [{ type: "text", text: "apps" }] });
		const backend = new ComputerUseBackend(client, new FakeThreads(), {
			computerUsePluginRoot: "/plugins/computer-use/1.2.3",
		});

		const result = await backend.callTool("/tmp", "list_apps", {});

		expect(result.content).toEqual([{ type: "text", text: "apps" }]);
		expect(client.calls[0]).toMatchObject({
			method: "mcpServer/tool/call",
			params: {
				server: "node_repl",
				threadId: "thread-1",
				tool: "js",
				arguments: {
					title: "List desktop apps",
				},
			},
		});
		expect(client.calls[0]?.params).toEqual(
			expect.objectContaining({
				arguments: expect.objectContaining({
					code: expect.stringContaining(
						'file:///plugins/computer-use/1.2.3/scripts/computer-use-client.mjs',
					),
				}),
			}),
		);
	});

	it("throws when MCP result has isError", async () => {
		const client = new FakeClient();
		client.responses.push({ isError: true, content: [{ type: "text", text: "Invalid app" }] });
		const backend = new ComputerUseBackend(client, new FakeThreads());

		await expect(backend.callTool("/tmp", "get_app_state", { app: "Nope" })).rejects.toThrow("Invalid app");
	});

	it("retries once with a fresh thread when app-server forgot the thread", async () => {
		const client = new FakeClient();
		client.responses.push(new Error("thread not found: thread-1"));
		client.responses.push({ content: [{ type: "text", text: "ok" }] });
		const threads = new FakeThreads();
		threads.ids = ["thread-1", "thread-2"];
		const backend = new ComputerUseBackend(client, threads);

		const result = await backend.callTool("/tmp", "list_apps", {});

		expect(result.content).toEqual([{ type: "text", text: "ok" }]);
		expect(threads.resetCount).toBe(1);
		expect(client.calls.map((call) => extractThreadId(call.params))).toEqual(["thread-1", "thread-2"]);
	});

	it("bubbles retry failure", async () => {
		const client = new FakeClient();
		client.responses.push(new Error("thread not found: thread-1"));
		client.responses.push(new Error("still broken"));
		const threads = new FakeThreads();
		const backend = new ComputerUseBackend(client, threads);

		await expect(backend.callTool("/tmp", "list_apps", {})).rejects.toThrow("still broken");
		expect(threads.resetCount).toBe(1);
	});
});

function extractThreadId(params: unknown): unknown {
	if (params && typeof params === "object" && "threadId" in params) return params.threadId;
	return undefined;
}
