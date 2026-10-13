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

/**
 * Resolves application base URL, strictly prioritizing process.env.BASE_URL
 */
function getBaseUrl(req) {
  if (process.env.BASE_URL) {
    return process.env.BASE_URL.replace(/\/+$/, '');
  }
  if (req) {
    const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'http';
    const host = req.headers['x-forwarded-host'] || req.get('host');
    if (host) return `${protocol}://${host}`;
  }
  return `http://localhost:${process.env.PORT || 3000}`;
}

module.exports = {
  getDayKey,
  generatePublicId,
  clamp,
  getBaseUrl
};

