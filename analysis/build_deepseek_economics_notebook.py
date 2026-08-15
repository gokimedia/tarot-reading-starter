from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

import nbformat as nbf
from nbclient import NotebookClient


HERE = Path(__file__).resolve().parent
NOTEBOOK = HERE / "deepseek-model-quality-economics-20260815.ipynb"
SUMMARY = HERE / "deepseek-model-quality-economics-summary-20260815.json"


mapping = {
    "en_contact": {"A": "pro_full", "B": "flash_control"},
    "en_feelings": {"A": "flash_control", "B": "pro_full"},
    "en_career": {"A": "pro_full", "B": "flash_control"},
    "tr_contact": {"A": "flash_control", "B": "pro_full"},
    "tr_feelings": {"A": "pro_full", "B": "flash_control"},
    "tr_decision": {"A": "flash_control", "B": "pro_full"},
    "es_contact": {"A": "pro_full", "B": "flash_control"},
    "es_career": {"A": "flash_control", "B": "pro_full"},
    "pt_feelings": {"A": "pro_full", "B": "flash_control"},
    "pt_decision": {"A": "flash_control", "B": "pro_full"},
    "de_contact": {"A": "pro_full", "B": "flash_control"},
    "de_decision": {"A": "flash_control", "B": "pro_full"},
}

benchmark_usage = [
    {
        "variant": "flash_control", "model": "DeepSeek Flash", "answers": 12, "calls": 19,
        "input_tokens": 31697, "cached_input_tokens": 27520, "uncached_input_tokens": 4177,
        "output_tokens": 4250, "legacy_cost_micros": 1861, "avg_call_latency_ms": 4179.4,
        "median_call_latency_ms": 3842.0, "p95_call_latency_ms": 5860.8,
    },
    {
        "variant": "pro_full", "model": "DeepSeek Pro", "answers": 12, "calls": 19,
        "input_tokens": 31642, "cached_input_tokens": 24832, "uncached_input_tokens": 6810,
        "output_tokens": 4397, "legacy_cost_micros": 6887, "avg_call_latency_ms": 4986.1,
        "median_call_latency_ms": 4907.0, "p95_call_latency_ms": 6485.5,
    },
]

production_usage = [
    {"stage": "initial", "model": "DeepSeek Flash", "calls": 3394, "cost_micros": 776850, "avg_cost_micros": 228.89, "median_latency_ms": 2858.5, "p95_latency_ms": 3883.7},
    {"stage": "length retry", "model": "DeepSeek Flash", "calls": 38, "cost_micros": 10971, "avg_cost_micros": 288.71, "median_latency_ms": 3919.5, "p95_latency_ms": 5300.8},
    {"stage": "quality retry", "model": "DeepSeek Flash", "calls": 585, "cost_micros": 143429, "avg_cost_micros": 245.18, "median_latency_ms": 2869.0, "p95_latency_ms": 4029.4},
]

historical_cohorts = [
    {"cohort": "Flash-only", "readings": 7197, "orders": 12, "observed_purchase_pct": 0.167, "gross_revenue_usd": 117.81, "avg_ai_cost_micros": 252.76},
    {"cohort": "Historical Pro rescue selected", "readings": 290, "orders": 0, "observed_purchase_pct": 0.0, "gross_revenue_usd": 0.0, "avg_ai_cost_micros": 1052.20},
]

pricing = {
    "Legacy recomputed (15 Aug)": {
        "flash_control": {"cached": 0.0028, "uncached": 0.14, "output": 0.28},
        "pro_full": {"cached": 0.003625, "uncached": 0.435, "output": 0.87},
    },
    "16 Aug off-peak": {
        "flash_control": {"cached": 0.007, "uncached": 0.22, "output": 0.66},
        "pro_full": {"cached": 0.022, "uncached": 0.66, "output": 1.98},
    },
    "16 Aug peak": {
        "flash_control": {"cached": 0.014, "uncached": 0.44, "output": 1.32},
        "pro_full": {"cached": 0.044, "uncached": 1.32, "output": 3.96},
    },
}

