// ============================================
// DFF! – Alarm Overlay
// ============================================

import { store } from '../store.js';
import { startAlarm, stopAlarm } from '../utils/alarm.js';

let currentAlarmMessage = null;

export function showAlarmOverlay(message) {
  currentAlarmMessage = message;
  const overlay = document.getElementById('alarm-overlay');
  if (!overlay) return;

  const sender = store.users.find(u => u.id === message.senderId);

  overlay.innerHTML = `
    <div class="alarm-bg"></div>
    <div class="alarm-content">
      <div class="alarm-icon">🔔</div>
      <div class="alarm-from">ALARM FRÅN ${sender?.name || 'Okänd'}</div>
      <div class="alarm-text">${escapeHtml(message.text)}</div>
      <div class="alarm-buttons">
        <button class="alarm-btn silence" id="alarm-silence">
          🔇 Tysta
        </button>
        <button class="alarm-btn snooze" id="alarm-snooze">
          ⏰ Snooze
        </button>
        <button class="alarm-btn done" id="alarm-done">
          ✅ Klar!
        </button>
      </div>
    </div>
  `;

  overlay.classList.add('active');

  // Start alarm effects
  startAlarm(store.settings);

  // Button handlers
  document.getElementById('alarm-silence')?.addEventListener('click', () => {
    store.markSeen(message.id);
    hideAlarmOverlay();
  });

  document.getElementById('alarm-snooze')?.addEventListener('click', () => {
    hideAlarmOverlay();
    store.emit('openSnooze', message.id);
  });

  document.getElementById('alarm-done')?.addEventListener('click', () => {
    store.markDone(message.id);
    hideAlarmOverlay();
    showToast('✅ Markerad som klar!');
  });
}

export function hideAlarmOverlay() {
  const overlay = document.getElementById('alarm-overlay');
  if (overlay) {
    overlay.classList.remove('active');
    overlay.innerHTML = '';
  }
  stopAlarm();
  currentAlarmMessage = null;
}

export function isAlarmActive() {
  return currentAlarmMessage !== null;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
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
