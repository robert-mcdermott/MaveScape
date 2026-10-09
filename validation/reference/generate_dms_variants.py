"""Reference scores from dms_variants for the validation suite `scoring` (validation/reference/dms_variants.json).

Run from the repository root:

    uv run --python 3.12 --with dms_variants==1.6.0 python validation/reference/generate_dms_variants.py

dms_variants (Bloom lab; GPLv3, used here as an external reference only, never ported) scores
codon variants by barcode. The synthetic two-population fixture (validation/fixtures/
two-population.csv, made by make-two-population.mjs) gives each variant as a codon substitution
(column `codon`), so a CodonVariantTable is built with one barcode per variant, the counts of each
replicate's input and output added as samples (technical replicates summed, as the fixture's design
says), and CodonVariantTable.func_scores run per replicate with pseudocount 0.5 and natural
logarithms (logbase e). Its formula is Enrich2's wild-type ratio:

    f = ln[((n_post + p) / (n_post,wt + p)) / ((n_pre + p) / (n_pre,wt + p))],
    var = 1/(n_post + p) + 1/(n_post,wt + p) + 1/(n_pre + p) + 1/(n_pre,wt + p).

A count the fixture does not give (NA) is passed as 0, which dms_variants cannot tell apart; those
rows are written as null and not compared. Numbers rounded to 13 significant digits.
"""

import csv
import json
import math
import os
import platform
import tempfile
from datetime import date
from importlib import metadata

import pandas as pd
from dms_variants.codonvarianttable import CodonVariantTable

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
FIXTURES = os.path.join(ROOT, "validation", "fixtures")
OUT = os.path.join(ROOT, "validation", "reference", "dms_variants.json")


def number(x):
    if x is None or (isinstance(x, float) and math.isnan(x)):
        return None
    return float(f"{float(x):.13g}")


def barcode(i):
    """A distinct 12-nt barcode for row i."""
    return "".join("ACGT"[(i >> (2 * k)) & 3] for k in range(12))


def main():
    with open(os.path.join(FIXTURES, "two-population.design.json")) as f:
        design = json.load(f)
    with open(os.path.join(FIXTURES, "two-population.csv"), newline="") as f:
        rows = list(csv.DictReader(f))
    samples = {s["id"]: s["columns"] for s in design["samples"]}
    geneseq = design["targets"][0]["sequence"]
    names = [r[design["variants"]["column"]] for r in rows]

    work = tempfile.mkdtemp(prefix="mavescape-dmsv-")
    variant_file = os.path.join(work, "variants.csv")
    with open(variant_file, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["library", "barcode", "substitutions", "variant_call_support"])
        for i, r in enumerate(rows):
            w.writerow(["lib", barcode(i), r["codon"], 1])
    table = CodonVariantTable(barcode_variant_file=variant_file, geneseq=geneseq, substitutions_are_codon=True)

    def sample_counts(sample_id):
        """Counts of a sample (technical replicates summed) and whether each row is given."""
        out, given = [], []
        for r in rows:
            values = [r[c] for c in samples[sample_id]]
            ok = all(v not in ("", "NA") for v in values)
            given.append(ok)
            out.append(sum(int(float(v)) for v in values) if ok else 0)
        return out, given

    counts = []
    given = {}
    for replicate in design["replicates"]:
        for role in ("input", "output"):
            sample_id = replicate[role]
            values, ok = sample_counts(sample_id)
            given[sample_id] = ok
            for i, value in enumerate(values):
                counts.append({"library": "lib", "sample": sample_id, "barcode": barcode(i), "count": value})
    table.add_sample_counts_df(pd.DataFrame(counts))

    out = {
        "about": "dms_variants func_scores (by barcode, pseudocount 0.5, logbase e) of validation/fixtures/two-population.csv, made by validation/reference/generate_dms_variants.py. "
                 "Per replicate, each variant's functional score and its variance, aligned with `variants`; null where the fixture does not give both counts. Numbers rounded to 13 significant digits.",
        "generated": date.today().isoformat(),
        "versions": {"dms_variants": metadata.version("dms_variants"), "pandas": metadata.version("pandas"), "python": platform.python_version()},
        "variants": names,
        "replicates": {},
    }
    index = {barcode(i): i for i in range(len(rows))}
    for replicate in design["replicates"]:
        pre, post = replicate["input"], replicate["output"]
        scores = table.func_scores({post: pre}, pseudocount=0.5, by="barcode", logbase=math.e)
        score = [None] * len(rows)
        var = [None] * len(rows)
        for _, r in scores.iterrows():
            i = index[r["barcode"]]
            if given[pre][i] and given[post][i]:
                score[i] = number(r["func_score"])
                var[i] = number(r["func_score_var"])
        out["replicates"][replicate["id"]] = {"score": score, "var": var}
    with open(OUT, "w") as f:
        json.dump(out, f, separators=(",", ":"))
        f.write("\n")
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
