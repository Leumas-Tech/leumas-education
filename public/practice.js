import { api, renderTaskInto, refreshGrassInto, showResultInto, md, showBusy, hideBusy } from './ui.js';

function q(name, d=null){ return new URLSearchParams(location.search).get(name) ?? d; }
const slug = q('slug');

const titleEl = document.getElementById('p-title');
const resultEl = document.getElementById('result');
const taskEl  = document.getElementById('task');
const grassEl = document.getElementById('grass');
const betterBtn = document.getElementById('btn-better');
const nextBtn = document.getElementById('btn-next');
const todayListEl = document.getElementById('today-list');

function renderTodayList(items, activeIndex){
  todayListEl.innerHTML = '';
  items.forEach(({ index, task })=>{
    const row = document.createElement('div');
    row.className = 'today-item' + (index===activeIndex?' active':'');
    row.innerHTML = `<div>#${index} • <strong>${task.status==='done'?'✅':'🟦'}</strong> ${task.title}</div>
                     <div class="meta">${task.acceptance?.type || ''}</div>`;
    row.onclick = ()=> loadSpecific(index);
    todayListEl.appendChild(row);
  });
}
async function fetchTodayList(){ const r = await api(`/task/${slug}/today/list`); return r.items || []; }

async function loadSpecific(index){
  try {
    showBusy('Loading…');
    // We fetch the list, then render the desired item (keeps one source of truth)
    const list = await fetchTodayList();
    const found = list.find(x => x.index === index);
    if (found) {
      resultEl.innerHTML = '';
      renderTaskInto(taskEl, found.task, { onAfterNext, showStatus: true });
      renderTodayList(list, index);
      titleEl.textContent = found.task.title || slug;
    }
  } finally { hideBusy(); }
}

const onAfterNext = async (res) => {
  // Graded problems
  if (res?.auto || res?.solution) {
    const passed = !!(res?.task?.status === 'done');
    const score = res?.auto?.score ?? 0;
    const feedback = res?.auto?.feedback || '';
    const solution = res?.solution || res?.auto?.solution || '';
    showResultInto(resultEl, { passed, score, feedback, solution });
  }
  // Non-graded proofs
  if (typeof res?.accepted === 'boolean') {
    const passed = res.accepted;
    const score = res?.task?.score ?? (passed ? 1 : 0);
    const feedback = res?.feedback || (passed ? 'Accepted.' : 'Denied.');
    showResultInto(resultEl, { passed, score, feedback, solution: '' });
  }

  // Update main view to the new nextTask, and refresh list
  if (res?.nextTask) {
    renderTaskInto(taskEl, res.nextTask, { onAfterNext, showStatus: true });
  }
  const list = await fetchTodayList();
  const lastIndex = list.length ? list[list.length - 1].index : 1;
  renderTodayList(list, lastIndex);

  await refreshGrassInto(grassEl, slug);
};

async function render(){
  const { task } = await api(`/task/${slug}/today`);
  titleEl.textContent = task.title || slug;

  renderTaskInto(taskEl, task, { onAfterNext, showStatus: true });
  await refreshGrassInto(grassEl, slug);

  // today list
  const list = await fetchTodayList();
  const active = list.length ? list[list.length - 1].index : 1;
  renderTodayList(list, active);

  // chat
  const msgs = (await api(`/chat/${slug}`).catch(()=>({messages:[]}))).messages || [];
  renderChat(msgs);
}

