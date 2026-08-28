import { dismissOverlayOnEscape, markerClass } from "./overlay-interactions.js";

type OverlayPoint = { actionId: string; label: string; x: number; y: number };
type OverlayPayload = {
	points: OverlayPoint[];
	interactive: boolean;
	originX: number;
	originY: number;
};

((): void => {
	const root: HTMLElement | null = document.getElementById("overlayRoot");
	const badge: HTMLElement | null = document.getElementById("overlayBadge");
	const tauri = window.__TAURI__;
	if (!root || !badge || !tauri) return;
	const overlayRoot: HTMLElement = root;
	const overlayBadge: HTMLElement = badge;
	const native = tauri;
	let payload: OverlayPayload = {
		points: [],
		interactive: false,
		originX: 0,
		originY: 0,
	};
	let selectedActionId: string | null = null;

	function render(): void {
		overlayRoot.innerHTML = "";
		overlayBadge.textContent = payload.interactive
			? "FlowClicker · drag click points"
			: "FlowClicker · click map";
		for (const point of payload.points) {
			const element: HTMLDivElement = document.createElement("div");
			element.className = markerClass(
				payload.interactive,
				point.actionId === selectedActionId,
			);
			element.textContent = point.label;
			element.style.left = `${point.x - payload.originX}px`;
			element.style.top = `${point.y - payload.originY}px`;
			element.dataset.actionId = point.actionId;
			if (payload.interactive) installDrag(element);
			overlayRoot.appendChild(element);
		}
	}

	function installDrag(element: HTMLDivElement): void {
		let dragging: boolean = false;
		element.addEventListener("pointerdown", (event: PointerEvent): void => {
			dragging = true;
			element.setPointerCapture(event.pointerId);
			event.preventDefault();
		});
		element.addEventListener("pointermove", (event: PointerEvent): void => {
			if (!dragging) return;
			element.style.left = `${event.clientX}px`;
			element.style.top = `${event.clientY}px`;
		});
		element.addEventListener(
			"pointerup",
			async (event: PointerEvent): Promise<void> => {
				if (!dragging) return;
				dragging = false;
				const invoke = native.core?.invoke;
				if (!invoke) return;
				try {
					await invoke("overlay_marker_moved", {
						actionId: element.dataset.actionId,
						screenX: Math.round(event.clientX + payload.originX),
						screenY: Math.round(event.clientY + payload.originY),
					});
				} catch (error: unknown) {
					console.error(error);
				}
			},
		);
	}

	native.event?.listen?.<OverlayPayload>("overlay-points", (event): void => {
		payload = event.payload;
		render();
	});
	native.event?.listen?.<{ actionId?: string }>(
		"overlay-selection",
		(event): void => {
			selectedActionId = event.payload.actionId ?? null;
			render();
		},
	);
	document.addEventListener("keydown", (event: KeyboardEvent): void => {
		dismissOverlayOnEscape(event, (): void => {
			native.event
				?.emitTo?.("main", "overlay-dismiss-requested")
				.catch((): void => {});
		});
	});
})();
