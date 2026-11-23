"""Render the measured trajectories, paired 30-day comparison and portable report.

python3 -m pip install matplotlib
python3 scripts/plot-brake-demand.py [evidence-directory]
"""
import base64
import csv
from decimal import Decimal, ROUND_HALF_UP
import html
import json
from pathlib import Path
import statistics as stats
import sys

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

root = Path(sys.argv[1] if len(sys.argv) > 1 else "docs/evidence/braking-rhythm")
baseline = json.loads((root / "baseline.json").read_text())["rows"]
tuned = json.loads((root / "tuned.json").read_text())["rows"]
assert len(baseline) == len(tuned) == 30
assert [r["seed"] for r in baseline] == [r["seed"] for r in tuned]
old, new = "#316b83", "#b44520"
plt.rcParams.update({"font.family": "DejaVu Sans", "font.size": 10, "axes.spines.top": False, "axes.spines.right": False, "axes.titleweight": "bold", "figure.facecolor": "#fffdf8", "axes.facecolor": "#fffdf8", "savefig.facecolor": "#fffdf8"})

def median(rows, key):
    return stats.median(r["demand"][key] for r in rows)

def repeat(row):
    d = row["demand"]
    return d.get("repeatedExcess", max(0, d["excess"] - max(0, d["longest"] - 5)))

def save(fig, name):
    fig.savefig(root / f"{name}.png", dpi=170, bbox_inches="tight")
    svg_path = root / f"{name}.svg"
    fig.savefig(svg_path, bbox_inches="tight")
    svg_path.write_text("\n".join(line.rstrip() for line in svg_path.read_text().splitlines()) + "\n")
    plt.close(fig)

fig, axes = plt.subplots(1, 2, figsize=(12, 12), sharey=True)
y = np.arange(30)
for ax, metric, title in zip(axes, [lambda r: r["demand"]["longest"], repeat], ["Longest interval without useful braking", "Excess in repeated intervals over 5 seconds"]):
    a, b = [metric(r) for r in baseline], [metric(r) for r in tuned]
    for i, (left, right) in enumerate(zip(a, b)):
        ax.plot([left, right], [i, i], color="#bfc4c3", lw=1.7, zorder=1)
    ax.scatter(a, y, color=old, s=34, label="Baseline V6", zorder=2)
    ax.scatter(b, y, color=new, s=24, marker="D", label="Tuned V7", zorder=3)
    ax.set_title(title, loc="left", pad=14, fontsize=11)
    ax.set_xlabel("Seconds")
    ax.grid(axis="x", color="#dfe3e2", lw=0.6)
    ax.set_ylim(29.8, -0.8)
    ax.set_xlim(left=-0.25)
axes[0].axvline(5, color="#9c9c98", ls="--", lw=1)
axes[0].set_yticks(y, [f'{r["day"][5:]}  {r["family"]}' for r in baseline], fontsize=9)
axes[0].legend(loc="upper right", frameon=False)
fig.suptitle("The Daily Lap · next 30 daily seeds", x=0.025, ha="left", fontsize=19, fontweight="bold", y=0.995)
fig.text(0.025, 0.962, "2026-11-24 through 2026-12-23 · same seed pairs · authoritative 120 Hz physics", fontsize=10)
fig.text(0.025, 0.008, "Repeated excess = Σ max(0, interval − 5s), after allowing one longest breather per lap.\nIntervals include GO and the road finish; tiny releases (<0.2s) do not reset them. Estimates from a bounded clean reference, not optimal human play.", fontsize=9, color="#4d5859")
fig.tight_layout(rect=(0, 0.045, 1, 0.945))
save(fig, "comparison-30-days")

