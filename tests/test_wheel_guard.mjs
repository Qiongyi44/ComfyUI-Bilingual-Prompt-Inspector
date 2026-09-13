import assert from "node:assert/strict";
import { boundedScrollPosition, normalizedWheelDelta } from "../js/wheel_guard.js";

assert.equal(normalizedWheelDelta(12, 0, 500), 12);
assert.equal(normalizedWheelDelta(3, 1, 500), 48);
assert.equal(normalizedWheelDelta(1, 2, 640), 640);
assert.equal(boundedScrollPosition(100, 40, 300), 140);
assert.equal(boundedScrollPosition(280, 40, 300), 300);
assert.equal(boundedScrollPosition(10, -40, 300), 0);

console.log("wheel guard tests: OK");
