import DOMPurify from 'dompurify';

/** Deck HTML is content, never executable code or an app-level stylesheet. */
export function cardContent(html: string, media: Map<string, string>) {
  const sounds: string[] = [];
  html = html.replace(/\[sound:([^\]]+)\]/g, (_, name: string) => { const url = media.get(name); if (url) sounds.push(url); return ''; });
  const clean = DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ['p', 'div', 'span', 'br', 'b', 'strong', 'i', 'em', 'u', 's', 'sub', 'sup', 'ul', 'ol', 'li', 'blockquote', 'hr', 'img', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'ruby', 'rt', 'rp', 'pre', 'code', 'h1', 'h2', 'h3'],
    ALLOWED_ATTR: ['src', 'alt', 'class', 'dir', 'colspan', 'rowspan'],
    ALLOW_DATA_ATTR: false,
  });
  const fragment = document.createElement('div');
  fragment.innerHTML = clean;
  fragment.querySelectorAll('[class]').forEach(element => {
    element.className = [...element.classList].filter(name => ['explanation', 'cloze'].includes(name)).join(' ');
  });
  fragment.querySelectorAll('img').forEach(img => {
    let name = img.getAttribute('src') || '';
    try { name = decodeURIComponent(name); } catch { /* A literal percent may be part of an Anki filename. */ }
    const url = media.get(name) || media.get(name.replace(/^\.\//, ''));
    if (url) { img.src = url; img.draggable = false; }
    else { const fallback = document.createElement('span'); fallback.className = 'media-missing'; fallback.textContent = img.alt || 'Image unavailable'; img.replaceWith(fallback); }
  });
  return { html: fragment.innerHTML, sounds };
}
