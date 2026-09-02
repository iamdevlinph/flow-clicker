import type { NativeInvoke, NativePayload, WindowTarget } from "./types.js";

export async function captureWindowTarget(
	invoke: NativeInvoke,
	signal: AbortSignal,
	setStatus: (message: string, tone: "recording") => void,
	sleep: (ms: number) => Promise<unknown> = (ms) =>
		new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<WindowTarget | null> {
	for (let seconds = 3; seconds > 0; seconds--) {
		if (signal.aborted) return null;
		setStatus(`Focus the target window — starting in ${seconds}`, "recording");
		await sleep(1000);
	}
	if (signal.aborted) return null;
	const snapshot = await invoke<NativePayload>("cursor_snapshot");
	if (!snapshot.executablePath || !snapshot.className || !snapshot.windowTitle)
		throw new Error("Could not identify the foreground target window.");
	return {
		executablePath: snapshot.executablePath,
		className: snapshot.className,
		title: snapshot.windowTitle,
	};
}
