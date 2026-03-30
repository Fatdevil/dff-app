// ============================================
// DFF! – Message Composer (Stable for mobile)
// ============================================

import { store } from '../store.js';

const PRIORITIES = [
  { id: 'normal', icon: '🔵', label: 'Normal' },
  { id: 'important', icon: '🟠', label: 'Viktigt' },
  { id: 'alarm', icon: '🔴', label: 'ALARM!' },
];

export function renderComposer(container, chatId) {
  let currentPriority = 'normal';

  // Build DOM once – never replace innerHTML again
  container.innerHTML = `
    <div class="composer">
      <button class="priority-btn normal" id="priority-toggle" title="Välj prioritet">🔵</button>
      <div class="priority-dropdown" id="priority-dropdown" style="display:none;">
        ${PRIORITIES.map(p => `
          <button class="priority-option" data-priority="${p.id}">
            <span class="icon">${p.icon}</span>
            <span class="label">${p.label}</span>
          </button>
        `).join('')}
      </div>
      <input 
        type="text" 
        class="composer-input" 
        id="message-input"
        placeholder="Skriv meddelande..." 
        autocomplete="off"
      />
      <button class="send-btn normal" id="send-btn" disabled>→</button>
    </div>
  `;

  // Get references to DOM elements (never re-query after this)
  const input = document.getElementById('message-input');
  const sendBtn = document.getElementById('send-btn');
  const priorityBtn = document.getElementById('priority-toggle');
  const dropdown = document.getElementById('priority-dropdown');

  // --- Input handler (never re-renders DOM) ---
  input.addEventListener('input', () => {
    sendBtn.disabled = !input.value.trim();
  });

  // --- Send on Enter ---
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && input.value.trim()) {
      doSend();
    }
  });

  // --- Send button click ---
  sendBtn.addEventListener('click', () => {
    if (input.value.trim()) {
      doSend();
    }
  });

  // --- Priority toggle (no re-render, just show/hide dropdown) ---
  priorityBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const isOpen = dropdown.style.display !== 'none';
    dropdown.style.display = isOpen ? 'none' : 'flex';
  });

  // --- Priority selection (no re-render, just update button) ---
  dropdown.querySelectorAll('.priority-option').forEach(opt => {
    opt.addEventListener('click', (e) => {
      e.stopPropagation();
      currentPriority = opt.dataset.priority;
      const p = PRIORITIES.find(pr => pr.id === currentPriority);
      priorityBtn.textContent = p.icon;
      priorityBtn.className = `priority-btn ${currentPriority}`;
      sendBtn.className = `send-btn ${currentPriority}`;
      dropdown.style.display = 'none';
      input.focus();
    });
  });

  // --- Close dropdown on outside click ---
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.priority-selector') && !e.target.closest('.priority-dropdown')) {
      dropdown.style.display = 'none';
    }
  });

  // --- Send function ---
  function doSend() {
    const text = input.value.trim();
    if (!text) return;
    store.sendMessage(chatId, text, currentPriority, null, null);
    // Reset state without re-render
    input.value = '';
    sendBtn.disabled = true;
    currentPriority = 'normal';
    priorityBtn.textContent = '🔵';
    priorityBtn.className = 'priority-btn normal';
    sendBtn.className = 'send-btn normal';
    input.focus();
  }

  // Auto-focus
  input.focus();
}
