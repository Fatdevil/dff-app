// ============================================
// DFF! – Login Screen (2-steg: Email → OTP)
// ============================================

import { store } from '../store.js';

export function renderLogin(container) {
  const savedEmail = localStorage.getItem('dff-email') || '';
  const savedName = localStorage.getItem('dff-username') || '';

  _renderStep1(container, savedEmail, savedName);
}

// ========== Steg 1: E-post ==========
function _renderStep1(container, prefillEmail = '', prefillName = '') {
  container.innerHTML = `
    <div class="screen login-screen">
      <div class="login-logo">
        <div class="login-logo-icon">🔔</div>
        <h1>DFF!</h1>
        <p>Don't Freaking Forget</p>
      </div>

      <div class="login-form">
        <label class="login-label">Ditt namn (visningsnamn)</label>
        <input
          type="text"
          class="login-input"
          id="login-name"
          placeholder="T.ex. Stellan, Lisa..."
          value="${_esc(prefillName)}"
          autocomplete="name"
          maxlength="30"
        />

        <label class="login-label" style="margin-top: 12px;">Din e-postadress</label>
        <input
          type="email"
          class="login-input"
          id="login-email"
          placeholder="din@epost.se"
          value="${_esc(prefillEmail)}"
          autocomplete="email"
          inputmode="email"
        />

        <div id="login-error" class="login-error" style="display:none;"></div>

        <button class="login-submit-btn" id="login-submit" disabled>
          📧 Skicka inloggningskod
        </button>
      </div>

      <p class="login-demo-note">
        Du får en 6-siffrig kod via e-post 🔐
      </p>
    </div>
  `;

  const nameInput = document.getElementById('login-name');
  const emailInput = document.getElementById('login-email');
  const submitBtn = document.getElementById('login-submit');
  const errorDiv = document.getElementById('login-error');

  function validate() {
    const hasEmail = emailInput.value.includes('@') && emailInput.value.includes('.');
    submitBtn.disabled = !hasEmail;
  }

  nameInput?.addEventListener('input', validate);
  emailInput?.addEventListener('input', validate);

  emailInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submitBtn.click();
  });

  submitBtn?.addEventListener('click', async () => {
    const email = emailInput.value.trim();
    const name = nameInput.value.trim() || email.split('@')[0];
    if (!email.includes('@')) return;

    submitBtn.disabled = true;
    submitBtn.textContent = '⏳ Skickar...';
    errorDiv.style.display = 'none';

    const result = await store.requestOtp(email);
    if (result.ok) {
      localStorage.setItem('dff-email', email);
      localStorage.setItem('dff-username', name);
      _renderStep2(container, email, name, result.dev);
    } else {
      errorDiv.textContent = result.error || 'Något gick fel – försök igen';
      errorDiv.style.display = 'block';
      submitBtn.disabled = false;
      submitBtn.textContent = '📧 Skicka inloggningskod';
    }
  });

  // Auto-fokus
  if (!prefillEmail) {
    nameInput?.focus();
  } else {
    emailInput?.focus();
  }

  validate();
}

// ========== Steg 2: Koden ==========
function _renderStep2(container, email, displayName, isDevMode) {
  const devNote = isDevMode
    ? `<div class="login-dev-note">⚙️ Dev-läge: Kolla terminalen för din kod</div>`
    : '';

  container.innerHTML = `
    <div class="screen login-screen">
      <div class="login-logo">
        <div class="login-logo-icon">📧</div>
        <h1>Kolla mejlet!</h1>
        <p>Kod skickad till</p>
        <p style="font-weight:600; font-size:15px; margin-top:4px;">${_esc(email)}</p>
      </div>

      ${devNote}

      <div class="login-form">
        <label class="login-label">Ange din 6-siffriga kod</label>
        <input
          type="text"
          class="login-input login-otp-input"
          id="login-otp"
          placeholder="123456"
          maxlength="6"
          inputmode="numeric"
          pattern="[0-9]*"
          autocomplete="one-time-code"
        />

        <div id="login-error" class="login-error" style="display:none;"></div>

        <button class="login-submit-btn" id="login-verify" disabled>
          🔓 Logga in
        </button>

        <button class="login-back-btn" id="login-back">
          ← Annan e-post
        </button>

        <div class="login-resend">
          <span id="resend-timer"></span>
          <button id="resend-btn" class="login-resend-btn" style="display:none;">
            Skicka ny kod
          </button>
        </div>
      </div>
    </div>
  `;

  const otpInput = document.getElementById('login-otp');
  const verifyBtn = document.getElementById('login-verify');
  const errorDiv = document.getElementById('login-error');
  const backBtn = document.getElementById('login-back');
  const resendBtn = document.getElementById('resend-btn');
  const timerSpan = document.getElementById('resend-timer');

  // Countdown för "skicka igen" (60s)
  let countdown = 60;
  timerSpan.textContent = `Du kan begära ny kod om ${countdown}s`;
  const interval = setInterval(() => {
    countdown--;
    if (countdown <= 0) {
      clearInterval(interval);
      timerSpan.textContent = '';
      resendBtn.style.display = 'inline';
    } else {
      timerSpan.textContent = `Du kan begära ny kod om ${countdown}s`;
    }
  }, 1000);

  otpInput?.addEventListener('input', () => {
    // Filtrera bort icke-siffror automatiskt
    otpInput.value = otpInput.value.replace(/\D/g, '');
    verifyBtn.disabled = otpInput.value.length !== 6;
    errorDiv.style.display = 'none';
    // Auto-submit när 6 siffror är ifyllda
    if (otpInput.value.length === 6) verifyBtn.click();
  });

  otpInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !verifyBtn.disabled) verifyBtn.click();
  });

  verifyBtn?.addEventListener('click', async () => {
    const code = otpInput.value.trim();
    if (code.length !== 6) return;

    verifyBtn.disabled = true;
    verifyBtn.textContent = '⏳ Verifierar...';
    errorDiv.style.display = 'none';

    const result = await store.verifyOtp(email, code, displayName);
    if (result.ok) {
      clearInterval(interval);
      store.emit('navigate', 'chatList');
    } else {
      errorDiv.textContent = result.error || 'Fel kod – försök igen';
      errorDiv.style.display = 'block';
      verifyBtn.disabled = false;
      verifyBtn.textContent = '🔓 Logga in';
      otpInput.value = '';
      otpInput.focus();
    }
  });

  backBtn?.addEventListener('click', () => {
    clearInterval(interval);
    const savedEmail = localStorage.getItem('dff-email') || '';
    const savedName = localStorage.getItem('dff-username') || '';
    _renderStep1(container, savedEmail, savedName);
  });

  resendBtn?.addEventListener('click', async () => {
    resendBtn.style.display = 'none';
    timerSpan.textContent = 'Skickar...';
    const result = await store.requestOtp(email);
    if (result.ok) {
      timerSpan.textContent = '✅ Ny kod skickad!';
      otpInput.value = '';
      otpInput.focus();
    } else {
      timerSpan.textContent = result.error || 'Kunde inte skicka';
      resendBtn.style.display = 'inline';
    }
  });

  otpInput?.focus();
}

function _esc(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;');
}
