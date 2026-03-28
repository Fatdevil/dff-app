// ============================================
// DFF! – Login Screen
// ============================================

import { store } from '../store.js';

export function renderLogin(container) {
  container.innerHTML = `
    <div class="screen login-screen">
      <div class="login-logo">
        <div class="login-logo-icon">🔔</div>
        <h1>DFF!</h1>
        <p>Don't Freaking Forget</p>
      </div>

      <p class="login-subtitle">Välj vem du är:</p>

      <div class="login-users" id="login-users">
        <button class="login-user-btn" data-user="alex" id="login-alex">
          <div class="login-avatar alex">A</div>
          <div class="login-user-info">
            <span class="name">Alex</span>
            <span class="status">Online</span>
          </div>
        </button>
        <button class="login-user-btn" data-user="sam" id="login-sam">
          <div class="login-avatar sam">S</div>
          <div class="login-user-info">
            <span class="name">Sam</span>
            <span class="status">Online</span>
          </div>
        </button>
      </div>

      <p class="login-demo-note">
        Demo-läge: byt mellan användare för att testa meddelanden och alarm
      </p>
    </div>
  `;

  container.querySelectorAll('.login-user-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const userId = btn.dataset.user;
      store.switchUser(userId);
      store.emit('navigate', 'chatList');
    });
  });
}