BASELINE_PURCHASE_PCT = historical_cohorts[0]["observed_purchase_pct"]

nb = nbf.v4.new_notebook()
nb["metadata"] = {
    "kernelspec": {"display_name": "Python 3", "language": "python", "name": "python3"},
    "language_info": {"name": "python", "version": "3"},
}

nb["cells"] = [
    nbf.v4.new_markdown_cell(
        "# DeckAura DeepSeek Model Quality & Unit Economics — 15 Aug 2026\n\n"
        "Reproducible offline comparison of the free-reading Flash control and full-Pro challenger. "
        "The same 12 synthetic questions, card positions and orientations were used across EN/TR/ES/PT/DE. "
        "Model identities were hidden from the judge."
    ),
    nbf.v4.new_markdown_cell(
        "## tl;dr\n\n"
        "Pro has a modest offline quality edge, but it is not yet a proven commercial winner. Both variants still have card-specific hard failures and frequent deterministic fallbacks. "
        "The incremental model cost is tiny relative to a paid order, so a fixed randomized experiment should choose the winner on contribution profit per assigned eligible visitor, not on token price or historical rescue cohorts."
    ),
    nbf.v4.new_markdown_cell(
        "## Context & Methods\n\n"
        "This is an offline diagnostic plus unit-economics analysis for the free-reading answer stage. "
        "Blind quality uses five equally weighted 1–5 dimensions: directness, card evidence, groundedness, language naturalness and useful next step. "
        "Technical results come from the same endpoint contract used for both variants. Token costs are computed from observed benchmark token counts. "
        "Re-running requires Python 3 with pandas, matplotlib and IPython; the two source JSON files must remain beside the notebook.\n\n"
        "### Key Assumptions\n\n"
        f"- Historical Flash-only purchase rate ({BASELINE_PURCHASE_PCT:.3f}%) is context, not a causal baseline.\n"
        "- Break-even examples use net contribution per verified order after discounts, refunds, payment fees and fulfillment—not gross checkout price.\n"
        "- The new DeepSeek schedule is effective 16 Aug 2026 at 16:00 UTC. Its peak rates apply 01:00–04:00 and 06:00–10:00 UTC; off-peak rates apply outside those windows.\n"
        "- `reading_id LIKE 'benchmark_%'` is synthetic traffic and must be excluded from online conversion analysis."
    ),
    nbf.v4.new_code_cell(
        "from pathlib import Path\n"
        "import json\n"
        "import pandas as pd\n"
        "import matplotlib.pyplot as plt\n"
        "from IPython.display import display, Markdown\n\n"
        "HERE = Path.cwd()\n"
        "benchmark = json.loads((HERE / 'deepseek-model-benchmark-20260815.json').read_text(encoding='utf-8'))\n"
        "judgement = json.loads((HERE / 'deepseek-model-blind-judgement-fixed-20260815.json').read_text(encoding='utf-8'))\n"
        f"mapping = {mapping!r}\n"
        f"benchmark_usage = {benchmark_usage!r}\n"
        f"production_usage = {production_usage!r}\n"
        f"historical_cohorts = {historical_cohorts!r}\n"
        f"pricing = {pricing!r}\n"
        f"BASELINE_PURCHASE_PCT = {BASELINE_PURCHASE_PCT!r}\n"
        "pd.set_option('display.max_columns', 30)"
    ),
    nbf.v4.new_markdown_cell(
        "## Data\n\n"
        "Inputs are the saved 12-fixture benchmark, its fixed blind judgement, exact benchmark token/cost aggregates from `deckaura.ai_usage_events`, seven-day production usage aggregates and a 14-day observational purchase cohort. "
        "The assertions below make missing fixtures, incomplete arms and token-accounting mismatches fail loudly."
    ),
    nbf.v4.new_code_cell(
        "assert len(mapping) == 12\n"
        "assert len(judgement['cases']) == 12\n"
        "assert set(mapping) == {case['fixtureId'] for case in judgement['cases']}\n"
        "assert all(set(sides.values()) == {'flash_control', 'pro_full'} for sides in mapping.values())\n"
        "assert len(benchmark['results']) == 24\n"
        "assert set(row['variant'] for row in benchmark['results']) == {'flash_control', 'pro_full'}\n"
        "assert all(row['cached_input_tokens'] + row['uncached_input_tokens'] == row['input_tokens'] for row in benchmark_usage)\n"
        "print('Input checks passed: 12 fixtures, 24 answers, both variants, balanced token accounting.')"
    ),
    nbf.v4.new_markdown_cell(
        "## Results\n\n"
        "### 1. Blind answer quality\n\n"
        "Scores are decoded only after judging. A hard failure marks missing or incorrect card-specific evidence; it is a guardrail, not another averaged dimension."
    ),
    nbf.v4.new_code_cell(
        "dims = ['directness','card_evidence','groundedness','language_naturalness','useful_next_step']\n"
        "rows = []\n"
        "winner_counts = {'flash_control': 0, 'pro_full': 0, 'tie': 0}\n"
        "for case in judgement['cases']:\n"
        "    fixture = case['fixtureId']\n"
        "    for side in ['A','B']:\n"
        "        variant = mapping[fixture][side]\n"
        "        scores = case['scores'][side]\n"
        "        rows.append({'fixture': fixture, 'variant': variant, **scores, 'hard_fail': bool(case['hard_failures'][side])})\n"
        "    pref = case['preference']\n"
        "    winner_counts['tie' if pref == 'tie' else mapping[fixture][pref]] += 1\n"
        "blind = pd.DataFrame(rows)\n"
        "blind_summary = blind.groupby('variant').agg(**{d:(d,'mean') for d in dims}, hard_fails=('hard_fail','sum')).reset_index()\n"
        "blind_summary['mean_score'] = blind_summary[dims].mean(axis=1)\n"
        "blind_summary['wins'] = blind_summary['variant'].map(winner_counts)\n"
        "blind_summary['ties'] = winner_counts['tie']\n"
        "display(blind_summary.round(3))"
    ),
    nbf.v4.new_markdown_cell(
        "### 2. Technical contract and fallback rate\n\n"
        "A technical pass means the endpoint response satisfied the contract and safety audit. Deterministic fallback frequency remains an important quality guardrail even when the request technically passes."
    ),
    nbf.v4.new_code_cell(
        "technical = pd.DataFrame(benchmark['results'])\n"
        "technical_summary = technical.groupby('variant').agg(answers=('fixtureId','size'), technical_passes=('audit', lambda s: sum(bool(x.get('ok')) for x in s)), deterministic_fallbacks=('servedModel', lambda s: sum(x == 'deterministic' for x in s)), mean_endpoint_ms=('latencyMs','mean')).reset_index()\n"
        "technical_summary['technical_pass_rate_pct'] = 100 * technical_summary['technical_passes'] / technical_summary['answers']\n"
        "technical_summary['fallback_rate_pct'] = 100 * technical_summary['deterministic_fallbacks'] / technical_summary['answers']\n"
        "display(technical_summary.round(2))"
    ),
    nbf.v4.new_markdown_cell(
        "### 3. Observed and scheduled model cost\n\n"
        "The first row uses exact observed database cost. The legacy recomputation and 16 Aug scenarios apply published rates to the same observed cached, uncached and output tokens, isolating the pricing effect."
    ),
    nbf.v4.new_code_cell(
        "usage = pd.DataFrame(benchmark_usage)\n"
        "cost_rows = []\n"
        "for _, row in usage.iterrows():\n"
        "    cost_rows.append({'variant': row['variant'], 'model': row['model'], 'pricing_window': 'Observed / legacy DB', 'cost_per_answer_usd': row['legacy_cost_micros'] / 1_000_000 / row['answers']})\n"
        "    for window, rates_by_variant in pricing.items():\n"
        "        rates = rates_by_variant[row['variant']]\n"
        "        micros = row['cached_input_tokens'] * rates['cached'] + row['uncached_input_tokens'] * rates['uncached'] + row['output_tokens'] * rates['output']\n"
        "        cost_rows.append({'variant': row['variant'], 'model': row['model'], 'pricing_window': window, 'cost_per_answer_usd': micros / 1_000_000 / row['answers']})\n"
        "costs = pd.DataFrame(cost_rows)\n"
        "scenario_order = ['Observed / legacy DB', *pricing.keys()]\n"
        "display(costs.pivot(index='pricing_window', columns='model', values='cost_per_answer_usd').reindex(scenario_order).round(6))"
    ),
    nbf.v4.new_code_cell(
        "fig, axes = plt.subplots(1, 2, figsize=(12, 4.2))\n"
        "q = blind_summary.set_index('variant').loc[['flash_control','pro_full']]\n"
        "axes[0].bar(['Flash','Pro'], q['mean_score'], color=['#5875A4','#D18F5F'])\n"
        "axes[0].set_ylim(0,5); axes[0].set_ylabel('Mean blind score (1–5)'); axes[0].set_title('Blind answer-quality score')\n"
        "for i,v in enumerate(q['mean_score']): axes[0].text(i, v+0.06, f'{v:.2f}', ha='center')\n"
        "pivot = costs.pivot(index='pricing_window', columns='model', values='cost_per_answer_usd').reindex(scenario_order)\n"
        "pivot.plot(kind='bar', ax=axes[1], color=['#5875A4','#D18F5F'])\n"
        "axes[1].set_xlabel(''); axes[1].set_ylabel('USD per answer'); axes[1].set_title('Observed tokens under each price window'); axes[1].tick_params(axis='x', rotation=20); axes[1].legend(title='')\n"
        "plt.tight_layout(); plt.show()"
    ),
    nbf.v4.new_markdown_cell(
        "### 4. Break-even conversion lift\n\n"
        "Absolute lift is the additional paid-order percentage points needed for Pro to cover its incremental AI cost. Relative lift compares that absolute requirement with the observational 0.167% Flash-only purchase rate; it is a planning ratio, not a forecast."
    ),
    nbf.v4.new_code_cell(
        "break_even_rows = []\n"
        "for window in scenario_order:\n"
        "    p = costs[costs.pricing_window == window].set_index('variant').cost_per_answer_usd\n"
        "    delta = p['pro_full'] - p['flash_control']\n"
        "    for margin in [5,10,15]:\n"
        "        lift_fraction = delta / margin\n"
        "        absolute_lift_pp = 100 * lift_fraction\n"
        "        break_even_rows.append({'pricing_window':window,'net_contribution_per_order_usd':margin,'incremental_cost_usd':delta,'absolute_cvr_lift_pp':absolute_lift_pp,'relative_lift_pct_vs_0_167_baseline':100*absolute_lift_pp/BASELINE_PURCHASE_PCT,'one_extra_order_per_answers':1/lift_fraction})\n"
        "break_even = pd.DataFrame(break_even_rows)\n"
        "display(break_even.round({'incremental_cost_usd':6,'absolute_cvr_lift_pp':5,'relative_lift_pct_vs_0_167_baseline':2,'one_extra_order_per_answers':0}))"
    ),
    nbf.v4.new_markdown_cell(
        "### 5. Historical conversion context\n\n"
        "These are observational cohorts. The Pro-rescue group was selected after earlier difficulty/failure, so comparing its purchase rate with Flash-only traffic creates selection bias."
    ),
    nbf.v4.new_code_cell(
        "hist = pd.DataFrame(historical_cohorts)\n"
        "display(hist)\n"
        "display(Markdown('**Important:** the historical Pro-rescue rows are a selected failure cohort, not a randomized experiment; their zero purchases do not prove that Pro reduces conversion.'))"
    ),
    nbf.v4.new_markdown_cell(
        "## Takeaways\n\n"
        "Use the offline benchmark to decide whether Pro is safe and promising enough to test—not to declare a revenue winner. Online assignment must be stable for the full test, and purchase attribution must inner-join the server assignment by `reading_id + variant`. "
        "Primary KPI: `(net contribution from verified orders − all AI cost) / assigned eligible visitors`. Guardrails: card-evidence hard failures, deterministic fallback, private-state/safety violations, wrong language/card, p95 latency, errors/timeouts, abandonment, refunds and disputes."
    ),
    nbf.v4.new_code_cell(
        "pro = blind_summary.set_index('variant').loc['pro_full']\n"
        "flash = blind_summary.set_index('variant').loc['flash_control']\n"
        "off = costs[costs.pricing_window == '16 Aug off-peak'].set_index('variant').cost_per_answer_usd\n"
        "delta = off['pro_full'] - off['flash_control']\n"
        "display(Markdown(f'''## Decision\n\n"
        "- **Offline quality:** Pro won {int(pro.wins)} cases, Flash won {int(flash.wins)}, and {int(pro.ties)} tied. Mean score was {pro.mean_score:.2f} vs {flash.mean_score:.2f}.\n"
        "- **Guardrail:** Pro still had {int(pro.hard_fails)} card-evidence hard failures vs {int(flash.hard_fails)} for Flash; model replacement alone does not solve the answer system.\n"
        "- **Cost:** observed 16 Aug off-peak incremental cost is about ${delta:.6f} per free answer. At $15 net contribution per order, break-even needs only {100*delta/15:.4f} percentage points of absolute conversion lift.\n"
        "- **Recommendation:** keep Flash as control, deploy attribution and quality telemetry, then run a fixed server-side experiment. Do not change the assignment threshold mid-test; use a new experiment version for any ramp. Choose the winner on contribution profit per assigned eligible visitor, with safety, fallback, latency and refund guardrails.''' ))"
    ),
    nbf.v4.new_markdown_cell(
        "## Sources and limitations\n\n"
        "- DeepSeek account overview inspected read-only on 15 Aug 2026; no API key was created or changed.\n"
        "- Supabase `deckaura.ai_usage_events`: 7-day production usage and the 03:09–03:14 UTC benchmark window; `reading_id LIKE 'benchmark_%'` is synthetic and must be excluded from online winner analysis.\n"
        "- Supabase `deckaura.funnel_events`: verified Shopify purchase events and gross line revenue. Gross revenue is not net contribution; discounts, refunds, payment fees and paid-reading fulfillment costs must be subtracted.\n"
        "- Official DeepSeek pricing: https://api-docs.deepseek.com/quick_start/pricing/ (effective-window rates captured 15 Aug 2026).\n"
        "- Twelve offline fixtures are diagnostic, not statistically sufficient to establish conversion lift. Historical Pro rescue usage is selection-biased.\n"
        "- Benchmark cache-hit rates are unusually high, so the scenario costs should be treated as observed-case estimates rather than guaranteed production averages."
    ),
]

