// public/ui.js
export async function api(path, opts = {}) {
  const url = path.startsWith('/api') ? path : '/api' + path;
  const r = await fetch(url, { headers: { 'content-type': 'application/json' }, ...opts });
  if (!r.ok) { const t = await r.text().catch(()=> ''); throw new Error(t || `HTTP ${r.status}`); }
  return await r.json();
}
export function showBusy(text='Working…'){
  let el = document.getElementById('busy');
  if (!el) {
    el = document.createElement('div');
    el.id = 'busy'; el.className = 'busy hidden';
    el.innerHTML = `<div class="spinner"></div><div class="busy-text" id="busy-text"></div>`;
    document.body.appendChild(el);
  }
  document.getElementById('busy-text').textContent = text;
  el.classList.remove('hidden');
}
export function hideBusy(){
  const el = document.getElementById('busy'); if (el) el.classList.add('hidden');
}

export function md(str=''){ /* unchanged from previous */ 
  str = String(str);
  str = str.replace(/```([\s\S]*?)```/g, (_, code) => {
    const esc = code.replace(/[&<>]/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[s]));
    const id = 'c'+Math.random().toString(36).slice(2,8);
    return `<div class="copy-wrap"><button class="copy-btn" data-copy="${id}">Copy</button></div><pre><code id="${id}">${esc}</code></pre>`;
  });
  str = str.replace(/`([^`]+)`/g, (_, code) => `<code>${code.replace(/[&<>]/g,s=>({'&':'&amp;','<':'&gt;'}[s]))}</code>`);
  str = str.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/\*([^*]+)\*/g, '<em>$1</em>');
  const parts = str.split(/\n\n+/).map(p=>`<p>${p}</p>`);
  return parts.join('');
}

export function proofControls(task){
  const acc = task.acceptance || { type:'checkbox' };
  if (acc.type === 'minutes') {
    return `<div class="proof">
      <label>Minutes</label><input type="number" id="min-${task.id}" min="0" value="${acc.baseline||10}"/>
      <button class="small" data-proof="minutes" data-id="${task.id}">Submit</button>
    </div>`;
  }
  if (acc.type === 'text') {
    return `<div class="proof">
      <textarea id="txt-${task.id}" rows="4" placeholder="Reflection (${acc.minWords||40} words min)"></textarea>
      <button class="small" data-proof="text" data-id="${task.id}">Submit</button>
    </div>`;
  }
  if (acc.type === 'quiz' && task.quiz) {
    return `<div class="proof">
      <div>${task.quiz.q}</div>
      ${task.quiz.options.map((o,i)=>`<label><input type="checkbox" name="q-${task.id}" value="${i}"/> ${o}</label>`).join(' ')}
      <button class="small" data-proof="quiz" data-id="${task.id}">Submit</button>
    </div>`;
  }
  if (acc.type === 'problem') {
    const isCode = (acc.kind || '').toLowerCase() === 'code';
    return `<div class="proof">
      <div style="font-size:12px;opacity:.8;margin-bottom:4px">${acc.prompt || 'Solve the problem'}</div>
      <textarea id="ans-${task.id}" rows="${isCode?8:4}" placeholder="${isCode?'Paste your function/solution':'Type your answer'}"></textarea>
      <button class="small" data-grade="1" data-id="${task.id}">Check Answer</button>
    </div>`;
  }
  return `<div class="proof">
    <label><input type="checkbox" id="chk-${task.id}"/> I did it</label>
    <button class="small" data-proof="checkbox" data-id="${task.id}">Submit</button>
  </div>`;
}

export function renderTaskInto(container, task, { onAfterNext, showStatus = true } = {}){
  const brief = task.brief ? `<div class="brief">${task.brief}</div>` : '';
  const ex = task.exercise ? `
    <div class="exercise">
      <div class="ex-title">${task.exercise.title || 'Exercise'}</div>
      <div class="ex-body">${task.exercise.instructions || ''}</div>
      ${task.exercise.starterCode ? `<pre><code>${task.exercise.starterCode}</code></pre>` : ''}
    </div>` : '';
  const steps = (task.steps||[]).map(s=>`<li>${s.label}${s.code?`<pre><code>${s.code}</code></pre>`:''}</li>`).join('');

  container.innerHTML = `
    <div><strong>${task.title}</strong> ${showStatus?`<span class="badge ${task.status==='done'?'done':(task.status==='failed'?'pending':'pending')}">${task.status||'pending'}</span>`:''}</div>
    ${brief}
    ${ex}
    <ol class="steps">${steps}</ol>
    ${proofControls(task)}
  `;

  // wire-up proof
  container.querySelectorAll('button[data-proof]').forEach(btn=>{
    btn.onclick = async ()=>{
      const type = btn.getAttribute('data-proof');
      let payload = {};
      if (type==='minutes') payload.minutes = Number(container.querySelector(`#min-${task.id}`).value||0);
      if (type==='text') payload.text = container.querySelector(`#txt-${task.id}`).value||'';
      if (type==='quiz') {
        const checks = Array.from(container.querySelectorAll(`input[name="q-${task.id}"]`));
        const chosen = checks.findIndex(c=>c.checked);
        const correct = (chosen === (task.quiz?.answerIndex ?? -1)) ? 1 : 0;
        payload = { correct, total: 1 };
      }
      if (type==='checkbox') payload.checked = container.querySelector(`#chk-${task.id}`).checked;

      try {
        showBusy('Submitting…');
        const res = await api(`/tasks/${task.id}/proof`, { method:'POST', body: JSON.stringify({ type, payload }) });
        if (res?.nextTask && typeof onAfterNext === 'function') onAfterNext(res);
      } finally { hideBusy(); }
    };
  });

  container.querySelectorAll('button[data-grade]').forEach(btn=>{
    btn.onclick = async ()=>{
      const ans = container.querySelector(`#ans-${task.id}`)?.value || '';
      if (!ans.trim()) { alert('Enter your answer first.'); return; }
      try {
        showBusy('Checking answer…');
        const res = await api(`/tasks/${task.id}/grade`, { method:'POST', body: JSON.stringify({ answer: ans }) });
        if (typeof onAfterNext === 'function') onAfterNext(res);
      } finally { hideBusy(); }
    };
  });
}

export async function refreshGrassInto(mount, slug){
  mount.innerHTML = '';
  try {
    const d = await (await fetch(`/api/grass/${slug}`)).json();
    const grid = document.createElement('div'); grid.className='grass';
    d.weeks.flat().forEach(v=>{
      const s = document.createElement('span'); s.className='cell';
      s.style.background = d.palette[v] || d.palette[0];
      grid.appendChild(s);
    });
    const meta = document.createElement('div'); meta.style.fontSize='12px'; meta.style.opacity='.8';
    meta.textContent = `Streak ${d.streak} • Completions ${d.totals}`;
    mount.appendChild(grid); mount.appendChild(meta);
  } catch {
    mount.innerHTML = '<div style="opacity:.7;font-size:12px">No grass yet.</div>';
  }
}

export function showResultInto(resultEl, { passed, score, feedback, solution }){
  const cls = passed ? 'result good' : 'result bad';
  const title = passed ? '✅ Correct' : '❌ Not quite';
  const s = solution ? `<div style="margin-top:6px"><strong>Solution</strong></div><div>${md(solution)}</div>` : '';
  resultEl.innerHTML = `
    <div class="${cls}">
      <div class="title">${title} • score ${score?.toFixed ? score.toFixed(2) : score}</div>
      <div style="opacity:.85">${feedback || ''}</div>
      ${s}
    </div>
  `;
}
