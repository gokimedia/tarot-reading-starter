import assert from 'node:assert/strict';
import test from 'node:test';

import {
  detectQuestionLanguage,
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
