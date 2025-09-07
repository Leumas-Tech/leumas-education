import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { generateTask } from './generator.js';
import { gradeAnswer } from './ollama.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_ROOT = process.env.DATA_ROOT || path.join(path.dirname(__dirname), 'data');
const ATLAS_ROOT = process.env.ATLAS_ROOT || path.join(path.dirname(__dirname), 'atlas_out');

const PRACTICES_FILE = path.join(__dirname, '..', 'config', 'practices.json');
const USER_FILE = path.join(__dirname, '..', 'config', 'user.json');

function ymd(d = new Date()) {
  const Y = d.getFullYear(), M = String(d.getMonth() + 1).padStart(2, '0'), D = String(d.getDate()).padStart(2, '0');
  return `${Y}-${M}-${D}`;
}


function parseDateFromName(name) {
  // 2025-09-04.json or 2025-09-04--2.json
  const m = name.match(/^(\d{4}-\d{2}-\d{2})(?:--(\d+))?\.json$/);
  if (!m) return null;
  return { date: m[1], index: m[2] ? Number(m[2]) : 1 };
}

export async function historyForPractice(slug, { days = 60, max = 200 } = {}) {
  const dir = path.join(DATA_ROOT, 'tasks', slug);
  let files = [];
  try { files = await fs.promises.readdir(dir); } catch { return []; }

  const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - days);
  const items = [];

  for (const f of files) {
    if (!f.endsWith('.json')) continue;
    const info = parseDateFromName(f);
    if (!info) continue;
    const d = new Date(info.date + 'T00:00:00');
    if (d < cutoff) continue;
    try {
      const t = JSON.parse(await fs.promises.readFile(path.join(dir, f), 'utf-8'));
      items.push({
        id: t.id,
        date: t.date,
        index: info.index,
        title: t.title,
        kind: t.practice || slug,
        status: t.status,
        score: t.score || 0,
        brief: t.brief || '',
        exercise: t.exercise || null,
        acceptance: t.acceptance || null,
        attempts: Array.isArray(t.attempts) ? t.attempts : [],
        solution: t.solution || t.exercise?.answerKey || ''
      });
    } catch {}
  }

  items.sort((a, b) => {
    if (a.date === b.date) return a.index - b.index;
    return a.date < b.date ? 1 : -1;
  });

  return items.slice(0, max);
}

/* setup */
export async function ensureDirs() {
  await fs.promises.mkdir(DATA_ROOT, { recursive: true });
  await fs.promises.mkdir(path.join(DATA_ROOT, 'tasks'), { recursive: true });
  await fs.promises.mkdir(path.join(DATA_ROOT, 'proofs'), { recursive: true });
  await fs.promises.mkdir(path.join(DATA_ROOT, 'chats'), { recursive: true });
  await fs.promises.mkdir(ATLAS_ROOT, { recursive: true });
}
export async function listPractices() {
  const raw = await fs.promises.readFile(PRACTICES_FILE, 'utf-8');
  return JSON.parse(raw).practices || [];
}
export async function getUser() {
  const raw = await fs.promises.readFile(USER_FILE, 'utf-8');
  return JSON.parse(raw);
}

/* per-day multi items */
function taskPath(slug, date, index = 1) {
  const name = index > 1 ? `${date}--${index}.json` : `${date}.json`;
  return path.join(DATA_ROOT, 'tasks', slug, name);
}
async function listDayTaskFiles(slug, date) {
  const dir = path.join(DATA_ROOT, 'tasks', slug);
  try {
    const files = await fs.promises.readdir(dir);
    return files
      .filter(f => f.startsWith(date) && f.endsWith('.json'))
      .map(f => {
        const m = f.match(/^(\d{4}-\d{2}-\d{2})(?:--(\d+))?\.json$/);
        const index = m && m[2] ? Number(m[2]) : 1;
        return { file: f, index };
      })
      .sort((a, b) => a.index - b.index);
  } catch { return []; }
}
async function loadTaskByIndex(slug, date, index = 1) {
  try { return JSON.parse(await fs.promises.readFile(taskPath(slug, date, index), 'utf-8')); }
  catch { return null; }
}
async function loadLatestTask(slug, date) {
  const files = await listDayTaskFiles(slug, date);
  if (!files.length) return null;
  const last = files[files.length - 1];
  return loadTaskByIndex(slug, date, last.index);
}
async function saveTask(slug, date, index, task) {
  const p = taskPath(slug, date, index);
  await fs.promises.mkdir(path.dirname(p), { recursive: true });
  await fs.promises.writeFile(p, JSON.stringify(task, null, 2), 'utf-8');
  return task;

}

