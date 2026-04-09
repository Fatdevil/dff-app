// ============================================
// DFF! – Chat List Screen
// ============================================

import { store } from '../store.js';
import { formatTime, formatSnoozeUntil } from '../utils/time.js';
import { escapeHtml } from '../utils/html.js';
import { showToast } from '../utils/toast.js';
import { showReminderDialog } from './reminderDialog.js';

// Track active listeners to prevent leaks
let _activeSubs = [];
let _pairTimeout = null;

function _cleanupAll() {
  _activeSubs.forEach(fn => fn());
  _activeSubs = [];
  if (_pairTimeout) {
    clearTimeout(_pairTimeout);
    _pairTimeout = null;
  }
}

export function renderChatList(container) {
  // ALWAYS clean up old listeners first
  _cleanupAll();

  const currentUser = store.getCurrentUser();
  const chats = store.getChatsForCurrentUser();

  container.innerHTML = `
    <div class="screen chat-list-screen">
      <div class="header">
        <div class="header-title">
          DFF!
          <div class="header-subtitle">Inloggad som ${escapeHtml(currentUser?.name || '...')}</div>
        </div>
        <div class="header-actions">
          <button class="header-btn" id="settings-btn" title="Inställningar">⚙️</button>
        </div>
      </div>

      <div class="chat-list" id="chat-list">
        <button class="add-person-btn" id="add-person-btn">
          <span class="add-person-icon">➕</span>
          <span class="add-person-text">Lägg till person</span>
        </button>

        ${chats.length === 0 ? `
          <div class="empty-state">
            <div class="empty-state-icon">👋</div>
            <div class="empty-state-text">Lägg till din sambo för att börja!</div>
            <div class="empty-state-hint">Tryck "Lägg till person" ovanför</div>
          </div>
        ` : chats.map(chat => renderChatItem(chat)).join('')}
      </div>

      <div class="pair-dialog" id="pair-dialog" style="display:none;">
        <div class="pair-backdrop" id="pair-backdrop"></div>
        <div class="pair-content">
          <div class="pair-title">👫 Lägg till person</div>
          <div class="pair-desc">Skriv din sambos namn – samma som hen skriver vid inloggning</div>
          <input type="text" class="pair-input" id="pair-input" placeholder="T.ex. Lisa, Marcus..." autocomplete="off" maxlength="20" />
          <div class="pair-buttons">
            <button class="pair-cancel" id="pair-cancel">Avbryt</button>
            <button class="pair-confirm" id="pair-confirm" disabled>Koppla ihop 🔗</button>
          </div>
        </div>
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
      store.emit('openChat', item.dataset.chatId);
    });
  });

  document.getElementById('switch-user-btn')?.addEventListener('click', () => {
    store.logout();
    store.emit('navigate', 'login');
  });

  document.getElementById('settings-btn')?.addEventListener('click', () => {
    store.emit('navigate', 'settings');
  });

  document.getElementById('reminder-fab')?.addEventListener('click', () => {
    showReminderDialog();
  });

  // Pair dialog
  const pairDialog = document.getElementById('pair-dialog');
  const pairInput = document.getElementById('pair-input');
  const pairConfirm = document.getElementById('pair-confirm');

  document.getElementById('add-person-btn')?.addEventListener('click', () => {
    pairDialog.style.display = 'flex';
    pairInput.value = '';
    pairConfirm.disabled = true;
    setTimeout(() => pairInput.focus(), 100);
  });

  document.getElementById('pair-backdrop')?.addEventListener('click', () => {
    pairDialog.style.display = 'none';
  });

  document.getElementById('pair-cancel')?.addEventListener('click', () => {
    pairDialog.style.display = 'none';
  });

  pairInput?.addEventListener('input', () => {
    pairConfirm.disabled = !pairInput.value.trim();
  });

  pairInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && pairInput.value.trim()) {
      doPair();
    }
  });

  pairConfirm?.addEventListener('click', doPair);

  function doPair() {
    const name = pairInput.value.trim();
    if (!name) return;
    store.pairWithUser(name);
    pairDialog.style.display = 'none';
    showToast(`🔗 Kopplad med ${name}!`);
    // No setTimeout re-render – chatsUpdated event handles it
  }

  // Store event listeners – tracked for cleanup
  const unsub1 = store.on('messagesChanged', () => {
    // Only re-render if we're still showing chatList
    if (document.getElementById('chat-list')) {
      renderChatList(container);
    }
  });

  const unsub2 = store.on('chatsUpdated', () => {
    // Only re-render if we're still showing chatList
    if (document.getElementById('chat-list')) {
      renderChatList(container);
    }
  });

  _activeSubs.push(unsub1, unsub2);

  // Also set container cleanup for navigate()
  container._cleanup = _cleanupAll;
}

function renderChatItem(chat) {
  const lastMsg = chat.lastMessage;
  const isAlarm = lastMsg?.priority === 'alarm';
  const isImportant = lastMsg?.priority === 'important';
  const hasUnread = chat.unreadCount > 0;

  let previewText = lastMsg ? lastMsg.text : 'Ingen chat ännu – skriv hej! 👋';
  let previewClass = '';
  let priorityPrefix = '';

  if (isAlarm) {
    previewClass = 'alarm';
    priorityPrefix = '🔴 ';
  } else if (isImportant) {
    priorityPrefix = '🟠 ';
  }

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
        ${escapeHtml(chat.otherUser?.name?.[0]?.toUpperCase() || '?')}
        ${hasUnread ? `<div class="chat-item-badge">${chat.unreadCount}</div>` : ''}
      </div>
      <div class="chat-item-content">
        <div class="chat-item-header">
          <span class="chat-item-name">${escapeHtml(chat.otherUser?.name || 'Unknown')}</span>
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