nbf.write(nb, NOTEBOOK)
executed = NotebookClient(nb, timeout=300, kernel_name="python3", resources={"metadata": {"path": str(HERE)}}).execute()
nbf.write(executed, NOTEBOOK)

# Materialize compact, privacy-safe values used by the native report artifact.
score_rows = []
judgement_data = json.loads((HERE / "deepseek-model-blind-judgement-fixed-20260815.json").read_text(encoding="utf-8"))
winner_counts = {"flash_control": 0, "pro_full": 0, "tie": 0}
for case in judgement_data["cases"]:
    for side in ("A", "B"):
        variant = mapping[case["fixtureId"]][side]
        scores = case["scores"][side]
        score_rows.append({
            "fixture": case["fixtureId"],
            "variant": variant,
            "mean_score": sum(scores.values()) / len(scores),
            "hard_fail": bool(case["hard_failures"][side]),
            **scores,
        })
    preference = case["preference"]
    winner_counts["tie" if preference == "tie" else mapping[case["fixtureId"]][preference]] += 1

dimensions = ("directness", "card_evidence", "groundedness", "language_naturalness", "useful_next_step")
quality_summary = []
for variant in ("flash_control", "pro_full"):
    variant_rows = [row for row in score_rows if row["variant"] == variant]
    dimension_means = {
        dimension: sum(row[dimension] for row in variant_rows) / len(variant_rows)
        for dimension in dimensions
    }
    quality_summary.append({
        "variant": variant,
        **dimension_means,
        "mean_score": sum(dimension_means.values()) / len(dimensions),
        "hard_fails": sum(row["hard_fail"] for row in variant_rows),
        "wins": winner_counts[variant],
        "ties": winner_counts["tie"],
    })

