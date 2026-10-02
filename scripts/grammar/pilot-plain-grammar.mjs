import { mkdir, writeFile } from 'node:fs/promises';
const tasks = [
  ['der Entwurf', 'Write four natural German sentences using the masculine noun Entwurf (draft), with its definite article, once in each case: nominative, accusative, dative, genitive.'],
  ['verstehen', 'Write four natural German sentences, each containing a conjugated form of verstehen (to understand). Demonstrate nominative on a subject, accusative on a direct object, dative in a mit phrase, and genitive in a possessive noun phrase. The verb itself does not decline for case.'],
  ['mit', 'Write four natural German sentences, each containing mit followed by a dative phrase. In these sentences demonstrate respectively a nominative subject, an accusative direct object, the dative phrase after mit, and a genitive possessive phrase. Mit must always retain dative government; the other cases occur elsewhere in the sentence.'],
];
const directory = 'artifacts/grammar-plain-pilot';
await mkdir(directory, { recursive: true });
for (const [index, [word, instruction]] of tasks.entries()) {
  const started = Date.now();
  await writeFile(`${directory}/status.json`, JSON.stringify({ state: 'testing', word, completed: index, total: tasks.length }));
  const r = await fetch('http://127.0.0.1:11434/api/generate', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(300000),
    body: JSON.stringify({ model: 'qwen3.5:9b', stream: true, think: false,
      options: { temperature: 0.3, num_ctx: 4096, num_predict: 1600 },
      prompt: `${instruction} For each case give a German sentence, an English translation, identify the phrase showing that case, and give one short English hint explaining why it is in that case. Include a brief word-specific pro-tip. Only final teaching material. No planning or discussion.` })
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const decoder = new TextDecoder();
  let pending = '', output = '', last;
  for await (const chunk of r.body) {
    pending += decoder.decode(chunk, { stream: true });
    const lines = pending.split('\n'); pending = lines.pop();
    for (const line of lines) {
      if (!line.trim()) continue;
      const item = JSON.parse(line);
      if (item.error) throw new Error(item.error);
      output += item.response ?? ''; last = item;
    }
  }
  await writeFile(`${directory}/${index + 1}.json`, JSON.stringify({ word, seconds: (Date.now() - started) / 1000, output, last }, null, 2));
  if (!last?.done || last.done_reason === 'length' || !output.trim()) throw new Error(`Incomplete answer for ${word}`);
  console.log(`Draft saved: ${word}`);
}
await writeFile(`${directory}/status.json`, JSON.stringify({ state: 'awaiting-review', completed: tasks.length, total: tasks.length }));
