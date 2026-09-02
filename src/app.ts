import {
	selectedFlows,
	selectionName,
	toggleSelection,
} from "./combine-selection.js";
import {
	exportPortableData,
	parsePortableData,
	replaceWithPortableData,
} from "./data-transfer.js";
import { bindDurationInput } from "./duration-input.js";
import { bindEditorView, mountEditorView, renderEditorView } from "./editor.js";
import { escapeAction } from "./escape-layer.js";
import { renderFlowLibrary } from "./flow-library.js";
import { normalizeFlowSelection, removeFlow } from "./flow-lifecycle.js";
import { moveFlow, moveFlowByKey } from "./flow-ordering.js";
import { hotkeysOverlap, normalizeHotkeyEvent } from "./hotkey.js";
import {
	moveLibraryGroup,
	moveLibraryGroupByKey,
	toggleLibraryGroup,
	updateLibraryGroups,
} from "./library-group.js";
import {
	normalizePlayback,
	playbackDefaults,
	playbackFromForm,
	playbackToForm,
} from "./playback-form.js";
import {
	setActivityBadge,
	setPlaybackHud as updatePlaybackHud,
} from "./playback-hud.js";
import {
	durationRemainder,
	playbackStatus,
	remainingSeconds,
} from "./playback-status.js";
import {
	beginRecordingReplacement,
	restoreRecordingReplacement,
} from "./recording-replacement.js";
import {
	acceptsRecordedClick,
	activateRecording,
	beginRecordingAttempt,
	cancelRecordingSession,
	idleRecordingSession,
	isCurrentRecordingAttempt,
	retainRecordingSnapshot,
	stopRecordingSession,
} from "./recording-session.js";
import {
	actionClickCount,
	combineFlows,
	migrateState as migratePersistedState,
	nextDeadline,
	normalizeEditorSize,
	sameRecordedWindow,
} from "./state-model.js";
import type {
	Action,
	AppState,
	EditorSnapshot,
	Flow,
	LibraryGroup,
	NativeInvoke,
	NativePayload,
	Playback,
	WindowTarget,
} from "./types.js";
import { captureWindowTarget } from "./window-target.js";

type PortableData = { version: 4; flows: Flow[]; groups: LibraryGroup[] };
type ClickAction = Extract<Action, { type: "click" }>;
type HotkeyId = "recordHotkey" | "playbackHotkey";
type HotkeyCapture = {
	id: HotkeyId;
	accepted: boolean;
	syncing: boolean;
	released: boolean;
};

