import { strict as expectAssert } from "node:assert";
import { test } from "vitest";
import { escapeAction } from "./escape-layer.js";

test("Escape handles the active layer before leaving the editor", () => {
	expectAssert.equal(escapeAction(true, true, true, true), "cancel-recording");
	expectAssert.equal(escapeAction(false, true, true, true), "hide-overlay");
	expectAssert.equal(escapeAction(false, false, true, true), "dismiss-layer");
	expectAssert.equal(escapeAction(false, false, false, true), "close-editor");
	expectAssert.equal(
		escapeAction(false, false, false, false),
		"dismiss-outside",
	);
});
