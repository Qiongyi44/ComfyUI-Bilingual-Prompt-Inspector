const SCROLLABLE_SELECTOR = [
  ".bpi-panel.bpi-details-collapsed",
  ".bpi-table",
  ".bpi-results",
  ".bpi-issues",
  ".bpi-chinese-mirror",
  ".bpi-chinese-editor",
  ".bpi-english-token-view",
  ".bpi-english-editor",
  ".bpi-manager-table",
  ".bpi-pack-list",
  ".bpi-sort-groups",
  ".bpi-import-conflicts",
  ".bpi-community-preview",
  ".bpi-modal textarea",
  ".bpi-modal",
].join(",");

export function normalizedWheelDelta(delta, deltaMode, pageSize) {
  const value = Number(delta) || 0;
  if (deltaMode === 1) return value * 16;
  if (deltaMode === 2) return value * Math.max(1, Number(pageSize) || 1);
  return value;
}

export function boundedScrollPosition(current, delta, maximum) {
  return Math.max(0, Math.min(Math.max(0, Number(maximum) || 0), (Number(current) || 0) + (Number(delta) || 0)));
}

function scrollableFromEvent(event) {
  const ElementClass = globalThis.Element;
  if (!ElementClass) return null;
  const path = typeof event.composedPath === "function" ? event.composedPath() : [];
  const candidates = path.filter((item) => item instanceof ElementClass && item.matches?.(SCROLLABLE_SELECTOR));
  return candidates.find((item) => item.scrollHeight - item.clientHeight > 1 || item.scrollWidth - item.clientWidth > 1)
    ?? candidates[0]
    ?? (event.target instanceof ElementClass ? event.target.closest?.(SCROLLABLE_SELECTOR) : null);
}

function handleBpiWheel(event) {
  const target = scrollableFromEvent(event);
  if (!target) return;
  const maxTop = Math.max(0, target.scrollHeight - target.clientHeight);
  const maxLeft = Math.max(0, target.scrollWidth - target.clientWidth);
  if (maxTop <= 1 && maxLeft <= 1) return;

  const verticalDelta = normalizedWheelDelta(event.deltaY, event.deltaMode, target.clientHeight);
  const horizontalDelta = normalizedWheelDelta(event.deltaX, event.deltaMode, target.clientWidth);
  if (event.shiftKey && !horizontalDelta && maxLeft > 1) {
    target.scrollLeft = boundedScrollPosition(target.scrollLeft, verticalDelta, maxLeft);
  } else {
    if (maxTop > 1) target.scrollTop = boundedScrollPosition(target.scrollTop, verticalDelta, maxTop);
    if (maxLeft > 1) target.scrollLeft = boundedScrollPosition(target.scrollLeft, horizontalDelta, maxLeft);
  }

  if (event.cancelable) event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation?.();
}

export function installBpiWheelGuard() {
  if (!globalThis.window || window.__bpiWheelGuardInstalled) return;
  window.__bpiWheelGuardInstalled = true;
  window.addEventListener("wheel", handleBpiWheel, { capture: true, passive: false });
}
