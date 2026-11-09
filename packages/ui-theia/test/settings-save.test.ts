import { expect, it, vi } from "vitest";
import { saveSettings } from "../src/infrastructure/settings-save.js";

const deferred = () => {
	let resolve!: () => void;
	const promise = new Promise<void>((done) => {
		resolve = done;
	});
	return { promise, resolve };
};
const setup = (held?: string) => {
	const calls: string[] = [];
	const started = deferred(),
		release = deferred();
	let current = true;
	const step = async (name: string) => {
		calls.push(name);
		if (name === held) {
			started.resolve();
			await release.promise;
		}
	};
	const saved = vi.fn(() => {
		calls.push("evidence");
	});
	const input: Parameters<typeof saveSettings>[0] = {
		current: () => current,
		forms: {
			saveAll: async (active) => {
				expect(active?.()).toBe(true);
				await step("forms");
			},
		},
		bindings: { save: () => step("bindings") },
		mcp: {
			form: () => ({ state: { dirty: true, servers: [] } }),
			save: async () => {
				await step("mcp");
				return true;
			},
		},
		tests: { saved },
		endpoints: {
			form: () => ({ state: { dirty: true } }),
			save: () => step("endpoints"),
		},
	};
	return {
		input,
		calls,
		saved,
		started,
		release,
		retire: () => {
			current = false;
		},
	};
};

it.each(["forms", "bindings", "mcp"])(
	"stops later save stages and evidence after context retirement during %s",
	async (held) => {
		const t = setup(held);
		const saving = saveSettings(t.input);
		await t.started.promise;
		t.retire();
		t.release.resolve();
		await saving;
		const order = ["forms", "bindings", "mcp"];
		expect(t.calls).toEqual(order.slice(0, order.indexOf(held) + 1));
		expect(t.saved).not.toHaveBeenCalled();
	},
);

it("keeps normal sequential saves and stamps only the saved MCP list", async () => {
	const t = setup();
	await saveSettings(t.input);
	expect(t.calls).toEqual([
		"forms",
		"bindings",
		"mcp",
		"evidence",
		"endpoints",
	]);
	expect(t.saved).toHaveBeenCalledExactlyOnceWith([]);
});

it("does not start an already retired batch", async () => {
	const t = setup();
	t.retire();
	await saveSettings(t.input);
	expect(t.calls).toEqual([]);
});
