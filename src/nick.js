// Приводить нік Instagram до чистого вигляду: без @, без посилання, малими літерами.
// Повертає null, якщо це не схоже на нік.
export function normalizeIg(input) {
  if (typeof input !== 'string') return null;
  let s = input.trim();
  if (!s || s.includes('{{')) return null; // ManyChat не підставив нік

  const link = s.match(/instagram\.com\/([^/?#\s]+)/i);
  if (link) s = link[1];

  s = s.replace(/^@+/, '').replace(/\/+$/, '').trim().toLowerCase();
  if (!/^[a-z0-9._]{1,30}$/.test(s)) return null;
  if (/^\.+$/.test(s)) return null;
  return s;
}