/* chat (unchanged core) */
function formatTime(ts){ const d = ts ? new Date(ts) : new Date(); return d.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}); }
function renderChat(messages){
  const box = document.getElementById('chat'); box.innerHTML = '';
  (messages||[]).forEach(m=>{
    const row = document.createElement('div'); row.className = 'msg-row ' + (m.role === 'user' ? 'user' : 'assistant');
    const avatar = document.createElement('div'); avatar.className = 'avatar ' + (m.role === 'user' ? 'user' : 'ai'); avatar.textContent = m.role === 'user' ? 'You' : 'AI';
    const body = document.createElement('div'); body.style.flex='1';
    const bubble = document.createElement('div'); bubble.className='bubble'; bubble.innerHTML = md(String(m.content||'')); 
    const meta = document.createElement('div'); meta.className='meta'; meta.textContent = formatTime(m.ts);
    body.appendChild(bubble); body.appendChild(meta);
    row.appendChild(avatar); row.appendChild(body);
    box.appendChild(row);
  });
  box.querySelectorAll('button.copy-btn').forEach(btn=>{
    btn.onclick = ()=>{ const id = btn.getAttribute('data-copy'); const el = document.getElementById(id); if (!el) return;
      navigator.clipboard.writeText(el.textContent||'').then(()=>{ btn.textContent='Copied'; setTimeout(()=> btn.textContent='Copy', 1200); });
    };
  });
  box.scrollTop = box.scrollHeight;
}
function setTyping(on){ document.getElementById('chat-typing')?.classList.toggle('hidden', !on); }
async function sendChat(slug, text){ const r = await api(`/chat/${slug}`, { method:'POST', body: JSON.stringify({ message: text }) }); return r.reply; }
const chatInput = document.getElementById('chat-text');
const chatSend = document.getElementById('chat-send');
function appendLocal(role, content){
  const now = Date.now(); const box = document.getElementById('chat');
  const row = document.createElement('div'); row.className = 'msg-row ' + (role === 'user' ? 'user' : 'assistant');
  const avatar = document.createElement('div'); avatar.className = 'avatar ' + (role === 'user' ? 'user' : 'ai'); avatar.textContent = role === 'user' ? 'You' : 'AI';
  const body = document.createElement('div'); body.style.flex='1';
  const bubble = document.createElement('div'); bubble.className='bubble'; bubble.innerHTML = md(content);
  const meta = document.createElement('div'); meta.className='meta'; meta.textContent = new Date(now).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
  body.appendChild(bubble); body.appendChild(meta);
  row.appendChild(avatar); row.appendChild(body);
  const boxEl = document.getElementById('chat');
  boxEl.appendChild(row); boxEl.scrollTop = boxEl.scrollHeight;
}
async function doSend(text){
  appendLocal('user', text);
  chatInput.value = ''; chatInput.disabled = true; chatSend.disabled = true; setTyping(true);
  try {
    const reply = await sendChat(slug, text);
    setTyping(false);
    appendLocal('assistant', reply || '…');
  } catch {
    setTyping(false);
    appendLocal('assistant', 'Sorry, I could not reply right now.');
  } finally {
    chatInput.disabled = false; chatSend.disabled = false; chatInput.focus();
  }
}
chatSend.onclick = async ()=>{ const text = chatInput.value.trim(); if (!text) return; await doSend(text); };
chatInput.addEventListener('keydown', (e)=>{ if (e.key==='Enter' && !e.shiftKey){ e.preventDefault(); chatSend.onclick(); } });

// Improve / Next with spinner
betterBtn.onclick = async ()=>{
  try {
    showBusy('Improving lesson…');
    const r = await api(`/practice/${slug}/next?better=1`, { method:'POST', body: '{}' });
    resultEl.innerHTML = '';
    renderTaskInto(taskEl, r.task, { onAfterNext, showStatus: true });
    const list = await fetchTodayList(); renderTodayList(list, list.length ? list[list.length-1].index : 1);
    await refreshGrassInto(grassEl, slug);
  } finally { hideBusy(); }
};
nextBtn.onclick = async ()=>{
  try {
    showBusy('Generating next…');
    const r = await api(`/practice/${slug}/next`, { method:'POST', body: '{}' });
    resultEl.innerHTML = '';
    renderTaskInto(taskEl, r.task, { onAfterNext, showStatus: true });
    const list = await fetchTodayList(); renderTodayList(list, list.length ? list[list.length-1].index : 1);
    await refreshGrassInto(grassEl, slug);
  } finally { hideBusy(); }
};

render();
