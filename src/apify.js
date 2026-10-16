// Читання відкритої сторінки Instagram через Apify (актор apify/instagram-profile-scraper).
import { config } from './config.js';

const ACTOR = 'apify~instagram-profile-scraper';
const MAX_IMAGE_BYTES = 4_500_000;

// Сторінку неможливо прочитати (закрита, не існує, порожня) — треба просити скріншоти.
export class PageUnreadableError extends Error {}

export async function fetchProfile(ig) {
  if (!config.apifyToken) throw new Error('Немає APIFY_TOKEN у Railway → Variables');
  const url = `https://api.apify.com/v2/acts/${ACTOR}/run-sync-get-dataset-items?timeout=240&clean=true`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apifyToken}` },
    body: JSON.stringify({ usernames: [ig] }),
    signal: AbortSignal.timeout(280_000),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`Apify відповів ${res.status}: ${body.slice(0, 300)}`);

  let items;
  try {
    items = JSON.parse(body);
  } catch {
    throw new Error(`Apify повернув не JSON: ${body.slice(0, 200)}`);
  }
  const profile = Array.isArray(items) ? items.find((i) => i && !i.error && i.username) : null;
  if (!profile) throw new PageUnreadableError(`Сторінку @${ig} не знайдено`);
  if (profile.private) throw new PageUnreadableError(`Сторінка @${ig} закрита`);
  if (!Array.isArray(profile.latestPosts) || profile.latestPosts.length === 0) {
    throw new PageUnreadableError(`На сторінці @${ig} не видно публікацій`);
  }
  return profile;
}

// Завантажує картинку і повертає її у форматі, який приймає Claude. null — якщо не вдалося.
export async function downloadImage(url, headers = {}) {
  if (!url) return null;
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(20_000) });
    if (!res.ok) return null;
    let type = (res.headers.get('content-type') || '').split(';')[0].trim();
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0 || buf.length > MAX_IMAGE_BYTES) return null;
    if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(type)) {
      type = sniffImageType(buf);
      if (!type) return null;
    }
    return { type: 'image', source: { type: 'base64', media_type: type, data: buf.toString('base64') } };
  } catch {
    return null;
  }
}

function sniffImageType(buf) {
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'image/jpeg';
  if (buf[0] === 0x89 && buf[1] === 0x50) return 'image/png';
  if (buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP') return 'image/webp';
  if (buf.slice(0, 3).toString() === 'GIF') return 'image/gif';
  return null;
}
