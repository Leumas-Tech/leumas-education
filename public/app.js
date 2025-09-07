import { api, renderTaskInto, refreshGrassInto, showResultInto, showBusy, hideBusy } from './ui.js';

const listEl = document.getElementById('list');
const refreshBtn = document.getElementById('refresh');

async function render(){
  listEl.innerHTML = '<div style="opacity:.8">Loading…</div>';
  const practices = await api('/practices');
  listEl.innerHTML = '';

  for (const p of practices) {
    const card = document.createElement('div'); card.className = 'card';
    card.innerHTML = `
      <h3 style="margin-bottom:6px">${p.title}</h3>
      <div class="result" id="res-${p.slug}" style="display:none"></div>
      <div id="task-${p.slug}"></div>
      <div class="row" style="margin-top:8px;">
        <a class="small" href="/practice.html?slug=${encodeURIComponent(p.slug)}" style="text-decoration:none; background:#2d47ff; color:white;">Open</a>
        <button class="small" id="better-${p.slug}">Better Lesson</button>
        <button class="small" id="next-${p.slug}">Next</button>
      </div>
      <div id="grass-${p.slug}" style="margin-top:8px;"></div>
    `;
    listEl.appendChild(card);

    // render today's
    const data = await api(`/task/${p.slug}/today`);
    const mount = card.querySelector(`#task-${p.slug}`);
    const resBox = card.querySelector(`#res-${p.slug}`);
    const onAfterNext = async (res) => {
  // Graded problems (has auto/solution)
  if (res?.auto || res?.solution) {
    const passed = !!(res?.task?.status === 'done');
    const score = res?.auto?.score ?? 0;
    const feedback = res?.auto?.feedback || '';
    const solution = res?.solution || res?.auto?.solution || '';
    resBox.style.display = 'block';
    showResultInto(resBox, { passed, score, feedback, solution });
  }
  // Non-graded proofs (minutes/text/quiz/checkbox): show Accepted/Denied
  if (typeof res?.accepted === 'boolean') {
    const passed = res.accepted;
    const score = res?.task?.score ?? (passed ? 1 : 0);
    const feedback = res?.feedback || (passed ? 'Accepted.' : 'Denied.');
    resBox.style.display = 'block';
    showResultInto(resBox, { passed, score, feedback, solution: '' });
  }

  // Render the newly generated next task (if any)
  if (res?.nextTask) renderTaskInto(mount, res.nextTask, { onAfterNext, showStatus: true });

  // ALWAYS refresh grass after any submit/grade so streak/totals update
  await refreshGrassInto(card.querySelector(`#grass-${p.slug}`), p.slug);
};


    renderTaskInto(mount, data.task, { onAfterNext, showStatus: true });

    // controls
    card.querySelector(`#better-${p.slug}`).onclick = async ()=>{
  try {
    showBusy('Improving lesson…');
    const r = await api(`/practice/${p.slug}/next?better=1`, { method:'POST', body: '{}' });
    resBox.style.display = 'none'; resBox.innerHTML = '';
    renderTaskInto(mount, r.task, { onAfterNext, showStatus: true });
    await refreshGrassInto(card.querySelector(`#grass-${p.slug}`), p.slug);
  } finally { hideBusy(); }
};

card.querySelector(`#next-${p.slug}`).onclick = async ()=>{
  try {
    showBusy('Generating next…');
    const r = await api(`/practice/${p.slug}/next`, { method:'POST', body: '{}' });
    resBox.style.display = 'none'; resBox.innerHTML = '';
    renderTaskInto(mount, r.task, { onAfterNext, showStatus: true });
    await refreshGrassInto(card.querySelector(`#grass-${p.slug}`), p.slug);
  } finally { hideBusy(); }
};

    // grass
    refreshGrassInto(card.querySelector(`#grass-${p.slug}`), p.slug);
  }
}

refreshBtn.onclick = render;
render();