cost_rows = []
for usage_row in benchmark_usage:
    cost_rows.append({
        "variant": usage_row["variant"],
        "model": usage_row["model"],
        "pricing_window": "Observed / legacy DB",
        "cost_per_answer_usd": usage_row["legacy_cost_micros"] / 1_000_000 / usage_row["answers"],
    })
    for window, rates_by_variant in pricing.items():
        rates = rates_by_variant[usage_row["variant"]]
        cost_micros = (
            usage_row["cached_input_tokens"] * rates["cached"]
            + usage_row["uncached_input_tokens"] * rates["uncached"]
            + usage_row["output_tokens"] * rates["output"]
        )
        cost_rows.append({
            "variant": usage_row["variant"],
            "model": usage_row["model"],
            "pricing_window": window,
            "cost_per_answer_usd": cost_micros / 1_000_000 / usage_row["answers"],
        })

break_even_rows = []
for window in ("Observed / legacy DB", *pricing.keys()):
    window_costs = {
        row["variant"]: row["cost_per_answer_usd"]
        for row in cost_rows
        if row["pricing_window"] == window
    }
    incremental_cost = window_costs["pro_full"] - window_costs["flash_control"]
    for margin in (5, 10, 15):
        lift_fraction = incremental_cost / margin
        absolute_lift_pp = 100 * lift_fraction
        break_even_rows.append({
            "pricing_window": window,
            "net_contribution_per_order_usd": margin,
            "incremental_cost_usd": incremental_cost,
            "absolute_cvr_lift_pp": absolute_lift_pp,
            "relative_lift_pct_vs_0_167_baseline": 100 * absolute_lift_pp / BASELINE_PURCHASE_PCT,
            "one_extra_order_per_answers": 1 / lift_fraction,
        })

