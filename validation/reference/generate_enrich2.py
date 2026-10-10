"""Reference scores from Enrich2 for the validation suites (validation/reference/enrich2.json).

Run from the repository root, after `node validation/fetch.mjs`:

    uv run --python 3.12 --with enrich2==2.0.2 python validation/reference/generate_enrich2.py

Enrich2's configuration is built from MaveScape's own design files (validation/designs/), so the
reference also checks that a design carries everything Enrich2 needs: which columns are which
samples, replicates, times, the wild-type row. Enrich2 conventions, read from its source
(enrich2 2.0.2) and recorded in validation/README.md:

- An ID-only library reads a tab-separated file whose one column is headed `count` (its
  documentation says `counts`; issue #77), with integer counts.
- A variant missing from a time point's table is left out of that time point (and so dropped from
  the replicate's score); an explicit 0 is kept.
- Wild-type normalization needs a row named `_wt`; the design's wild-type identifier is renamed to
  it here and back in the output.
- Two-population replicates are written as time series of two points (input 0, output 1).
- Output folders are named by Enrich2's fix_filename (it drops "-" and other punctuation).
- Enrich2 compares conditions by z = |s₁ − s₂| / √(SE₁² + SE₂²) and its two-sided normal p
  (Experiment.calc_pvalues_pairwise), but its command never calls it (issue #59): for cases with two
  conditions the experiment is run through its Python API, as enrich_cmd runs it, and that method
  called after scoring.

The output holds, for every case and method, each replicate's score and SE and the combined
score, SE and epsilon (Enrich2's last change in the random-effects variance), column by column for
the case's list of variants, rounded to 13 significant digits, with the tool versions and the
inputs' SHA-256. Enrich2 always scores the whole table; for large tables the file keeps a fixed
subset of variants (KEEP below), which is enough to compare with and keeps the file small.
"""

import csv
import hashlib
import json
import math
import os
import platform
import shutil
import subprocess
import sys
import tempfile
from datetime import date
from importlib import metadata

import pandas as pd
from enrich2.storemanager import fix_filename

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
CACHE = os.path.join(ROOT, "validation", "cache")
DESIGNS = os.path.join(ROOT, "validation", "designs")
OUT = os.path.join(ROOT, "validation", "reference", "enrich2.json")


# (case, design file, counts file in the cache (or "fixtures/…"), [(scoring method, log-ratio method)])
CASES = [
    ("grb2-sh3", "grb2-sh3.design.json", "mavedb-grb2-sh3/counts.csv",
     [("ratios", "wt"), ("ratios", "complete"), ("ratios", "full")]),
    ("brca1-ring-e2", "brca1-ring-e2.design.json", "mavedb-brca1-ring/aa/counts.csv",
     [("WLS", "wt"), ("OLS", "wt"), ("ratios", "wt")]),
    ("brca1-ring-y2h", "brca1-ring-y2h.design.json", "mavedb-brca1-ring/aa/counts.csv",
     [("WLS", "wt")]),
    # The synthetic fixture with the PRD's edge cases (fixtures/make-two-population.mjs).
    ("two-population", "fixtures/two-population.design.json", "fixtures/two-population.csv",
     [("ratios", "wt"), ("ratios", "complete"), ("ratios", "full")]),
    # The synthetic time series: five unevenly spaced times, its edge cases planted
    # (fixtures/make-time-series.mjs).
    ("time-series", "fixtures/time-series.design.json", "fixtures/time-series.csv",
     [("WLS", "wt"), ("OLS", "wt"), ("WLS", "complete"), ("ratios", "wt")]),
    # Two conditions from shared inputs, with the differential's edge cases planted
    # (fixtures/make-two-condition.mjs): the conditions compared as well.
    ("two-condition", "fixtures/two-condition.design.json", "fixtures/two-condition.csv",
     [("ratios", "wt")]),
]

WT = "_wt"

# Which variants a case keeps: "all", or every n-th variant by name plus the wild-type and
# synonymous rows and the first `partial` variants (by name) missing from some replicates but not
# all (how missing counts are handled).
KEEP = {"grb2-sh3": "all", "two-population": "all", "time-series": "all", "two-condition": "all", "brca1-ring-e2": {"every": 6, "partial": 300}, "brca1-ring-y2h": {"every": 6, "partial": 300}}


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def number(x):
    """A float rounded to 13 significant digits, or None for NaN."""
    if x is None or (isinstance(x, float) and math.isnan(x)):
        return None
    return float(f"{float(x):.13g}")