families = ["technical", "switchbacks", "sweeping", "ridge", "crossover"]
indices = [next(i for i, r in enumerate(baseline) if r["family"] == f) for f in families]
fig, axes = plt.subplots(5, 1, figsize=(12, 10), sharex=True)
for ax, index, family in zip(axes, indices, families):
    for row, level, color in [(baseline[index], 1, old), (tuned[index], 0, new)]:
        demand = row["demand"]
        ax.hlines(level, 0, demand["run"]["seconds"], color="#bac1be", lw=1)
        # Pale approach grouping; solid release inputs inside that validated group.
        for event in demand["validated"]:
            ax.broken_barh([(event["start"], event["end"] - event["start"])], (level - 0.24, 0.48), facecolor=color, alpha=0.18)
        for point in demand["run"]["trace"]:
            t = point["tick"] / 120
            if not point["held"] and any(e["start"] <= t <= e["end"] for e in demand["validated"]):
                ax.broken_barh([(t, 0.1)], (level - 0.24, 0.48), facecolor=color)
        ax.plot(demand["run"]["seconds"], level, "|", ms=15, color=color)
        ax.text(demand["run"]["seconds"] + 0.35, level, f'{demand["run"]["seconds"]:.2f}s', va="center", fontsize=8, color=color)
    ax.set_title(f'{baseline[index]["day"]} · {family}', loc="left", fontsize=11, pad=5)
    ax.set_yticks([1, 0], ["Baseline", "Tuned"])
    ax.set_ylim(-0.55, 1.55)
    ax.grid(axis="x", color="#e2e6e3", lw=0.7)
    ax.spines["left"].set_visible(False)
axes[-1].set_xlabel("Seconds from GO (countdown excluded; each run ends at its road finish)")
axes[-1].set_xlim(0, max(baseline[i]["demand"]["run"]["seconds"] for i in indices) + 3.5)
fig.suptitle("When the reference driver benefits from releasing", x=0.025, ha="left", fontsize=18, fontweight="bold", y=0.995)
fig.text(0.025, 0.956, "Solid bars: useful grounded brake input. Pale bars: approach group (gaps ≤0.75s). Grey: effective throttle interval.", fontsize=10)
fig.text(0.025, 0.008, "Each coloured approach passed a hold-through counterfactual: ≥0.05s slower, >0.1s extra off-road, or extra recovery.\nThe representative is the first occurrence of each family, selected before looking at its improvement.", fontsize=9, color="#4d5859")
fig.tight_layout(rect=(0, 0.05, 1, 0.94))
save(fig, "braking-over-lap-time")

fig, axes = plt.subplots(5, 2, figsize=(10, 13))
for row_index, (index, family) in enumerate(zip(indices, families)):
    for col, rows in enumerate([baseline, tuned]):
        row, ax = rows[index], axes[row_index, col]
        points = row["samples"]
        x, z, height = [p["x"] for p in points], [p["z"] for p in points], [p["y"] for p in points]
        ax.plot(x + [x[0]], z + [z[0]], color="#c0c9c4", lw=3)
        image = ax.scatter(x, z, c=height, cmap="viridis", vmin=0, vmax=18, s=5, zorder=2)
        ax.scatter([x[0]], [z[0]], color="#172421", marker="s", s=24, zorder=3)
        ax.set_aspect("equal")
        ax.axis("off")
        ax.set_title(f'{family} · {row["length"]:.0f}m · {"V6" if col == 0 else "V7"}', loc="left", fontsize=10)
fig.suptitle("Layout families, elevation and localized bridge retained", x=0.025, ha="left", fontsize=17, fontweight="bold", y=0.995)
fig.text(0.025, 0.964, "Black square = GO / finish. Colour = road elevation (dark 0m → yellow 18m). Each map fits its panel; lengths are labelled.", fontsize=9)
fig.tight_layout(rect=(0, 0, 1, 0.95))
save(fig, "layout-comparison")

columns = ["day", "family", "baseline_lap_s", "tuned_lap_s", "baseline_longest_s", "tuned_longest_s", "baseline_excess_over_5_s", "tuned_excess_over_5_s", "baseline_repeated_excess_s", "tuned_repeated_excess_s", "baseline_brake_fraction", "tuned_brake_fraction"]
with (root / "comparison.csv").open("w") as handle:
    writer = csv.writer(handle, lineterminator="\n")
    writer.writerow(columns)
    for a, b in zip(baseline, tuned):
        writer.writerow([a["day"], a["family"], a["demand"]["run"]["seconds"], b["demand"]["run"]["seconds"], a["demand"]["longest"], b["demand"]["longest"], a["demand"]["excess"], b["demand"]["excess"], repeat(a), repeat(b), a["demand"]["brakeFraction"], b["demand"]["brakeFraction"]])

