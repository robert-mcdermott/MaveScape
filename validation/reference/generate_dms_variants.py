"""Reference scores from dms_variants for the validation suite `scoring` (validation/reference/dms_variants.json
and dms_variants-barcodes.json).

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

The barcode fixture (validation/fixtures/barcodes.csv and barcodes.map.csv, made by
make-barcodes.mjs; wave 2, slice 4) is scored as dms_variants is meant to be used: a
CodonVariantTable of each library's barcodes and their codon substitutions (from the map, leaving
out the barcodes it gives two variants and those it does not name, as MaveScape does), each
library's counts before and after selection added as samples "pre" and "post", and func_scores run
by barcode and by aa_substitutions (counts summed per substitution), pseudocount 0.5, natural
logarithms, the wild type's barcodes (no codon substitution) summed as the normalizer. The table's
variant_counts (dms_variants' own long layout) is written as validation/fixtures/
barcodes.variant_counts.csv.gz, for MaveScape's import of that layout.
"""

import csv
import gzip
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
OUT_BARCODES = os.path.join(ROOT, "validation", "reference", "dms_variants-barcodes.json")
OUT_COUNTS = os.path.join(FIXTURES, "barcodes.variant_counts.csv.gz")


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


def barcodes():
    with open(os.path.join(FIXTURES, "barcodes.design.json")) as f:
        design = json.load(f)
    with open(os.path.join(FIXTURES, "barcodes.csv"), newline="") as f:
        counts = list(csv.DictReader(f))
    with open(os.path.join(FIXTURES, "barcodes.map.csv"), newline="") as f:
        mapping = list(csv.DictReader(f))
    geneseq = design["targets"][0]["sequence"]
    replicates = design["replicates"]
    # The map: barcodes it gives two different variants are left out.
    variants = {}
    conflicts = set()
    for r in mapping:
        b = r["barcode"]
        if b in variants and variants[b] != r["codon_substitutions"]:
            conflicts.add(b)
        variants.setdefault(b, r["codon_substitutions"])
    # Each counted barcode's library: the replicate whose samples count it.
    library_of = {}
    for r in counts:
        for rep in replicates:
            if r[rep["input"]] not in ("", "NA"):
                library_of[r["barcode"]] = rep["id"]
    work = tempfile.mkdtemp(prefix="mavescape-dmsv-barcodes-")
    variant_file = os.path.join(work, "variants.csv")
    kept = [r for r in counts if r["barcode"] in variants and r["barcode"] not in conflicts]
    with open(variant_file, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["library", "barcode", "substitutions", "variant_call_support"])
        for r in kept:
            w.writerow([library_of[r["barcode"]], r["barcode"], variants[r["barcode"]], 1])
    table = CodonVariantTable(barcode_variant_file=variant_file, geneseq=geneseq, substitutions_are_codon=True)
    rows = []
    for r in kept:
        rep = next(x for x in replicates if x["id"] == library_of[r["barcode"]])
        rows.append({"library": rep["id"], "sample": "pre", "barcode": r["barcode"], "count": int(r[rep["input"]])})
        rows.append({"library": rep["id"], "sample": "post", "barcode": r["barcode"], "count": int(r[rep["output"]])})
    table.add_sample_counts_df(pd.DataFrame(rows))
    libraries = [rep["id"] for rep in replicates]
    out = {
        "about": "dms_variants func_scores (pseudocount 0.5, logbase e, the wild type's barcodes summed) of validation/fixtures/barcodes.csv with barcodes.map.csv applied, "
                 "made by validation/reference/generate_dms_variants.py: per library (replicate), by barcode (each barcode's score and variance) and by aa_substitutions "
                 "(counts summed per substitution; the empty substitution is the wild type with the synonymous variants). Numbers rounded to 13 significant digits.",
        "generated": date.today().isoformat(),
        "versions": {"dms_variants": metadata.version("dms_variants"), "pandas": metadata.version("pandas"), "python": platform.python_version()},
        "left_out": {"conflicts": len(conflicts), "unmapped": sum(1 for r in counts if r["barcode"] not in variants)},
        "barcode": {},
        "substitution": {},
    }
    by_barcode = table.func_scores("pre", pseudocount=0.5, by="barcode", libraries=libraries, logbase=math.e)
    by_aa = table.func_scores("pre", pseudocount=0.5, by="aa_substitutions", libraries=libraries, logbase=math.e)
    for lib in libraries:
        b = by_barcode[by_barcode["library"] == lib]
        out["barcode"][lib] = {"barcode": list(b["barcode"]), "score": [number(x) for x in b["func_score"]], "var": [number(x) for x in b["func_score_var"]]}
        a = by_aa[by_aa["library"] == lib]
        out["substitution"][lib] = {"aa_substitutions": list(a["aa_substitutions"]), "score": [number(x) for x in a["func_score"]], "var": [number(x) for x in a["func_score_var"]],
                                    "pre_count": [int(x) for x in a["pre_count"]], "post_count": [int(x) for x in a["post_count"]]}
    with open(OUT_BARCODES, "w") as f:
        json.dump(out, f, separators=(",", ":"))
        f.write("\n")
    print(f"wrote {OUT_BARCODES}")
    # dms_variants' own layout of the counts, for MaveScape's import (mtime 0: the same bytes each time).
    text = table.variant_count_df.to_csv(index=False, lineterminator="\n")
    with open(OUT_COUNTS, "wb") as raw:
        with gzip.GzipFile(fileobj=raw, mode="wb", mtime=0, filename="") as f:
            f.write(text.encode())
    print(f"wrote {OUT_COUNTS}")


if __name__ == "__main__":
    main()
    barcodes()
