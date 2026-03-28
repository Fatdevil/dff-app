// ============================================
// DFF! – Settings Screen
// ============================================

import { store } from '../store.js';

export function renderSettings(container) {
  const s = store.settings;
  const presets = store.themePresets;
  const currentTheme = s.theme;

  container.innerHTML = `
    <div class="screen settings-screen">
      <div class="header">
        <button class="header-back" id="settings-back-btn">←</button>
        <div class="header-title">Inställningar</div>
      </div>

      <div class="settings-list">
        <div class="settings-group">
          <div class="settings-group-title">🎨 Tema</div>
          <div class="theme-presets">
            ${Object.entries(presets).map(([key, preset]) => `
              <button class="theme-preset-btn ${currentTheme === key ? 'active' : ''}" data-theme="${key}">
                <div class="theme-preset-preview" style="background: ${preset.bgPrimary};">
                  <div class="theme-preview-bubble sent" style="background: ${preset.sentBubble};"></div>
                  <div class="theme-preview-bubble received" style="background: ${preset.receivedBubble}; border: 1px solid ${preset.borderLight};"></div>
                </div>
                <span class="theme-preset-icon">${preset.icon}</span>
                <span class="theme-preset-name">${preset.name}</span>
              </button>
            `).join('')}
            <button class="theme-preset-btn ${currentTheme === 'custom' ? 'active' : ''}" data-theme="custom">
              <div class="theme-preset-preview" style="background: linear-gradient(135deg, ${s.customColors.bgPrimary}, ${s.customColors.sentBubble});">
                <div class="theme-preview-bubble sent" style="background: ${s.customColors.sentBubble};"></div>
                <div class="theme-preview-bubble received" style="background: ${s.customColors.receivedBubble}; border: 1px solid #ccc;"></div>
              </div>
              <span class="theme-preset-icon">🎨</span>
              <span class="theme-preset-name">Egen</span>
            </button>
          </div>
        </div>

        ${currentTheme === 'custom' ? `
          <div class="settings-group">
            <div class="settings-group-title">🖌️ Egna färger</div>
            <div class="color-picker-grid">
              <div class="color-picker-item">
                <label class="color-picker-label">Bakgrund</label>
                <div class="color-picker-row">
                  <input type="color" class="color-input" id="color-bgPrimary" value="${s.customColors.bgPrimary}" />
                  <span class="color-value">${s.customColors.bgPrimary}</span>
                </div>
              </div>
              <div class="color-picker-item">
                <label class="color-picker-label">Kort/panel</label>
                <div class="color-picker-row">
                  <input type="color" class="color-input" id="color-bgCard" value="${s.customColors.bgCard}" />
                  <span class="color-value">${s.customColors.bgCard}</span>
                </div>
              </div>
              <div class="color-picker-item">
                <label class="color-picker-label">Skickade bubblor</label>
                <div class="color-picker-row">
                  <input type="color" class="color-input" id="color-sentBubble" value="${s.customColors.sentBubble}" />
                  <span class="color-value">${s.customColors.sentBubble}</span>
                </div>
              </div>
              <div class="color-picker-item">
                <label class="color-picker-label">Mottagna bubblor</label>
                <div class="color-picker-row">
                  <input type="color" class="color-input" id="color-receivedBubble" value="${s.customColors.receivedBubble}" />
                  <span class="color-value">${s.customColors.receivedBubble}</span>
                </div>
              </div>
              <div class="color-picker-item">
                <label class="color-picker-label">Accent</label>
                <div class="color-picker-row">
                  <input type="color" class="color-input" id="color-accent" value="${s.customColors.accent}" />
                  <span class="color-value">${s.customColors.accent}</span>
                </div>
              </div>
              <div class="color-picker-item">
                <label class="color-picker-label">Text</label>
                <div class="color-picker-row">
                  <input type="color" class="color-input" id="color-textPrimary" value="${s.customColors.textPrimary}" />
                  <span class="color-value">${s.customColors.textPrimary}</span>
                </div>
              </div>
            </div>
          </div>
        ` : ''}

        <div class="settings-group">
          <div class="settings-group-title">Notifikationer</div>
          <div class="settings-item" id="toggle-sound">
            <span class="settings-item-label">🔊 Alarm-ljud</span>
            <div class="settings-toggle ${s.soundEnabled ? 'active' : ''}" data-setting="soundEnabled"></div>
          </div>
          <div class="settings-item" id="toggle-vibration">
            <span class="settings-item-label">📳 Vibration</span>
            <div class="settings-toggle ${s.vibrationEnabled ? 'active' : ''}" data-setting="vibrationEnabled"></div>
          </div>
          <div class="settings-item" id="toggle-alarm">
            <span class="settings-item-label">🚨 Fullskärmsalarm</span>
            <div class="settings-toggle ${s.alarmEnabled ? 'active' : ''}" data-setting="alarmEnabled"></div>
          </div>
        </div>

        <div class="settings-group">
          <div class="settings-group-title">Konto</div>
          <div class="settings-item" id="switch-account">
            <span class="settings-item-label">🔄 Byt användare</span>
            <span style="color: var(--text-tertiary)">→</span>
          </div>
        </div>

        <div class="settings-group">
          <div class="settings-group-title">Om appen</div>
          <div class="settings-item">
            <span class="settings-item-label">Version</span>
            <span style="color: var(--text-tertiary); font-family: var(--font-mono); font-size: 13px;">1.0.0-demo</span>
          </div>
        </div>
      </div>
    </div>
  `;

  // Back button
  document.getElementById('settings-back-btn')?.addEventListener('click', () => {
    store.emit('navigate', 'chatList');
  });

  // Theme preset buttons
  container.querySelectorAll('.theme-preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      store.setTheme(btn.dataset.theme);
      renderSettings(container);
    });
  });

  // Custom color pickers
  const colorKeys = ['bgPrimary', 'bgCard', 'sentBubble', 'receivedBubble', 'accent', 'textPrimary'];
  colorKeys.forEach(key => {
    const input = document.getElementById(`color-${key}`);
    if (input) {
      input.addEventListener('input', (e) => {
        store.setCustomColor(key, e.target.value);
        // Update the value label
        const label = input.closest('.color-picker-row')?.querySelector('.color-value');
        if (label) label.textContent = e.target.value;
      });
    }
  });

  // Toggle handlers
  document.getElementById('toggle-sound')?.addEventListener('click', () => {
    store.settings.soundEnabled = !store.settings.soundEnabled;
    renderSettings(container);
  });

  document.getElementById('toggle-vibration')?.addEventListener('click', () => {
    store.settings.vibrationEnabled = !store.settings.vibrationEnabled;
    renderSettings(container);
  });

  document.getElementById('toggle-alarm')?.addEventListener('click', () => {
    store.settings.alarmEnabled = !store.settings.alarmEnabled;
    renderSettings(container);
  });

  document.getElementById('switch-account')?.addEventListener('click', () => {
    store.emit('navigate', 'login');
  });
}
