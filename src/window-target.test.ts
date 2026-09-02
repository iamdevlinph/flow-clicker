import { expect, test } from "vitest";
import type { NativeInvoke } from "./types.js";
import { captureWindowTarget } from "./window-target.js";

test("counts down and captures the foreground target", async () => {
	const statuses: string[] = [];
	const invoke: NativeInvoke = async () => ({
		executablePath: "C:\\App.exe",
		className: "Main",
		windowTitle: "Target",
	});
	const target = await captureWindowTarget(
		invoke,
		new AbortController().signal,
		(message) => statuses.push(message),
		async () => {},
	);
	expect(statuses).toEqual([
		"Focus the target window — starting in 3",
		"Focus the target window — starting in 2",
		"Focus the target window — starting in 1",
	]);
	expect(target).toEqual({
		executablePath: "C:\\App.exe",
		className: "Main",
		title: "Target",
	});
});

test("cancellation stops before capture", async () => {
	const controller = new AbortController();
	let invoked = false;
	const result = await captureWindowTarget(
		async () => {
			invoked = true;
		},
		controller.signal,
		() => {},
		async () => controller.abort(),
	);
	expect(result).toBeNull();
	expect(invoked).toBe(false);
});