metrics = [
    ("Median longest interval", median(baseline, "longest"), median(tuned, "longest"), "s"),
    ("Worst longest interval", max(r["demand"]["longest"] for r in baseline), max(r["demand"]["longest"] for r in tuned), "s"),
    ("Repeated excess, all 30 laps", sum(map(repeat, baseline)), sum(map(repeat, tuned)), "s"),
    ("All excess over 5s, all 30 laps", sum(r["demand"]["excess"] for r in baseline), sum(r["demand"]["excess"] for r in tuned), "s"),
    ("Median brake duty", 100 * median(baseline, "brakeFraction"), 100 * median(tuned, "brakeFraction"), "%"),
    ("Maximum brake duty", 100 * max(r["demand"]["brakeFraction"] for r in baseline), 100 * max(r["demand"]["brakeFraction"] for r in tuned), "%"),
    ("Median reference lap", stats.median(r["demand"]["run"]["seconds"] for r in baseline), stats.median(r["demand"]["run"]["seconds"] for r in tuned), "s"),
]
(root / "summary.json").write_text(json.dumps({"metrics": [{"metric": k, "baseline": a, "tuned": b, "unit": u} for k, a, b, u in metrics]}, indent=2) + "\n")

def decimal2(value):
    return str(Decimal(str(round(value, 8))).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))

