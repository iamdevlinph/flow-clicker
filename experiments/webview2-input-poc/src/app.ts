import type {
	NativeInvoke,
	NativePayload,
	NativeResult,
} from "../../../src/types.js";

type PocElement = HTMLElement & { value: string; checked: boolean };
type NativeEvent = { payload: NativePayload };
const $ = <TElement extends PocElement = PocElement>(id: string): TElement => {
	const element = document.getElementById(id);
	if (!element) throw new Error(`Missing element: ${id}`);
	return element as TElement;
};
const tauri = window.__TAURI__;
const invoke: NativeInvoke =
	tauri?.core?.invoke ??
	(<TResult extends NativeResult>(cmd: string) =>
		Promise.reject<TResult>(new Error(`Tauri unavailable: ${cmd}`)));
const listen = tauri?.event?.listen;
const status = (text: string, kind: string = ""): void => {
	$("status").textContent = text;
	$("status").className = `status ${kind}`;
};
const run = (
	cmd: string,
	args?: Record<string, unknown>,
): Promise<NativePayload> => invoke(cmd, args);
const show = (id: string, value: unknown = ""): void => {
	$(id).textContent =
		typeof value === "string" ? value : JSON.stringify(value, null, 2);
};
let replayResult: NativePayload | null = null;
const updateGate = (): void => {
	const names = replayResult?.replay_events?.map((event) => event.event);
	const physicalNames = replayResult?.physical_events?.map(
		(event) => event.event,
	);
	const ordered =
		JSON.stringify(names) ===
		JSON.stringify([
			"pointermove",
			"pointerdown",
			"mousedown",
			"pointerup",
			"mouseup",
			"click",
		]);
	const physicalOrdered =
		JSON.stringify(physicalNames) ===
		JSON.stringify([
			"pointermove",
			"pointerdown",
			"mousedown",
			"pointerup",
			"mouseup",
			"click",
		]);
	const physicalClick = replayResult?.physical_events?.at(-1),
		replayClick = replayResult?.replay_events?.at(-1);
	const sameCoordinates =
		physicalClick?.x === replayClick?.x && physicalClick?.y === replayClick?.y;
	if (
		replayResult &&
		!replayResult.cursor_moved &&
		ordered &&
		physicalOrdered &&
		sameCoordinates &&
		replayResult.replay_events?.every((event) => event.is_trusted) &&
		replayResult.physical_events?.every((event) => event.is_trusted) &&
		$("physicalConfirm").checked &&
		$("replayConfirm").checked
	)
		status("PASS", "pass");
};

for (const [id, cmd] of [
	["open", "open_game"],
	["focus", "focus_game"],
	["reload", "reload_game"],
	["close", "close_game"],
	["clear", "clear_test"],
] as const)
	$(id).onclick = (): void => {
		void run(cmd);
	};
$("arm").onclick = (): void => {
	void run("arm_physical_capture").then(() => status("CAPTURE ARMED"));
};
$("replay").onclick = (): void => {
	void run("replay_last_click", {
		settleMs: Number($("settle").value),
		holdMs: Number($("hold").value),
	}).then((result) => {
		replayResult = result;
		show("cursor", `${result.cursor_before} → ${result.cursor_after}`);
		show("moved", result.cursor_moved ? "YES" : "NO");
		show("cdp", result.cdp);
		show(
			"events",
			`PHYSICAL\n${result.physical_events?.map((event) => event.event).join(" → ")}\nREPLAY\n${result.replay_events?.map((event) => `${event.event} trusted=${event.is_trusted}`).join(" → ")}`,
		);
		status("BACKEND INVESTIGATION REQUIRED", "error");
		updateGate();
	});
};
$("selfTest").onclick = (): void => {
	void run("run_backend_self_test").then((result) =>
		show("selfTestResult", result),
	);
};
for (const id of ["physicalConfirm", "replayConfirm"] as const)
	$<HTMLInputElement>(id).onchange = updateGate;
if (listen) {
	void listen("physical-click", (event: NativeEvent): void => {
		show("physical", event.payload);
		show("events", event.payload.events);
	});
	void listen("physical-diagnostic", (event: NativeEvent): void => {
		show("events", `PHYSICAL\n${event.payload.event}`);
	});
}
