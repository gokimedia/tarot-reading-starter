import assert from 'node:assert/strict';
import test from 'node:test';

import {
  detectQuestionLanguage,
  freeTeaserAudit,
  freePreviewOutputTokenBudget,
  generateFreeTeaserHtml,
} from '../lib/legacy-worker.mjs';

function modelResponse(content, finishReason, outputTokens) {
  return new Response(JSON.stringify({
    choices: [{ message: { content }, finish_reason: finishReason }],
    usage: { prompt_tokens: 120, completion_tokens: outputTokens },
  }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function modelEnvironment() {
  const claims = [];
  const settlements = [];
  return {
    DEEPSEEK_DIRECT_API_KEY: 'test-only-key',
    AI_BUDGETS: {
      async claim(value) {
        claims.push(value);
        return { allowed: true };
      },
      async settle(...value) {
        settlements.push(value);
        return { settled: true };
      },
    },
    claims,
    settlements,
  };
}

const LONG_HINDI_THREE_CARD_READING = 'इस समय भरोसा बढ़ाने की स्वस्थ दिशा जल्दबाजी में निष्कर्ष चुनना नहीं, बल्कि अपनी शांति बचाते हुए शब्दों और लगातार दिखने वाले व्यवहार का तालमेल देखना है। The Star upright बताता है कि आशा जीवित है और उपचार संभव है, फिर भी यह आशा तभी सहारा बनेगी जब छोटी कोशिशें समय के साथ स्थिर और ईमानदार रहें। Queen of Swords upright इस नरमी के भीतर साफ सीमा रखने को कहती है, इसलिए अपनी जरूरत शांत स्वर में बताएं और वादे के बजाय सम्मान तथा जिम्मेदारी दिखाने वाली प्रतिक्रिया को महत्व दें। Temperance upright इन दोनों कार्डों के बीच संतुलन बनाता है, जिससे धैर्य का अर्थ चुपचाप इंतजार करना नहीं बल्कि बातचीत और दूरी की ऐसी गति चुनना है जिसमें दोनों पक्ष सच बोल सकें। अगले कुछ दिनों में एक सरल सीमा तय करके उसे स्थिर रखें, फिर देखें कि संवाद अधिक खुला, सुरक्षित और पारस्परिक बनता है या वही पुराना असमंजस लौटता है, क्योंकि भरोसे का खुला गहरा सूत्र भावना से आगे लगातार दिखाई देने वाली संगति और आत्मसम्मान में बसता है।';

const HINDI_THREE_CARD_FIELDS = {
  lang: 'hi',
  locale: 'hi-IN',
  question: 'विश्वास और अपनी सीमाओं के बीच स्वस्थ संतुलन कैसे रखूं?',
  type: 'Three Card Tarot',
  tool: '/pages/free-tarot-reading',
  spread: 'Three Card',
  context: 'Reflective guidance about trust and personal boundaries.',
  signals: 'Situation: The Star upright; Challenge: Queen of Swords upright; Advice: Temperance upright',
  cards: 'Situation: The Star upright; Challenge: Queen of Swords upright; Advice: Temperance upright',
};

test('script-heavy free previews receive a larger bounded output budget', () => {
  assert.equal(freePreviewOutputTokenBudget({
    isFiveRune: false,
    isSevenCard: false,
    isOneCard: false,
    isOtherLanguage: false,
    useThinking: false,
  }), 220);
  assert.equal(freePreviewOutputTokenBudget({
    isFiveRune: false,
    isSevenCard: false,
    isOneCard: false,
    isOtherLanguage: true,
    useThinking: false,
  }), 420);
  assert.equal(freePreviewOutputTokenBudget({
    isFiveRune: false,
    isSevenCard: false,
    isOneCard: true,
    isOtherLanguage: true,
    useThinking: false,
  }), 300);
  assert.equal(freePreviewOutputTokenBudget({
    isFiveRune: false,
    isSevenCard: true,
    isOneCard: false,
    isOtherLanguage: true,
    useThinking: false,
  }), 620);
  assert.equal(freePreviewOutputTokenBudget({
    isFiveRune: false,
    isSevenCard: false,
    isThreeCard: true,
    isOneCard: false,
    isOtherLanguage: false,
    useThinking: false,
  }), 360);
  assert.equal(freePreviewOutputTokenBudget({
    isFiveRune: false,
    isSevenCard: false,
    isThreeCard: true,
    isOneCard: false,
    isOtherLanguage: true,
    useThinking: false,
  }), 620);
});

test('canonical reserved previews use the audited deterministic fast path when the model share is dialed to zero', async (t) => {
  const originalFetch = globalThis.fetch;
  let modelCalls = 0;
  const environment = { ...modelEnvironment(), FREE_RESERVED_LLM_SHARE: 0 };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async () => {
    modelCalls += 1;
    throw new Error('reserved fast path must not call a model provider');
  };
  const fixtures = [
    {
      question: 'Will Alex contact me again?',
      spread: 'Three Card',
      context: 'Past: Page of Cups upright. Present: The Hermit reversed. Future: Eight of Wands upright.',
      signals: 'Past: Page of Cups Upright; Present: The Hermit Reversed; Future: Eight of Wands Upright',
      cards: 'Page of Cups, The Hermit, Eight of Wands',
      readingId: 'reserved_fast_path_ppf',
      minWords: 180,
      visiblePattern: /Future position holds Eight of Wands upright, but its interpretation stays sealed/i,
    },
    {
      question: 'Should I take the offer?',
      spread: 'Yes or No Tarot',
      context: 'Three-card Yes or No Tarot.',
      signals: 'Card 1: The Star Upright - YES; Card 2: The Moon Reversed - MAYBE; Card 3: The Sun Upright - YES; Overall Lean: YES',
      cards: 'The Star, The Moon, The Sun',
      readingId: 'reserved_fast_path_yesno',
      minWords: 95,
      visiblePattern: /full reading reveals the answer's direction, the exact deciding condition, timing, and the next step/i,
    },
  ];

  for (const fixture of fixtures) {
    const fields = {
      ...fixture,
      lang: 'en',
      locale: 'en-US',
      type: 'Three Card Tarot',
      tool: '/pages/free-tarot-reading',
    };
    const html = await generateFreeTeaserHtml(fields, environment);
    const visible = html.replace(/<[^>]+>/g, ' ').replace(/&#0*39;|&apos;/gi, "'").replace(/&quot;/gi, '"').replace(/\s+/g, ' ').trim();
    const audit = freeTeaserAudit(html, fields, fixture.minWords);
    assert.equal(audit.ok, true, `${fixture.readingId}: ${audit.reason}: ${html}`);
    assert.match(visible, fixture.visiblePattern);
    assert.equal(fields.freePreviewServedModel, 'deterministic');
    assert.equal(fields.freePreviewServedSource, 'deterministic_reserved_fast_path');
    assert.equal(fields.freePreviewAuditStatus, 'passed');
  }

  assert.equal(modelCalls, 0);
  assert.equal(environment.claims.length, 0, 'fast path must not claim model budget');
  assert.equal(environment.settlements.length, 0, 'fast path must not settle model usage');
});

const RESERVED_PPF_FIXTURE = {
  question: 'Will Alex contact me again?',
  spread: 'Three Card',
  context: 'Past: Page of Cups upright. Present: The Hermit reversed. Future: Eight of Wands upright.',
  signals: 'Past: Page of Cups Upright; Present: The Hermit Reversed; Future: Eight of Wands Upright',
  cards: 'Page of Cups, The Hermit, Eight of Wands',
  lang: 'en',
  locale: 'en-US',
  type: 'Three Card Tarot',
  tool: '/pages/free-tarot-reading',
};

test('reserved past-present-future previews are model-first when credentials and share allow', async (t) => {
  const originalFetch = globalThis.fetch;
  let modelCalls = 0;
  const environment = modelEnvironment();
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  const modelDraft = [
    'Looking at "Will Alex contact me again?", the story opens well before this silence.',
    'Page of Cups upright in the Past position shows how this connection first reached you, through small sincere gestures, playful messages, and an openness that taught you to expect warmth whenever Alex appeared.',
    'That early sweetness set the emotional habit you still carry, and it is why the quiet days now feel louder than they should.',
    'The Hermit reversed in the Present position names the live tension, a withdrawal that has hardened into isolation instead of honest reflection, leaving you to read meaning into every small signal.',
    'It makes sense that this waiting feels heavy, because the heart that learned to expect warmth is now asked to sit with silence.',
    'The one thing that truly hangs on this knot is whether the closeness you remember was a beginning that paused or an ending that never announced itself.',
  ].join(' ');
  globalThis.fetch = async () => {
    modelCalls += 1;
    return modelResponse(modelDraft, 'stop', 320);
  };
  const fields = {
    ...RESERVED_PPF_FIXTURE,
    readingId: 'reserved_llm_primary_ppf',
    visitorId: 'reserved_llm_primary_visitor',
  };
  const html = await generateFreeTeaserHtml(fields, environment);
  const visible = html.replace(/<[^>]+>/g, ' ').replace(/&#0*39;|&apos;/gi, "'").replace(/&quot;/gi, '"').replace(/\s+/g, ' ').trim();
  const audit = freeTeaserAudit(html, fields, 180);
  assert.equal(audit.ok, true, `${audit.reason}: ${html}`);
  assert.ok(modelCalls >= 1, 'reserved preview must consult the model first');
  assert.equal(fields.freePreviewReservedRoute, 'llm_primary');
  assert.notEqual(fields.freePreviewServedModel, 'deterministic');
  assert.match(String(fields.freePreviewServedSource), /^model_/);
  assert.match(visible, /Page of Cups/);
  assert.match(visible, /The Hermit/);
  assert.match(visible, /Future position holds Eight of Wands upright, but its interpretation stays sealed/i);
  assert.match(visible, /full reading reveals the Future card's meaning/i);
});

test('reserved previews fall back to the audited deterministic template when the model fails', async (t) => {
  const originalFetch = globalThis.fetch;
  let modelCalls = 0;
  const environment = modelEnvironment();
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async () => {
    modelCalls += 1;
    throw new Error('model provider unavailable');
  };
  const fields = {
    ...RESERVED_PPF_FIXTURE,
    readingId: 'reserved_llm_fallback_ppf',
    visitorId: 'reserved_llm_fallback_visitor',
  };
  const html = await generateFreeTeaserHtml(fields, environment);
  const audit = freeTeaserAudit(html, fields, 180);
  assert.equal(audit.ok, true, `${audit.reason}: ${html}`);
  assert.ok(modelCalls >= 1, 'model must be attempted before the deterministic fallback');
  assert.equal(fields.freePreviewReservedRoute, 'llm_primary');
  assert.equal(fields.freePreviewServedModel, 'deterministic');
  assert.match(String(fields.freePreviewServedSource), /^deterministic_/);
  assert.match(html, /stays sealed/i);
});

test('Hindi free preview rewrites once after finish_reason length and keeps the locale contract', async (t) => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  const environment = modelEnvironment();
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const completeHindiReading = 'इस रिश्ते में धैर्य रखना अभी सही दिशा है, लेकिन अपने मन की शांति को केवल प्रतीक्षा पर निर्भर न करें. The Star upright आशा, उपचार और धीरे धीरे लौटते भरोसे की ओर इशारा करता है, इसलिए जल्दबाजी के बजाय साफ और सम्मानजनक संवाद को जगह दें. अपनी सीमाओं को शांत ढंग से बताएं और सामने वाले के लगातार व्यवहार को देखें. यहां खुला हुआ गहरा सूत्र यह है कि उम्मीद तभी सहारा बनती है जब वह आत्मसम्मान के साथ चलती है.';
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(String(options.body));
    requests.push(body);
    return requests.length === 1
      ? modelResponse('यह उत्तर अधूरा है और अंतिम वाक्य तक नहीं पहुंचा', 'length', body.max_tokens)
      : modelResponse(completeHindiReading, 'stop', 238);
  };

  const html = await generateFreeTeaserHtml({
    lang: 'hi',
    locale: 'hi-IN',
    question: 'क्या मुझे इस रिश्ते में धैर्य रखना चाहिए?',
    type: 'One Card Love Tarot',
    tool: '/pages/free-tarot-reading',
    spread: 'One Card',
    context: 'One Card Love Tarot',
    signals: 'Answer: The Star upright',
    cards: 'Answer: The Star upright',
  }, environment);

  assert.equal(requests.length, 2);
  assert.equal(environment.claims.length, 2);
  assert.equal(requests[0].max_tokens, 300);
  assert.equal(requests[1].max_tokens, 460);
  assert.match(requests[1].messages[0].content, /previous draft reached the output limit/i);
  assert.match(html, /\p{Script=Devanagari}/u);
  assert.match(html, /The Star upright/);
  assert.doesNotMatch(html, /अधूरा/);
});

test('three-card Hindi length retry accepts danda endings and clamps only at a complete sentence', async (t) => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  const environment = modelEnvironment();
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  // This deliberately exceeds the 145-word display ceiling. The first four
  // sentences contain every required card in 124 words; the fifth forces the
  // clamp to recognize the native Devanagari danda rather than append an
  // ellipsis or discard an otherwise complete Hindi reading.
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(String(options.body));
    requests.push(body);
    return requests.length === 1
      ? modelResponse('यह उत्तर सीमा तक पहुंचा लेकिन पूरा अंतिम वाक्य नहीं लिख सका', 'length', body.max_tokens)
      : modelResponse(LONG_HINDI_THREE_CARD_READING, 'stop', 452);
  };

  const html = await generateFreeTeaserHtml(HINDI_THREE_CARD_FIELDS, environment);

  const visible = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  assert.equal(requests.length, 2);
  assert.equal(environment.claims.length, 2);
  assert.equal(requests[0].max_tokens, 420);
  assert.equal(requests[1].max_tokens, 630);
  assert.match(visible, /The Star upright/);
  assert.match(visible, /Queen of Swords upright/);
  assert.match(visible, /Temperance upright/);
  assert.match(visible, /।$/u);
  assert.doesNotMatch(visible, /…/u);
  assert.doesNotMatch(visible, /अगले कुछ दिनों/u);
  assert.ok(visible.split(/\s+/).length <= 145);
});

test('Hindi quality rewrite uses one larger bounded call instead of truncating again', async (t) => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  const environment = modelEnvironment();
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(String(options.body));
    requests.push(body);
    if (requests.length === 1) {
      return modelResponse(LONG_HINDI_THREE_CARD_READING.replace(/।$/u, ''), 'stop', 390);
    }
    return body.max_tokens >= 630
      ? modelResponse(LONG_HINDI_THREE_CARD_READING, 'stop', 452)
      : modelResponse('यह दूसरा उत्तर भी टोकन सीमा पर अधूरा रह गया', 'length', body.max_tokens);
  };

  const html = await generateFreeTeaserHtml(HINDI_THREE_CARD_FIELDS, environment);
  const visible = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

  assert.equal(requests.length, 2);
  assert.equal(environment.claims.length, 2);
  assert.equal(requests[0].max_tokens, 420);
  assert.equal(requests[1].max_tokens, 630);
  assert.match(requests[1].messages[1].content, /ended with an incomplete final sentence/i);
  assert.match(visible, /।$/u);
  assert.doesNotMatch(visible, /…/u);
});

