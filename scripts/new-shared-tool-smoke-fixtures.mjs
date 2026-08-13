const fixture = (resultContext, signals, scope = '', confidence = '') => Object.freeze({
  resultContext,
  context: `${resultContext}${scope ? ` Reading scope: ${scope}.` : ''}${confidence ? ` Calculation confidence: ${confidence}.` : ''}`,
  signals,
  scope,
  confidence,
});

export const NEW_SHARED_TOOL_SMOKE_FIXTURES = Object.freeze({
  '/pages/name-numerology-calculator': fixture(
    'Calculation input: normalized birth name <TEST PERSON>; birth date 1990-01-15. Method: Pythagorean letter values; master numbers 11, 22, and 33 preserved during final reductions.',
    'Life Path: 8; Expression: 7; Soul Urge: 7; Personality: 9; Birthday: 6',
    'A synthesis of the five deterministic Pythagorean numerology scores shown above, applied to the selected focus with practical reflection prompts.',
    'Deterministic symbolic calculation; numerology is not scientifically validated.',
  ),
  '/pages/personal-year-calculator': fixture(
    'Calculation input: birth date 1990-01-15; target year 2026. Method: reduced birth month + reduced birth day + reduced universal year; master numbers 11, 22, and 33 preserved.',
    'Personal Year: 8; Target Year: 2026; Universal Year: 1; Life Path: 8',
    'A timing-focused numerology reflection for the selected target year, including its month sequence, priorities, cautions and practical planning prompts.',
    'Deterministic symbolic calculation; timing themes are reflective, not predictive.',
  ),
  '/pages/karmic-debt-calculator': fixture(
    'Calculation input: birth date 1970-02-09; normalized birth name not provided. Method: Birth Day, Life Path compound, and optional Pythagorean Expression compound checked for 13, 14, 16, and 19.',
    'Karmic Debt Numbers: 19; Birth Day Compound: 9; Life Path Compound: 19; Life Path: 1; Expression Compound: Not provided',
    'A non-punitive reflection on the explicitly checked compound-number positions and a practical habit to test in the selected focus.',
    'Deterministic symbolic check; karmic debt is a tradition-specific belief, not a scientific fact.',
  ),
  '/pages/destiny-matrix-calculator': fixture(
    'Calculation input: birth date 1990-01-15. Method: Deckaura 22-energy matrix; values above 22 are reduced by digit sum until 1–22.',
    'Day Energy: 15; Month Energy: 1; Year Energy: 19; Core Energy: 8; Love Line: 5; Money Line: 9; Karmic Tail: 16-20-9',
    'A synthesis of the seven visible Deckaura 22-energy positions, their Major Arcana archetypes and practical reflection prompts for the selected focus.',
    'Deterministic Deckaura symbolic matrix; not a standardized or scientifically validated system.',
  ),
  '/pages/aura-color-quiz': fixture(
    'AQ1 deterministic reflective quiz. Answer vector AQ1:0-1-2-3-0-1-6. Primary blue 9. Secondary indigo 8. Score vector violet:6|indigo:8|blue:9|green:6|yellow:1|orange:4|red:8.',
    'Aura quiz version: AQ1; Answer vector: AQ1:0-1-2-3-0-1-6; Primary aura: blue|9; Secondary aura: indigo|8; Score vector: violet:6|indigo:8|blue:9|green:6|yellow:1|orange:4|red:8; Questions answered: 7/7',
    'Apply the AQ1 color-archetype pattern only to the user-selected reflective focus. Do not present an energy-field measurement, health assessment, diagnosis, fixed identity or guaranteed outcome.',
    'Deterministic AQ1 scoring from seven canonical answer indices; symbolic self-reflection only.',
  ),
  '/pages/chakra-test': fixture(
    'CT1 deterministic reflective test. Answer vector CT1:0-1-2-3-0-1-2-3-0-1-2-3-0-1. Reflection focus root 1/6. Strongest sacral 5/6. Score vector root:1|sacral:5|solar:1|heart:5|throat:1|third-eye:5|crown:1.',
    'Chakra test version: CT1; Answer vector: CT1:0-1-2-3-0-1-2-3-0-1-2-3-0-1; Reflection focus: root|1/6|17%; Strongest signal: sacral|5/6|83%; Score vector: root:1|sacral:5|solar:1|heart:5|throat:1|third-eye:5|crown:1; Questions answered: 14/14',
    'Apply the CT1 symbolic themes only to the user-selected reflective focus. Do not claim a blocked chakra, energy diagnosis, medical or mental-health assessment, treatment effect, fixed identity or guaranteed outcome.',
    'Deterministic CT1 scoring from 14 canonical 0-3 answer indices; symbolic self-reflection only.',
  ),
  '/pages/midheaven-calculator': fixture(
    'Canonical inputs — birth=1990-01-15; localTime=12:00; utcOffset=+2; longitude=+28.9784.',
    'Midheaven: 21.82° Capricorn; UTC birth moment: 1990-01-15T10:00Z; Birth longitude: +28.9784°',
    'Tropical Midheaven sign and degree only; no houses or complete natal chart.',
    'Astronomy-derived; exact time, UTC offset and longitude supplied.',
  ),
  '/pages/mars-sign-calculator': fixture(
    'Canonical inputs — birth=1990-01-15; localTime=12:00; utcOffset=+2.',
    'Mars placement: 19.85° Sagittarius; Mars motion: Direct; UTC birth moment: 1990-01-15T10:00Z',
    'Tropical geocentric Mars placement and motion only.',
    'Astronomy Engine ephemeris; exact UTC birth moment.',
  ),
  '/pages/mercury-sign-calculator': fixture(
    'Canonical inputs — birth=1990-01-15; localTime=12:00; utcOffset=+2.',
    'Mercury placement: 11.40° Capricorn; Mercury motion: Retrograde; UTC birth moment: 1990-01-15T10:00Z',
    'Tropical geocentric Mercury placement and motion only.',
    'Astronomy Engine ephemeris; exact UTC birth moment.',
  ),
  '/pages/chiron-sign-calculator': fixture(
    'Canonical input — birthDate=1990-01-15.',
    'Chiron sign: Cancer; Ephemeris date: 1990-01-15; Data source: NASA/JPL Horizons · daily geocentric ecliptic-of-date',
    'Chiron sign only; no degree, house or aspects.',
    'JPL daily sign interval; one-day boundary precision.',
  ),
  '/pages/transit-chart-calculator': fixture(
    'Canonical inputs — birth=1990-01-15; localTime=12:00; utcOffset=+2; transitDate=2026-08-12T12:00:00Z.',
    'Natal Sun: 24.99° Capricorn; Transit timestamp: 2026-08-12T12:00Z; Strongest transit: Neptune square natal Jupiter · orb 0.71°; Second transit: Mars conjunct natal Jupiter · orb 2.62°; Third transit: Saturn square natal Saturn · orb 2.79°',
    'Major geocentric aspects from transiting Mars–Pluto to natal Sun–Saturn; 3° orb; no houses.',
    'Astronomy Engine ephemeris; natal moment exact; transit evaluated 12:00 UTC.',
  ),
  '/pages/solar-return-chart-calculator': fixture(
    'Canonical inputs — birth=1990-01-15; localTime=12:00; utcOffset=+2; returnYear=2026.',
    'Natal Sun: 24.993° Capricorn; Solar return UTC: 2026-01-15T03:46Z; Return year: 2026; Longitude delta: 0.0000°',
    'Exact solar-longitude return moment only; no return houses or angles without return location.',
    'Astronomy Engine numerical search; minute-level return moment.',
  ),
  '/pages/astrocartography-calculator': fixture(
    'Canonical inputs — birth=1990-01-15; localTime=12:00; utcOffset=+2; latitude=+41.0082; longitude=+28.9784.',
    'City coordinates: +41.0082, +28.9784; Birth UTC: 1990-01-15T10:00Z; Closest angle: Sun near MC · 3.36°; Second angle: Saturn near MC · 4.86°',
    'Single-city angular proximity scan; no global map, parans or local-space lines.',
    'Astronomy-derived equatorial positions; exact supplied coordinates and birth moment.',
  ),
  '/pages/nakshatra-calculator': fixture(
    'Canonical inputs — birth=1990-01-15; localTime=12:00; utcOffset=+2.',
    'Janma Nakshatra: Purva Phalguni · Pada 3; Sidereal Moon: 22.75° Simha; Ayanamsa model: Lahiri-style · 23.71°; Birth UTC: 1990-01-15T10:00Z',
    'Sidereal Moon Nakshatra and pada only; no dashas, houses or full Jyotish chart.',
    'Astronomy Engine Moon plus date-adjusted Lahiri-style ayanamsa; boundary estimate.',
  ),
  '/pages/sade-sati-calculator': fixture(
    'Canonical inputs — birth=1990-01-15; localTime=12:00; utcOffset=+2; evaluationDate=2026-08-12.',
    'Natal Moon sign: Simha; Transit Saturn sign: Meena; Sade Sati status: Not active; Evaluation date: 2026-08-12',
    'Traditional three-sign Sade Sati status only; no dasha or event prediction.',
    'Astronomy Engine positions plus date-adjusted Lahiri-style ayanamsa.',
  ),
  '/pages/dream-interpreter': fixture(
    'Privacy-minimized result; Deckaura used allowlisted themes, tone and a length band to create this reflection. Raw dream text was not retained or attached to checkout.',
    'Dream themes: Water, Vehicle or journey; Emotional tone: curious; Dream length band: 50–149 words; Privacy mode: Temporary processing · raw dream excluded from storage, analytics and checkout',
    'Reflect only on allowlisted dream themes and the selected tone; no diagnosis, recovered-memory claim, factual third-party claim or prediction.',
    'Symbolic reflection generated from allowlisted themes; personal meaning may differ.',
  ),
  '/pages/i-ching-reading': fixture(
    'Six line values bottom-to-top=7,7,7,8,7,8; focus=general.',
    'Primary hexagram: 5 | Waiting | Water over Heaven; Changing lines: None; Relating hexagram: 5 | Waiting | Water over Heaven; Cast method: Three coins · Web Crypto',
    'King Wen hexagram identity, primary/relating trigram structure and changing lines only; no fabricated translated oracle passage.',
    'Independent cryptographic three-coin cast.',
  ),
  '/pages/pendulum-reading': fixture(
    'Privacy-minimized symbolic draw; raw free question not retained or transmitted.',
    'Pendulum answer: Unclear; Draw clarity: Open; Method: Web Crypto · balanced three-way draw; Question privacy: Local-only · raw question excluded',
    'Single symbolic three-way result; not factual prediction or high-stakes advice.',
    'Balanced cryptographic random draw.',
  ),
  '/pages/lenormand-reading': fixture(
    'Three unique card indexes=1,2,3; focus=general; raw question excluded.',
    'Situation card: Rider; Influence card: Clover; Direction card: Ship; Line theme: news · opportunity · movement; Question privacy: Local-only · raw question excluded',
    'Three-card Lenormand line only; no factual claim about third parties or guaranteed outcome.',
    'Without-replacement cryptographic draw from canonical 36-card deck.',
  ),
});
