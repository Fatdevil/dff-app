// ============================================
// DFF! – Chat View Screen
// ============================================

import { store } from '../store.js';
import { formatTime, formatSnoozeUntil, formatScheduleTime } from '../utils/time.js';
import { escapeHtml } from '../utils/html.js';
import { showToast } from '../utils/toast.js';
import { renderComposer } from './composer.js';

export function renderChatView(container, chatId) {
  const currentUser = store.getCurrentUser();
  const otherUser = store.getOtherUser(chatId);

  // Load messages from server
  store.loadChatMessages(chatId);

  const messages = store.getMessagesForChat(chatId);

  // Mark received messages as seen
  messages.forEach(m => {
    if (m.senderId !== currentUser.id && m.status === 'sent') {
      store.markSeen(m.id);
    }
  });

  container.innerHTML = `
    <div class="screen chat-view-screen">
      <div class="header">
        <button class="header-back" id="chat-back-btn">←</button>
        <div class="header-title">
          ${escapeHtml(otherUser?.name || 'Chat')}
          <div class="header-subtitle">Online</div>
        </div>
        <div class="header-actions">
          <button class="header-btn" id="chat-settings-btn" title="Inställningar">⚙️</button>
        </div>
      </div>

      <div class="messages-container" id="messages-container">
        ${messages.map(msg => renderMessage(msg, currentUser.id)).join('')}
      </div>

      <div id="composer-container"></div>
    </div>
  `;

  // Render composer
  const composerContainer = document.getElementById('composer-container');
  renderComposer(composerContainer, chatId);

  // Scroll to bottom
  const messagesDiv = document.getElementById('messages-container');
  if (messagesDiv) {
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
  }

  // Event listeners
  document.getElementById('chat-back-btn')?.addEventListener('click', () => {
    store.emit('navigate', 'chatList');
  });

  document.getElementById('chat-settings-btn')?.addEventListener('click', () => {
    store.emit('navigate', 'settings');
  });

  // Message action buttons
  container.querySelectorAll('.msg-action-btn.snooze').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      store.emit('openSnooze', btn.dataset.messageId);
    });
  });

  container.querySelectorAll('.msg-action-btn.done').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      store.markDone(btn.dataset.messageId);
      showToast('✅ Markerad som klar!');
    });
  });

  // Cancel scheduled message
  container.querySelectorAll('.msg-action-btn.cancel-schedule').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      store.cancelScheduledMessage(btn.dataset.messageId);
      showToast('🗑 Schemalagt meddelande avbrutet');
    });
  });

  // Edit scheduled message
  container.querySelectorAll('.msg-action-btn.edit-schedule').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const msgId = btn.dataset.messageId;
      const rescheduleRow = document.getElementById(`reschedule-${msgId}`);
      if (rescheduleRow) {
        rescheduleRow.style.display = rescheduleRow.style.display === 'none' ? 'flex' : 'none';
      }
    });
  });

  // Confirm reschedule
  container.querySelectorAll('.reschedule-confirm').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const msgId = btn.dataset.messageId;
      const dateInput = document.getElementById(`reschedule-date-${msgId}`);
      const timeInput = document.getElementById(`reschedule-time-${msgId}`);
      if (!dateInput?.value || !timeInput?.value) return;
      const [y, m, d] = dateInput.value.split('-').map(Number);
      const [h, min] = timeInput.value.split(':').map(Number);
      const target = new Date(y, m - 1, d, h, min, 0, 0);
      if (target.getTime() <= Date.now()) {
        showToast('⚠️ Välj en framtida tid');
        return;
      }
      store.rescheduleMessage(msgId, target.getTime());
      showToast('✅ Ny leveranstid sparad');
    });
  });

  // Listen for message changes – ONLY update messages, not the composer
  const unsub = store.on('messagesChanged', (data) => {
    if (data.chatId === chatId) {
      const messagesContainer = document.getElementById('messages-container');
      if (messagesContainer) {
        const currentUser = store.getCurrentUser();
        const chatMessages = store.getMessagesForChat(chatId) || [];
        messagesContainer.innerHTML = chatMessages.map(msg => renderMessage(msg, currentUser.id)).join('');
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
      }
    }
  });

  container._cleanup = unsub;
}

