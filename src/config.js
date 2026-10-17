export const HIDE_CURSOR = false; // Set to true for the touch-screen event kiosk.

// Leave empty when Express serves both the UI and API (including localhost).
// On Vercel, set this at build time to the public HTTPS quiz server origin.
export const API_BASE_URL = (import.meta.env.VITE_API_URL || '').trim().replace(/\/+$/, '');