table = "".join(f"<tr><th>{k}</th><td>{decimal2(a)}{u}</td><td>{decimal2(b)}{u}</td></tr>" for k, a, b, u in metrics)
images = "".join(f'<figure><img alt="{html.escape(title)}" src="data:image/png;base64,{base64.b64encode((root / (name + ".png")).read_bytes()).decode()}"></figure>' for name, title in [("comparison-30-days", "Paired metrics for the next thirty daily seeds"), ("braking-over-lap-time", "Estimated useful braking against elapsed lap seconds for five representative families"), ("layout-comparison", "Baseline and tuned layout families with elevation")])
report = f'''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>The Daily Lap — braking rhythm tuning</title><style>body{{font:17px/1.55 system-ui,sans-serif;color:#18332d;background:#fffdf8;margin:0 auto;padding:48px 28px;max-width:1080px}}h1{{font-size:36px;line-height:1.15}}h2{{font-size:24px;margin-top:40px}}.eyebrow{{letter-spacing:.12em;text-transform:uppercase;font-size:12px;color:#51665f}}p{{max-width:900px}}table{{border-collapse:collapse;width:100%;font-size:15px;margin:28px 0}}th,td{{border-bottom:1px solid #d7dfd8;padding:10px;text-align:right}}th:first-child{{text-align:left}}figure{{margin:36px 0}}img{{width:100%;height:auto}}code{{font-size:13px;overflow-wrap:anywhere}}.note{{background:#edf1e9;padding:18px 24px;border-radius:8px}}a{{color:#226b80}}</style><body>
<div class="eyebrow">Request date: 23 November 2026 · local tuning pass · estimates from actual game physics</div>
<h1>More useful braking, with room to accelerate</h1>
<p>Version 7 shortens the switchback and ridge layouts, tightens their broad return lobes, and makes the sweeping family’s first corner require a real release. Technical routes and the localized crossover geometry stay the same. The five families, elevation, five gap-jump days and six overpass days remain represented in the next thirty daily seeds.</p>
<table><thead><tr><th>Metric</th><th>Baseline V6</th><th>Tuned V7</th></tr></thead><tbody>{table}</tbody></table>
<p class="note">Each counted brake approach was tested by holding throttle through it in the same physics, then resuming the spatial reference inputs. The baseline and tuned references finish all 30 laps and every checkpoint, with zero off-road or recovery ticks. The target was median longest interval below 7s, at least 50% less excess beyond 5s, and brake duty below 25%. The median remains close to, but above, the 7s target; the excess and density targets pass.</p>
{images}
<p>Longest interval improves on 18 days, stays within 0.025s on 11, and worsens by 0.45s on December 6. Repeated excess worsens on four days. The additional 100-seed campaign passes all existing acceptance gates; 38 focused tests, TypeScript, lint and the production build pass. No human or physical-device rhythm test is claimed.</p>
<h2>What changed</h2><p>The recipe is now <code>linked-circuits-v7</code>. Sweeping length is 620–690m (previously 640–710m), switchbacks 640–710m (760–830m), and ridge 650–720m (740–810m). The existing broad lobes receive small control-point adjustments. The current controls, traction, acceleration, braking, launch bonus, drift behavior, hill formula and jump physics are unchanged. Version 6 remains reconstructible with its original acceptance policy, hashes and replay ticks.</p>
<h2>What the measurement means</h2><p>This is a bounded estimate of useful braking by a competent driver, not proof of globally mandatory inputs or an optimal lap. A 1m backward speed envelope proposes inputs using grip, braking, drag and grade. Twenty grip/lead settings plus the existing searched driver are compared with the authoritative 120Hz simulation. Candidate inputs are converted to spatial windows with a speed floor so counterfactuals cannot stall in a release zone. The selected clean reference is pruned of unhelpful approaches. Holding through each retained approach must lose at least 0.05s, add more than 0.1s of off-road travel, or add a recovery; faster but less stable holds are labelled accordingly in the raw evidence.</p>
<p>Releases shorter than 0.2s and ineffective airborne releases do not create demand. Releases at most 0.75s apart form one approach. The clock begins at GO after a legal last-second countdown press, includes initial acceleration, and stops at the grounded road finish after every checkpoint. It is a single standing scored lap, so the end is not joined to the next start and the preview does not brake for a fictitious next lap. Jump launch/run-out windows retain full throttle.</p>
<p>“All excess” sums <code>max(0, interval − 5s)</code>. “Repeated excess” additionally allows the longest interval as one deliberate breather per lap. A long opening acceleration or final run still counts toward the longest interval. The 30-day campaign also informs tuning, so it is not an independent statistical holdout. The additional 100 seeds validate acceptance and route safety rather than detailed brake demand. Maps are independently fitted and lengths are labelled: some improvement comes from shorter routes. Human late-braking skill, touch comfort and perceived rhythm remain unmeasured.</p>
<h2>Source and release provenance</h2><p>Baseline: <code>c155dce88db80e011b2c102c4f55fd086661f6b8</code>, current <code>origin/main</code> when this pass started. The <a href="https://github.com/kickflip-games/reddit_racer/actions/runs/45144117112">release run</a> identifies <code>the-daily-lap@0.0.20261123</code> as source <code>e2af8a205695a09ced4ea9e13cba4058b8fdb3ae</code>. Only dependencies and minimap/release checks differ from that source; gameplay source is identical. This evidence does not independently establish which version is installed.</p>
<h2>Reproduce locally</h2><p>Branch: <code>feature/braking-rhythm-tuning</code>. From the committed checkout with Node 24.22.2: <code>npm ci --ignore-scripts</code>, then <code>npx tsx scripts/brake-demand-report.ts baseline</code> and <code>npx tsx scripts/brake-demand-report.ts tuned</code>. Run <code>npx tsx scripts/brake-demand-coverage.ts</code> for the additional 100-seed acceptance campaign. With matplotlib installed, run <code>python3 scripts/plot-brake-demand.py</code> to rebuild this self-contained report and all figures. Raw JSON, per-event counterfactuals, a CSV comparison and figures are under <code>docs/evidence/braking-rhythm/</code>.</p>
<p>All changes are local to an isolated worktree. Today’s live race was not accessed or modified. No remote push, merge, new private app, hosted test environment or production release was performed.</p></body></html>'''
(root / "braking-rhythm-report.html").write_text(report)
print(json.dumps({"files": [str(root / "braking-rhythm-report.html"), str(root / "comparison-30-days.png"), str(root / "braking-over-lap-time.png"), str(root / "layout-comparison.png")], "metrics": metrics}))