(() => {
	const T = window.__TAURI__ || null;
	const nativeAvailable = Boolean(T?.core?.invoke);
	const invoke: NativeInvoke =
		T?.core?.invoke ??
		(<TResult extends import("./types.js").NativeResult>(
			_command: string,
			_args?: Record<string, unknown>,
		) => Promise.reject<TResult>(new Error("Tauri unavailable")));
	const listen = T?.event?.listen;
	const emitTo = T?.event?.emitTo;
	const getVersion = T?.app?.getVersion;
	const getCurrentWindow = T?.window?.getCurrentWindow;
	type DomElement = HTMLElement & {
		value: string;
		checked: boolean;
		disabled: boolean;
	};
	const $ = <TElement extends DomElement = DomElement>(id: string): TElement =>
		document.getElementById(id) as TElement;

	const defaults: AppState = {
		version: 4,
		editorSize: null,
		selectedFlowId: null,
		flows: [],
		groups: [],
		settings: {
			recordHotkey: "Alt+Shift+R",
			playbackHotkey: "Alt+Shift+P",
			playback: { ...playbackDefaults },
		},
	};

	let state: AppState = structuredClone(defaults);
	let combineQueue: string[] = [];
	let selectedActionId: string | null = null;
	let selectedActionIds: Set<string> = new Set();
	let recordingSessionState = idleRecordingSession();
	let playing = false;
	let runningFlowId: string | null = null;
	let mapVisible = false;
	let saveTimer: ReturnType<typeof setTimeout> | null = null;
	let saveQueue: Promise<boolean> = Promise.resolve(true);
	let importSelection: Set<string> = new Set();
	const dialogFocus = new Map<string, HTMLElement | null>();
	let editorOpen = false;
	let pendingDeleteFlow: Flow | null = null;
	let deleteInProgress = false;
	let capturingHotkey: HotkeyCapture | null = null;
	let activePlayback: {
		flowId: string;
		playback: Playback;
		execution: number;
		durationSeconds: number;
		startedAt: number;
		configuredDuration: number;
	} | null = null;
	let statusTimer: ReturnType<typeof setInterval> | null = null;
	let pendingPortableData: PortableData | null = null;
	let bindingCountdown: AbortController | null = null;
	let recordingWindowHandle: number | null = null;

	const uid = (): string =>
		crypto.randomUUID
			? crypto.randomUUID()
			: `${Date.now()}-${Math.random().toString(16).slice(2)}`;
	const nowIso = (): string => new Date().toISOString();
	const currentFlow = (): Flow | null =>
		state.flows.find((f) => f.id === state.selectedFlowId) || null;
	const actionDelay = (a: Action): number =>
		a.type === "group"
			? a.actions.reduce((n, child) => n + actionDelay(child), 0) *
				Math.max(1, Number(a.repeatCount) || 1)
			: Math.max(0, Number(a.delayMs) || 0);
	const clickCount = (flow: Flow | null): number =>
		(flow?.actions || []).reduce((n, a) => n + actionClickCount(a), 0);
	const deepActionCopy = (a: Action, index = 0): Action => {
		const copy = structuredClone(a);
		copy.id = uid();
		copy.name ||= `${a.type === "click" ? "Click" : a.type === "delay" ? "Delay" : "Group"} ${index + 1}`;
		if (copy.type === "group")
			copy.actions = (copy.actions || []).map((child, i) =>
				deepActionCopy(child, i),
			);
		return copy;
	};
	const flowPlayback = () => normalizePlayback(state.settings.playback);
	const findAction = (actions: Action[], id: string): Action | null => {
		for (const action of actions || []) {
			if (action.id === id) return action;
			const child = action.type === "group" && findAction(action.actions, id);
			if (child) return child;
		}
		return null;
	};

	function newFlow(name: string = "New flow"): Flow {
		const flow: Flow = {
			id: uid(),
			name,
			actions: [],
			groupId: null,
			createdAt: nowIso(),
			updatedAt: nowIso(),
		};
		state.flows.push(flow);
		state.selectedFlowId = flow.id;
		selectedActionId = null;
		scheduleSave();
		renderAll();
		return flow;
	}

	function toast(title: string, message = "", type = "success"): void {
		const el = document.createElement("div");
		el.className = `toast ${type}`;
		el.innerHTML = `<strong>${escapeHtml(title)}</strong>${message ? `<span>${escapeHtml(message)}</span>` : ""}`;
		$("toastStack").appendChild(el);
		setTimeout(() => el.remove(), 2800);
	}

	function escapeHtml(value: unknown): string {
		return String(value ?? "").replace(
			/[&<>'"]/g,
			(ch) =>
				({
					"&": "&amp;",
					"<": "&lt;",
					">": "&gt;",
					"'": "&#39;",
					'"': "&quot;",
				})[ch] || ch,
		);
	}

	function setStatus(text: string, kind = ""): void {
		const el = $("runtimeStatus");
		el.className = `status-banner ${kind}`.trim();
		el.textContent = text;
	}

	async function setPlaybackHud(active: boolean): Promise<boolean> {
		return updatePlaybackHud(invoke, document.body, active);
	}

	function refreshPlaybackStatus(): void {
		if (!activePlayback) return;
		const playback = activePlayback.playback;
		setStatus(
			playbackStatus({
				mode: playback.repeatMode,
				execution: activePlayback.execution,
				repeatValue: playback.repeatValue,
				remaining: remainingSeconds(
					activePlayback.durationSeconds,
					activePlayback.startedAt,
				),
				untilTime: playback.untilTime,
			}),
			"playing",
		);
	}

	function beginStatusTimer(): void {
		if (statusTimer) clearInterval(statusTimer);
		refreshPlaybackStatus();
		statusTimer = setInterval(refreshPlaybackStatus, 1000);
	}

	function clearPlaybackStatus(): void {
		if (statusTimer) clearInterval(statusTimer);
		statusTimer = null;
		activePlayback = null;
	}

	async function loadState() {
		try {
			let json: string | null = null;
			if (nativeAvailable) json = await invoke<string>("load_state");
			else json = localStorage.getItem("flowclicker-mock-state");
			if (json) {
				const parsed: unknown = JSON.parse(json);
				state = migratePersistedState(
					parsed as Parameters<typeof migratePersistedState>[0],
				);
			}
		} catch (err) {
			toast("Could not load saved state", String(err), "error");
		}
		state = normalizeFlowSelection(state);
		setView("compact");
		renderAll();
		syncHotkeys();
		detectPlatform();
	}

	async function showVersion() {
		if (!getVersion) return;
		const version = await getVersion();
		$("appVersion").textContent = `v${version}`;
		const currentWindow = getCurrentWindow?.();
		if (currentWindow) await currentWindow.setTitle(`FlowClicker v${version}`);
	}

	function saveState(
		showFeedback: boolean = false,
		targetState: AppState = state,
	): Promise<boolean> {
		if (saveTimer) clearTimeout(saveTimer);
		const json = JSON.stringify(
			{
				version: 4,
				editorSize: normalizeEditorSize(targetState.editorSize),
				selectedFlowId: targetState.selectedFlowId,
				flows: targetState.flows,
				groups: targetState.groups,
				settings: targetState.settings,
			},
			null,
			2,
		);
		saveQueue = saveQueue.then(async () => {
			try {
				if (nativeAvailable) await invoke("save_state", { stateJson: json });
				else localStorage.setItem("flowclicker-mock-state", json);
				if (showFeedback)
					toast(
						"Saved",
						`${targetState.flows.length} flow${targetState.flows.length === 1 ? "" : "s"} saved locally.`,
					);
				return true;
			} catch (err) {
				toast("Save failed", String(err), "error");
				return false;
			}
		});
		return saveQueue;
	}

	function scheduleSave(): void {
		if (saveTimer) clearTimeout(saveTimer);
		saveTimer = setTimeout(() => saveState(false), 350);
	}

	async function detectPlatform() {
		if (!nativeAvailable) {
			$("platformOs").textContent = "Browser preview";
			$("platformMouse").textContent = "Unavailable";
			$("platformCapture").textContent = "Unavailable";
			$("platformRelative").textContent = "Unavailable";
			return;
		}
		try {
			const info = await invoke("platform_info");
			$("platformOs").textContent = info.os || "";
			$("platformMouse").textContent = info.physicalMouseSupported
				? "✓ supported"
				: "✕ unavailable";
			$("platformCapture").textContent = info.globalRecordingSupported
				? "✓ supported"
				: "✕ unavailable";
			$("platformRelative").textContent = info.windowRelativeSupported
				? "✓ supported"
				: "Screen only";
			if (info.accessibilityNote) {
				$("platformNote").textContent = info.accessibilityNote;
				$("platformNote").classList.remove("hidden");
			} else $("platformNote").classList.add("hidden");
		} catch (err) {
			$("platformOs").textContent = "Error";
			toast("Platform detection failed", String(err), "error");
		}
	}

	function renderAll(): void {
		renderFlowList();
		publishEditorSnapshot();
		renderSettings();
	}

	function setView(view: "compact" | "settings" | "editor"): void {
		document.body.classList.toggle("settings-view", view === "settings");
		document.body.classList.toggle("editor-view", view === "editor");
		if (view !== "settings") closeSettingsModal();
	}

	function editorSnapshot(): EditorSnapshot | null {
		const flow = currentFlow();
		return flow
			? structuredClone({
					flow,
					selectedActionId,
					selectedActionIds: [...selectedActionIds],
					recording: recordingSessionState.active,
					playing,
					mapVisible,
				})
			: null;
	}

	function publishEditorSnapshot(): void {
		const snapshot = editorSnapshot();
		renderEditorView(snapshot);
		if (mapVisible && emitTo)
			emitTo("overlay", "overlay-selection", {
				actionId: selectedActionId,
			}).catch(() => {});
	}

	async function openEditor(flow: Flow | null | undefined): Promise<void> {
		if (!flow) return;
		state.selectedFlowId = flow.id;
		selectedActionId = null;
		editorOpen = true;
		setView("editor");
		publishEditorSnapshot();
		requestAnimationFrame(() => $("editorHeading")?.focus());
	}

	async function closeEditor(): Promise<void> {
		editorOpen = false;
		await hideOverlay();
		setView("compact");
		document
			.querySelector<HTMLElement>(
				`[data-flow-id="${CSS.escape(state.selectedFlowId || "")}"]`,
			)
			?.focus();
	}
	function applyEditorIntent(intent: NativePayload = {}): void | Promise<void> {
		const flow = currentFlow();
		if (intent.type === "close") return closeEditor();
		if (!flow) return;
		if (intent.type === "select-action") {
			selectedActionId = intent.actionId || null;
			selectedActionIds = new Set(
				intent.multi
					? intent.actionIds || []
					: intent.actionId
						? [intent.actionId]
						: [],
			);
			return publishEditorSnapshot();
		}
		const action = intent.actionId
			? findAction(flow.actions, intent.actionId)
			: null;
		if (intent.type === "rename")
			flow.name = String(intent.value || "").trim() || "Untitled flow";
		if (intent.type === "action-update" && action) {
			if (intent.field === "name")
				action.name = String(intent.value || "").trim() || action.name;
			if (intent.field === "delayMs" && action.type !== "group")
				action.delayMs = Math.max(0, Number(intent.value) || 0);
			if (intent.field === "screenX" && action.type === "click")
				action.screenX = Math.round(Number(intent.value) || 0);
			if (intent.field === "screenY" && action.type === "click")
				action.screenY = Math.round(Number(intent.value) || 0);
			if (
				intent.field === "button" &&
				action.type === "click" &&
				(intent.value === "left" || intent.value === "right")
			)
				action.button = intent.value;
		}
		if (intent.type === "add-click")
			flow.actions.push({
				id: uid(),
				type: "click",
				name: `Click ${clickCount(flow) + 1}`,
				screenX: 0,
				screenY: 0,
				button: "left",
				delayMs: 0,
			});
		if (intent.type === "add-delay")
			flow.actions.push({
				id: uid(),
				type: "delay",
				name: `Delay ${flow.actions.filter((a) => a.type === "delay").length + 1}`,
				delayMs: 500,
			});
		if (intent.type === "delete-action" && action)
			flow.actions = flow.actions.filter(
				(candidate) => candidate.id !== action.id,
			);
		if (intent.type === "move-action" && action) {
			const index = flow.actions.indexOf(action);
			const next = index + Number(intent.delta || 0);
			if (next >= 0 && next < flow.actions.length)
				[flow.actions[index], flow.actions[next]] = [
					flow.actions[next],
					flow.actions[index],
				];
		}
		if (intent.type === "duplicate-action" && action) {
			const copy = deepActionCopy(action, flow.actions.indexOf(action));
			flow.actions.splice(flow.actions.indexOf(action) + 1, 0, copy);
		}
		if (intent.type === "settings") return openFlowSettings(flow);
		if (intent.type === "record") return startRecording();
		if (intent.type === "stop-record") return stopRecording();
		if (intent.type === "run") return runFlow();
		if (intent.type === "stop") return stopPlayback();
		if (intent.type === "map")
			return mapVisible ? hideOverlay() : showOverlay(true);
		if (intent.type === "import") return openImportModal();
		touchFlow(flow);
		renderAll();
	}

	function openDialog(
		id: string,
		focusId: string,
		origin: HTMLElement | null = document.activeElement as HTMLElement | null,
	): void {
		dialogFocus.set(id, origin);
		$("appShell").inert = true;
		$(id).classList.remove("hidden");
		$(focusId)?.focus();
	}

	function closeDialog(id: string): void {
		$(id)?.classList.add("hidden");
		if (!document.querySelector(".modal-backdrop:not(.hidden)"))
			$("appShell").inert = false;
		dialogFocus.get(id)?.focus?.();
		dialogFocus.delete(id);
	}

	function renderFlowList(): void {
		const search = $("flowSearch").value.trim().toLowerCase();
		renderFlowLibrary({
			list: $("flowList"),
			groups: state.groups || [],
			flows: state.flows,
			selectedFlowId: state.selectedFlowId,
			combineQueue,
			runningFlowId,
			search,
			escapeHtml,
			onSelect: (flow: Flow) => {
				hideOverlay();
				state.selectedFlowId = flow.id;
				selectedActionId = null;
				scheduleSave();
				renderAll();
			},
			onEdit: openEditor,
			onCreateFlow: () => newFlow(`Flow ${state.flows.length + 1}`),
			onSettings: openFlowSettings,
			onPlay: runFlow,
			onToggleCombine: toggleCombineFlow,
			onToggleGroup: (id: string) => {
				state.groups = toggleLibraryGroup(state.groups, id);
				scheduleSave();
				renderFlowList();
			},
			onMenu: openFlowMenu,
			onRenameGroup: renameLibraryGroup,
			onDeleteGroup: deleteLibraryGroup,
			onMoveBefore: moveFlowBefore,
			onMoveToGroup: moveFlowToGroup,
			onMoveGroupBefore: moveLibraryGroupBefore,
			moveGroupByKey: (group: LibraryGroup, delta: number): boolean => {
				const moved = moveLibraryGroupByKey(state.groups, group.id, delta);
				if (moved === state.groups) return false;
				state.groups = moved;
				scheduleSave();
				renderFlowList();
				return true;
			},
			moveByKey: (flow: Flow, delta: number): boolean => {
				const moved = moveFlowByKey(state.flows, flow.id, delta);
				if (moved === state.flows) return false;
				state.flows = moved;
				touchFlow(state.flows.find((candidate) => candidate.id === flow.id));
				renderFlowList();
				return true;
			},
			announce: (flow: Flow, direction: string): void =>
				toast("Flow reordered", `${flow.name} moved ${direction}.`),
			announceGroup: (group: LibraryGroup, direction: string): void =>
				toast("Group reordered", `${group.name} moved ${direction}.`),
		});
	}
	function moveLibraryGroupBefore(groupId: string, targetId: string): void {
		const moved = moveLibraryGroup(state.groups, groupId, targetId);
		if (moved === state.groups) return;
		state.groups = moved;
		scheduleSave();
		renderFlowList();
	}

	function renameLibraryGroup(id: string): void {
		if (!id) return;
		const group = state.groups.find((candidate) => candidate.id === id);
		if (group) openLibraryGroupModal(group);
	}
	function deleteLibraryGroup(id: string): void {
		if (!id || !confirm("Delete this group? Its flows will move to Ungrouped."))
			return;
		state.flows.forEach((flow) => {
			if (flow.groupId === id) flow.groupId = null;
		});
		state.groups = state.groups.filter((group) => group.id !== id);
		scheduleSave();
		renderFlowList();
	}
	function moveFlowToGroup(
		flowId: string | null,
		groupId: string | null,
	): void {
		if (!flowId || !state.flows.some((flow) => flow.id === flowId)) return;
		state.flows = moveFlow(state.flows, flowId, null, groupId);
		touchFlow(state.flows.find((flow) => flow.id === flowId));
		renderFlowList();
	}
	function moveFlowBefore(flowId: string | null, targetId: string): void {
		if (!flowId || flowId === targetId) return;
		const target = state.flows.find((flow) => flow.id === targetId);
		const flow = state.flows.find((candidate) => candidate.id === flowId);
		if (!target || !flow) return;
		state.flows = moveFlow(state.flows, flowId, targetId, target.groupId);
		touchFlow(state.flows.find((candidate) => candidate.id === flowId));
		renderFlowList();
	}
	function openFlowSettings(flow: Flow | null | undefined): void {
		if (!flow) return;
		renderSettings();
		openDialog("flowSettingsModal", "closeFlowSettingsBtn");
	}
	function closeSettingsModal() {
		if (!$("flowSettingsModal")?.classList.contains("hidden"))
			closeDialog("flowSettingsModal");
	}
	function openFlowMenu(x: number, y: number, flow: Flow): void {
		document.querySelector(".flow-context-menu")?.remove();
		const menu = document.createElement("div");
		menu.className = "context-menu flow-context-menu";
		menu.style.left = `${x}px`;
		menu.style.top = `${y}px`;
		menu.innerHTML =
			'<button data-menu="edit">Edit</button><button data-menu="duplicate">Duplicate</button><button data-menu="delete">Delete</button>';
		document.body.appendChild(menu);
		menu.onclick = (event: MouseEvent): void => {
			const target = event.target as HTMLElement | null;
			const choice = target?.dataset.menu;
			if (choice === "edit") openEditor(flow);
			if (choice === "duplicate") duplicateFlow(flow);
			if (choice === "delete") deleteFlow(flow);
			menu.remove();
		};
		setTimeout(
			() =>
				document.addEventListener("click", () => menu.remove(), { once: true }),
			0,
		);
	}
	function duplicateFlow(source: Flow): void {
		const { playback: _playback, ...copy } = structuredClone(source);
		copy.id = uid();
		copy.name = `${source.name} copy`;
		copy.actions = source.actions.map((action) => deepActionCopy(action));
		copy.createdAt = nowIso();
		copy.updatedAt = nowIso();
		state.flows.splice(state.flows.indexOf(source) + 1, 0, copy);
		state.selectedFlowId = copy.id;
		selectedActionId = null;
		scheduleSave();
		renderAll();
	}
	function createLibraryGroup(): void {
		openLibraryGroupModal(null);
	}
	function openLibraryGroupModal(group: LibraryGroup | null): void {
		$("libraryGroupHeading").textContent = group ? "Rename group" : "New group";
		$("libraryGroupNameInput").value = group?.name || "";
		openDialog("libraryGroupModal", "libraryGroupNameInput");
		$("saveLibraryGroupBtn").onclick = () => {
			const name = $("libraryGroupNameInput").value.trim();
			if (!name) return $("libraryGroupNameInput").focus();
			state.groups =
				updateLibraryGroups(state.groups, group?.id || null, name, uid()) || [];
			scheduleSave();
			closeDialog("libraryGroupModal");
			renderFlowList();
		};
	}
	function deleteFlow(flow: Flow | null): void {
		if (!flow) return;
		pendingDeleteFlow = flow;
		$("deleteFlowMessage").textContent =
			`Delete “${flow.name}”? This cannot be undone.`;
		const origin =
			(document.querySelector(
				`[data-flow-id="${CSS.escape(flow.id)}"]`,
			) as HTMLElement | null) || $("newFlowBtn");
		openDialog("deleteFlowModal", "cancelDeleteFlowBtn", origin);
	}

	async function confirmDeleteFlow() {
		const flow = pendingDeleteFlow;
		if (deleteInProgress) return;
		if (!flow) return closeDialog("deleteFlowModal");
		deleteInProgress = true;
		try {
			if (recordingSessionState.active) await stopRecording();
			state = removeFlow(state, flow.id);
			combineQueue = combineQueue.filter((id) => id !== flow.id);
			importSelection = new Set();
			selectedActionId = null;
			selectedActionIds = new Set();
			pendingDeleteFlow = null;
			const empty = !state.flows.length;
			dialogFocus.set("deleteFlowModal", $("newFlowBtn"));
			closeDialog("deleteFlowModal");
			if (empty) {
				hideOverlay();
				closeEditor();
			}
			scheduleSave();
			renderAll();
		} finally {
			deleteInProgress = false;
		}
	}

	function renderSettings() {
		const s = playbackToForm(flowPlayback(), $);
		$("recordHotkey").textContent = state.settings.recordHotkey;
		$("playbackHotkey").textContent = state.settings.playbackHotkey;
		$("repeatValueRow").classList.toggle("hidden", s.repeatMode !== "cycles");
		$("repeatTimerRow").classList.toggle("hidden", s.repeatMode !== "duration");
		$("untilTimeField").classList.toggle(
			"hidden",
			(s.repeatMode as string) !== "until",
		);
	}

	function touchFlow(flow: Flow | null | undefined): void {
		if (!flow) return;
		flow.updatedAt = nowIso();
		scheduleSave();
	}

	async function updateClickPosition(
		action: ClickAction,
		x: number,
		y: number,
	): Promise<void> {
		action.screenX = Math.round(x);
		action.screenY = Math.round(y);
		if (nativeAvailable) {
			try {
				const meta = await invoke("retarget_click", {
					windowTitle: action.windowTitle || null,
					screenX: action.screenX,
					screenY: action.screenY,
				});
				action.relativeX = meta.relativeX;
				action.relativeY = meta.relativeY;
			} catch (err) {
				console.warn(err);
			}
		}
		touchFlow(currentFlow());
		renderAll();
		if (mapVisible) showOverlay(true);
	}

	async function startRecording() {
		if (!nativeAvailable)
			return toast(
				"Recording requires the desktop build",
				"The browser preview only demonstrates the UI.",
				"error",
			);
		if (recordingSessionState.active || recordingSessionState.starting) return;
		recordingSessionState = beginRecordingAttempt(
			recordingSessionState,
			currentFlow()?.id || null,
		);
		const token = recordingSessionState.token;
		try {
			recordingWindowHandle = null;
			await hideOverlay();
			if (!isCurrentRecordingAttempt(recordingSessionState, token)) return;
			await invoke("start_recording");
			if (!isCurrentRecordingAttempt(recordingSessionState, token)) return;
			const flow = recordingSessionState.flowId
				? state.flows.find(
						(candidate) => candidate.id === recordingSessionState.flowId,
					)
				: null;
			if (flow) {
				const snapshot = beginRecordingReplacement(flow, {
					selectedActionId,
					selectedActionIds: [...selectedActionIds],
				});
				recordingSessionState = retainRecordingSnapshot(
					recordingSessionState,
					snapshot,
				);
				selectedActionId = null;
				selectedActionIds = new Set();
				touchFlow(flow);
				const saved = await saveState();
				if (!isCurrentRecordingAttempt(recordingSessionState, token)) return;
				if (!saved) {
					try {
						await invoke("stop_recording");
					} catch (_) {}
					const selection = restoreRecordingReplacement(flow, snapshot);
					selectedActionId = selection.selectedActionId;
					selectedActionIds = new Set(selection.selectedActionIds);
					recordingSessionState = stopRecordingSession(recordingSessionState);
					renderAll();
					toast(
						"Could not save recording",
						"The previous actions were restored.",
						"error",
					);
					return;
				}
			}
			if (!isCurrentRecordingAttempt(recordingSessionState, token)) return;
			recordingSessionState = activateRecording(recordingSessionState);
			await setActivityBadge(invoke, "recording");
			if (!isCurrentRecordingAttempt(recordingSessionState, token)) return;
			publishEditorSnapshot();
			setStatus("Recording", "recording");
			toast(
				"Recording started",
				`Use ${state.settings.recordHotkey} to stop and keep this recording. Press Escape to cancel and restore the previous actions.`,
			);
		} catch (err) {
			if (!isCurrentRecordingAttempt(recordingSessionState, token)) return;
			recordingSessionState = idleRecordingSession();
			recordingSessionState.token = token;
			recordingWindowHandle = null;
			setStatus("Idle");
			toast("Could not start recording", String(err), "error");
		}
	}

	async function stopRecording() {
		const flow = currentFlow();
		recordingSessionState = stopRecordingSession(recordingSessionState);
		recordingWindowHandle = null;
		if (!nativeAvailable) {
			publishEditorSnapshot();
			setStatus("Idle");
			return;
		}
		try {
			await invoke("stop_recording");
		} catch (_) {}
		await setActivityBadge(invoke, "idle");
		publishEditorSnapshot();
		setStatus("Idle");
		toast(
			"Recording stopped",
			`${flow?.actions.length || 0} actions in the current flow.`,
		);
	}

	async function cancelRecording(): Promise<void> {
		const cancelled = cancelRecordingSession(recordingSessionState);
		if (!cancelled.changed) return;
		const session = recordingSessionState;
		const flow = session.flowId
			? state.flows.find((candidate) => candidate.id === session.flowId)
			: null;
		recordingSessionState = cancelled.state;
		recordingWindowHandle = null;
		try {
			if (nativeAvailable) await invoke("stop_recording");
		} catch (_) {}
		if (flow && session.snapshot) {
			const selection = restoreRecordingReplacement(flow, session.snapshot);
			selectedActionId = selection.selectedActionId;
			selectedActionIds = new Set(selection.selectedActionIds);
			await saveState();
		}
		await setActivityBadge(invoke, "idle");
		publishEditorSnapshot();
		setStatus("Idle");
		toast("Recording cancelled");
	}

	async function runFlow(flow = currentFlow()) {
		if (bindingCountdown) {
			bindingCountdown.abort();
			bindingCountdown = null;
			setStatus("Idle");
			toast("Binding cancelled", "Playback was not started.", "error");
			return;
		}
		if (flow) {
			state.selectedFlowId = flow.id;
			scheduleSave();
		}
		if (!flow?.actions?.length)
			return toast(
				"Nothing to run",
				"Add at least one click or delay action.",
				"error",
			);
		if (!nativeAvailable)
			return toast(
				"Playback requires the desktop build",
				"Build and run the FlowClicker desktop app to use native mouse input.",
				"error",
			);
		if (!flow.target) {
			const countdown = new AbortController();
			bindingCountdown = countdown;
			try {
				const target = await captureWindowTarget(
					invoke,
					countdown.signal,
					setStatus,
				);
				if (!target) return;
				const previousTarget = flow.target;
				flow.target = target;
				touchFlow(flow);
				if (!(await saveState())) {
					flow.target = previousTarget;
					throw new Error("Could not save the target window.");
				}
				renderAll();
			} catch (err) {
				setStatus("Idle");
				return toast("Playback unavailable", String(err), "error");
			} finally {
				if (bindingCountdown === countdown) bindingCountdown = null;
			}
		}
		const playback = flowPlayback();
		runningFlowId = flow.id;
		activePlayback = {
			flowId: flow.id,
			playback,
			configuredDuration: playback.repeatValue,
			durationSeconds: playback.repeatValue,
			startedAt: Date.now(),
			execution: 1,
		};
		beginStatusTimer();
		renderFlowList();
		const options = {
			speed: Number(playback.playbackSpeed) || 1,
			repeatMode: playback.repeatMode,
			repeatValue: Math.max(1, Number(playback.repeatValue) || 1),
			repeatUnit: "seconds",
			settleMs: Math.max(0, Number(playback.settleMs) || 0),
			holdMs: Math.max(0, Number(playback.holdMs) || 0),
			restoreCursor: !!playback.restoreCursor,
			focusTargetWindow: !!playback.focusTargetWindow,
			untilTime: nextDeadline(playback.untilTime),
		};
		try {
			await hideOverlay();
			await setPlaybackHud(true);
			await setActivityBadge(invoke, "playing");
			await invoke("play_flow", {
				actionsJson: JSON.stringify(flow.actions),
				optionsJson: JSON.stringify(options),
				targetJson: JSON.stringify(flow.target ?? null),
			});
			publishEditorSnapshot();
		} catch (err) {
			await setPlaybackHud(false);
			await setActivityBadge(invoke, "idle");
			clearPlaybackStatus();
			playing = false;
			runningFlowId = null;
			renderFlowList();
			setStatus("Idle");
			toast("Playback failed", String(err), "error");
		}
	}

	async function stopPlayback() {
		if (!nativeAvailable) return;
		const active = activePlayback;
		const canPersistDuration =
			!!active && playing && active.playback.repeatMode === "duration";
		try {
			await invoke("stop_playback");
		} catch (_) {
			return;
		}
		if (!canPersistDuration) return;
		const remainder = active ? durationRemainder(active, flowPlayback()) : null;
		if (remainder == null) return;
		state.settings.playback.repeatValue = remainder;
		renderSettings();
		scheduleSave();
	}

	async function syncHotkeys() {
		if (!nativeAvailable) return;
		try {
			await invoke("set_hotkeys", {
				recordHotkey: state.settings.recordHotkey,
				playbackHotkey: state.settings.playbackHotkey,
			});
		} catch (err) {
			toast("Hotkey update failed", String(err), "error");
		}
	}

	async function showOverlay(_interactive: boolean): Promise<void> {
		const flow = currentFlow();
		if (!flow || clickCount(flow) === 0)
			return toast(
				"No click points",
				"This flow has no click actions.",
				"error",
			);
		if (!nativeAvailable)
			return toast("Overlay requires the desktop build", "", "error");
		try {
			await invoke("show_overlay", {
				actionsJson: JSON.stringify(flow.actions),
				interactive: true,
			});
			mapVisible = true;
			publishEditorSnapshot();
		} catch (err) {
			toast("Could not show click map", String(err), "error");
		}
	}

	async function hideOverlay() {
		if (!nativeAvailable) return;
		try {
			await invoke("hide_overlay");
		} catch (_) {}
		mapVisible = false;
		publishEditorSnapshot();
	}

	function openImportModal() {
		const flow = currentFlow();
		const sources = state.flows.filter((f) => f.id !== flow?.id);
		if (!sources.length)
			return toast(
				"No other flows yet",
				"Create another flow before importing actions.",
				"error",
			);
		$("importSourceFlow").innerHTML = sources
			.map((f) => `<option value="${f.id}">${escapeHtml(f.name)}</option>`)
			.join("");
		$("importPosition").value = selectedActionId ? "after" : "end";
		openDialog("importModal", "importSourceFlow");
		renderImportActions();
	}

	function renderImportActions(): void {
		const source = state.flows.find(
			(f) => f.id === $("importSourceFlow").value,
		);
		const list = $("importActionList");
		list.innerHTML = "";
		importSelection = new Set(source?.actions.map((a) => a.id) || []);
		(source?.actions || []).forEach((a, i) => {
			const row = document.createElement("label");
			row.className = "import-action-row";
			const summary =
				a.type === "click"
					? `Click at ${a.screenX}, ${a.screenY}`
					: a.type === "delay"
						? `Delay ${a.delayMs} ms`
						: `${a.actions.length} actions`;
			row.innerHTML = `<input type="checkbox" checked data-action-id="${a.id}"><span class="num">${i + 1}</span><div><strong>${escapeHtml(a.name)}</strong><div class="summary">${summary}</div></div><span class="action-type ${a.type}">${a.type}</span>`;
			const checkbox = row.querySelector("input");
			if (!checkbox) return;
			checkbox.addEventListener("change", (e: Event): void => {
				const target = e.target as HTMLInputElement;
				if (target.checked) importSelection.add(a.id);
				else importSelection.delete(a.id);
				$("importSelectAll").checked =
					importSelection.size === (source?.actions.length || 0);
				updateImportCount();
			});
			list.appendChild(row);
		});
		$("importSelectAll").checked = true;
		updateImportCount();
	}

	function updateImportCount(): void {
		$("importCount").textContent = `${importSelection.size} selected`;
	}
	function closeImportModal(): void {
		closeDialog("importModal");
	}

	function openPortableImport(): void {
		if (recordingSessionState.active || playing) {
			toast(
				"Import unavailable",
				"Stop recording or playback before replacing the library.",
				"error",
			);
			return;
		}
		$("portableImportText").value = "";
		pendingPortableData = null;
		openDialog("portableImportModal", "portableImportText");
	}

	function stagePortableImport(
		json: string = $("portableImportText").value,
	): void {
		if (recordingSessionState.active || playing) {
			toast(
				"Import unavailable",
				"Stop recording or playback before replacing the library.",
				"error",
			);
			return;
		}
		try {
			pendingPortableData = parsePortableData(json);
		} catch (err) {
			pendingPortableData = null;
			toast(
				"Import rejected",
				String(err instanceof Error ? err.message : err),
				"error",
			);
			return;
		}
		$("portableConfirmMessage").textContent =
			`Replace ${state.flows.length} current flow${state.flows.length === 1 ? "" : "s"} with ${pendingPortableData.flows.length} imported flow${pendingPortableData.flows.length === 1 ? "" : "s"} and ${pendingPortableData.groups.length} group${pendingPortableData.groups.length === 1 ? "" : "s"}?`;
		closeDialog("portableImportModal");
		openDialog("portableConfirmModal", "cancelPortableConfirmBtn");
	}

	async function confirmPortableImport() {
		if (!pendingPortableData || recordingSessionState.active || playing)
			return closeDialog("portableConfirmModal");
		const overlayWasVisible = mapVisible;
		await hideOverlay();
		const replacement = replaceWithPortableData(state, pendingPortableData);
		if (!(await saveState(false, replacement))) {
			if (overlayWasVisible && editorOpen) await showOverlay(true);
			return;
		}
		state = replacement;
		combineQueue = [];
		importSelection = new Set();
		selectedActionId = null;
		selectedActionIds = new Set();
		pendingPortableData = null;
		editorOpen = false;
		$("flowsTab").classList.add("active");
		$("settingsTab").classList.remove("active");
		setView("compact");
		closeDialog("portableConfirmModal");
		renderAll();
		toast(
			"Library imported",
			`${state.flows.length} flow${state.flows.length === 1 ? "" : "s"} imported. Local settings were retained.`,
		);
	}

	function confirmImport(): void {
		const dest = currentFlow();
		const source = state.flows.find(
			(f) => f.id === $("importSourceFlow").value,
		);
		if (!dest || !source) return;
		const copies = source.actions
			.filter((a) => importSelection.has(a.id))
			.map((a, i) => deepActionCopy(a, i));
		if (!copies.length) {
			toast("Nothing selected", "Choose at least one source action.", "error");
			return;
		}
		const position = $("importPosition").value;
		let index = dest.actions.length;
		if (position === "beginning") index = 0;
		if (position === "after" && selectedActionId) {
			const found = dest.actions.findIndex((a) => a.id === selectedActionId);
			index = found >= 0 ? found + 1 : dest.actions.length;
		}
		dest.actions.splice(index, 0, ...copies);
		selectedActionId = copies[0].id;
		touchFlow(dest);
		closeImportModal();
		renderAll();
		toast(
			"Actions imported",
			`${copies.length} independent action${copies.length === 1 ? "" : "s"} copied from ${source.name}.`,
		);
	}

	function openCombineModal(): void {
		if (selectedFlows(combineQueue, state.flows).length < 2) {
			toast(
				"Select two flows",
				"Choose at least two flow cards before combining.",
				"error",
			);
			return;
		}
		$("combinedFlowName").value = "Combined flow";
		openDialog("combineModal", "combinedFlowName");
		renderCombineChoices();
	}
	function renderCombineChoices(): void {
		const flows = selectedFlows(combineQueue, state.flows);
		$("combinedFlowName").value = selectionName(flows) || "Combined flow";
		$("combineSummary").innerHTML = flows
			.map(
				(flow, index) =>
					`<div class="combine-summary-row"><strong>${index + 1}. ${escapeHtml(flow.name)}</strong><span>${flow.actions.length} actions</span></div>`,
			)
			.join("");
		$("confirmCombineBtn").disabled = flows.length < 2;
	}
	function toggleCombineFlow(flow: Flow, checked: boolean): void {
		combineQueue = toggleSelection(combineQueue, flow.id, checked);
		renderFlowList();
	}
	function closeCombineModal(): void {
		closeDialog("combineModal");
	}

	function confirmCombine() {
		const sources = selectedFlows(combineQueue, state.flows);
		if (sources.length < 2) return closeCombineModal();
		const name = $("combinedFlowName").value.trim() || "Combined flow";
		const combined = combineFlows(sources, uid);
		if (!combined) return closeCombineModal();
		const actions = combined.actions;
		const flow = {
			...combined,
			name,
			createdAt: nowIso(),
			updatedAt: nowIso(),
			combinedFrom: sources.map((f) => ({ id: f.id, name: f.name })),
		};
		state.flows.push(flow);
		state.selectedFlowId = flow.id;
		combineQueue = [];
		selectedActionId = actions[0]?.id || null;
		scheduleSave();
		closeCombineModal();
		renderAll();
		toast(
			"Combined flow created",
			`${actions.length} copied actions. Source flows were not changed.`,
		);
	}

	function bindUi() {
		const closeLibraryMenu = () => {
			$("libraryMenu").classList.add("hidden");
			$("libraryMenuBtn").setAttribute("aria-expanded", "false");
		};
		$("newFlowBtn").addEventListener("click", () =>
			newFlow(`Flow ${state.flows.length + 1}`),
		);
		$("libraryMenuBtn").addEventListener("click", (event) => {
			event.stopPropagation();
			const hidden = $("libraryMenu").classList.toggle("hidden");
			$("libraryMenuBtn").setAttribute("aria-expanded", String(!hidden));
		});
		$("newGroupBtn").addEventListener("click", () => {
			closeLibraryMenu();
			createLibraryGroup();
		});
		$("combineMenuBtn").addEventListener("click", () => {
			closeLibraryMenu();
			openCombineModal();
		});
		$("flowsTab").addEventListener("click", async () => {
			editorOpen = false;
			await hideOverlay();
			$("flowsTab").classList.add("active");
			$("settingsTab").classList.remove("active");
			setView("compact");
		});
		$("settingsTab").addEventListener("click", async () => {
			await hideOverlay();
			$("settingsTab").classList.add("active");
			$("flowsTab").classList.remove("active");
			setView("settings");
			editorOpen = false;
			renderSettings();
		});
		$("closeFlowSettingsBtn").addEventListener("click", () =>
			closeDialog("flowSettingsModal"),
		);
		document.addEventListener("click", (event) => {
			if (
				!(event.target instanceof Element) ||
				!event.target.closest(".library-menu-wrap")
			)
				closeLibraryMenu();
			for (const id of [
				"importModal",
				"combineModal",
				"groupModal",
				"libraryGroupModal",
				"flowSettingsModal",
				"deleteFlowModal",
				"portableImportModal",
				"portableConfirmModal",
			])
				if (event.target === $(id)) closeDialog(id);
		});
		document.addEventListener("keydown", (event) => {
			const modal = document.querySelector(
				".modal-backdrop:not(.hidden) .modal",
			);
			if (event.key === "Tab" && modal) {
				const focusable = [
					...modal.querySelectorAll<HTMLElement>(
						'button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])',
					),
				];
				if (focusable.length) {
					const edge = event.shiftKey ? focusable[0] : focusable.at(-1);
					if (
						document.activeElement === edge ||
						!modal.contains(document.activeElement)
					) {
						event.preventDefault();
						(event.shiftKey ? focusable.at(-1) : focusable[0])?.focus();
					}
				}
				return;
			}
			if (event.key !== "Escape") return;
			const action = escapeAction(
				recordingSessionState.active || recordingSessionState.starting,
				mapVisible,
				Boolean(modal || !$("libraryMenu").classList.contains("hidden")),
				editorOpen,
			);
			if (action === "cancel-recording") {
				void cancelRecording();
				return;
			}
			if (action === "hide-overlay") {
				void hideOverlay();
				return;
			}
			closeLibraryMenu();
			closeSettingsModal();
			closeCombineModal();
			closeImportModal();
			closeDialog("groupModal");
			closeDialog("libraryGroupModal");
			closeDialog("deleteFlowModal");
			closeDialog("portableImportModal");
			closeDialog("portableConfirmModal");
			if (action === "close-editor") void closeEditor();
		});
		$("flowSearch").addEventListener("input", renderFlowList);
		["playbackSpeed", "repeatValue", "settleMs", "holdMs", "untilTime"].forEach(
			(id) => {
				$(id).addEventListener("change", saveSettingsFromUi);
			},
		);
		bindDurationInput($("repeatDuration"), saveSettingsFromUi);
		$("repeatMode").addEventListener("change", () => {
			const mode = $("repeatMode").value;
			$("repeatValueRow").classList.toggle("hidden", mode !== "cycles");
			$("repeatTimerRow").classList.toggle("hidden", mode !== "duration");
			$("untilTimeField").classList.toggle("hidden", mode !== "until");
			if (mode !== "until") saveSettingsFromUi();
		});
		["restoreCursor", "focusTarget"].forEach((id) => {
			$(id).addEventListener("change", saveSettingsFromUi);
		});
		(["recordHotkey", "playbackHotkey"] as const).forEach((id) => {
			const button = $(id);
			button.addEventListener("click", () => {
				capturingHotkey = {
					id,
					accepted: false,
					syncing: false,
					released: false,
				};
				button.classList.add("capturing");
				button.textContent = "Press a shortcut…";
				button.focus();
			});
			button.addEventListener("blur", () => {
				if (!capturingHotkey || capturingHotkey.id !== id) return;
				if (capturingHotkey.accepted) return;
				capturingHotkey = null;
				button.classList.remove("capturing");
				button.textContent = state.settings[id];
			});
			button.addEventListener("keydown", async (event) => {
				if (!capturingHotkey || capturingHotkey.id !== id) return;
				event.preventDefault();
				event.stopPropagation();
				if (event.key === "Escape") return button.blur();
				if (capturingHotkey.accepted) return;
				const shortcut = normalizeHotkeyEvent(event);
				if (!shortcut)
					return toast(
						"Unsupported shortcut",
						"Use F1–F12 alone, or Ctrl, Alt, Shift, or Meta plus a letter, number, F-key, Space, or Enter.",
						"error",
					);
				const other = id === "recordHotkey" ? "playbackHotkey" : "recordHotkey";
				if (
					state.settings[other] === shortcut ||
					hotkeysOverlap(state.settings[other], shortcut)
				)
					return toast(
						"Shortcut already used",
						"Choose a shortcut that does not overlap the other toggle.",
						"error",
					);
				const capture = capturingHotkey;
				capture.accepted = true;
				capture.syncing = true;
				state.settings[id] = shortcut;
				button.textContent = shortcut;
				scheduleSave();
				await syncHotkeys();
				if (capturingHotkey !== capture) return;
				capture.syncing = false;
				if (capture.released) {
					capturingHotkey = null;
					button.classList.remove("capturing");
				}
			});
			button.addEventListener("keyup", () => {
				if (
					!capturingHotkey ||
					capturingHotkey.id !== id ||
					!capturingHotkey.accepted
				)
					return;
				capturingHotkey.released = true;
				if (!capturingHotkey.syncing) {
					capturingHotkey = null;
					button.classList.remove("capturing");
				}
			});
		});
		document.addEventListener("keyup", () => {
			if (!capturingHotkey?.accepted) return;
			capturingHotkey.released = true;
			if (!capturingHotkey.syncing) {
				document
					.getElementById(capturingHotkey.id)
					?.classList.remove("capturing");
				capturingHotkey = null;
			}
		});
		$("cancelDeleteFlowBtn").addEventListener("click", () => {
			pendingDeleteFlow = null;
			closeDialog("deleteFlowModal");
		});
		$("confirmDeleteFlowBtn").addEventListener("click", confirmDeleteFlow);

		$("closeImportBtn").addEventListener("click", closeImportModal);
		$("cancelImportBtn").addEventListener("click", closeImportModal);
		$("confirmImportBtn").addEventListener("click", confirmImport);
		$("importSourceFlow").addEventListener("change", renderImportActions);
		$("importSelectAll").addEventListener("change", () => {
			const source = state.flows.find(
				(f) => f.id === $("importSourceFlow").value,
			);
			importSelection = new Set(
				$("importSelectAll").checked
					? (source?.actions || []).map((a) => a.id)
					: [],
			);
			renderImportActionsFromSelection(source);
		});
		$("closeCombineBtn").addEventListener("click", closeCombineModal);
		$("cancelCombineBtn").addEventListener("click", closeCombineModal);
		$("confirmCombineBtn").addEventListener("click", confirmCombine);
		$("closeLibraryGroupBtn").addEventListener("click", () =>
			closeDialog("libraryGroupModal"),
		);
		$("cancelLibraryGroupBtn").addEventListener("click", () =>
			closeDialog("libraryGroupModal"),
		);
		$("exportPortableBtn").addEventListener("click", async () => {
			if (!nativeAvailable)
				return toast(
					"Export requires the desktop build",
					"The browser preview cannot open native files.",
					"error",
				);
			try {
				if (
					await invoke("export_portable_data", {
						dataJson: exportPortableData(state),
						fileName: `FlowClicker-${new Date().toISOString().slice(0, 10)}.flowclicker.json`,
					})
				)
					toast("Library exported", "Flows and groups were saved.");
			} catch (err) {
				toast("Export failed", String(err), "error");
			}
		});
		$("importPortableBtn").addEventListener("click", openPortableImport);
		$("choosePortableFileBtn").addEventListener("click", async () => {
			if (!nativeAvailable)
				return toast(
					"File import requires the desktop build",
					"Paste JSON in the box when using the browser preview.",
					"error",
				);
			try {
				const json = await invoke("pick_portable_data");
				if (typeof json === "string") {
					$("portableImportText").value = json;
					stagePortableImport(json);
				}
			} catch (err) {
				toast("Could not read import file", String(err), "error");
			}
		});
		$("closePortableImportBtn").addEventListener("click", () =>
			closeDialog("portableImportModal"),
		);
		$("cancelPortableImportBtn").addEventListener("click", () =>
			closeDialog("portableImportModal"),
		);
		$("stagePortableImportBtn").addEventListener("click", () =>
			stagePortableImport(),
		);
		$("closePortableConfirmBtn").addEventListener("click", () =>
			closeDialog("portableConfirmModal"),
		);
		$("cancelPortableConfirmBtn").addEventListener("click", () =>
			closeDialog("portableConfirmModal"),
		);
		$("confirmPortableImportBtn").addEventListener(
			"click",
			confirmPortableImport,
		);
	}

	function renderImportActionsFromSelection(source: Flow | undefined): void {
		$("importActionList")
			.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')
			.forEach((cb) => {
				cb.checked = importSelection.has(cb.dataset.actionId || "");
			});
		$("importSelectAll").checked =
			importSelection.size === (source?.actions.length || 0) &&
			importSelection.size > 0;
		updateImportCount();
	}

	function saveSettingsFromUi() {
		state.settings.playback = playbackFromForm($);
		scheduleSave();
		renderSettings();
	}

	async function bindTauriEvents() {
		if (!listen) return;
		await listen("overlay-dismiss-requested", () => hideOverlay());
		await listen("recording-cancel-requested", () => cancelRecording());
		await listen("recorded-click", (event) => {
			const flow = recordingSessionState.flowId
				? state.flows.find(
						(candidate) => candidate.id === recordingSessionState.flowId,
					)
				: null;
			if (!acceptsRecordedClick(recordingSessionState) || !flow) return;
			const c = event.payload;
			if (
				typeof c.screenX !== "number" ||
				typeof c.screenY !== "number" ||
				typeof c.delayMs !== "number"
			)
				return;
			if (c.executablePath && c.className && c.windowTitle) {
				const target: WindowTarget = {
					executablePath: c.executablePath,
					className: c.className,
					title: c.windowTitle,
				};
				if (
					!sameRecordedWindow(
						flow.target,
						recordingWindowHandle,
						target,
						c.windowHandle,
					)
				)
					return toast(
						"Click ignored",
						"The click came from a different window.",
						"error",
					);
				recordingWindowHandle ??= c.windowHandle;
				if (!flow.target) flow.target = target;
			} else
				return toast(
					"Click ignored",
					"The target window could not be identified.",
					"error",
				);
			const a: ClickAction = {
				id: uid(),
				type: "click",
				name: `Click ${clickCount(flow) + 1}`,
				screenX: c.screenX,
				screenY: c.screenY,
				relativeX: c.relativeX,
				relativeY: c.relativeY,
				windowTitle: c.windowTitle,
				button: c.button === "right" ? "right" : "left",
				delayMs: c.delayMs,
			};
			flow.actions.push(a);
			selectedActionId = a.id;
			touchFlow(flow);
			renderAll();
		});
		await listen("hotkey-record", () => {
			if (!capturingHotkey)
				return recordingSessionState.active || recordingSessionState.starting
					? stopRecording()
					: startRecording();
		});
		await listen("hotkey-play", () => {
			if (!capturingHotkey) return playing ? stopPlayback() : runFlow();
		});
		await listen("playback-state", (event) => {
			playing = String(event.payload) === "playing";
			if (playing) {
				if (!runningFlowId) runningFlowId = state.selectedFlowId;
				beginStatusTimer();
			} else {
				clearPlaybackStatus();
				runningFlowId = null;
			}
			if (!playing) {
				setPlaybackHud(false);
				setActivityBadge(invoke, "idle");
				hideOverlay();
			}
			publishEditorSnapshot();
			renderFlowList();
			if (!playing) setStatus("Idle");
			if (!playing) toast("Playback finished");
		});
		await listen("playback-progress", (event) => {
			if (activePlayback && Number(event.payload?.execution) > 0) {
				activePlayback.execution = Number(event.payload.execution);
				refreshPlaybackStatus();
			}
		});
		await listen("playback-error", (event) => {
			clearPlaybackStatus();
			playing = false;
			setPlaybackHud(false);
			setActivityBadge(invoke, "idle");
			hideOverlay();
			runningFlowId = null;
			publishEditorSnapshot();
			renderFlowList();
			setStatus("Idle");
			toast("Playback error", String(event.payload), "error");
		});
		await listen("input-listener-error", (event) =>
			toast("Global input listener failed", String(event.payload), "error"),
		);
		await listen("overlay-action-moved", async (event) => {
			const flow = currentFlow();
			const move = event.payload;
			if (
				!flow ||
				typeof move.actionId !== "string" ||
				typeof move.screenX !== "number" ||
				typeof move.screenY !== "number"
			)
				return;
			const action = findAction(flow.actions, move.actionId);
			if (action?.type !== "click") return;
			await updateClickPosition(action, move.screenX, move.screenY);
			toast(
				"Click point moved",
				`${action.name} → ${move.screenX}, ${move.screenY}`,
			);
		});
	}

	mountEditorView($("editorPanel"));
	bindUi();
	bindEditorView((type, payload) => applyEditorIntent({ type, ...payload }));
	bindTauriEvents();
	showVersion().catch(() => {});
	loadState();
})();
