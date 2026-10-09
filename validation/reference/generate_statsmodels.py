"""Reference regressions from statsmodels for the validation suite `scoring` (wave 2, slice 2):
validation/reference/statsmodels.json.

Run from the repository root:

    uv run --python 3.12 --with statsmodels==0.15.0 --with scipy==1.18.1 --with numpy==2.5.3 --with pandas==3.0.6 python validation/reference/generate_statsmodels.py

For the synthetic time-series fixture (validation/fixtures/time-series.csv, made by
make-time-series.mjs), each replicate, each variant fitted on the time points where it was
counted (its first among them, three or more in all), as research.md §2.1 defines Enrich2's
regression:

    y_t = ln(c_t + 0.5) - ln r_t,   v_t = 1/(c_t + 0.5) + 1/r_t,   w_t = 1/v_t (OLS: 1),   x_t = t / max t

with r_t the wild type's count + 0.5 ('wt'), or the sum over the variants counted at every time
+ 0.5 ('complete'); max t over the replicate's times. Stored per method, replicate and variant:

- slope and bse: statsmodels' WLS (or OLS) with an intercept, its residual-scaled standard error;
- se_counting: the slope's standard error from counting alone, (A diag(v) Aᵀ)[1,1]^½ with
  A = (XᵀWX)⁻¹XᵀW, computed here with numpy;
- chi2: Σ e²/v / (n − 2), the departure from the fitted line against counting noise;
- n: the time points used.

Numbers rounded to 15 significant digits.
"""

import csv
import hashlib
import json
import math
import os
import platform
from datetime import date
from importlib import metadata

import numpy as np
import statsmodels.api as sm

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
FIXTURES = os.path.join(ROOT, "validation", "fixtures")
OUT = os.path.join(ROOT, "validation", "reference", "statsmodels.json")
P = 0.5
METHODS = [("WLS", "wt"), ("OLS", "wt"), ("WLS", "complete"), ("OLS", "complete")]


def sha256(path):
    with open(path, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()


def number(x):
    return None if x is None or math.isnan(x) else float(f"{float(x):.15g}")


def read(path):
    with open(path, newline="") as f:
        rows = list(csv.DictReader(f))
    return rows


def count(value):
    return float("nan") if value in ("", "NA") else float(value)


def fit_replicate(rows, design, replicate, scoring, logr):
    samples = {s["id"]: s for s in design["samples"]}
    points = sorted(replicate["timepoints"], key=lambda p: p["time"])
    times = np.array([p["time"] for p in points], dtype=float)
    columns = [samples[p["sample"]]["columns"][0] for p in points]
    names = [row[design["variants"]["column"]] for row in rows]
    c = np.array([[count(row[col]) for col in columns] for row in rows])
    every = ~np.isnan(c).any(axis=1)
    if logr == "wt":
        w_row = names.index(design["controls"]["wildType"])
        r = c[w_row] + P
    else:
        r = c[every].sum(axis=0) + P
    x_all = times / times.max()
    out = {}
    for i, name in enumerate(names):
        use = ~np.isnan(c[i])
        if not use[0] or use.sum() < 3:
            continue
        x = x_all[use]
        cp = c[i][use] + P
        y = np.log(cp) - np.log(r[use])
        v = 1 / cp + 1 / r[use]
        w = 1 / v if scoring == "WLS" else np.ones_like(v)
        X = sm.add_constant(x)
        res = sm.WLS(y, X, weights=w).fit()
        W = np.diag(w)
        A = np.linalg.inv(X.T @ W @ X) @ X.T @ W
        se_counting = math.sqrt((A @ np.diag(v) @ A.T)[1, 1])
        chi2 = float(((y - res.fittedvalues) ** 2 / v).sum() / (use.sum() - 2))
        out[name] = [number(res.params[1]), number(res.bse[1]), number(se_counting), number(chi2), int(use.sum())]
    return out


def main():
    design_path = os.path.join(FIXTURES, "time-series.design.json")
    counts_path = os.path.join(FIXTURES, "time-series.csv")
    with open(design_path) as f:
        design = json.load(f)
    rows = read(counts_path)
    versions = {name: metadata.version(name) for name in ("statsmodels", "numpy", "scipy", "pandas")}
    versions["python"] = platform.python_version()
    out = {
        "about": "statsmodels regressions of the synthetic time-series fixture, made by validation/reference/generate_statsmodels.py. "
                 "Per method and replicate, per variant: [slope, bse (residual-scaled), se_counting, chi2 / (n - 2), n].",
        "generated": date.today().isoformat(),
        "versions": versions,
        "countsSha256": sha256(counts_path),
        "designSha256": sha256(design_path),
        "methods": {},
    }
    for scoring, logr in METHODS:
        out["methods"][f"{scoring}/{logr}"] = {r["id"]: fit_replicate(rows, design, r, scoring, logr) for r in design["replicates"]}
    with open(OUT, "w") as f:
        json.dump(out, f, separators=(",", ":"))
        f.write("\n")
    print(f"wrote {OUT} ({os.path.getsize(OUT) / 1e3:.0f} kB)")


if __name__ == "__main__":
    main()
