const THEMES = [
  'Water','Falling','Flying','Teeth','Being chased','Death or ending','Snake',
  'House or room','Door or key','Baby or child','Fire','Test or school',
  'Vehicle or journey','Bridge','Phone or message','Wedding or union','Unresolved scene',
];

export const DREAM_THEME_NAMES = Object.freeze(THEMES.slice());
export const DREAM_TONES = Object.freeze(['curious','anxious','sad','calm','confused']);
export const DREAM_PRIVACY_MODE = 'Server-minimized DeepSeek · raw dream not sent to the model or checkout';

const THEME_PATTERNS = Object.freeze([
  ['Water', /\b(?:water|ocean|sea|river|lake|rain|flood|wave|swim(?:ming)?|drown(?:ing|ed)?)\b/iu],
  ['Falling', /\b(?:fall(?:ing)?|fell|dropped|plummet(?:ing|ed)?)\b/iu],
  ['Flying', /\b(?:fly|flying|flew|float(?:ing|ed)?)\b/iu],
  ['Teeth', /\b(?:tooth|teeth)\b/iu],
  ['Being chased', /\b(?:chas(?:e|ed|ing)|pursu(?:e|ed|ing)|running\s+away|ran\s+away)\b/iu],
  ['Death or ending', /\b(?:death|dead|died|dying|funeral|ending|goodbye|farewell)\b/iu],
  ['Snake', /\b(?:snake|serpent)\b/iu],
  ['House or room', /\b(?:house|home|room|bedroom|kitchen|building)\b/iu],
  ['Door or key', /\b(?:door|key|lock(?:ed)?|gate|threshold)\b/iu],
  ['Baby or child', /\b(?:baby|child|kid|infant|toddler)\b/iu],
  ['Fire', /\b(?:fire|flame|burn(?:ing|ed)?|smoke)\b/iu],
  ['Test or school', /\b(?:test|exam|school|classroom|teacher|student)\b/iu],
  ['Vehicle or journey', /\b(?:car|bus|train|airplane|plane|bicycle|bike|road|trip|journey|travel(?:ing|led)?|driv(?:e|ing|en))\b/iu],
  ['Bridge', /\bbridge\b/iu],
  ['Phone or message', /\b(?:phone|call(?:ed|ing)?|text(?:ed|ing)?|message|letter|email)\b/iu],
  ['Wedding or union', /\b(?:wedding|marriage|married|bride|groom|engag(?:e|ed|ement)|wedding\s+ring)\b/iu],
]);

function clean(value, maximum) {
  return String(value ?? '').normalize('NFKC').replace(/\u0000/g, '').trim().slice(0, maximum);
}

export function safeDreamInput(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const dream = clean(value.dream, 4_001).replace(/\r\n?/g, '\n');
  const tone = clean(value.tone, 20).toLowerCase();
  if (dream.length < 20 || dream.length > 4_000 || !DREAM_TONES.includes(tone)) return null;
  return { dream, tone };
}

