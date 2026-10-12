const { URL } = require('node:url');

const mode = 'matrix';
const baseUrl = process.env.GOOGLE_FLIGHTS_URL || '';

console.log(`[INFO] Strategy selected: ${mode}`);
console.log('[INFO] Matrix strategy is reserved for the future departure × return calendar module.');
console.log('[INFO] No Google Flights navigation or data collection was executed.');
if (baseUrl) {
  try {
    const parsed = new URL(baseUrl);
    console.log(`[INFO] URL received: ${parsed.origin}${parsed.pathname}`);
  } catch {
    console.log('[WARN] GOOGLE_FLIGHTS_URL is not a valid URL.');
  }
}
console.log('[INFO] Matrix module status: not implemented');