function renderMessage(msg, currentUserId) {
  const isSent = msg.senderId === currentUserId;
  const direction = isSent ? 'sent' : 'received';
  const priorityClass = msg.priority !== 'normal' ? `priority-${msg.priority}` : '';

  let priorityLabel = '';
  if (msg.priority === 'alarm') {
    priorityLabel = `<div class="message-priority-label">🔴 ALARM</div>`;
  } else if (msg.priority === 'important') {
    priorityLabel = `<div class="message-priority-label">🟠 Viktigt</div>`;
  }

  let statusIcon = '';
  if (isSent) {
    switch (msg.status) {
      case 'sent': statusIcon = '✓'; break;
      case 'delivered': statusIcon = '✓✓'; break;
      case 'seen': statusIcon = '✓✓'; break;
      case 'snoozed': statusIcon = '⏰'; break;
      case 'done': statusIcon = '✅'; break;
      case 'scheduled': statusIcon = '🕐'; break;
    }
  }

  // Actions for received alarm/important messages
  let actions = '';
  if (!isSent && (msg.priority === 'alarm' || msg.priority === 'important') && msg.status !== 'done') {
    actions = `
      <div class="message-actions">
        ${msg.status !== 'snoozed' ? `
          <button class="msg-action-btn snooze" data-message-id="${msg.id}">⏰ Snooze</button>
        ` : ''}
        <button class="msg-action-btn done" data-message-id="${msg.id}">✅ Klar!</button>
      </div>
    `;
  }

  // Status badges
  let statusBadge = '';
  if (msg.status === 'scheduled' && msg.scheduledFor) {
    const schedDate = new Date(msg.scheduledFor);
    const todayStr = new Date().toISOString().slice(0, 10);
    statusBadge = `
      <div class="message-scheduled-badge">
        🕐 Levereras kl ${formatTime(msg.scheduledFor)}
      </div>
    `;
    if (isSent) {
      actions = `
        <div class="message-actions">
          <button class="msg-action-btn edit-schedule" data-message-id="${msg.id}">✏️ Ändra tid</button>
          <button class="msg-action-btn cancel-schedule" data-message-id="${msg.id}">🗑 Avbryt</button>
        </div>
        <div class="reschedule-row" id="reschedule-${msg.id}" style="display:none;">
          <input type="date" id="reschedule-date-${msg.id}" class="reschedule-input" value="${schedDate.toISOString().slice(0, 10)}" min="${todayStr}" />
          <input type="time" id="reschedule-time-${msg.id}" class="reschedule-input" value="${schedDate.toTimeString().slice(0, 5)}" />
          <button class="reschedule-confirm" data-message-id="${msg.id}">✓</button>
        </div>
      `;
    }
  } else if (msg.status === 'snoozed') {
    statusBadge = `
      <div class="message-snooze-badge">
        ⏰ Snoozad till ${formatSnoozeUntil(msg.snoozeUntil)}
      </div>
    `;
  } else if (msg.status === 'done') {
    statusBadge = `
      <div class="message-done-badge">
        ✅ Klar!
      </div>
    `;
  }

  const scheduledClass = msg.status === 'scheduled' ? 'scheduled' : '';

  // Location badge
  let locationBadge = '';
  if (msg.location) {
    const loc = msg.location;
    locationBadge = `
      <div class="msg-location-badge">
        📍 ${loc.address || `${loc.lat.toFixed(4)}, ${loc.lng.toFixed(4)}`} (${loc.radius}m)
      </div>
    `;
  }

  return `
    <div class="message ${direction} ${priorityClass} ${scheduledClass}">
      <div class="message-bubble">
        ${priorityLabel}
        <div class="message-text">${escapeHtml(msg.text)}</div>
        ${locationBadge}
        <div class="message-meta">
          <span class="message-time">${formatTime(msg.timestamp)}</span>
          ${statusIcon ? `<span class="message-status-icon">${statusIcon}</span>` : ''}
        </div>
      </div>
      ${statusBadge}
      ${actions}
    </div>
  `;
}