export function needsImmediateSafetyResponse(dream) {
  const text = clean(dream, 4_000).toLowerCase().replace(/[’]/g, "'");
  const intendedAction = '(?:(?:kill|hurt)\\s+myself|end\\s+my\\s+life|die|commit\\s+suicide|(?:killing|hurting)\\s+myself|ending\\s+my\\s+life|dying|committing\\s+suicide)';
  const statedIntent = new RegExp(`\\bi(?:\\s+am|'m|\\s+have|'ve)?\\s+(?:(?:going|about|planning)\\s+to|(?:intend|want|plan|decided)\\s+to|(?:plan|planning)\\s+on|will|might|have\\s+(?:(?:a\\s+)?plan|decided)\\s+to)\\s+${intendedAction}\\b`, 'u');
  const riskPatterns = [
    statedIntent,
    /\bi\s+(?:want|wish)\s+to\s+die\b/u,
    /\bi\s+(?:have\s+)?(?:a\s+)?suicid(?:e|al)\s+plan\b/u,
    /\bi\s+(?:am\s+)?suicidal\b(?=.{0,60}\b(?:now|today|tonight|may\s+act|plan)\b)/u,
    /\bi\s+(?:cannot|can't)\s+(?:keep(?:\s+myself)?|stay)\s+safe\b/u,
  ];
  const currentMarker = /\b(?:woke|but\s+now|right\s+now|while\s+awake)\b/gu.exec(text);
  const currentSegmentStart = currentMarker?.index ?? -1;
  if (currentSegmentStart >= 0 && riskPatterns.some((pattern) => pattern.test(text.slice(currentSegmentStart)))) return true;
  const explicitlyDreamOnlyAndSafe = /\b(?:dreamed|in (?:my|the) dream)\b.{0,500}\b(?:woke|awake)\b.{0,60}\b(?:safe|calm)\b/u.test(text)
    || /\b(?:dreamed|in (?:my|the) dream)\b.{0,500}\b(?:safe|calm)\b.{0,40}\b(?:while\s+)?awake\b/u.test(text);
  if (explicitlyDreamOnlyAndSafe) return false;
  return riskPatterns.some((pattern) => pattern.test(text));
}

export function immediateSafetyOutput() {
  return {
    urgentSafety: true,
    headline: 'Pause here — your safety comes first',
    summary: 'I am not going to interpret this as dream symbolism. If any part describes how you feel while awake or you might act now, contact local emergency services or a crisis line, move away from anything you could use to hurt yourself, and reach a trusted person who can stay with you.',
    themes: [{
      name: 'Unresolved scene',
      reflection: 'This response intentionally pauses symbolic interpretation because the text may describe immediate danger outside the dream.',
      question: 'Who can you contact now and ask to stay with you while you get immediate help?',
    }],
    groundingSteps: [
      'Call or message a trusted person and say clearly that you need them to stay with you now.',
      'Contact local emergency services or a crisis line, and move away from anything you could use to hurt yourself.',
    ],
    safetyNote: 'If this is immediate or you may act, call your local emergency number now. In the United States or Canada, call or text 988; elsewhere use your local crisis service.',
  };
}

export function dreamLengthBand(dream) {
  const count = clean(dream, 4_000).split(/\s+/u).filter(Boolean).length;
  return count < 50 ? 'under 50 words' : count < 150 ? '50–149 words' : '150+ words';
}

export function dreamModelSignals(input) {
  const safe = safeDreamInput(input);
  if (!safe) return null;
  const themes = THEME_PATTERNS
    .filter(([, pattern]) => pattern.test(safe.dream))
    .slice(0, 4)
    .map(([name]) => name);
  return {
    themes: themes.length ? themes : ['Unresolved scene'],
    emotionalTone: safe.tone,
    dreamLengthBand: dreamLengthBand(safe.dream),
  };
}

export function safeDreamAiOutput(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const headline = clean(value.headline, 100);
  const summary = clean(value.summary, 700);
  const sourceThemes = Array.isArray(value.themes) ? value.themes : [];
  const seen = new Set();
  const themes = sourceThemes.slice(0, 4).map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
    const name = clean(entry.name, 40);
    const reflection = clean(entry.reflection, 420);
    const question = clean(entry.question, 240);
    if (!THEMES.includes(name) || seen.has(name) || reflection.length < 30 || question.length < 12) return null;
    seen.add(name);
    return { name, reflection, question };
  }).filter(Boolean);
  const groundingSteps = (Array.isArray(value.groundingSteps) ? value.groundingSteps : [])
    .slice(0, 3).map((entry) => clean(entry, 240)).filter((entry) => entry.length >= 12);
  const safetyNote = clean(value.safetyNote, 320);
  if (headline.length < 8 || summary.length < 60 || themes.length < 1 || groundingSteps.length < 2 || safetyNote.length < 20) return null;
  return { headline, summary, themes, groundingSteps, safetyNote };
}

export function dreamEvidence(input, output) {
  const names = output.themes.map((theme) => theme.name);
  return {
    signals: [
      { label: 'Dream themes', value: names.join(', ') },
      { label: 'Emotional tone', value: input.tone },
      { label: 'Dream length band', value: dreamLengthBand(input.dream) },
      { label: 'Privacy mode', value: DREAM_PRIVACY_MODE },
    ],
    context: 'Privacy-minimized AI result; Deckaura derived allowlisted themes, tone and a length band on its server, then sent only those signals to DeepSeek. Raw dream text was not sent to the model, retained, or attached to checkout.',
    scope: 'Reflect only on allowlisted dream themes and the selected tone; no diagnosis, recovered-memory claim, factual third-party claim or prediction.',
    confidence: 'AI-assisted symbolic reflection grounded in allowlisted themes; personal meaning may differ.',
  };
}
