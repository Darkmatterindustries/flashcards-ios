export interface NoteType {
  name: string;
  kind: number;
  fields: string[];
  templates: { ordinal: number; front: string; back: string }[];
}

export class UnsupportedTemplate extends Error {}

const escapeHTML = (value: string) => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function cloze(value: string, ordinal: number, answer: boolean): string {
  return value.replace(/\{\{c(\d+)::([\s\S]*?)\}\}/g, (_, index: string, body: string) => {
    const [text, ...hint] = body.split('::');
    if (Number(index) !== ordinal + 1) return text;
    return answer ? `<strong class="cloze">${text}</strong>` : `<span class="cloze">[${hint.join('::') || '…'}]</span>`;
  });
}

export function renderNote(model: NoteType, values: string[], ordinal: number, deckName: string, tags = '') {
  if (/image occlusion/i.test(model.name)) throw new UnsupportedTemplate('Image occlusion');
  const template = model.kind === 1 ? model.templates[0] : model.templates.find(t => t.ordinal === ordinal);
  if (!template) throw new UnsupportedTemplate('Missing card template');
  const fields: Record<string, string> = Object.create(null);
  model.fields.forEach((name, i) => fields[name] = values[i] || '');
  Object.assign(fields, { Deck: escapeHTML(deckName), Subdeck: escapeHTML(deckName.split('::').at(-1) || deckName), Tags: escapeHTML(tags), Type: escapeHTML(model.name), Card: String(ordinal + 1) });
  const render = (input: string, answer: boolean, front = ''): string => {
    // Resolve nested Anki conditional sections from inside out.
    let previous = '';
    for (let depth = 0; depth < 30 && previous !== input; depth++) {
      previous = input;
      input = input.replace(/\{\{([#^])([^{}]+)\}\}((?:(?!\{\{[#^])[\s\S])*?)\{\{\/\2\}\}/g, (_, op: string, name: string, body: string) => {
        const present = !!(fields[name.trim()] || '').replace(/<[^>]*>/g, '').trim() || /<img\b|\[sound:/i.test(fields[name.trim()] || '');
        return (op === '#' ? present : !present) ? body : '';
      });
    }
    return input.replace(/\{\{([^{}]+)\}\}/g, (_, expression: string) => {
      if (expression === 'FrontSide') return front;
      const parts = expression.split(':');
      const field = parts.pop()!.trim();
      if (!(field in fields)) throw new UnsupportedTemplate(`Unknown field: ${field}`);
      let value = fields[field];
      for (const filter of parts.reverse()) {
        if (filter === 'cloze') value = cloze(value, ordinal, answer);
        else if (filter === 'text') value = value.replace(/<[^>]*>/g, '');
        else if (filter === 'type') { if (!answer) value = ''; }
        else throw new UnsupportedTemplate(`Unsupported filter: ${filter}`);
      }
      return value;
    });
  };
  const front = render(template.front, false);
  // The answer face in the supplied design contains the answer only. Anki's
  // repeated FrontSide/answer separator is omitted to keep that same hierarchy.
  const back = render(template.back.replace(/\{\{FrontSide\}\}/g, '').replace(/<hr\b[^>]*id=["']?answer["']?[^>]*>/gi, ''), true, front);
  if (!front.trim() || !back.trim()) throw new UnsupportedTemplate('Empty card face');
  return { front, back };
}
