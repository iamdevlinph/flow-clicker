import { describe, expect, test, vi } from "vitest";
import {
	keepAccordionToggleOnChevron,
	keepActionNameKeyInsideInput,
} from "./editor.js";

const keydown = (
	input: {
		dataset: Record<string, string>;
		selectionEnd: number | null;
		selectionStart: number | null;
		setRangeText(
			replacement: string,
			start: number,
			end: number,
			selectionMode: SelectionMode,
		): void;
		value: string;
	},
	overrides: Partial<KeyboardEvent> = {},
) => {
	const event = {
		altKey: false,
		ctrlKey: false,
		currentTarget: input,
		isComposing: false,
		key: " ",
		metaKey: false,
		preventDefault: vi.fn(),
		shiftKey: false,
		stopPropagation: vi.fn(),
		...overrides,
	} as unknown as KeyboardEvent;
	keepActionNameKeyInsideInput(event);
	return event;
};

describe("click-name keyboard handling", () => {
	test("replaces the selection with a space and keeps the key inside the input", () => {
		const input = {
			dataset: {},
			value: "firstclick",
			selectionStart: 5,
			selectionEnd: 10,
			setRangeText: vi.fn((replacement: string, start: number, end: number) => {
				input.value = `${input.value.slice(0, start)}${replacement}${input.value.slice(end)}`;
				input.selectionStart = start + replacement.length;
				input.selectionEnd = input.selectionStart;
			}),
		};
		const event = keydown(input);

		expect(event.stopPropagation).toHaveBeenCalledOnce();
		expect(event.preventDefault).toHaveBeenCalledOnce();
		expect(input.setRangeText).toHaveBeenCalledWith(" ", 5, 10, "end");
		expect(input.value).toBe("first ");
		expect(input.selectionStart).toBe(6);
		expect(input.dataset.manualChange).toBe("true");
	});

	test("leaves ordinary, modified, and composing keys to the input", () => {
		const input = {
			dataset: {},
			value: "click",
			selectionStart: 0,
			selectionEnd: 5,
			setRangeText: vi.fn(),
		};

		for (const overrides of [
			{ key: "a" },
			{ ctrlKey: true },
			{ isComposing: true },
		]) {
			const event = keydown(input, overrides);
			expect(event.stopPropagation).toHaveBeenCalledOnce();
			expect(event.preventDefault).not.toHaveBeenCalled();
		}
		expect(input.setRangeText).not.toHaveBeenCalled();
		expect(input.dataset.manualChange).toBeUndefined();
	});
});

test("only chevron clicks activate the action disclosure", () => {
	for (const [detail, chevron, prevented] of [
		[1, false, true],
		[1, true, false],
		[0, false, false],
	] as const) {
		const event = {
			detail,
			preventDefault: vi.fn(),
			target: { closest: vi.fn(() => (chevron ? {} : null)) },
		} as unknown as MouseEvent;
		keepAccordionToggleOnChevron(event);
		expect(event.preventDefault).toHaveBeenCalledTimes(prevented ? 1 : 0);
	}
});