/* ===== DEDUPE HELPERS ===== */
function norm(s='') {
  return String(s).toLowerCase()
    .replace(/[`*_~#>[\](){},.;:!?/\\|\-+="]/g, ' ')
    .replace(/\s+/g, ' ').trim();
}
function signatureFromTask(t) {
  // prefer the most “contentful” field for signature
  const parts = [];
  if (t.exercise?.title) parts.push(t.exercise.title);
  if (t.exercise?.instructions) parts.push(t.exercise.instructions);
  if (t.acceptance?.prompt) parts.push(t.acceptance.prompt);
  if (!parts.length && t.brief) parts.push(t.brief);
  if (!parts.length && t.title) parts.push(t.title);
  return norm(parts.join(' | ')).slice(0, 220);
}

async function listAllTaskFiles(slug) {
  const dir = path.join(DATA_ROOT, 'tasks', slug);
  try { return (await fs.promises.readdir(dir)).filter(f => f.endsWith('.json')); } catch { return []; }
}
function parseNameInfo(name) {
  const m = name.match(/^(\d{4}-\d{2}-\d{2})(?:--(\d+))?\.json$/);
  if (!m) return null;
  return { date: m[1], index: m[2] ? Number(m[2]) : 1 };
}
function isWithinDays(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00');
  const cut = new Date(); cut.setDate(cut.getDate() - days);
  return d >= cut;
}

async function buildAvoidSet(slug, days = 30, cap = 40) {
  const files = await listAllTaskFiles(slug);
  const sigs = [];
  for (const f of files) {
    const info = parseNameInfo(f); if (!info) continue;
    if (!isWithinDays(info.date, days)) continue;
    try {
      const t = JSON.parse(await fs.promises.readFile(path.join(DATA_ROOT, 'tasks', slug, f), 'utf-8'));
      const sig = signatureFromTask(t);
      if (sig) sigs.push(sig);
      if (sigs.length >= cap) break;
    } catch {}
  }
  return new Set(sigs);
}

async function saveUniqueTask({ slug, date, index, user, meta, tryBetter=false }) {
  // Try up to 4 times to avoid signatures we've seen recently
  const avoid = await buildAvoidSet(slug, 45, 60);
  for (let attempt = 0; attempt < 4; attempt++) {
    const content = await generateTask({
      kind: meta.kind,
      title: meta.title,
      date,
      user,
      config: meta.config || {},
      better: tryBetter || attempt > 1,
      variant: index + attempt,
      avoid: Array.from(avoid).slice(0, 50) // pass hints to model
    });
    let t = {
      id: Math.random().toString(36).slice(2, 18),
      date,
      practice: slug,
      title: content.title,
      brief: content.brief || '',
      exercise: content.exercise || null,
      steps: content.steps,
      quiz: content.quiz || null,
      acceptance: content.acceptance || { type: 'checkbox' },
      status: 'pending',
      score: 0,
      attempts: []
    };
    t = ensureConcrete({ config: meta.config || {}, kind: meta.kind, title: meta.title, date }, t);

    const sig = signatureFromTask(t);
    if (!avoid.has(sig)) {
      await saveTask(slug, date, index, t);
      await writeGrass(slug);
      return t;
    }
    // else: increase attempt; loop to try a fresher angle
  }
  // Fallback: save the last attempt even if similar (should be unlikely)
  const lastContent = await generateTask({
    kind: meta.kind, title: meta.title, date, user, config: meta.config || {},
    better: true, variant: index + 99, avoid: Array.from(await buildAvoidSet(slug, 90, 80))
  });
  let t = {
    id: Math.random().toString(36).slice(2, 18),
    date, practice: slug,
    title: lastContent.title, brief: lastContent.brief || '',
    exercise: lastContent.exercise || null, steps: lastContent.steps,
    quiz: lastContent.quiz || null, acceptance: lastContent.acceptance || { type:'checkbox' },
    status:'pending', score:0, attempts:[]
  };
  t = ensureConcrete({ config: meta.config || {}, kind: meta.kind, title: meta.title, date }, t);
  await saveTask(slug, date, index, t);
  await writeGrass(slug);
  return t;
}


/* enforce shape per kind (prevents wrong inputs like minutes for study) */
function ensureConcrete({ config, kind, title, date }, t) {
  const safe = v => (typeof v === 'string' ? v.trim() : '');
  t.brief = safe(t.brief) || '';
  const hasExercise = t.exercise && (safe(t.exercise.title) || safe(t.exercise.instructions));

  if (!t.brief) {
    if (kind === 'study') t.brief = `Warm up on today’s topic. Read the brief, then solve the 2-minute task.`;
    else if (kind === 'micro') t.brief = `Quick concept refresh. Read and answer the check question.`;
    else if (kind === 'religion') t.brief = `Read the passage and write a short reflection.`;
    else if (kind === 'fitness') t.brief = `Short yoga + strength sequence. Move safely.`;
    else if (kind === 'hobby') t.brief = `Tiny focused drill to build skill via repetition.`;
    else t.brief = `Tiny task: read, do, submit proof.`;
  }

  if (!hasExercise && kind === 'study') {
    t.exercise = {
      title: `Two-minute array task`,
      instructions: `Write a JavaScript function \`sum\` that returns the sum of all numbers in an array. If the array is empty, return 0.`,
      starterCode: `function sum(arr){\n  // your code\n}\nconsole.log(sum([1,2,3])); // 6`,
      answerKey: `Loop or reduce, return 0 for [].`
    };
  }

  // Acceptance normalization (critical)
  if (kind === 'study') {
    t.acceptance = { type: 'problem', minScore: 0.7, kind: (t.acceptance?.kind === 'math' ? 'math' : 'code'), prompt: t.exercise?.instructions || 'Solve the exercise.' };
  } else if (kind === 'micro') {
    t.acceptance = t.acceptance?.type === 'problem' ? { ...t.acceptance, minScore: 0.7, kind: 'concept', prompt: t.acceptance.prompt || 'Answer the concept check clearly.' }
      : { type: 'problem', minScore: 0.7, kind: 'concept', prompt: 'Answer the concept check clearly.' };
  } else if (kind === 'religion') {
    t.acceptance = { type: 'text', minWords: (config?.reflectionMinWords || 40) };
  } else if (kind === 'fitness') {
    const base = (config?.yogaMinutes || 10) + (config?.muscleMinutes || 10);
    t.acceptance = { type: 'minutes', baseline: base };
  } else if (kind === 'hobby') {
    t.acceptance = { type: 'minutes', baseline: config?.minutes || 10 };
  } else {
    // generic
    t.acceptance = t.acceptance?.type ? t.acceptance : { type: 'checkbox' };
  }

  if (!Array.isArray(t.steps) || t.steps.length < 2) {
    t.steps = [{ label: 'Read the brief' }, { label: 'Do the 2-minute task' }];
  }

  t.title = safe(t.title) || `${title} — ${date}`;
  if (!Array.isArray(t.attempts)) t.attempts = [];
  return t;
}

