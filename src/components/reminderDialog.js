// ============================================
// DFF! – Reminder Dialog (Self-Reminder)
// ============================================

import { store } from '../store.js';

function getDateLabel(date) {
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (date.toDateString() === today.toDateString()) return 'Idag';
  if (date.toDateString() === tomorrow.toDateString()) return 'Imorgon';
  const weekdays = ['sön', 'mån', 'tis', 'ons', 'tor', 'fre', 'lör'];
  const months = ['jan', 'feb', 'mar', 'apr', 'maj', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
  return `${weekdays[date.getDay()]} ${date.getDate()} ${months[date.getMonth()]}`;
}

// Quick time presets
const QUICK_TIMES = [
  { label: '30 min', minutes: 30 },
  { label: '1 tim', minutes: 60 },
  { label: '2 tim', minutes: 120 },
  { label: '4 tim', minutes: 240 },
  { label: 'Imorgon 08:00', custom: true, hours: 8, tomorrow: true },
];

export function showReminderDialog() {
  // Remove any existing dialog
  document.getElementById('reminder-dialog-overlay')?.remove();

  let selectedDate = new Date();
  let selectedTimeStr = '';
  let isRecording = false;
  let recognition = null;

  // Check for Web Speech API support
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const hasVoice = !!SpeechRecognition;

  const overlay = document.createElement('div');
  overlay.id = 'reminder-dialog-overlay';
  overlay.className = 'reminder-overlay';

  function render() {
    // Generate quick dates
    const today = new Date();
    const quickDates = [];
    for (let i = 0; i < 5; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() + i);
      const label = i === 0 ? 'Idag' : i === 1 ? 'Imorgon' : getDateLabel(d);
      const isSelected = selectedDate && d.toDateString() === selectedDate.toDateString();
      quickDates.push({ date: d, label, iso: d.toISOString().slice(0, 10), isSelected });
    }

    overlay.innerHTML = `
      <div class="reminder-dialog">
        <div class="reminder-dialog-header">
          <span class="reminder-dialog-icon">🔔</span>
          <span class="reminder-dialog-title">Påminn mig</span>
          <button class="reminder-close" id="reminder-close">✕</button>
        </div>

        <div class="reminder-dialog-body">
          <div class="reminder-input-group">
            <label class="reminder-label">Vad ska du komma ihåg?</label>
            <div class="reminder-text-row">
              <textarea 
                class="reminder-textarea" 
                id="reminder-text" 
                placeholder="T.ex. Köp mjölk, Ring tandläkaren..."
                rows="2"
              >${document.getElementById('reminder-text')?.value || ''}</textarea>
              ${hasVoice ? `
                <button class="reminder-voice-btn ${isRecording ? 'recording' : ''}" id="reminder-voice" title="Tala in påminnelse">
                  ${isRecording ? '⏹' : '🎤'}
                </button>
              ` : ''}
            </div>
            ${isRecording ? `
              <div class="reminder-recording-indicator">
                <span class="recording-dot"></span> Lyssnar...
              </div>
            ` : ''}
          </div>

          <div class="reminder-input-group">
            <label class="reminder-label">Snabbval</label>
            <div class="reminder-quick-times">
              ${QUICK_TIMES.map((qt, i) => `
                <button class="reminder-quick-btn" data-quick-idx="${i}">${qt.label}</button>
              `).join('')}
            </div>
          </div>

          <div class="reminder-input-group">
            <label class="reminder-label">Eller välj datum & tid</label>
            <div class="reminder-date-chips">
              ${quickDates.map(qd => `
                <button class="reminder-chip ${qd.isSelected ? 'selected' : ''}" data-date="${qd.iso}">
                  ${qd.label}
                </button>
              `).join('')}
            </div>
            <div class="reminder-time-row">
              <input type="time" id="reminder-time" class="reminder-time-input" value="${selectedTimeStr}" />
            </div>
          </div>
        </div>

        <div class="reminder-dialog-footer">
          <button class="reminder-cancel-btn" id="reminder-cancel">Avbryt</button>
          <button class="reminder-save-btn" id="reminder-save">
            🔔 Spara påminnelse
          </button>
        </div>
      </div>
    `;

    // Event listeners
    document.getElementById('reminder-close')?.addEventListener('click', close);
    document.getElementById('reminder-cancel')?.addEventListener('click', close);

    // Overlay click to close
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });

    // Quick time buttons
    overlay.querySelectorAll('.reminder-quick-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.quickIdx);
        const qt = QUICK_TIMES[idx];
        const textEl = document.getElementById('reminder-text');
        if (!textEl?.value.trim()) {
          textEl?.focus();
          return;
        }

        let target;
        if (qt.custom) {
          target = new Date();
          if (qt.tomorrow) target.setDate(target.getDate() + 1);
          target.setHours(qt.hours, 0, 0, 0);
        } else {
          target = new Date(Date.now() + qt.minutes * 60000);
        }

        saveReminder(textEl.value.trim(), target.getTime());
      });
    });

    // Date chips
    overlay.querySelectorAll('.reminder-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const [y, m, d] = chip.dataset.date.split('-').map(Number);
        selectedDate = new Date(y, m - 1, d);
        render();
      });
    });

    // Save button
    document.getElementById('reminder-save')?.addEventListener('click', () => {
      const textEl = document.getElementById('reminder-text');
      const timeEl = document.getElementById('reminder-time');
      if (!textEl?.value.trim()) {
        textEl?.focus();
        return;
      }
      if (!timeEl?.value) {
        timeEl?.focus();
        return;
      }

      const [hours, minutes] = timeEl.value.split(':').map(Number);
      const target = new Date(selectedDate);
      target.setHours(hours, minutes, 0, 0);

      if (target.getTime() <= Date.now()) {
        target.setDate(target.getDate() + 1);
      }

      saveReminder(textEl.value.trim(), target.getTime());
    });

    // Voice input
    if (hasVoice) {
      document.getElementById('reminder-voice')?.addEventListener('click', () => {
        if (isRecording) {
          stopVoice();
        } else {
          startVoice();
        }
      });
    }
  }

  function startVoice() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    recognition = new SpeechRecognition();
    recognition.lang = 'sv-SE';
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onresult = (event) => {
      const transcript = Array.from(event.results)
        .map(r => r[0].transcript)
        .join('');
      const textEl = document.getElementById('reminder-text');
      if (textEl) textEl.value = transcript;
    };

    recognition.onerror = () => {
      isRecording = false;
      render();
    };

    recognition.onend = () => {
      isRecording = false;
      render();
    };

    recognition.start();
    isRecording = true;
    render();
  }

  function stopVoice() {
    if (recognition) {
      recognition.stop();
      recognition = null;
    }
    isRecording = false;
    render();
  }

  function saveReminder(text, scheduledFor) {
    store.addReminder(text, scheduledFor);
    close();

    // Show toast
    const target = new Date(scheduledFor);
    const label = getDateLabel(target);
    const time = target.toTimeString().slice(0, 5);
    window.showToast?.(`🔔 Påminnelse sparad – ${label} kl ${time}`);
  }

  function close() {
    if (recognition) {
      recognition.stop();
      recognition = null;
    }
    overlay.classList.add('closing');
    setTimeout(() => overlay.remove(), 200);
  }

  render();
  document.body.appendChild(overlay);

  // Focus the text input
  setTimeout(() => {
    document.getElementById('reminder-text')?.focus();
  }, 100);
}
