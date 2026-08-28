import { expect, test } from "vitest";
import { setActivityBadge, setPlaybackHud } from "./playback-hud.js";
import type { NativeInvoke, NativePayload, NativeResult } from "./types.js";

type FakeBody = {
	classes: Set<string>;
	classList: {
		toggle: (name: string, active?: boolean) => void;
		remove: (name: string) => void;
	};
};
type CommandCall = [command: string, args: Record<string, unknown> | undefined];

function body(): FakeBody {
	const classes: Set<string> = new Set<string>();
	return {
		classes,
		classList: {
			toggle: (name: string, active?: boolean): void => {
				if (active) classes.add(name);
				else classes.delete(name);
			},
			remove: (name: string): void => {
				classes.delete(name);
			},
		},
	};
}

test("enters and exits HUD mode after native success", async () => {
	const calls: CommandCall[] = [];
	const target = body();
	const invoke: NativeInvoke = async <
		TResult extends NativeResult = NativePayload,
	>(
		command: string,
		args?: Record<string, unknown>,
	): Promise<TResult> => {
		calls.push([command, args]);
		return {} as TResult;
	};
	await setPlaybackHud(invoke, target as unknown as HTMLElement, true);
	expect(target.classes.has("hud-mode")).toBe(true);
	await setPlaybackHud(invoke, target as unknown as HTMLElement, false);
	expect(target.classes.has("hud-mode")).toBe(false);
	expect(calls).toEqual([
		["set_playback_hud", { active: true }],
		["set_playback_hud", { active: false }],
	]);
});

test("failed HUD entry rolls back normal UI", async () => {
	const target = body();
	target.classes.add("hud-mode");
	const invoke: NativeInvoke = async <
		TResult extends NativeResult = NativePayload,
	>(): Promise<TResult> => {
		throw new Error("no HUD");
	};
	expect(
		await setPlaybackHud(invoke, target as unknown as HTMLElement, true),
	).toBe(false);
	expect(target.classes.has("hud-mode")).toBe(false);
});

test("recording badge does not enter HUD mode and badge failures are nonfatal", async () => {
	const calls: CommandCall[] = [];
	const invoke: NativeInvoke = async <
		TResult extends NativeResult = NativePayload,
	>(
		command: string,
		args?: Record<string, unknown>,
	): Promise<TResult> => {
		calls.push([command, args]);
		return {} as TResult;
	};
	await setActivityBadge(invoke, "recording");
	const failed: NativeInvoke = async <
		TResult extends NativeResult = NativePayload,
	>(): Promise<TResult> => {
		throw new Error("no badge");
	};
	await setActivityBadge(failed, "idle");
	expect(calls).toEqual([["set_activity_badge", { activity: "recording" }]]);
});
