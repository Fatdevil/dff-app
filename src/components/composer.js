// ============================================
// DFF! – Message Composer
// ============================================

import { store } from '../store.js';
import { formatTime } from '../utils/time.js';
import { parseNaturalLanguage } from '../utils/nlp.js';
import { showLocationPicker } from './locationPicker.js';

const PRIORITIES = [
  { id: 'normal', icon: '🔵', label: 'Normal', desc: 'Vanlig notis' },
  { id: 'important', icon: '🟠', label: 'Viktigt', desc: 'Starkare notis' },
  { id: 'alarm', icon: '🔴', label: 'ALARM!', desc: 'Fullskärmsalarm' },
];

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

function formatScheduleLabel(timestamp) {
  const date = new Date(timestamp);
  const dateLabel = getDateLabel(date);
  const timeLabel = formatTime(timestamp);
  return `${dateLabel} kl ${timeLabel}`;
}

export function renderComposer(container, chatId) {
  let currentPriority = 'normal';
  let dropdownOpen = false;
  let scheduledTime = null;
  let pickerOpen = false;
  let selectedDate = null;
  let magicMode = false;
  let nlpPreview = null;
  let locationData = null; // { lat, lng, radius, address }

  function render() {
    const priority = PRIORITIES.find(p => p.id === currentPriority);
    
    // Generate quick-date buttons
    const today = new Date();
    const quickDates = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() + i);
      const label = i === 0 ? 'Idag' : i === 1 ? 'Imorgon' : getDateLabel(d);
      const isSelected = selectedDate && d.toDateString() === selectedDate.toDateString();
      quickDates.push({ date: d, label, iso: d.toISOString().slice(0, 10), isSelected });
    }
    
    container.innerHTML = `
      <div class="composer">
        <div class="priority-selector">
          <button class="priority-btn ${currentPriority}" id="priority-toggle" title="Välj prioritet">
            ${priority.icon}
          </button>
          ${dropdownOpen ? `
            <div class="priority-dropdown" id="priority-dropdown">
              ${PRIORITIES.map(p => `
                <button class="priority-option" data-priority="${p.id}">
                  <span class="icon">${p.icon}</span>
                  <span class="label">${p.label}</span>
                  <span class="desc">${p.desc}</span>
                </button>
              `).join('')}
            </div>
          ` : ''}
        </div>
        <input 
          type="text" 
          class="composer-input ${magicMode ? 'magic-active' : ''}" 
          id="message-input"
          placeholder="${magicMode ? '✨ Skriv naturligt, t.ex. köp mjölk imorgon kl 16...' : scheduledTime ? '⏰ Schemalagt meddelande...' : 'Skriv meddelande...'}" 
          autocomplete="off"
        />
        <button class="magic-btn ${magicMode ? 'active' : ''}" id="magic-toggle" title="Magic mode – AI tolkar tid & datum">
          ✨
        </button>
        <button class="location-btn ${locationData ? 'active' : ''}" id="location-toggle" title="Plats-alarm">
          📍
        </button>
        <button class="schedule-btn ${scheduledTime ? 'active' : ''}" id="schedule-toggle" title="Schemalägg leverans">
          🕐
        </button>
        <button class="send-btn ${currentPriority}" id="send-btn" disabled>
          ${scheduledTime ? '🕐' : locationData ? '📍' : '→'}
        </button>
      </div>
      ${magicMode && nlpPreview && nlpPreview.date ? `
        <div class="magic-preview">
          <span class="magic-preview-icon">✨</span>
          <span class="magic-preview-text">${nlpPreview.summary}</span>
          <span class="magic-preview-confidence">${nlpPreview.confidence}%</span>
        </div>
      ` : ''}
      ${locationData ? `
        <div class="location-bar">
          <span class="location-bar-info">📍 Alarm vid <strong>${locationData.address || `${locationData.lat.toFixed(4)}, ${locationData.lng.toFixed(4)}`}</strong> (${locationData.radius}m radie)</span>
          <button class="location-bar-clear" id="location-clear">✕</button>
        </div>
      ` : ''}
      ${scheduledTime ? `
        <div class="schedule-bar">
          <button class="schedule-bar-edit" id="schedule-bar-edit" title="Klicka för att ändra">
            ⏰ Levereras <strong>${formatScheduleLabel(scheduledTime)}</strong> ✏️
          </button>
          <button class="schedule-clear" id="schedule-clear">✕</button>
        </div>
      ` : ''}
      ${pickerOpen ? `
        <div class="schedule-picker" id="schedule-picker">
          <div class="schedule-picker-content">
            <div class="schedule-picker-title">🕐 Schemalägg leverans</div>
            <div class="schedule-picker-desc">Välj dag och tid – meddelandet levereras då</div>
            
            <div class="schedule-date-scroll" id="schedule-date-scroll">
              ${quickDates.map(qd => `
                <button class="schedule-date-chip ${qd.isSelected ? 'selected' : ''}" data-date="${qd.iso}">
                  ${qd.label}
                </button>
              `).join('')}
            </div>

            <div class="schedule-date-custom">
              <button class="schedule-date-custom-btn" id="schedule-date-custom-btn">
                📅 Välj annat datum...
              </button>
              <input type="date" id="schedule-date-input" class="schedule-date-input" style="display:none;" />
            </div>

            <div class="schedule-time-section ${selectedDate ? '' : 'disabled'}">
              <div class="schedule-time-label">Tid</div>
              <div class="schedule-picker-row">
                <input type="time" id="schedule-time-input" class="schedule-time-input" ${selectedDate ? '' : 'disabled'} />
                <button class="schedule-confirm-btn" id="schedule-confirm" ${selectedDate ? '' : 'disabled'}>Ställ in</button>
              </div>
            </div>

            <button class="schedule-picker-cancel" id="schedule-picker-cancel">Avbryt</button>
          </div>
        </div>
      ` : ''}
    `;

    // Event listeners
    const input = document.getElementById('message-input');
    const sendBtn = document.getElementById('send-btn');
    const priorityToggle = document.getElementById('priority-toggle');
    const scheduleToggle = document.getElementById('schedule-toggle');

    input?.addEventListener('input', () => {
      sendBtn.disabled = !input.value.trim();
      // Live NLP preview in magic mode
      if (magicMode && input.value.trim()) {
        nlpPreview = parseNaturalLanguage(input.value.trim());
        // Update preview bar without full re-render
        const previewEl = container.querySelector('.magic-preview');
        if (nlpPreview.date) {
          if (previewEl) {
            previewEl.querySelector('.magic-preview-text').textContent = nlpPreview.summary;
            previewEl.querySelector('.magic-preview-confidence').textContent = nlpPreview.confidence + '%';
          } else {
            render(); // Full re-render to show preview bar
            const newInput = document.getElementById('message-input');
            if (newInput) { newInput.value = input.value; newInput.disabled = false; }
            document.getElementById('send-btn').disabled = false;
          }
        } else if (previewEl) {
          previewEl.remove();
        }
      } else {
        nlpPreview = null;
      }
    });

    input?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && input.value.trim()) {
        handleSend(input.value.trim());
      }
    });

    sendBtn?.addEventListener('click', () => {
      const input = document.getElementById('message-input');
      if (input?.value.trim()) {
        handleSend(input.value.trim());
      }
    });

    // Magic mode toggle
    document.getElementById('magic-toggle')?.addEventListener('click', () => {
      magicMode = !magicMode;
      nlpPreview = null;
      render();
      document.getElementById('message-input')?.focus();
    });

    priorityToggle?.addEventListener('click', () => {
      dropdownOpen = !dropdownOpen;
      render();
    });

    container.querySelectorAll('.priority-option').forEach(opt => {
      opt.addEventListener('click', () => {
        currentPriority = opt.dataset.priority;
        dropdownOpen = false;
        render();
        document.getElementById('message-input')?.focus();
      });
    });

    // Schedule toggle
    scheduleToggle?.addEventListener('click', () => {
      pickerOpen = !pickerOpen;
      if (pickerOpen && !selectedDate) {
        selectedDate = new Date(); // Default to today
      }
      render();
      if (pickerOpen) {
        // Set default time to 1 hour from now
        const defaultTime = new Date(Date.now() + 3600000);
        const timeInput = document.getElementById('schedule-time-input');
        if (timeInput) {
          timeInput.value = defaultTime.toTimeString().slice(0, 5);
        }
      }
    });

    // Quick date chips
    container.querySelectorAll('.schedule-date-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const [y, m, d] = chip.dataset.date.split('-').map(Number);
        selectedDate = new Date(y, m - 1, d);
        render();
        // Restore time if needed
        const defaultTime = new Date(Date.now() + 3600000);
        const timeInput = document.getElementById('schedule-time-input');
        if (timeInput && !timeInput.value) {
          timeInput.value = defaultTime.toTimeString().slice(0, 5);
        }
      });
    });

    // Custom date button
    document.getElementById('schedule-date-custom-btn')?.addEventListener('click', () => {
      const dateInput = document.getElementById('schedule-date-input');
      const btn = document.getElementById('schedule-date-custom-btn');
      if (dateInput && btn) {
        dateInput.style.display = 'block';
        btn.style.display = 'none';
        // Set min date to today
        dateInput.min = new Date().toISOString().slice(0, 10);
        dateInput.focus();
      }
    });

    // Custom date input change
    document.getElementById('schedule-date-input')?.addEventListener('change', (e) => {
      if (e.target.value) {
        const [y, m, d] = e.target.value.split('-').map(Number);
        selectedDate = new Date(y, m - 1, d);
        render();
        const defaultTime = new Date(Date.now() + 3600000);
        const timeInput = document.getElementById('schedule-time-input');
        if (timeInput && !timeInput.value) {
          timeInput.value = defaultTime.toTimeString().slice(0, 5);
        }
      }
    });

    // Confirm schedule
    document.getElementById('schedule-confirm')?.addEventListener('click', () => {
      const timeInput = document.getElementById('schedule-time-input');
      if (!timeInput?.value || !selectedDate) return;
      
      const [hours, minutes] = timeInput.value.split(':').map(Number);
      const target = new Date(selectedDate);
      target.setHours(hours, minutes, 0, 0);
      
      // If target is in the past, show warning
      if (target.getTime() <= Date.now()) {
        // Push to tomorrow same time
        target.setDate(target.getDate() + 1);
      }
      
      scheduledTime = target.getTime();
      pickerOpen = false;
      selectedDate = null;
      render();
      document.getElementById('message-input')?.focus();
    });

    document.getElementById('schedule-picker-cancel')?.addEventListener('click', () => {
      pickerOpen = false;
      selectedDate = null;
      render();
    });

    // Edit schedule by clicking the bar
    document.getElementById('schedule-bar-edit')?.addEventListener('click', () => {
      // Pre-fill picker with current scheduled date/time
      const scheduledDate = new Date(scheduledTime);
      selectedDate = new Date(scheduledDate);
      selectedDate.setHours(0, 0, 0, 0);
      pickerOpen = true;
      render();
      // Set the time input to the currently scheduled time
      const timeInput = document.getElementById('schedule-time-input');
      if (timeInput) {
        timeInput.value = scheduledDate.toTimeString().slice(0, 5);
      }
    });

    // Location picker
    document.getElementById('location-toggle')?.addEventListener('click', async () => {
      const result = await showLocationPicker();
      if (result) {
        locationData = result;
        render();
        document.getElementById('message-input')?.focus();
      }
    });

    document.getElementById('location-clear')?.addEventListener('click', () => {
      locationData = null;
      render();
    });

    document.getElementById('schedule-clear')?.addEventListener('click', () => {
      scheduledTime = null;
      render();
    });

    // Close priority dropdown on outside click
    if (dropdownOpen) {
      setTimeout(() => {
        document.addEventListener('click', function closeDropdown(e) {
          if (!e.target.closest('.priority-selector')) {
            dropdownOpen = false;
            render();
            document.removeEventListener('click', closeDropdown);
          }
        });
      }, 0);
    }

    // Focus input (only if picker is not open)
    if (!pickerOpen) input?.focus();
  }

  function handleSend(text) {
    if (magicMode && nlpPreview && nlpPreview.date) {
      store.sendMessage(chatId, nlpPreview.task, currentPriority, nlpPreview.timestamp, locationData);
      window.showToast?.(`✨ Tolkad: ${nlpPreview.summary}`);
    } else {
      store.sendMessage(chatId, text, currentPriority, scheduledTime, locationData);
    }
    if (locationData) {
      window.showToast?.(`📍 Plats-alarm aktiverat – ${locationData.radius}m radie`);
    }
    currentPriority = 'normal';
    scheduledTime = null;
    nlpPreview = null;
    locationData = null;
    render();
  }

  function sendMessage(text) {
    store.sendMessage(chatId, text, currentPriority, scheduledTime);
    currentPriority = 'normal';
    scheduledTime = null;
    render();
  }

  render();
}
