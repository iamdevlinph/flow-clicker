import { expect, test } from "vitest";
import {
	beginRecordingReplacement,
	restoreRecordingReplacement,
} from "./recording-replacement.js";
import type { Flow } from "./types.js";

const flow = (): Flow => ({
	id: "flow",
	name: "Flow",
	actions: [{ type: "delay", id: "delay", name: "Delay", delayMs: 40 }],
	groupId: null,
	updatedAt: "before",
	target: { executablePath: "C:\\App.exe", className: "Main", title: "A" },
});

test("replacement clears actions while retaining a rollback snapshot", () => {
	const value = flow();
	const snapshot = beginRecordingReplacement(value, {
		selectedActionId: "delay",
		selectedActionIds: ["delay"],
	});

	expect(value.actions).toEqual([]);
	expect(value.target).toBeNull();
	const selection = restoreRecordingReplacement(value, snapshot);
	expect(value.actions[0].id).toBe("delay");
	expect(value.actions).not.toBe(snapshot.actions);
	expect(value.updatedAt).toBe("before");
	expect(value.target).toEqual({
		executablePath: "C:\\App.exe",
		className: "Main",
		title: "A",
	});
	expect(selection).toEqual({
		selectedActionId: "delay",
		selectedActionIds: ["delay"],
	});
});

test("rollback restores independent action data and multi-selection", () => {
	const value = flow();
	const snapshot = beginRecordingReplacement(value, {
		selectedActionId: "delay",
		selectedActionIds: ["delay", "other"],
	});
	value.actions.push({ type: "delay", id: "new", name: "New", delayMs: 1 });
	value.updatedAt = "changed";

	const selection = restoreRecordingReplacement(value, snapshot);
	expect(value.actions).toEqual(snapshot.actions);
	expect(value.actions).not.toBe(snapshot.actions);
	expect(value.updatedAt).toBe("before");
	expect(selection.selectedActionIds).toEqual(["delay", "other"]);
});