/* public API */
export async function getOrCreateTodayTask(slug, user, opts = { latest: true }) {
  const date = ymd();
  const practices = await listPractices();
  const p = practices.find(x => x.slug === slug) || { kind: 'generic', title: slug, config: {} };

  const existing = await loadLatestTask(slug, date);
  if (existing && (opts.latest ?? true)) {
    const files = await listDayTaskFiles(slug, date);
    const last = files[files.length - 1];
    const hydrated = ensureConcrete({ config: p.config || {}, kind: p.kind, title: p.title, date }, { ...existing });
    if (JSON.stringify(hydrated) !== JSON.stringify(existing)) {
      await saveTask(slug, date, last.index, hydrated);
      await writeGrass(slug);
      return hydrated;
    }
    return existing;
  }

  if (!existing) {
    // FIRST item of today with dedupe
    return await saveUniqueTask({
      slug, date, index: 1, user,
      meta: { kind: p.kind, title: p.title, config: p.config || {} }
    });
  }
  return existing;
}

export async function createNextTaskForToday(slug, user, { better = false } = {}) {
  const date = ymd();
  const files = await listDayTaskFiles(slug, date);
  const nextIndex = (files[files.length - 1]?.index || 0) + 1;

  const practices = await listPractices();
  const p = practices.find(x => x.slug === slug) || { kind: 'generic', title: slug, config: {} };

  return await saveUniqueTask({
    slug, date, index: nextIndex, user,
    meta: { kind: p.kind, title: p.title, config: p.config || {} },
    tryBetter: better
  });
}


