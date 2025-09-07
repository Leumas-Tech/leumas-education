import { request } from 'undici';

const OLLAMA = process.env.OLLAMA_HOST || 'http://127.0.0.1:11434';
const MODEL_PRIORITY = (process.env.OLLAMA_MODEL_PRIORITY || 'llama3.2:latest').split(',');

export async function listModels() {
  try {
    const { body, statusCode } = await request(`${OLLAMA}/api/tags`);
    if (statusCode >= 400) return [];
    const j = await body.json();
    return (j.models || []).map(m => m.model);
  } catch { return []; }
}

export async function pickModel() {
  const have = await listModels();
  for (const m of MODEL_PRIORITY) if (have.includes(m)) return m;
  return have[0] || null;
}

export async function chatJSON({ system, user, schemaHint }) {
  const model = await pickModel();
  if (!model) throw new Error('No model. Run: ollama pull llama3.2:latest');

  const messages = [];
  if (system) messages.push({ role: 'system', content: system });

  let suffix = '';
  if (schemaHint) {
    suffix = `

Return ONLY JSON matching this shape (no code fences, no commentary):
${schemaHint}`;
  }
  messages.push({ role: 'user', content: user + suffix });

  const { body, statusCode } = await request(`${OLLAMA}/api/chat`, {
    method: 'POST',
    body: JSON.stringify({ model, messages, stream: false }),
    headers: { 'content-type': 'application/json' }
  });
  if (statusCode >= 400) throw new Error(await body.text());
  const data = await body.json();
  const content = data.message?.content || '';

  // greedy JSON extraction
  const a = content.indexOf('{'), b = content.lastIndexOf('}');
  const jsonText = a !== -1 && b !== -1 && b > a ? content.slice(a, b + 1) : content;
  try { return JSON.parse(jsonText); }
  catch { return { raw: content }; }
}

/** Grade + provide correct solution; retry with strict schema if parse fails */
export async function gradeAnswer({ kind, prompt, student, context }) {
  const model = await pickModel();
  if (!model) throw new Error('No model. Run: ollama pull llama3.2:latest');

  async function ask(system, user) {
    const { body, statusCode } = await request(`${OLLAMA}/api/chat`, {
      method: 'POST',
      body: JSON.stringify({ model, messages: [{ role:'system', content: system }, { role:'user', content: user }], stream: false }),
      headers: { 'content-type': 'application/json' }
    });
    if (statusCode >= 400) throw new Error(await body.text());
    const data = await body.json();
    return data.message?.content || '{}';
  }

  const baseSystem = `You are a strict, fair grader.
Return ONLY JSON:
{"score": number (0..1), "feedback": string (<= 120 chars), "solution": string}
Rules:
- score 1.0 fully correct; 0.7 mostly correct; 0.4 partial; 0 incorrect.
- "solution" MUST contain a correct reference answer.
- If kind="code": provide a minimal correct implementation as a code block (language inferred).
- If kind="math": show steps and final numeric/symbolic result.
- If kind="concept": provide a clear 2–4 sentence ideal answer.`;

  const user = `Kind: ${kind}
Prompt: ${prompt}
StudentAnswer: ${student}
Context: ${JSON.stringify(context).slice(0, 1500)}`;

  // pass 1
  let content = await ask(baseSystem, user);
  let a = content.indexOf('{'), b = content.lastIndexOf('}');
  let jsonText = a !== -1 && b !== -1 && b > a ? content.slice(a, b + 1) : content;
  try { return JSON.parse(jsonText); } catch {}

  // pass 2 (strict reminder)
  const strictSystem = `Return ONLY a single JSON object with keys: score, feedback, solution. NO MARKDOWN, NO EXTRA TEXT.`;
  content = await ask(strictSystem, user);
  a = content.indexOf('{'); b = content.lastIndexOf('}');
  jsonText = a !== -1 && b !== -1 && b > a ? content.slice(a, b + 1) : content;
  try { return JSON.parse(jsonText); }
  catch { return { score: 0, feedback: 'Could not parse.', solution: '' }; }
}

/** Tutor chat (unchanged) */
export async function tutorChat({ modelOverride, kind, task, history = [], userMessage }) {
  const model = modelOverride || await pickModel();
  if (!model) throw new Error('No model. Run: ollama pull llama3.2:latest');

  const system = [
    'You are a friendly, rigorous tutor. Keep answers concise (<= 180 words).',
    'Use lesson context; show steps for math; snippets for code.',
    'Give hints when asked; do not reveal full answers unless asked.'
  ].join(' ');

  const contextBlock = [
    `Practice kind: ${kind}`,
    `Title: ${task?.title || ''}`,
    `Brief: ${task?.brief || ''}`,
    `Exercise: ${task?.exercise ? (task.exercise.title + ' — ' + (task.exercise.instructions || '')) : ''}`,
    `Acceptance: ${task?.acceptance ? JSON.stringify(task.acceptance) : ''}`,
    `Steps: ${(task?.steps || []).map(s => s.label).join(' • ')}`
  ].join('\n');

  const msgs = [{ role: 'system', content: system }, { role: 'user', content: `Lesson context:\n${contextBlock}` }];
  for (const m of history) if (m?.role && m?.content) msgs.push({ role: m.role, content: m.content });
  msgs.push({ role: 'user', content: userMessage });

  const { body, statusCode } = await request(`${OLLAMA}/api/chat`, {
    method: 'POST',
    body: JSON.stringify({ model, messages: msgs, stream: false }),
    headers: { 'content-type': 'application/json' }
  });
  if (statusCode >= 400) throw new Error(await body.text());
  const data = await body.json();
  return data.message?.content?.trim() || '…';
}