def kept_variants(case, design, results):
    """The case's variant list: every variant scored anywhere, or the KEEP subset."""
    scored = set()
    for method in results.values():
        for replicate in method["replicates"].values():
            scored.update(replicate)
    names = sorted(scored)
    rule = KEEP[case]
    if rule == "all":
        return names
    controls = design.get("controls", {})
    special = {controls.get("wildType")} | set(controls.get("synonymous") if isinstance(controls.get("synonymous"), list) else [])
    first = next(iter(results.values()))["replicates"]
    partial = [n for n in names if 0 < sum(n in r for r in first.values()) < len(first)][: rule["partial"]]
    keep = set(names[:: rule["every"]]) | (special & scored) | set(partial)
    return [n for n in names if n in keep]


def columns(results, variants):
    """Per method: replicates' and conditions' values as columns aligned with `variants`."""
    out = {}
    for key, method in results.items():
        out[key] = {
            "replicates": {rep: {"score": [values.get(v, [None, None])[0] for v in variants],
                                 "se": [values.get(v, [None, None])[1] for v in variants]}
                           for rep, values in method["replicates"].items()},
            "combined": {cond: {"score": [values.get(v, [None] * 3)[0] for v in variants],
                                "se": [values.get(v, [None] * 3)[1] for v in variants],
                                "epsilon": [values.get(v, [None] * 3)[2] for v in variants]}
                         for cond, values in method["combined"].items()},
        }
        if method.get("pairwise"):
            out[key]["pairwise"] = {pair: {"z": [values.get(v, [None, None])[0] for v in variants],
                                           "p": [values.get(v, [None, None])[1] for v in variants]}
                                    for pair, values in method["pairwise"].items()}
    return out


def read_counts(path):
    with open(path, newline="") as f:
        return list(csv.DictReader(f))


def time_points(replicate):
    if "timepoints" in replicate:
        return [(t["sample"], int(t["time"])) for t in replicate["timepoints"]]
    return [(replicate["input"], 0), (replicate["output"], 1)]


def build_config(design, rows, workdir):
    """Writes one count file per (replicate, time) and returns Enrich2's experiment config."""
    variant_column = design["variants"]["column"]
    wild = design.get("controls", {}).get("wildType", "auto")
    samples = {s["id"]: s for s in design["samples"]}
    conditions = design.get("conditions") or [{"id": "all", "name": "all"}]
    os.makedirs(os.path.join(workdir, "counts"), exist_ok=True)
    config = {"name": "reference", "output directory": os.path.join(workdir, "out"), "conditions": []}
    for condition in conditions:
        selections = []
        for replicate in design["replicates"]:
            if replicate.get("condition", "all") != condition["id"]:
                continue
            libraries = []
            for sample_id, time in time_points(replicate):
                columns = samples[sample_id]["columns"]
                path = os.path.join(workdir, "counts", f"{replicate['id']}_t{time}.tsv")
                with open(path, "w") as f:
                    f.write("\tcount\n")
                    for row in rows:
                        values = [row[c] for c in columns]
                        # Missing in any technical replicate: missing (not zero) for the sample.
                        if any(v in ("", "NA") for v in values):
                            continue
                        total = sum(int(round(float(v))) for v in values)
                        name = row[variant_column]
                        if name == wild:
                            name = WT
                        f.write(f"{name}\t{total}\n")
                libraries.append({"name": f"{replicate['id']}_t{time}", "timepoint": time,
                                  "report filtered reads": False, "counts file": path, "identifiers": {}})
            selections.append({"name": replicate["id"], "libraries": libraries})
        config["conditions"].append({"name": condition["id"], "selections": selections})
    return config


def run_api(config, scoring, logr):
    """Runs the experiment as enrich_cmd does (Python API), then Enrich2's comparison of each pair
    of conditions; returns {"a|b": {variant: [z, p]}}."""
    from enrich2.experiment import Experiment
    obj = Experiment()
    obj.force_recalculate = False
    obj.component_outliers = False
    obj.scoring_method = scoring
    obj.logr_method = logr
    obj.plots_requested = False
    obj.tsv_requested = True
    obj.output_dir_override = False
    obj.configure(config)
    obj.validate()
    obj.store_open(children=True)
    try:
        obj.calculate()
        out = {}
        for label in obj.labels:
            if label == "barcodes":
                continue
            obj.calc_pvalues_pairwise(label)
            frame = obj.store["/main/{}/scores_pvalues".format(label)]
            for (c1, c2) in sorted({(a, b) for a, b, _ in frame.columns}):
                out[f"{c1}|{c2}"] = {name: [number(r[(c1, c2, "z")]), number(r[(c1, c2, "pvalue_raw")])] for name, r in frame.iterrows()}
        obj.write_tsv()
        return out
    finally:
        obj.store_close(children=True)


