import type { NativeInvoke } from "./types.js";

const MAX_X = 1140;
const MAX_Y = 148;

export function bindBrowserPocPanel(invoke: NativeInvoke): void {
	const bar = document.getElementById("browserPocTitlebar");
	if (!bar) return;
	document.body.classList.add("browser-poc");
	bar.classList.remove("hidden");
	let panelX = 20;
	let panelY = 20;
	const movePanel = (x: number, y: number) => {
		panelX = Math.max(0, Math.min(MAX_X, x));
		panelY = Math.max(0, Math.min(MAX_Y, y));
		void invoke("move_control_panel", { x: panelX, y: panelY });
	};
	bar.addEventListener("pointerdown", (event) => {
		const button = (event.target as HTMLElement).closest("button");
		if (button && button.id !== "browserPocDragHandle") return;
		bar.setPointerCapture(event.pointerId);
		const startX = event.screenX;
		const startY = event.screenY;
		const originX = panelX;
		const originY = panelY;
		const move = (next: PointerEvent) => {
			movePanel(
				originX + next.screenX - startX,
				originY + next.screenY - startY,
			);
		};
		const end = () => {
			bar.removeEventListener("pointermove", move);
			bar.removeEventListener("pointerup", end);
			bar.removeEventListener("pointercancel", end);
		};
		bar.addEventListener("pointermove", move);
		bar.addEventListener("pointerup", end);
		bar.addEventListener("pointercancel", end);
	});
	document
		.getElementById("browserPocDragHandle")
		?.addEventListener("keydown", (event) => {
			if (event.target !== event.currentTarget) return;
			const delta = event.shiftKey ? 1 : 10;
			const offsets: Record<string, [number, number]> = {
				ArrowLeft: [-delta, 0],
				ArrowRight: [delta, 0],
				ArrowUp: [0, -delta],
				ArrowDown: [0, delta],
			};
			const offset = offsets[event.key];
			if (!offset) return;
			event.preventDefault();
			movePanel(panelX + offset[0], panelY + offset[1]);
		});
}
