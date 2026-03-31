// ============================================
// DFF! – Auth Module
// Email OTP + JWT session management
// ============================================

import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'dff-dev-secret-change-in-production';
const JWT_EXPIRES = '30d'; // Token gäller 30 dagar

// In-memory OTP store: email -> { code, expires, attempts }
const otpStore = new Map();

const OTP_TTL_MS = 10 * 60 * 1000;   // 10 minuter
const MAX_ATTEMPTS = 5;               // Max felförsök per OTP
const RESEND_COOLDOWN_MS = 60 * 1000; // Min 60s mellan SMS

// ========== OTP Generering ==========
export function generateOtp() {
  return String(Math.floor(100000 + Math.random() * 900000)); // 6 siffror
}

// ========== Lagra OTP ==========
export function storeOtp(email, code) {
  const existing = otpStore.get(email);
  const now = Date.now();

  // Rate-limit: blockera om för nyligen skickad
  if (existing && existing.sentAt && (now - existing.sentAt) < RESEND_COOLDOWN_MS) {
    const waitSec = Math.ceil((RESEND_COOLDOWN_MS - (now - existing.sentAt)) / 1000);
    return { ok: false, error: `Vänta ${waitSec}s innan du begär en ny kod` };
  }

  otpStore.set(email, {
    code,
    expires: now + OTP_TTL_MS,
    attempts: 0,
    sentAt: now,
  });
  return { ok: true };
}

// ========== Verifiera OTP ==========
export function verifyOtp(email, inputCode) {
  const entry = otpStore.get(email);
  if (!entry) return { ok: false, error: 'Ingen kod skickad till denna adress' };
  if (Date.now() > entry.expires) {
    otpStore.delete(email);
    return { ok: false, error: 'Koden har gått ut – begär en ny' };
  }

  entry.attempts++;

  if (entry.attempts > MAX_ATTEMPTS) {
    otpStore.delete(email);
    return { ok: false, error: 'För många felförsök – begär en ny kod' };
  }

  if (entry.code !== inputCode.trim()) {
    return { ok: false, error: `Fel kod (${MAX_ATTEMPTS - entry.attempts + 1} försök kvar)` };
  }

  // Rätt kod – används bara en gång
  otpStore.delete(email);
  return { ok: true };
}

// ========== Skicka OTP via Resend HTTP API ==========
export async function sendOtpEmail(email, code) {
  const apiKey = process.env.RESEND_API_KEY;

  if (!apiKey) {
    // Dev-läge: logga koden istället för att skicka
    console.log(`\n🔑 DEV MODE – OTP för ${email}: ${code}\n`);
    return { ok: true, dev: true };
  }

  try {
    const fromEmail = process.env.FROM_EMAIL || 'onboarding@resend.dev';
    const fromName  = process.env.FROM_NAME  || 'DFF!';

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: `${fromName} <${fromEmail}>`,
        to: [email],
        subject: `${code} – Din DFF! inloggningskod`,
        html: `
          <div style="font-family: -apple-system, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px;">
            <div style="text-align: center; margin-bottom: 32px;">
              <span style="font-size: 48px;">🔔</span>
              <h1 style="font-size: 28px; font-weight: 700; margin: 8px 0 4px;">DFF!</h1>
              <p style="color: #666; margin: 0;">Don't Freaking Forget</p>
            </div>
            <p style="color: #333; font-size: 16px;">Din inloggningskod:</p>
            <div style="background: #f5f5f7; border-radius: 16px; padding: 24px; text-align: center; margin: 16px 0;">
              <span style="font-size: 48px; font-weight: 700; letter-spacing: 8px; font-family: monospace; color: #1c1c1e;">${code}</span>
            </div>
            <p style="color: #666; font-size: 14px;">Koden gäller i <strong>10 minuter</strong>. Dela den inte med någon.</p>
            <p style="color: #999; font-size: 12px; margin-top: 32px;">Om du inte begärt denna kod kan du ignorera mejlet.</p>
          </div>
        `,
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.error('Resend error:', err);
      return { ok: false, error: 'Kunde inte skicka e-post.' };
    }

    console.log(`📧 OTP skickad till ${email} via Resend`);
    return { ok: true };
  } catch (err) {
    console.error('Resend fetch error:', err.message);
    return { ok: false, error: 'Nätverksfel vid e-postutskick.' };
  }
}

// ========== JWT ==========
export function createToken(payload) {
  // payload: { userId, email, displayName }
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES });
}

export function verifyToken(token) {
  try {
    return { ok: true, payload: jwt.verify(token, JWT_SECRET) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// ========== Normalisera e-post ==========
export function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

// ========== Skapa userId från e-post ==========
export function emailToUserId(email) {
  // "stellan.k@gmail.com" -> "stellan.k_gmail.com" (unikt, stabilt ID)
  return email.replace('@', '_at_').replace(/[^a-z0-9._-]/gi, '_').toLowerCase();
}
