"""SciPy's Mann–Whitney test and Benjamini–Hochberg adjustment on seeded data sets
(validation/reference/mannwhitney.json).

Run from the repository root (any Python with SciPy and NumPy; `python -m venv env &&
env/bin/pip install scipy`):

    env/bin/python -I validation/reference/generate_mannwhitney.py

Structure as evidence (web/lib/structure-evidence.js) compares the scores of each structural
class with the rest by Mann–Whitney's test, two-sided, by the normal approximation with the
correction for ties and for continuity, and adjusts the p-values by Benjamini and Hochberg. Each
data set here is drawn with a fixed seed: two groups of position scores of unequal sizes, some with
ties (scores rounded, as published scores often are), one group shifted; small and large, a group
of three. SciPy's mannwhitneyu (method 'asymptotic', use_continuity True) gives the first group's U
and p; false_discovery_control (method 'bh') the adjusted p of each set of tests. MaveScape must give
the same (validation suite `structures`).
"""

import datetime
import json
import os

import numpy as np
import scipy
from scipy import stats

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, "validation", "reference", "mannwhitney.json")


def case(rng, n1, n2, shift, decimals):
    a = rng.normal(shift, 1.0, n1)
    b = rng.normal(0.0, 1.0, n2)
    if decimals is not None:
        a = np.round(a, decimals)
        b = np.round(b, decimals)
    result = stats.mannwhitneyu(a, b, alternative="two-sided", method="asymptotic", use_continuity=True)
    return {"a": a.tolist(), "b": b.tolist(), "u": float(result.statistic), "p": float(result.pvalue)}


def main():
    rng = np.random.default_rng(20261012)
    specs = [
        (3, 40, -1.0, None), (17, 39, -1.5, 2), (158, 119, -0.6, 2), (100, 96, 0.0, 1), (23, 173, -0.2, None),
        (8, 8, 0.5, 0), (61, 299, -0.8, 3), (5, 6, 0.0, 1),
    ]
    cases = [case(rng, n1, n2, shift, decimals) for n1, n2, shift, decimals in specs]
    ps = [c["p"] for c in cases]
    out = {
        "source": "scipy.stats.mannwhitneyu(a, b, alternative='two-sided', method='asymptotic', use_continuity=True): U of a, p; scipy.stats.false_discovery_control(p, method='bh') over the cases' p",
        "generated": datetime.date.today().isoformat(),
        "tool": {"name": "scipy", "version": scipy.__version__, "numpy": np.__version__},
        "cases": cases,
        "bh": stats.false_discovery_control(ps, method="bh").tolist(),
    }
    with open(OUT, "w") as f:
        json.dump(out, f, indent=1)
        f.write("\n")
    print(len(cases), "cases")


if __name__ == "__main__":
    main()