export async function submitProof(taskId, { type, payload }) {
  const date = ymd();
  const practices = await listPractices();

  for (const p of practices) {
    const files = await listDayTaskFiles(p.slug, date);
    for (const f of files) {
      const t = await loadTaskByIndex(p.slug, date, f.index);
      if (!t || t.id !== taskId) continue;

      let score = 0;
      let accepted = false;
      let feedback = '';
      const acc = t.acceptance || { type: 'checkbox' };

      if (acc.type === 'minutes') {
        const mins = Number(payload?.minutes || 0);
        const base = acc.baseline || 10;
        if (mins >= base) {
          score = mins >= 2 * base ? 4 : 2;
          accepted = true;
          feedback = `Accepted — ${mins}/${base} minutes logged.`;
        } else {
          score = 0;
          accepted = false;
          feedback = `Denied — need at least ${base} minutes; you logged ${mins}.`;
        }
      } else if (acc.type === 'text') {
        const req = acc.minWords || 40;
        const words = String(payload?.text || '').trim().split(/\s+/).filter(Boolean).length;
        if (words >= req) {
          score = words >= Math.floor(req * 1.5) ? 3 : 2;
          accepted = true;
          feedback = `Accepted — ${words} words (min ${req}).`;
        } else {
          score = 0;
          accepted = false;
          feedback = `Denied — ${words} words; need at least ${req}.`;
        }
      } else if (acc.type === 'quiz') {
        const total = Number(payload?.total || 1);
        const correct = Number(payload?.correct || 0);
        const ratio = total ? correct / total : 0;
        const min = acc.minScore || 0.6;
        if (ratio >= min) {
          score = ratio >= 0.9 ? 4 : ratio >= 0.75 ? 3 : 2;
          accepted = true;
          feedback = `Accepted — ${correct}/${total} correct.`;
        } else {
          score = 0;
          accepted = false;
          feedback = `Denied — ${correct}/${total} correct (min ${(min*100)|0}%).`;
        }
      } else {
        // checkbox fallback
        accepted = !!payload?.checked;
        score = accepted ? 1 : 0;
        feedback = accepted ? 'Accepted.' : 'Denied — please check the box when done.';
      }

      t.status = accepted ? 'done' : 'pending';
      t.score = score;
      t.attempts = Array.isArray(t.attempts) ? t.attempts : [];
      t.attempts.push({ ts: Date.now(), type, payload, score, passed: accepted, feedback });
      await saveTask(p.slug, date, f.index, t);

      // IMPORTANT: recompute grass/streak immediately after this attempt
      await writeGrass(p.slug);

      return { ok: true, task: t, practice: p.slug, accepted, feedback };
    }
  }
  throw new Error('Task not found for today');
}

export async function listTodayTasks(slug) {
  const date = ymd();
  const files = await listDayTaskFiles(slug, date);
  const tasks = [];
  for (const f of files) {
    const t = await loadTaskByIndex(slug, date, f.index);
    if (t) tasks.push({ index: f.index, task: t });
  }
  tasks.sort((a,b)=> a.index - b.index);
  return tasks;
}


export async function gradeAndSubmit(taskId, studentAnswer) {
  const date = ymd();
  const practices = await listPractices();

  for (const p of practices) {
    const files = await listDayTaskFiles(p.slug, date);
    for (const f of files) {
      const t = await loadTaskByIndex(p.slug, date, f.index);
      if (!t || t.id !== taskId) continue;

      const acc = t.acceptance || {};
      if (acc.type !== 'problem') throw new Error('This task is not a problem type.');

      const kind = acc.kind || 'concept';
      const prompt = acc.prompt || (t.exercise?.instructions) || 'Solve the exercise.';
      const result = await gradeAnswer({
        kind, prompt,
        student: String(studentAnswer || ''),
        context: { steps: t.steps, brief: t.brief, exercise: t.exercise }
      });

      const parsedScore = Number(result?.score);
      const scoreOk = Number.isFinite(parsedScore) && parsedScore >= 0 && parsedScore <= 1;
      const min = typeof acc.minScore === 'number' ? acc.minScore : 0.7;

      let score = 0;
      let passed = false;
      if (scoreOk && parsedScore >= min) { passed = true; score = parsedScore >= 0.9 ? 4 : parsedScore >= 0.8 ? 3 : 2; }
      else { passed = false; score = 0; }

      t.status = passed ? 'done' : 'failed';
      t.score = score;
      t.solution = result?.solution || t.exercise?.answerKey || '';
      t.attempts.push({
        ts: Date.now(),
        type: 'problem',
        payload: { answer: studentAnswer },
        auto: { score: scoreOk ? parsedScore : 0, feedback: result?.feedback || 'Could not parse.', solution: t.solution },
        passed
      });
      await saveTask(p.slug, date, f.index, t);
      await writeGrass(p.slug);

      return { ok: true, task: t, practice: p.slug, auto: { score: scoreOk ? parsedScore : 0, feedback: result?.feedback || 'Could not parse.', solution: t.solution } };
    }
  }
  throw new Error('Task not found for today');
}

