// ============================================
// DFF! – Login Screen (Real Users)
// ============================================

import { store } from '../store.js';

export function renderLogin(container) {
  // Check if user is saved in localStorage
  const savedUser = localStorage.getItem('dff-username');

  container.innerHTML = `
    <div class="screen login-screen">
      <div class="login-logo">
        <div class="login-logo-icon">🔔</div>
        <h1>DFF!</h1>
        <p>Don't Freaking Forget</p>
      </div>

      <div class="login-form">
        <label class="login-label">Ditt namn</label>
        <input 
          type="text" 
          class="login-input" 
          id="login-name" 
          placeholder="T.ex. Stellan, Lisa..." 
          value="${savedUser || ''}" 
          autocomplete="off" 
          maxlength="20"
        />
        <button class="login-submit-btn" id="login-submit" ${savedUser ? '' : 'disabled'}>
          🚀 Starta DFF!
        </button>
      </div>

      <p class="login-demo-note">
        Skriv ditt namn → dela länken med din sambo → börja skicka alarm! 🔔
      </p>
    </div>
  `;

  const nameInput = document.getElementById('login-name');
  const submitBtn = document.getElementById('login-submit');

  nameInput?.addEventListener('input', () => {
    submitBtn.disabled = !nameInput.value.trim();
  });

  nameInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && nameInput.value.trim()) {
      doLogin(nameInput.value.trim());
    }
  });

  submitBtn?.addEventListener('click', () => {
    if (nameInput.value.trim()) {
      doLogin(nameInput.value.trim());
    }
  });

  // Auto-focus
  nameInput?.focus();
  if (savedUser) nameInput?.select();

  function doLogin(name) {
    const userId = name.toLowerCase().replace(/[^a-zåäö0-9]/g, '');
    if (!userId) return;

    localStorage.setItem('dff-username', name);
    localStorage.setItem('dff-userid', userId);

    store.switchUser(userId, name);
    store.emit('navigate', 'chatList');
  }
}
