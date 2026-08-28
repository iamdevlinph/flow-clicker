export const MAX_DURATION_SECONDS = 99 * 3600 + 59 * 60 + 59;
const SEGMENTS: readonly [number, number][] = [
	[0, 2],
	[3, 5],
	[6, 8],
];
export function formatDuration(seconds: number = 0): string {
	const total = Math.min(
		MAX_DURATION_SECONDS,
		Math.max(1, Math.trunc(Number(seconds) || 0)),
	);
	const hours = Math.floor(total / 3600),
		minutes = Math.floor((total % 3600) / 60);
	return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}
export function parseDuration(value: unknown): number | null {
	const match = /^(\d{2}):?(\d{2}):?(\d{2})$/.exec(String(value ?? ""));
	if (!match) return null;
	const [hours, minutes, seconds] = match.slice(1).map(Number),
		total = hours * 3600 + minutes * 60 + seconds;
	return hours <= 99 && minutes <= 59 && seconds <= 59 && total >= 1
		? total
		: null;
}
export function bindDurationInput(
	input: HTMLInputElement,
	onCommit: (seconds: number) => void = () => {},
): { selectSegment: (index: number) => void; commit: () => void } {
	let lastGood = formatDuration(parseDuration(input.value) ?? 1),
		segment = 2,
		digit = 0;
	const selectSegment = (index: number): void => {
		segment = Math.max(0, Math.min(2, index));
		digit = 0;
		const [start, end] = SEGMENTS[segment];
		input.setSelectionRange(start, end);
	};
	const commit = (): void => {
		const seconds = parseDuration(input.value);
		if (seconds == null) {
			input.value = lastGood;
			return;
		}
		input.value = formatDuration(seconds);
		lastGood = input.value;
		onCommit(seconds);
	};
	input.value = lastGood;
	input.addEventListener("focus", () => {
		const seconds = parseDuration(input.value);
		if (seconds != null) lastGood = formatDuration(seconds);
		const p = input.selectionStart ?? 0;
		selectSegment(p <= 2 ? 0 : p <= 5 ? 1 : 2);
	});
	input.addEventListener("click", () => {
		const p = input.selectionStart ?? 0;
		selectSegment(p <= 2 ? 0 : p <= 5 ? 1 : 2);
	});
	input.addEventListener("keydown", (event) => {
		if (event.key === "Tab") return;
		if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
			event.preventDefault();
			selectSegment(segment + (event.key === "ArrowRight" ? 1 : -1));
			return;
		}
		if (event.key === "Backspace" || event.key === "Delete") {
			event.preventDefault();
			const [start, end] = SEGMENTS[segment];
			input.value = `${input.value.slice(0, start)}00${input.value.slice(end)}`;
			selectSegment(segment);
			commit();
			return;
		}
		if (/^\d$/.test(event.key) && segment > 0 && digit === 0 && event.key > "5")
			return event.preventDefault();
		if (!/^\d$/.test(event.key)) {
			if (event.key.length === 1) event.preventDefault();
			return;
		}
		event.preventDefault();
		const [start] = SEGMENTS[segment],
			position = start + digit;
		input.value = `${input.value.slice(0, position)}${event.key}${input.value.slice(position + 1)}`;
		if (digit === 0) {
			digit = 1;
			input.setSelectionRange(position + 1, position + 2);
		} else {
			commit();
			selectSegment(segment === 2 ? 2 : segment + 1);
		}
	});
	input.addEventListener("paste", (event) => {
		const seconds = parseDuration(event.clipboardData?.getData("text")?.trim());
		if (seconds == null) return event.preventDefault();
		event.preventDefault();
		input.value = formatDuration(seconds);
		commit();
		selectSegment(0);
	});
	input.addEventListener("input", () => {
		if (parseDuration(input.value) == null) input.value = lastGood;
	});
	input.addEventListener("blur", commit);
	return { selectSegment, commit };
}
