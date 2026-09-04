import { dismissOverlayOnEscape, markerClass } from "./overlay-interactions.js";

type OverlayPoint = { actionId: string; label: string; x: number; y: number };
type OverlayPayload = {
	points: OverlayPoint[];
	interactive: boolean;
	originX: number;
	originY: number;
};
type PlaybackClick = {
	mode: "playback";
	screenX: number;
	screenY: number;
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
	let mode: "map" | "playback" = "map";

	function render(): void {
		overlayRoot.innerHTML = "";
		if (mode === "playback") {
			overlayBadge.hidden = true;
			return;
		}
		overlayBadge.hidden = false;
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
						viewportWidth: window.innerWidth,
						viewportHeight: window.innerHeight,
					});
				} catch (error: unknown) {
					console.error(error);
				}
			},
		);
	}

	native.event?.listen?.<OverlayPayload>("overlay-points", (event): void => {
		mode = "map";
		payload = event.payload;
		render();
	});
	native.event?.listen?.<PlaybackClick>("playback-click", (event): void => {
		if (mode !== "playback") {
			mode = "playback";
			overlayRoot.innerHTML = "";
		}
		overlayBadge.hidden = true;
		const { screenX, screenY, originX, originY } = event.payload;
		if (![screenX, screenY, originX, originY].every(Number.isFinite)) return;
		const effect = document.createElement("div");
		effect.className = "playback-click-effect";
		effect.style.left = `${screenX - originX}px`;
		effect.style.top = `${screenY - originY}px`;
		effect.addEventListener("animationend", () => effect.remove(), {
			once: true,
		});
		overlayRoot.appendChild(effect);
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
			void native.core?.invoke?.("hide_overlay").catch(() => {});
			void native.event
				?.emitTo?.("main", "overlay-dismiss-requested")
				.catch(() => {});
			void native.event
				?.emitTo?.("control", "overlay-dismiss-requested")
				.catch(() => {});
		});
	});
})();
