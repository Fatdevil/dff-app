// ============================================
// DFF! – Chat List Screen
// ============================================

import { store } from '../store.js';
import { formatTime, formatSnoozeUntil } from '../utils/time.js';
import { showReminderDialog } from './reminderDialog.js';

export function renderChatList(container) {
  const currentUser = store.getCurrentUser();
  const chats = store.getChatsForCurrentUser();

  container.innerHTML = `
    <div class="screen chat-list-screen">
      <div class="header">
        <div class="header-title">
          DFF!
          <div class="header-subtitle">Inloggad som ${currentUser.name}</div>
        </div>
        <div class="header-actions">
          <button class="header-btn" id="settings-btn" title="Inställningar">⚙️</button>
        </div>
      </div>

      <div class="chat-list" id="chat-list">
        ${chats.length === 0 ? `
          <div class="empty-state">
            <div class="empty-state-icon">💬</div>
            <div class="empty-state-text">Inga konversationer ännu</div>
          </div>
        ` : chats.map(chat => renderChatItem(chat)).join('')}
      </div>

      <button class="reminder-fab" id="reminder-fab" title="Påminn mig">
        🔔
      </button>

      <div class="switch-user-bar">
        <button class="switch-user-btn" id="switch-user-btn">
          🔄 Byt användare
        </button>
      </div>
    </div>
  `;

  // Event listeners
  container.querySelectorAll('.chat-item').forEach(item => {
    item.addEventListener('click', () => {
      store.emit('navigate', 'chatView');
      store.emit('openChat', item.dataset.chatId);
    });
  });

  document.getElementById('switch-user-btn')?.addEventListener('click', () => {
    store.emit('navigate', 'login');
  });

  document.getElementById('settings-btn')?.addEventListener('click', () => {
    store.emit('navigate', 'settings');
  });

  document.getElementById('reminder-fab')?.addEventListener('click', () => {
    showReminderDialog();
  });

  // Listen for changes
  const unsub = store.on('messagesChanged', () => {
    renderChatList(container);
  });

  // Store cleanup function
  container._cleanup = unsub;
}

function renderChatItem(chat) {
  const lastMsg = chat.lastMessage;
  const isAlarm = lastMsg?.priority === 'alarm';
  const isImportant = lastMsg?.priority === 'important';
  const hasUnread = chat.unreadCount > 0;

  let previewText = lastMsg ? lastMsg.text : 'Ingen chat ännu';
  let previewClass = '';
  let priorityPrefix = '';

  if (isAlarm) {
    previewClass = 'alarm';
    priorityPrefix = '🔴 ';
  } else if (isImportant) {
    priorityPrefix = '🟠 ';
  }

  // Truncate
  if (previewText.length > 40) {
    previewText = previewText.substring(0, 40) + '...';
  }

  const snoozeTag = chat.snoozedMessage ? `
    <div class="chat-item-snooze-tag">
      ⏰ Snoozad till ${formatSnoozeUntil(chat.snoozedMessage.snoozeUntil)}
    </div>
  ` : '';

  return `
    <div class="chat-item" data-chat-id="${chat.id}">
      <div class="chat-item-avatar ${chat.otherUser?.avatarClass || 'gradient-1'}">
        ${chat.otherUser?.name?.[0] || '?'}
        ${hasUnread ? `<div class="chat-item-badge">${chat.unreadCount}</div>` : ''}
      </div>
      <div class="chat-item-content">
        <div class="chat-item-header">
          <span class="chat-item-name">${chat.otherUser?.name || 'Unknown'}</span>
          <span class="chat-item-time ${hasUnread ? 'has-unread' : ''}">
            ${lastMsg ? formatTime(lastMsg.timestamp) : ''}
          </span>
        </div>
        <div class="chat-item-preview ${previewClass}">
          ${priorityPrefix}${previewText}
        </div>
        ${snoozeTag}
      </div>
    </div>
  `;
}