summary = {
    "generated_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    "data_as_of": "2026-08-15T03:14:00Z",
    "score_rows": score_rows,
    "quality_summary": quality_summary,
    "winner_counts": winner_counts,
    "technical_rows": [
        {"variant": "flash_control", "answers": 12, "technical_passes": 12, "deterministic_fallbacks": 10, "mean_endpoint_ms": 11910},
        {"variant": "pro_full", "answers": 12, "technical_passes": 12, "deterministic_fallbacks": 7, "mean_endpoint_ms": 13040},
    ],
    "benchmark_usage": benchmark_usage,
    "pricing": pricing,
    "cost_rows": cost_rows,
    "break_even_rows": break_even_rows,
    "production_usage": production_usage,
    "historical_cohorts": historical_cohorts,
    "experiment_notes": {
        "primary_kpi": "Contribution profit per assigned eligible visitor",
        "synthetic_exclusion": "Exclude reading_id LIKE 'benchmark_%' from online winner analysis",
        "purchase_attribution": "Inner-join verified purchase to server assignment by reading_id + variant",
        "selection_bias": "Historical Pro rescue is a selected failure cohort and is not causal evidence",
        "cache_caveat": "Benchmark cache-hit rates are unusually high; scenario costs are observed-case estimates",
    },
}
SUMMARY.write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(NOTEBOOK)
print(SUMMARY)
