// ============================================
// DFF! – Snooze Dialog
// ============================================

import { store } from '../store.js';
import { formatDuration } from '../utils/time.js';

const SNOOZE_OPTIONS = [
  { label: '5 min', ms: 5 * 60 * 1000 },
  { label: '15 min', ms: 15 * 60 * 1000 },
  { label: '30 min', ms: 30 * 60 * 1000 },
  { label: '1 tim', ms: 60 * 60 * 1000 },
  { label: '2 tim', ms: 2 * 60 * 60 * 1000 },
  { label: '4 tim', ms: 4 * 60 * 60 * 1000 },
];

// For demo, use shorter times so user can actually test
const DEMO_SNOOZE_NOTE = 'Demo-tips: välj 5 min för att snabbt testa snooze-funktionen';

let currentMessageId = null;

export function showSnoozeDialog(messageId) {
  currentMessageId = messageId;
  const dialog = document.getElementById('snooze-dialog');
  if (!dialog) return;

  dialog.innerHTML = `
    <div class="snooze-backdrop" id="snooze-backdrop"></div>
    <div class="snooze-sheet">
      <div class="snooze-handle"></div>
      <div class="snooze-title">⏰ Snooze påminnelse</div>
      
      <div class="snooze-grid">
        ${SNOOZE_OPTIONS.map(opt => `
          <button class="snooze-option" data-ms="${opt.ms}">
            ${opt.label}
          </button>
        `).join('')}
      </div>

      <button class="snooze-custom" id="snooze-custom-btn">
        🕐 Välj egen tid...
      </button>

      <div class="snooze-custom-input" id="snooze-custom-input">
        <input type="time" id="snooze-time-input" />
        <button class="confirm-btn" id="snooze-custom-confirm">OK</button>
      </div>

      <button class="snooze-cancel" id="snooze-cancel">Avbryt</button>
    </div>
  `;

  dialog.classList.add('active');

  // Event listeners
  dialog.querySelectorAll('.snooze-option').forEach(btn => {
    btn.addEventListener('click', () => {
      const ms = parseInt(btn.dataset.ms);
      doSnooze(ms);
    });
  });

  document.getElementById('snooze-custom-btn')?.addEventListener('click', () => {
    const customInput = document.getElementById('snooze-custom-input');
    const customBtn = document.getElementById('snooze-custom-btn');
    if (customInput && customBtn) {
      customInput.classList.add('active');
      customBtn.style.display = 'none';
      // Set default to current time + 1 hour
      const defaultTime = new Date(Date.now() + 3600000);
      const timeInput = document.getElementById('snooze-time-input');
      if (timeInput) {
        timeInput.value = defaultTime.toTimeString().slice(0, 5);
        timeInput.focus();
      }
    }
  });

  document.getElementById('snooze-custom-confirm')?.addEventListener('click', () => {
    const timeInput = document.getElementById('snooze-time-input');
    if (!timeInput?.value) return;

    const [hours, minutes] = timeInput.value.split(':').map(Number);
    const target = new Date();
    target.setHours(hours, minutes, 0, 0);

    // If target is in the past, add a day
    if (target.getTime() <= Date.now()) {
      target.setDate(target.getDate() + 1);
    }

    const ms = target.getTime() - Date.now();
    doSnooze(ms);
  });

  document.getElementById('snooze-backdrop')?.addEventListener('click', hideSnoozeDialog);
  document.getElementById('snooze-cancel')?.addEventListener('click', hideSnoozeDialog);
}

function doSnooze(ms) {
  if (!currentMessageId) return;
  store.snoozeMessage(currentMessageId, ms);
  hideSnoozeDialog();
  showToast(`⏰ Snoozad ${formatDuration(ms)}`);
}

export function hideSnoozeDialog() {
  const dialog = document.getElementById('snooze-dialog');
  if (dialog) {
    dialog.classList.remove('active');
    dialog.innerHTML = '';
  }
  currentMessageId = null;
}

function showToast(message) {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('out');
    setTimeout(() => toast.remove(), 200);
  }, 2000);
}
