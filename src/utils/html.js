// ============================================
// DFF! – HTML Utilities
// Centralized HTML escaping to prevent XSS
// ============================================

/**
 * Escape HTML special characters to prevent XSS.
 * Use this for ALL user-generated content injected via innerHTML.
 */
export function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Escape for use inside HTML attribute values (e.g. value="...").
 */
export function escapeAttr(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
