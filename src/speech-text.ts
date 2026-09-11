/** Shared by the app and vocabulary exporter so saved audio matches exactly. */
export function plainText(html: string) {
  const holder = document.createElement('div');
  holder.innerHTML = html.replace(/\[sound:[^\]]+\]/g, '').replace(/<br\s*\/?>|<\/(?:p|div|li|h[1-6])>/gi, ' ');
  return (holder.textContent || '').normalize('NFC').replace(/\s+/g, ' ').trim();
}
