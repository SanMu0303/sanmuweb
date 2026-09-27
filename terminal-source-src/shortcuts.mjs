export function shortcutAction(event, modalOpen = false) {
  const target = event.target;
  if (
    modalOpen ||
    event.isComposing ||
    event.repeat ||
    event.metaKey ||
    event.ctrlKey ||
    event.altKey ||
    target?.closest?.(
      'input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"]',
    )
  )
    return null;
  return (
    {
      j: "next",
      k: "previous",
      w: "watch",
      x: "ignore",
      p: "plan",
      "?": "help",
    }[event.key.toLowerCase()] || null
  );
}
export function navigationTarget(ids, signals, currentId, direction) {
  const available = ids
    .map((id) => signals.find((s) => s.id === id))
    .filter((s) => s && s.status !== "ignored");
  if (!available.length) return null;
  const index = available.findIndex((s) => s.id === currentId);
  if (index < 0) return direction < 0 ? available.at(-1) : available[0];
  return available[index + direction] || null;
}
