import { chatJSON } from './ollama.js';

function schema() {
  return `type Task = {
    title: string;
    brief?: string;
    exercise?: { title: string, instructions: string, starterCode?: string, answerKey?: string };
    steps: { label: string, code?: string }[];
    acceptance:
      | { type: "checkbox" }
      | { type: "minutes", baseline: number }
      | { type: "text", minWords: number }
      | { type: "quiz", minScore: number }
      | { type: "problem", minScore: number, kind: "math" | "code" | "concept", prompt: string };
    quiz?: { q: string, options: string[], answerIndex: number };
  }`;
}

export async function generateTask({ kind, title, date, user, config, better = false, variant = 1, avoid = [] }) {
  const betterHint = better ? ' Produce a stronger, more concrete micro-lesson than usual.' : '';
  const variantHint = `This is variant #${variant} for today. Choose a different micro-focus than earlier variants and avoid repeating instructions.`;
  const avoidHint = avoid.length
    ? `\nDo NOT repeat or closely paraphrase any of these prior prompts/themes:\n- ${avoid.slice(0,20).join('\n- ').slice(0, 2000)}`
    : '';

  let system, userPrompt;

  if (kind === 'fitness') {
    const yoga = config?.yogaMinutes || 10, muscle = config?.muscleMinutes || 10;
    system = 'You are a certified trainer. JSON only.';
    userPrompt = `Create a safe, concise Yoga + Muscle micro-workout for ${user.name} on ${date}.
${variantHint}
Return:
- title
- brief (<= 80 words)
- steps: 3-6 short labels
- acceptance: {type:"minutes", baseline:${yoga + muscle}}
${betterHint}`;
  } else if (kind === 'study') {
        const topics = config?.topics?.join(', ') || 'Arrays, Loops, Algebra';
    system = 'You are a senior JS & Math mentor. JSON only.';
    userPrompt = `Make a 3-5 minute micro-lesson for ${user.name} on ${topics} (date ${date}).
${variantHint}
Return:
- title
- brief (<= 120 words) explaining the concept(s)
- exercise { title, instructions (1-3 short lines), starterCode (<=12 lines if code), answerKey }
- steps: 3-6 concise steps
- acceptance: { type:"problem", minScore:0.7, kind:"code" or "math", prompt: the exact exercise statement to solve }
${betterHint}${avoidHint}`;
  
  } else if (kind === 'religion') {
    const minWords = config?.reflectionMinWords || 40, plan = config?.plan || 'Luke';
    system = 'You are a concise Bible study guide. JSON only.';
    userPrompt = `Plan: ${plan}. Date ${date}.
${variantHint}
Return:
- title
- brief (<= 80 words) with today’s reading
- steps: 2-4 bullets (include 2 reflection prompts)
- acceptance: {type:"text", minWords:${minWords}}
${betterHint}`;
  } else if (kind === 'micro') {
    const topic = (config?.syllabus?.[0]) || 'atoms';
    system = 'You are a chemistry tutor. JSON only.';
    userPrompt = `Topic ${topic}. Date ${date}.
${variantHint}
Return:
- title
- brief (<= 120 words) explaining the core idea
- exercise { title, instructions, answerKey }
- steps: 3-5 concise bullets
- acceptance: { type:"problem", minScore:0.7, kind:"concept", prompt: a precise single-question check }
${betterHint}`;
  } else if (kind === 'hobby') {
    const minutes = config?.minutes || 10;
    system = 'You are a hobby coach. JSON only.';
    userPrompt = `Ukulele or Rubik's Cube drill. Date ${date}.
${variantHint}
Return:
- title
- brief (<=60 words)
- steps: 3-6 concise drill steps
- acceptance: { type:"minutes", baseline:${minutes} }
${betterHint}`;
  } else {
    system = 'You are a helpful coach. JSON only.';
    userPrompt = `Create a tiny task for ${user.name} on ${date} with brief, exercise, steps, and a concrete acceptance.
${variantHint} ${betterHint}`;
  }

  try {
    const j = await chatJSON({ system, user: userPrompt, schemaHint: schema() });
    const out = {
      title: j?.title || `${title} — ${date}`,
      brief: j?.brief || '',
      exercise: j?.exercise || null,
      steps: Array.isArray(j?.steps) && j.steps.length ? j.steps.map(s => ({ label: String(s.label ?? s), code: s.code })) : [],
      acceptance: j?.acceptance || null,
      quiz: j?.quiz || null
    };
    if (!out.steps.length) out.steps = [{ label: 'Read the brief' }, { label: 'Do the 2-minute task' }];
    // Safety: If Study yields wrong acceptance, fix here too
    if (kind === 'study') {
      if (!out.exercise) {
        out.exercise = {
          title: 'Two-minute arrays task',
          instructions: 'Write a function sum(arr) that returns the sum of numbers; [] -> 0.',
          starterCode: `function sum(arr){\n  // your code\n}\nconsole.log(sum([1,2,3])); // 6`,
          answerKey: 'Use reduce or loop; return 0 for empty array.'
        };
      }
      out.acceptance = { type: 'problem', minScore: 0.7, kind: 'code', prompt: out.exercise.instructions };
    }
    return out;
  } catch {
    // Minimal fallback
    return {
      title: `${title} — ${date}`,
      brief: 'Quick brief: focus on one tiny idea and try a two-minute task.',
      exercise: { title: 'Two-minute task', instructions: 'Do one tiny example that uses the idea.', starterCode: '', answerKey: '' },
      steps: [{ label: 'Read the brief' }, { label: 'Do the 2-minute task' }],
      acceptance: kind === 'study'
        ? { type: 'problem', minScore: 0.7, kind: 'code', prompt: 'Provide a working JS solution for sum(arr).' }
        : { type: 'checkbox' },
      quiz: null
    };
  }
}
