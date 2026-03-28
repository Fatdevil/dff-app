// ============================================
// DFF! – Swedish Natural Language Parser
// Parses natural language into structured
// reminder/schedule data
// ============================================

const WEEKDAYS_SV = {
  'måndag': 1, 'mån': 1,
  'tisdag': 2, 'tis': 2,
  'onsdag': 3, 'ons': 3,
  'torsdag': 4, 'tor': 4,
  'fredag': 5, 'fre': 5,
  'lördag': 6, 'lör': 6,
  'söndag': 0, 'sön': 0,
};

const TIME_WORDS_SV = {
  'bitti': { h: 8, m: 0 },
  'morgon': { h: 8, m: 0 },
  'morgonen': { h: 8, m: 0 },
  'förmiddag': { h: 10, m: 0 },
  'förmiddagen': { h: 10, m: 0 },
  'lunch': { h: 12, m: 0 },
  'lunchtid': { h: 12, m: 0 },
  'eftermiddag': { h: 15, m: 0 },
  'eftermiddagen': { h: 15, m: 0 },
  'kväll': { h: 18, m: 0 },
  'kvällen': { h: 18, m: 0 },
  'ikväll': { h: 18, m: 0 },
  'natt': { h: 22, m: 0 },
  'natten': { h: 22, m: 0 },
};

/**
 * Parse a Swedish natural-language string into structured data.
 * Returns: { task: string, date: Date|null, confidence: number }
 */
export function parseNaturalLanguage(input) {
  const original = input.trim();
  let text = original.toLowerCase();
  let date = null;
  let time = null;
  let task = original;
  let confidence = 0;
  const removeParts = [];

  // === RELATIVE TIME: "om X minuter/timmar" ===
  const relMatch = text.match(/\bom\s+(\d+)\s*(min(?:ut(?:er)?)?|tim(?:m(?:ar?|e))?|h)\b/i);
  if (relMatch) {
    const amount = parseInt(relMatch[1]);
    const unit = relMatch[2].toLowerCase();
    const ms = unit.startsWith('tim') || unit === 'h'
      ? amount * 3600000
      : amount * 60000;
    date = new Date(Date.now() + ms);
    time = { h: date.getHours(), m: date.getMinutes() };
    confidence += 40;
    removeParts.push(relMatch[0]);
  }

  // === DATE: "idag", "imorgon", "i övermorgon" ===
  if (!date) {
    if (/\bidag\b/.test(text)) {
      date = new Date();
      confidence += 20;
      removeParts.push('idag');
    } else if (/\bimorgon\b/.test(text)) {
      date = new Date();
      date.setDate(date.getDate() + 1);
      confidence += 25;
      removeParts.push('imorgon');
    } else if (/\bi\s*övermorgon\b/.test(text)) {
      date = new Date();
      date.setDate(date.getDate() + 2);
      confidence += 25;
      removeParts.push(/i\s*övermorgon/.exec(text)[0]);
    }

    // === WEEKDAY: "på fredag", "nästa tisdag" ===
    for (const [name, dow] of Object.entries(WEEKDAYS_SV)) {
      const weekdayRegex = new RegExp(`(?:på|nästa|i)\\s+${name}\\b`, 'i');
      const simpleRegex = new RegExp(`\\b${name}\\b`, 'i');
      const isNext = new RegExp(`nästa\\s+${name}\\b`, 'i').test(text);

      if (weekdayRegex.test(text) || simpleRegex.test(text)) {
        date = new Date();
        const currentDow = date.getDay();
        let daysUntil = (dow - currentDow + 7) % 7;
        if (daysUntil === 0 || isNext) daysUntil += 7;
        date.setDate(date.getDate() + daysUntil);
        confidence += 30;
        removeParts.push((weekdayRegex.exec(text) || simpleRegex.exec(text))[0]);
        break;
      }
    }
  }

  // === TIME: "kl 16", "kl 16:30", "klockan 8" ===
  if (!time) {
    const timeMatch = text.match(/\b(?:kl(?:ockan)?\.?\s*)(\d{1,2})(?::(\d{2}))?\b/i);
    if (timeMatch) {
      time = { h: parseInt(timeMatch[1]), m: parseInt(timeMatch[2] || '0') };
      confidence += 30;
      removeParts.push(timeMatch[0]);
    }
  }

  // === TIME WORDS: "bitti", "kväll", "lunch" ===
  if (!time) {
    for (const [word, t] of Object.entries(TIME_WORDS_SV)) {
      if (text.includes(word)) {
        time = t;
        confidence += 20;
        removeParts.push(word);
        break;
      }
    }
  }

  // === COMBINE DATE + TIME ===
  if (date && time) {
    date.setHours(time.h, time.m, 0, 0);
    // If combined time is in the past, push to tomorrow
    if (date.getTime() <= Date.now()) {
      date.setDate(date.getDate() + 1);
    }
  } else if (date && !time) {
    // Default to 08:00 if only date given
    date.setHours(8, 0, 0, 0);
    if (date.getTime() <= Date.now()) {
      // If today and 08:00 is past, default to 1 hour from now
      date = new Date(Date.now() + 3600000);
    }
    confidence += 5;
  } else if (!date && time) {
    // If only time given, assume today/tomorrow
    date = new Date();
    date.setHours(time.h, time.m, 0, 0);
    if (date.getTime() <= Date.now()) {
      date.setDate(date.getDate() + 1);
    }
    confidence += 10;
  }

  // === EXTRACT TASK (remove time/date parts) ===
  task = original;
  for (const part of removeParts) {
    task = task.replace(new RegExp(escapeRegex(part), 'i'), '');
  }

  // Clean up common prefixes
  task = task
    .replace(/^(påminn\s+mig\s*(att|om)?|glöm\s+inte\s*(att)?|kom\s+ihåg\s*(att)?)/i, '')
    .replace(/^\s*[,.\-–:!]+\s*/, '')
    .replace(/\s*[,.\-–:!]+\s*$/, '')
    .trim();

  // Capitalize first letter
  if (task.length > 0) {
    task = task[0].toUpperCase() + task.slice(1);
  }

  // Clamp confidence
  confidence = Math.min(confidence, 100);

  return {
    task: task || original,
    date: date,
    timestamp: date ? date.getTime() : null,
    confidence,
    summary: date ? formatParsedResult(task, date) : null,
  };
}

function formatParsedResult(task, date) {
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);

  let dateStr;
  if (date.toDateString() === now.toDateString()) {
    dateStr = 'Idag';
  } else if (date.toDateString() === tomorrow.toDateString()) {
    dateStr = 'Imorgon';
  } else {
    const weekdays = ['sön', 'mån', 'tis', 'ons', 'tor', 'fre', 'lör'];
    const months = ['jan', 'feb', 'mar', 'apr', 'maj', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
    dateStr = `${weekdays[date.getDay()]} ${date.getDate()} ${months[date.getMonth()]}`;
  }

  const timeStr = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;

  return `📝 "${task}" → 📅 ${dateStr} kl ${timeStr}`;
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
