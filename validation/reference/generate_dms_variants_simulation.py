"""Simulated experiments from dms_variants, an independent simulator, for the coverage suite
(validation/coverage.mjs, wave 2 slice 9): validation/reference/dms_variants-simulation.json.

Run from the repository root:

    uv run --python 3.12 --with dms_variants==1.6.0 python validation/reference/generate_dms_variants_simulation.py

dms_variants (Bloom lab; GPLv3, used here as an external reference only, never ported) simulates a
barcoded codon-variant library (simulate_CodonVariantTable: a 40-codon gene, 40,000 barcodes, a
Poisson number of codon mutations per variant, mean 1), a phenotype for every amino-acid variant
(SigmoidPhenotypeSimulator, whose observedEnrichment is the variant's enrichment relative to the
wild type), and counts (simulateSampleCounts): one pre-selection sample, drawn once, and three
selections from the same library, each through its own bottleneck and with its own noise. The three
replicates therefore share their input sample, as in many experiments (BRCA1's among them). Its
noise multiplies a barcode's enrichment by a random variable of mean 1, and its bottleneck samples
the library's frequencies, not the pre-selection counts: a model independent of MaveScape's own
simulator (web/lib/simulate.js).

Counts are summed over each variant's barcodes (its amino-acid substitutions; synonymous codon
changes count as the wild type); the wild type and single substitutions are kept (a double mutant
here is mostly one barcode). The truth of a
variant is the natural log of its observed enrichment. Numbers rounded to 13 significant digits.
"""

import json
import math
import os
import platform
from datetime import date

import dms_variants
import dms_variants.simulate
import numpy

OUT = os.path.join(os.path.dirname(__file__), "dms_variants-simulation.json")
THREE = {
    "A": "Ala", "R": "Arg", "N": "Asn", "D": "Asp", "C": "Cys", "Q": "Gln", "E": "Glu", "G": "Gly",
    "H": "His", "I": "Ile", "L": "Leu", "K": "Lys", "M": "Met", "F": "Phe", "P": "Pro", "S": "Ser",
    "T": "Thr", "W": "Trp", "Y": "Tyr", "V": "Val", "*": "Ter",
}

# Each scenario: three selections from one shared pre-selection sample.
SCENARIOS = [
    ("counting", "counting noise alone", {"noise": 0, "bottleneck": None}),
    ("bottleneck", "a bottleneck of 100,000 cells (about 2.5 per barcode) into each selection", {"noise": 0, "bottleneck": 100000}),
    ("noise", "selection noise: each barcode's enrichment times a random variable of mean 1 and SD 0.3", {"noise": 0.3, "bottleneck": None}),
]


def hgvs(subs):
    if not subs:
        return "p.="
    parts = []
    for s in subs.split():
        wt, pos, mut = s[0], s[1:-1], s[-1]
        parts.append(f"{THREE[wt]}{pos}{THREE[mut]}")
    return f"p.{parts[0]}" if len(parts) == 1 else f"p.[{';'.join(parts)}]"


def sig(x):
    return float(f"{x:.13g}")


def main():
    rng = numpy.random.default_rng(20261009)
    codons = [c for c in dms_variants.constants.CODONS if dms_variants.constants.CODON_TO_AA[c] != "*"]
    geneseq = "ATG" + "".join(rng.choice(codons, 39))
    out = {
        "generated": str(date.today()),
        "versions": {"dms_variants": dms_variants.__version__, "numpy": numpy.__version__, "python": platform.python_version()},
        "gene": geneseq,
        "scenarios": [],
    }
    for k, (name, description, post) in enumerate(SCENARIOS):
        seed = 100 + k
        table = dms_variants.simulate.simulate_CodonVariantTable(
            geneseq=geneseq, bclen=16, library_specs={"lib_1": {"avgmuts": 1.0, "nvariants": 40000}}, seed=seed,
        )
        phenosim = dms_variants.simulate.SigmoidPhenotypeSimulator(geneseq, seed=seed)
        counts = dms_variants.simulate.simulateSampleCounts(
            variants=table,
            phenotype_func=phenosim.observedEnrichment,
            variant_error_rate=0,
            pre_sample={"total_count": 1_000_000, "uniformity": 5},
            pre_sample_name="pre",
            post_samples={f"rep{r}": {"total_count": 1_000_000, **post} for r in (1, 2, 3)},
            seed=seed,
        )
        bv = table.barcode_variant_df[["barcode", "aa_substitutions", "n_aa_substitutions"]]
        merged = counts.merge(bv, on="barcode")
        merged = merged[merged.n_aa_substitutions <= 1]
        wide = merged.pivot_table(index="aa_substitutions", columns="sample", values="count", aggfunc="sum", fill_value=0)
        samples = ["pre", "rep1", "rep2", "rep3"]
        variants = []
        for subs, row in wide.iterrows():
            if row["pre"] == 0:
                continue
            variants.append({
                "hgvs": hgvs(subs),
                "counts": [int(row[s]) for s in samples],
                "truth": sig(math.log(phenosim.observedEnrichment(subs))),
            })
        variants.sort(key=lambda v: v["hgvs"])
        out["scenarios"].append({"name": name, "description": description, "seed": seed, "samples": samples, "variants": variants})
        print(f"{name}: {len(variants)} variants")
    with open(OUT, "w") as f:
        json.dump(out, f, separators=(",", ":"))
        f.write("\n")
    print(f"wrote {OUT} ({os.path.getsize(OUT)} bytes)")


if __name__ == "__main__":
    main()