def run_case(design, rows, scoring, logr):
    workdir = tempfile.mkdtemp(prefix="mavescape-enrich2-")
    try:
        config = build_config(design, rows, workdir)
        config_path = os.path.join(workdir, "config.json")
        with open(config_path, "w") as f:
            json.dump(config, f)
        pairwise = None
        if len(config["conditions"]) > 1:
            pairwise = run_api(config, scoring, logr)
        else:
            enrich = shutil.which("enrich_cmd")
            subprocess.run([enrich, config_path, scoring, logr, "--no-plots"], check=True,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        tsv = os.path.join(workdir, "out", "tsv")
        wild = design.get("controls", {}).get("wildType", "auto")
        back = (lambda name: wild if name == WT and wild != "auto" else name)
        result = {"replicates": {}, "combined": {}}
        if pairwise is not None:
            result["pairwise"] = {pair: {back(name): values for name, values in table.items()} for pair, table in pairwise.items()}
        for condition in config["conditions"]:
            for selection in condition["selections"]:
                frame = pd.read_csv(os.path.join(tsv, f"{fix_filename(selection['name'])}_sel", "main_identifiers_scores.tsv"),
                                    sep="\t", index_col=0)
                result["replicates"][selection["name"]] = {
                    back(name): [number(r["score"]), number(r["SE"])] for name, r in frame.iterrows()}
            if len(condition["selections"]) > 1:
                frame = pd.read_csv(os.path.join(tsv, "reference_exp", "main_identifiers_scores.tsv"),
                                    sep="\t", index_col=0, header=[0, 1])
                part = frame[condition["name"]]
                result["combined"][condition["name"]] = {
                    back(name): [number(r["score"]), number(r["SE"]), number(r["epsilon"])]
                    for name, r in part.iterrows()}
        return result
    finally:
        shutil.rmtree(workdir, ignore_errors=True)


def main():
    versions = {name: metadata.version(name) for name in ("enrich2", "pandas", "numpy", "scipy", "statsmodels", "tables")}
    versions["python"] = platform.python_version()
    out = {
        "about": "Enrich2 scores of the validation data sets, made by validation/reference/generate_enrich2.py from MaveScape's design files. "
                 "Per case: `variants` (identifiers as in the table), and per method each replicate's score and SE and each condition's combined score, SE and epsilon, "
                 "as columns aligned with `variants` (null where Enrich2 gives none). Enrich2 scored the whole tables; `kept` says which variants are stored. "
                 "Numbers rounded to 13 significant digits.",
        "generated": date.today().isoformat(),
        "versions": versions,
        "cases": {},
    }
    for case, design_file, counts_file, methods in CASES:
        design_path = os.path.join(ROOT, "validation", design_file) if design_file.startswith("fixtures/") else os.path.join(DESIGNS, design_file)
        counts_path = os.path.join(ROOT, "validation", counts_file) if counts_file.startswith("fixtures/") else os.path.join(CACHE, counts_file)
        if not os.path.exists(counts_path):
            sys.exit(f"{counts_path} is missing: run node validation/fetch.mjs first")
        with open(design_path) as f:
            design = json.load(f)
        rows = read_counts(counts_path)
        results = {}
        for scoring, logr in methods:
            print(f"{case}: {scoring} {logr}", flush=True)
            results[f"{scoring}/{logr}"] = run_case(design, rows, scoring, logr)
        variants = kept_variants(case, design, results)
        out["cases"][case] = {"design": design_file, "counts": counts_file, "countsSha256": sha256(counts_path),
                              "designSha256": sha256(design_path), "rows": len(rows), "kept": KEEP[case],
                              "variants": variants, "methods": columns(results, variants)}
    with open(OUT, "w") as f:
        json.dump(out, f, separators=(",", ":"), sort_keys=False)
        f.write("\n")
    print(f"wrote {OUT} ({os.path.getsize(OUT) / 1e6:.1f} MB)")


if __name__ == "__main__":
    main()
