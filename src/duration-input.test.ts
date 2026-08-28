import { expect, test } from "vitest";
import {
	bindDurationInput,
	formatDuration,
	MAX_DURATION_SECONDS,
	parseDuration,
} from "./duration-input.js";

class Input {
	value: string;
	selectionStart: number;
	selectionEnd: number;
	listeners: Record<string, (event: Record<string, unknown>) => void>;
	constructor(value: string = "") {
		this.value = value;
		this.selectionStart = 0;
		this.selectionEnd = 0;
		this.listeners = {};
	}
	addEventListener(
		type: string,
		listener: (event: Record<string, unknown>) => void,
	): void {
		this.listeners[type] = listener;
	}
	setSelectionRange(start: number, end: number): void {
		this.selectionStart = start;
		this.selectionEnd = end;
	}
	fire(type: string, event: Record<string, unknown> = {}): boolean {
		let prevented = false;
		this.listeners[type]?.({
			preventDefault: () => {
				prevented = true;
			},
			...event,
		});
		return prevented;
	}
}

test("formats and parses duration bounds and paste forms", () => {
	expect(formatDuration()).toBe("00:00:01");
	expect(formatDuration(MAX_DURATION_SECONDS + 1)).toBe("99:59:59");
	expect(parseDuration("01:02:03")).toBe(3723);
	expect(parseDuration("010203")).toBe(3723);
	for (const value of ["00:00:00", "00:60:00", "1:02:03", "abcdef"])
		expect(parseDuration(value)).toBeNull();
});

test("edits, navigates, clears, and pastes duration segments", () => {
	const input = new Input("00:00:01");
	const commits: number[] = [];
	bindDurationInput(input as unknown as HTMLInputElement, (seconds: number) =>
		commits.push(seconds),
	);
	input.fire("focus");
	input.fire("keydown", { key: "1" });
	input.fire("keydown", { key: "2" });
	expect(input.value).toBe("12:00:01");
	expect(input.selectionStart).toBe(3);
	expect(input.fire("keydown", { key: "6" })).toBe(true);
	expect(input.value).toBe("12:00:01");
	input.fire("keydown", { key: "5" });
	input.fire("keydown", { key: "9" });
	expect(input.value).toBe("12:59:01");
	expect(input.selectionStart).toBe(6);
	input.fire("keydown", { key: "ArrowLeft" });
	expect(input.selectionStart).toBe(3);
	input.fire("keydown", { key: "Delete" });
	expect(input.value).toBe("12:00:01");
	input.fire("paste", { clipboardData: { getData: (): string => "235959" } });
	expect(input.value).toBe("23:59:59");
	expect(
		input.fire("paste", {
			clipboardData: { getData: (): string => "24:99:00" },
		}),
	).toBe(true);
	expect(input.value).toBe("23:59:59");
	expect(commits).toEqual([43201, 46741, 43201, 86399]);
});

test("refreshes rollback value after another flow is loaded", () => {
	const input = new Input("00:00:01");
	bindDurationInput(input as unknown as HTMLInputElement);
	input.value = "02:00:00";
	input.selectionStart = 6;
	input.fire("focus");
	input.fire("keydown", { key: "Delete" });
	expect(input.value).toBe("02:00:00");
});