/* grass */
function lastNDates(n = 371) {
  const arr = []; const today = new Date();
  for (let i = 0; i < n; i++) { const d = new Date(today); d.setDate(today.getDate() - i); arr.push(ymd(d)); }
  return arr.reverse();
}
async function writeGrass(slug) {
  const dir = path.join(DATA_ROOT, 'tasks', slug);
  let scoreByDate = {};
  try {
    const files = await fs.promises.readdir(dir);
    for (const f of files) if (f.endsWith('.json')) {
      const t = JSON.parse(await fs.promises.readFile(path.join(dir, f), 'utf-8'));
      scoreByDate[t.date] = Math.max(scoreByDate[t.date] || 0, t.score || 0);
    }
  } catch {}
  const dates = lastNDates(371);
  const weeks = [];
  for (let c = 0; c < 53; c++) {
    const col = [];
    for (let r = 0; r < 7; r++) {
      const idx = c * 7 + r;
      const d = dates[idx];
      col.push(scoreByDate[d] || 0);
    }
    weeks.push(col);
  }
  const palette = ['#0b1020', '#163d2b', '#1e6d3f', '#29a35a', '#39d27a'];
  const legend = ['No activity', 'Attempted', 'Baseline', 'Good', 'Great'];
  let streak = 0;
  for (let i = dates.length - 1; i >= 0; i--) { const sc = scoreByDate[dates[i]] || 0; if (sc > 0) streak++; else break; }
  const totals = Object.values(scoreByDate).filter(v => v > 0).length;
  const outDir = path.join(ATLAS_ROOT, 'william', slug);
  await fs.promises.mkdir(outDir, { recursive: true });
  await fs.promises.writeFile(path.join(outDir, 'grass.json'), JSON.stringify({ weeks, palette, legend, scoreByDate }, null, 2), 'utf-8');
  await fs.promises.writeFile(path.join(outDir, 'stats.json'), JSON.stringify({ streak, totals }, null, 2), 'utf-8');
}
export async function getGrass(slug) {
  const outDir = path.join(ATLAS_ROOT, 'william', slug);
  const g = JSON.parse(await fs.promises.readFile(path.join(outDir, 'grass.json'), 'utf-8'));
  const s = JSON.parse(await fs.promises.readFile(path.join(outDir, 'stats.json'), 'utf-8'));
  return { ...g, ...s };
}

/* Tutor Chat storage */
function chatPath(slug, date) {
  return path.join(DATA_ROOT, 'chats', slug, `${date}.json`);
}
async function loadChat(slug, date) {
  try { return JSON.parse(await fs.promises.readFile(chatPath(slug, date), 'utf-8')); }
  catch { return { messages: [] }; }
}
async function saveChat(slug, date, convo) {
  const p = chatPath(slug, date);
  await fs.promises.mkdir(path.dirname(p), { recursive: true });
  await fs.promises.writeFile(p, JSON.stringify(convo, null, 2), 'utf-8');
  return convo;
}
export async function getChat(slug) {
  const date = ymd(); const convo = await loadChat(slug, date);
  return { date, messages: convo.messages || [] };
}
export async function appendChat(slug, msg) {
  const date = ymd();
  const convo = await loadChat(slug, date);
  const messages = Array.isArray(convo.messages) ? convo.messages : [];
  const withTs = { ...msg, ts: Date.now() };
  messages.push(withTs);
  await saveChat(slug, date, { messages });
  return { date, messages };
}
