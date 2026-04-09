// ============================================
// DFF! – Toast Utility
// Single source of truth for toast notifications
// ============================================

/**
 * Show a toast notification.
 * @param {string} message – The message to display
 * @param {number} duration – Duration in ms (default 2500)
 */
export function showToast(message, duration = 2500) {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('out');
    setTimeout(() => toast.remove(), 200);
  }, duration);
}

// Also expose globally for legacy usage
window.showToast = showToast;
