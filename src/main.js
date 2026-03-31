// ============================================
// DFF! – Don't Freaking Forget
// Main Entry Point
// ============================================

import './style.css';
import { store } from './store.js';
import { renderLogin } from './components/login.js';
import { renderChatList } from './components/chatList.js';
import { renderChatView } from './components/chatView.js';
import { renderSettings } from './components/settings.js';
import { showAlarmOverlay, hideAlarmOverlay } from './components/alarmOverlay.js';
import { showSnoozeDialog, hideSnoozeDialog } from './components/snoozeDialog.js';

// --- App State ---
let currentScreen = 'login';
let currentChatId = null;

const app = document.getElementById('app');

// --- Navigation ---
function navigate(screen) {
  // Cleanup previous screen listeners
  if (app._cleanup) {
    app._cleanup();
    app._cleanup = null;
  }

  currentScreen = screen;

  switch (screen) {
    case 'login':
      renderLogin(app);
      break;
    case 'chatList':
      renderChatList(app);
      break;
    case 'chatView':
      if (currentChatId) {
        renderChatView(app, currentChatId);
      }
      break;
    case 'settings':
      renderSettings(app);
      break;
  }
}

// --- Event Handlers ---
store.on('navigate', (screen) => {
  navigate(screen);
});

store.on('openChat', (chatId) => {
  currentChatId = chatId;
  navigate('chatView');
});

store.on('openSnooze', (messageId) => {
  showSnoozeDialog(messageId);
});

// When user switches: check for incoming alarm messages
store.on('userChanged', ({ userId, pendingAlarms }) => {
  if (pendingAlarms.length > 0 && store.settings.alarmEnabled) {
    // Show alarm for the first pending alarm message
    setTimeout(() => {
      showAlarmOverlay(pendingAlarms[0]);
    }, 500);
  }
});

// When a message is sent, check if the OTHER user would get an alarm
store.on('messageSent', (msg) => {
  // In demo mode, we store the alarm for when user switches
  // The alarm will trigger in the userChanged handler
});

// Snooze reminder: re-trigger alarm
store.on('snoozeReminder', ({ message }) => {
  // Only show alarm if the snoozed-user is currently active
  if (store.currentUserId !== message.senderId) {
    if (store.settings.alarmEnabled && message.priority === 'alarm') {
      showAlarmOverlay(message);
    } else {
      showToast(`🔔 Påminnelse: ${message.text}`);
    }
  }
});

// Scheduled message delivered: trigger alarm for recipient
store.on('messageDelivered', ({ message }) => {
  // If the recipient is currently active, trigger alarm
  if (store.currentUserId !== message.senderId) {
    if (store.settings.alarmEnabled && message.priority === 'alarm') {
      showAlarmOverlay(message);
    } else {
      showToast(`📬 Nytt meddelande: ${message.text}`);
    }
  } else {
    showToast(`✅ Schemalagt meddelande levererat!`);
  }
});

// Scheduled message confirmation
store.on('messageScheduled', (msg) => {
  const deliveryTime = new Date(msg.scheduledFor).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });
  showToast(`🕐 Schemalagt – levereras kl ${deliveryTime}`);
});

// Self-reminder triggered
store.on('reminderTriggered', (reminder) => {
  if (store.settings.alarmEnabled) {
    const alarmMsg = {
      id: reminder.id,
      text: reminder.text,
      priority: 'alarm',
      senderId: reminder.userId,
      timestamp: Date.now(),
    };
    showAlarmOverlay(alarmMsg);
  } else {
    showToast(`🔔 PÅMINNELSE: ${reminder.text}`);
  }
});

// Location-based alarm: register geofence when receiving a location message
import { geofenceTracker } from './utils/geofence.js';

store.on('messageDelivered', ({ message }) => {
  if (message.location && message.senderId !== store.currentUserId) {
    const loc = message.location;
    geofenceTracker.addFence(
      message.id,
      loc.lat, loc.lng, loc.radius,
      ({ distance }) => {
        showToast(`📍 Du är nära "${loc.address || 'målpunkten'}"!`);
        if (store.settings.alarmEnabled) {
          showAlarmOverlay({
            id: message.id,
            text: `📍 PLATS-ALARM: ${message.text}\n\n📍 ${loc.address || 'Plats nådd'} (${Math.round(distance)}m)`,
            priority: 'alarm',
            senderId: message.senderId,
            timestamp: Date.now(),
          });
        }
      }
    );
    showToast(`📍 GPS-bevakning aktiverad – ${loc.address || 'plats'} (${loc.radius}m radie)`);
  }
});

// Toast utility
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
  }, 2500);
}
window.showToast = showToast;

// --- Initialize ---
(async () => {
  const loggedIn = await store.tryAutoLogin();
  if (!loggedIn) {
    navigate('login');
  } else {
    // tryAutoLogin verifierade JWT och anslöt socket – vänta på loginSuccess
    // som triggas av socket-händelsen, och navigera sedan
    navigate('chatList');
  }
})();

console.log('🔔 DFF! – Don\'t Freaking Forget');
