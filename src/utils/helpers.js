// src/utils/helpers.js
const crypto = require('crypto');

/**
 * Returns YYYY-MM-DD string for Asia/Karachi time zone
 */
function getDayKey(date = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Karachi',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  return formatter.format(date); // outputs "YYYY-MM-DD"
}

/**
 * Generates an unguessable 12-character URL-safe string
 */
function generatePublicId() {
  return crypto.randomBytes(9).toString('base64url'); // exactly 12 chars
}

/**
 * Clamps a number between min and max
 */
function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

module.exports = {
  getDayKey,
  generatePublicId,
  clamp
};