test('two truncated Hindi drafts stop after one retry and never serve an English fallback', async (t) => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  const environment = modelEnvironment();
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(String(options.body));
    requests.push(body);
    return modelResponse('यह उत्तर अभी भी अधूरा है और पूरा नहीं हुआ', 'length', body.max_tokens);
  };

  await assert.rejects(
    generateFreeTeaserHtml({
      lang: 'hi',
      locale: 'hi-IN',
      question: 'क्या मुझे इस रिश्ते में धैर्य रखना चाहिए?',
      type: 'One Card Love Tarot',
      tool: '/pages/free-tarot-reading',
      spread: 'One Card',
      context: 'One Card Love Tarot',
      signals: 'Answer: The Star upright',
      cards: 'Answer: The Star upright',
    }, environment),
    (error) => error && error.code === 'FREE_PREVIEW_QUALITY_UNAVAILABLE',
  );
  assert.equal(requests.length, 2);
  assert.equal(environment.claims.length, 2);
});

test('Hindi language UI retries truncated JSON once without weakening the exact-key contract', async (t) => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  const environment = modelEnvironment();
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const hindiUi = {
    code: 'hi',
    language: 'Hindi',
    acknowledgement: 'Deckaura आपकी भाषा बोलता है.',
    waiting: 'आपके प्रश्न का उत्तर आपकी भाषा में दिया जाएगा. कृपया प्रतीक्षा करें.',
    followupLabel: 'अपना दूसरा प्रश्न पूछें',
    followupPlaceholder: 'अपना दूसरा प्रश्न लिखें या संपादित करें...',
    followupSubmit: 'मेरा दूसरा प्रश्न भेजें',
    followupReceived: 'आपका दूसरा प्रश्न पहले प्रश्न, चुने गए कार्ड और ऊपर दिए उत्तर के साथ सुरक्षित है.',
    followupNote: 'आपका पहला प्रश्न, कार्ड और Deckaura का उत्तर जुड़े रहेंगे.',
    limitTitle: 'आपके उत्तर सतह के नीचे एक अनसुलझा पैटर्न दिखाते हैं.',
    limitMessage: 'आपका मूल प्रश्न, सटीक कार्ड और चारों उत्तर अब एक जुड़े हुए पैटर्न का हिस्सा हैं. गहरी व्यक्तिगत रीडिंग इस संदर्भ को जोड़कर व्यावहारिक अगला कदम दे सकती है. अपनी उपयुक्त गहराई चुनें; रीडिंग लगभग 90 मिनट में ईमेल से मिलेगी.',
    offerButton: 'मेरी व्यक्तिगत रीडिंग के साथ जारी रखें',
    handoffTitle: 'आपकी पूरी बातचीत गहरी रीडिंग के लिए तैयार है',
    handoffMessage: 'आपका मूल प्रश्न, सटीक कार्ड और चारों उत्तर इस ऑर्डर से सुरक्षित रूप से जुड़े रहेंगे. आपको फिर से समझाना नहीं पड़ेगा.',
    curiosityKicker: 'आपके कार्ड में एक सूत्र अभी भी अनसुलझा है',
    curiosityButton: 'इसे मेरा दूसरा प्रश्न बनाएं',
    curiosityEditNote: 'यह नीचे पहले से लिखा है. भेजने से पहले आप इसे संपादित कर सकते हैं.',
    localizedCuriosityQuestion: 'अगला कदम उठाने से पहले कार्ड आपको किस व्यवहार को देखने के लिए कहते हैं?',
  };
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(String(options.body));
    requests.push(body);
    return requests.length === 1
      ? modelResponse('{"code":"hi","language":"Hindi"', 'length', body.max_tokens)
      : modelResponse(JSON.stringify(hindiUi), 'stop', 1120);
  };

  const result = await detectQuestionLanguage(
    'क्या मुझे इस रिश्ते में धैर्य रखना चाहिए?',
    environment,
    'What behavior should I observe before taking the next step?',
  );

  assert.equal(requests.length, 2);
  assert.equal(environment.claims.length, 2);
  assert.equal(requests[0].max_tokens, 1400);
  assert.equal(requests[1].max_tokens, 2200);
  assert.deepEqual(requests[0].response_format, { type: 'json_object' });
  assert.deepEqual(requests[1].response_format, { type: 'json_object' });
  assert.match(requests[1].messages[0].content, /every exact required key/i);
  assert.equal(result.code, 'hi');
  assert.equal(result.isEnglish, false);
  assert.match(result.acknowledgement, /\p{Script=Devanagari}/u);
  assert.match(result.localizedCuriosityQuestion, /\?$/);
});
