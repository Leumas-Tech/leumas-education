import { api, md } from './ui.js';

const mount = document.getElementById('hist');

function attemptRow(a){
  const when = new Date(a.ts || Date.now()).toLocaleString();
  const score = (a.auto?.score ?? a.score ?? 0);
  const fb = a.auto?.feedback || '';
  const ans = a.payload?.answer ? `<div><strong>Your answer</strong></div><pre><code>${(a.payload.answer||'').replace(/[&<>]/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[s]))}</code></pre>` : '';
  const sol = a.auto?.solution ? `<div style="margin-top:6px"><strong>Solution</strong></div>${md(a.auto.solution)}` : '';
  return `
    <div style="border:1px solid rgba(255,255,255,.12);border-radius:8px;padding:8px;margin:6px 0;">
      <div style="font-size:12px;opacity:.8">${when} • ${a.passed ? '✅' : '❌'} • score ${score}</div>
      ${fb ? `<div style="opacity:.85">${fb}</div>` : ''}
      ${ans}
      ${sol}
    </div>
  `;
}

function itemBlock(it){
  const ex = it.exercise ? `
    <div class="exercise">
      <div class="ex-title">${it.exercise.title || 'Exercise'}</div>
      <div class="ex-body">${it.exercise.instructions || ''}</div>
    </div>` : '';
  const attempts = (it.attempts||[]).map(attemptRow).join('') || `<div style="opacity:.8">No attempts</div>`;
  return `
    <div class="card">
      <div><strong>${it.date}${it.index>1?` — #${it.index}`:''}</strong> • ${it.title}</div>
      ${ex}
      <div style="margin-top:6px">${attempts}</div>
    </div>
  `;
}

async function render(){
  const practices = await api('/practices');
  mount.innerHTML = '';
  for (const p of practices) {
    const box = document.createElement('section'); box.className='card';
    box.innerHTML = `<h2>${p.title}</h2><div id="list-${p.slug}">Loading…</div>`;
    mount.appendChild(box);

    const res = await api(`/history/${p.slug}?days=60&max=200`);
    const list = box.querySelector(`#list-${p.slug}`);
    if (!res.ok) { list.textContent = 'Failed to load.'; continue; }
    if (!res.items.length) { list.innerHTML = '<div style="opacity:.8">No history yet.</div>'; continue; }

    list.innerHTML = res.items.map(itemBlock).join('');
  }
}
render();
