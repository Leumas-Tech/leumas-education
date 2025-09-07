import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  ensureDirs, listPractices, getUser,
  getOrCreateTodayTask, createNextTaskForToday,
  submitProof, gradeAndSubmit, getGrass,
  getChat, appendChat, historyForPractice,  listTodayTasks

} from './src/store.js';
import { tutorChat } from './src/ollama.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json({ limit: '5mb' }));

app.get('/api/health', (_, res) => res.json({ ok: true }));
app.get('/api/practices', async (_, res) => res.json(await listPractices()));

app.get('/api/task/:slug/today', async (req, res) => {
  try {
    const user = await getUser();
    const latest = req.query.latest !== '0';
    const task = await getOrCreateTodayTask(req.params.slug, user, { latest });
    res.json({ ok: true, task });
  } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});

app.post('/api/practice/:slug/next', async (req, res) => {
  try {
    const user = await getUser();
    const better = !!(req.query.better === '1' || req.body?.better);
    const task = await createNextTaskForToday(req.params.slug, user, { better });
    res.json({ ok: true, task });
  } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});

app.post('/api/tasks/:id/proof', async (req, res) => {
  try {
    const result = await submitProof(req.params.id, req.body || {});
    const user = await getUser();
    const nextTask = await createNextTaskForToday(result.practice, user);
    // pass through accepted/feedback so UI can show Accepted/Denied
    res.json({ ...result, nextTask });
  } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});


app.post('/api/tasks/:id/grade', async (req, res) => {
  try {
    const { answer } = req.body || {};
    const result = await gradeAndSubmit(req.params.id, answer);
    const user = await getUser();
    const nextTask = await createNextTaskForToday(result.practice, user);
    res.json({ ...result, solution: result.auto?.solution || '', nextTask });
  } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});

app.get('/api/grass/:slug', async (req, res) => {
  try { res.json(await getGrass(req.params.slug)); }
  catch (e) { res.status(404).json({ ok: false, error: e.message }); }
});

// NEW: history endpoints
app.get('/api/history/:slug', async (req, res) => {
  try {
    const days = Number(req.query.days || 60);
    const max = Number(req.query.max || 200);
    const items = await historyForPractice(req.params.slug, { days, max });
    res.json({ ok: true, items });
  } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});

// Tutor Chat
app.get('/api/chat/:slug', async (req, res) => {
  try { res.json({ ok: true, ...(await getChat(req.params.slug)) }); }
  catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});
app.post('/api/chat/:slug', async (req, res) => {
  try {
    const { message } = req.body || {};
    if (!message || !String(message).trim()) throw new Error('Message is required.');
    const slug = req.params.slug;
    const user = await getUser();
    const task = await getOrCreateTodayTask(slug, user, { latest: true });
    await appendChat(slug, { role: 'user', content: String(message) });
    const hist = await getChat(slug);
    const reply = await tutorChat({ kind: task.practice || slug, task, history: hist.messages, userMessage: String(message) });
    await appendChat(slug, { role: 'assistant', content: reply });
    res.json({ ok: true, reply });
  } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});

app.get('/api/task/:slug/today/list', async (req, res) => {
  try {
    const items = await listTodayTasks(req.params.slug);
    res.json({ ok: true, items });
  } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});

// static
const pub = path.join(__dirname, 'public');
app.use('/', express.static(pub));

await ensureDirs();
const PORT = process.env.PORT || 4124;
app.listen(PORT, () => console.log(`MVP running → http://localhost:${PORT}`));
