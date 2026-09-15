const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/**
 * Escape a value before interpolating it into a printed document.
 *
 * The ticket is assembled as HTML and loaded into a real BrowserWindow, and it
 * carries operator-typed text (vehicle model, colour). Without escaping, a
 * vehicle saved as `<img onerror=...>` would execute there. The single-pass
 * regex also guarantees `&` is escaped before the entities it introduces.
 */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char]);
}
