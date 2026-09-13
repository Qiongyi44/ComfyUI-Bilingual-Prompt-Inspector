import assert from "node:assert/strict";
import { createPanelSyncHub } from "../js/panel_sync.js";

const hub = createPanelSyncHub();
const firstSource = Symbol("first");
const secondSource = Symbol("second");
const firstEvents = [];
const secondEvents = [];

const unsubscribeFirst = hub.subscribe((kind, source) => {
  if (source !== firstSource) firstEvents.push(kind);
});
hub.subscribe((kind, source) => {
  if (source !== secondSource) secondEvents.push(kind);
});

hub.machineTranslations.set("lanterns", { english: "lanterns", text: "灯笼" });
hub.notify("machine", firstSource);
assert.deepEqual(firstEvents, []);
assert.deepEqual(secondEvents, ["machine"]);
assert.equal(hub.machineTranslations.get("lanterns").text, "灯笼");

hub.notify("preferences", secondSource);
assert.deepEqual(firstEvents, ["preferences"]);
assert.deepEqual(secondEvents, ["machine"]);

unsubscribeFirst();
hub.notify("dictionary", secondSource);
assert.deepEqual(firstEvents, ["preferences"]);

console.log("panel sync tests: OK");
