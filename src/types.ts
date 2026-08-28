export type ActionButton = "left" | "right";
export type ClickAction = {
	type: "click";
	id: string;
	name: string;
	screenX: number;
	screenY: number;
	relativeX?: number | null;
	relativeY?: number | null;
	windowTitle?: string | null;
	button?: ActionButton;
	delayMs: number;
};
export type DelayAction = {
	type: "delay";
	id: string;
	name: string;
	delayMs: number;
};
export type ActionGroup = {
	type: "group";
	id: string;
	name: string;
	repeatCount: number;
	actions: Action[];
};
export type Action = ClickAction | DelayAction | ActionGroup;
export type PlaybackMode = "cycles" | "duration" | "continuous";
export type Playback = {
	playbackSpeed: number;
	repeatMode: PlaybackMode;
	repeatValue: number;
	repeatUnit: "seconds";
	settleMs: number;
	holdMs: number;
	restoreCursor: boolean;
	focusTargetWindow: boolean;
	untilTime: string | null;
};
export type Flow = {
	id: string;
	name: string;
	actions: Action[];
	groupId: string | null;
	createdAt?: string;
	updatedAt?: string;
	combinedFrom?: Array<{ id: string; name: string }>;
	playback?: Playback;
};
export type LibraryGroup = { id: string; name: string; collapsed: boolean };
export type AppSettings = {
	recordHotkey: string;
	playbackHotkey: string;
	playback: Playback;
};
export type EditorSize = { width: number; height: number } | null;
export type AppState = {
	version: 3;
	editorSize: EditorSize;
	selectedFlowId: string | null;
	settings: AppSettings;
	groups: LibraryGroup[];
	flows: Flow[];
};
export type EditorSnapshot = {
	flow: Flow;
	selectedActionId: string | null;
	selectedActionIds: string[];
	recording: boolean;
	playing: boolean;
	mapVisible: boolean;
};
export type NativePayload = {
	type?: string;
	field?: string;
	value?: string | number;
	multi?: boolean;
	actionIds?: string[];
	delta?: number;
	actionId?: string;
	screenX?: number;
	screenY?: number;
	relativeX?: number | null;
	relativeY?: number | null;
	windowTitle?: string | null;
	button?: "left" | "right";
	delayMs?: number;
	execution?: number;
	event?: string;
	os?: string;
	physicalMouseSupported?: boolean;
	globalRecordingSupported?: boolean;
	windowRelativeSupported?: boolean;
	accessibilityNote?: string;
	width?: number;
	height?: number;
	cursor_before?: string;
	cursor_after?: string;
	cursor_moved?: boolean;
	cdp?: unknown;
	events?: unknown;
	physical_events?: Array<{
		event: string;
		is_trusted: boolean;
		x?: number;
		y?: number;
	}>;
	replay_events?: Array<{
		event: string;
		is_trusted: boolean;
		x?: number;
		y?: number;
	}>;
	[key: string]: unknown;
};
export type NativeResult =
	| NativePayload
	| string
	| boolean
	| EditorSize
	| undefined;
export type NativeInvoke = <TResult extends NativeResult = NativePayload>(
	command: string,
	args?: Record<string, unknown>,
) => Promise<TResult>;
export type NativeListen = <TPayload = NativePayload>(
	event: string,
	handler: (event: { payload: TPayload }) => void,
) => Promise<() => void>;
export type NativeApi = {
	core?: { invoke?: NativeInvoke };
	event?: {
		emit?: (event: string, payload?: unknown) => Promise<unknown>;
		emitTo?: (
			label: string,
			event: string,
			payload?: unknown,
		) => Promise<unknown>;
		listen?: NativeListen;
	};
	window?: {
		getCurrentWindow?: () => { setTitle: (title: string) => Promise<void> };
	};
	app?: { getVersion?: () => Promise<string> };
};
declare global {
	interface Window {
		__TAURI__?: NativeApi;
	}
}
