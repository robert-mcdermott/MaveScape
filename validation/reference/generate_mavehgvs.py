"""MAVE-HGVS reference judgments from mavehgvs (validation/reference/mavehgvs.json).

Run from the repository root, after `node validation/fetch.mjs`:

    uv run --python 3.12 --with mavehgvs==0.8.1 python validation/reference/generate_mavehgvs.py

mavehgvs (BSD-3, VariantEffect) defines MAVE-HGVS. Every string of a corpus is parsed by it, and
the result recorded: whether it is valid, the error otherwise, and for valid strings the prefix,
the canonical string (str(Variant)), the variant types, positions and sequences, and whether it is
synonymous or target-identical. web/lib/hgvs.js must agree on every string (validation suite
`hgvs`). The corpus:

- every string literal of mavehgvs's own tests at v0.8.1 (validation/reference/mavehgvs-tests/,
  downloaded by this script), as written and with each prefix in front;
- identifiers from the feasibility data (all of GRB2; a fixed sample of the others);
- variants generated from the grammar, valid and invalid, with a fixed seed;
- single-character edits of the above, with a fixed seed (near-misses).
"""

import csv
import json
import os
import random
import re
import urllib.request
from importlib import metadata

from mavehgvs import Variant
from mavehgvs.exceptions import MaveHgvsParseError

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
CACHE = os.path.join(ROOT, "validation", "cache")
OUT = os.path.join(ROOT, "validation", "reference", "mavehgvs.json")
TAG_COMMIT = "56e7fb11d1de9d0d2c8109266afed9ae4ca9c831"  # mavehgvs v0.8.1
TEST_FILES = ["tests/test_variant.py", "tests/test_patterns/test_dna.py",
              "tests/test_patterns/test_protein.py", "tests/test_patterns/test_rna.py",
              "tests/test_position.py"]
PREFIXES = ["c.", "g.", "m.", "n.", "o.", "p.", "r."]
AA = ["Ala", "Arg", "Asn", "Asp", "Cys", "Gln", "Glu", "Gly", "His", "Ile", "Leu", "Lys", "Met",
      "Phe", "Pro", "Ser", "Thr", "Trp", "Tyr", "Val", "Ter"]


def test_literals():
    out = []
    for path in TEST_FILES:
        url = f"https://raw.githubusercontent.com/VariantEffect/mavehgvs/{TAG_COMMIT}/{path}"
        text = urllib.request.urlopen(url).read().decode()
        out.extend(m.group(1) for m in re.finditer(r'"((?:[^"\\\n]|\\.){1,80})"', text))
    return out


def data_identifiers(rng):
    out = []
    samples = [("mavedb-grb2-sh3/counts.csv", None), ("mavedb-brca1-ring/aa/counts.csv", 2000),
               ("mavedb-brca1-ring/nt/counts.csv", 2000), ("mavedb-factor9/counts.csv", 1500)]
    for path, n in samples:
        with open(os.path.join(CACHE, path), newline="") as f:
            rows = list(csv.DictReader(f))
        names = sorted({r[c] for r in rows for c in ("hgvs_nt", "hgvs_pro") if r.get(c) not in (None, "", "NA")})
        out.extend(names if n is None else rng.sample(names, min(n, len(names))))
    return out


def position(rng, kind):
    p = str(rng.choice([1, 2, 3, 9, 10, 12, 27, 99, 100, 345, 1000]))
    if kind == "intron" and rng.random() < 0.5:
        p += rng.choice(["+", "-"]) + str(rng.choice([1, 2, 6, 15]))
    if kind == "utr":
        r = rng.random()
        if r < 0.25:
            p = "-" + p
        elif r < 0.5:
            p = "*" + p
        if rng.random() < 0.3:
            p += rng.choice(["+", "-"]) + str(rng.choice([1, 2, 6]))
    return p


def generated(rng, n):
    out = []
    for _ in range(n):
        prefix = rng.choice(PREFIXES)
        if prefix == "p.":
            a, b = rng.choice(AA), rng.choice(AA)
            i = rng.choice([1, 2, 12, 27, 99, 345])
            j = i + rng.choice([1, 1, 2, 5, -1, 0])
            body = rng.choice([
                f"{a}{i}{b}", f"{a}{i}=", "=", "(=)", f"{a}{i}_{b}{j}=", f"{a}{i}fs", f"{a}{i}del",
                f"{a}{i}_{b}{j}del", f"{a}{i}dup", f"{a}{i}_{b}{j}dup", f"{a}{i}_{b}{j}ins{rng.choice(AA)}{rng.choice(AA)}",
                f"{a}{i}delins{rng.choice(AA)}", f"{a}{i}_{b}{j}delins{rng.choice(AA)}", f"{a[0]}{i}{b[0]}", f"{a}{i}*",
            ])
        else:
            kind = {"c.": "utr", "n.": "intron", "r.": "intron"}.get(prefix, "plain")
            nt = "acgu" if prefix == "r." else "ACGT"
            x, y = rng.choice(nt), rng.choice(nt)
            p, q = position(rng, kind), position(rng, kind)
            seq = "".join(rng.choice(nt) for _ in range(rng.choice([1, 2, 3])))
            body = rng.choice([f"{p}{x}>{y}", f"{p}=", "=", f"{p}_{q}=", f"{p}del", f"{p}_{q}del", f"{p}dup",
                               f"{p}_{q}ins{seq}", f"{p}delins{seq}", f"{p}_{q}delins{seq}", f"{p}{x.lower()}>{y.lower()}"])
        if rng.random() < 0.25:
            parts = [body] + [generated_component(rng, prefix) for _ in range(rng.choice([1, 2, 3]))]
            if rng.random() < 0.6:
                parts.sort(key=lambda s: int(re.search(r"\d+", s).group()) if re.search(r"\d+", s) else 0)
            body = "[" + ";".join(parts) + "]"
        target = rng.choice(["", "", "", "NM_007294.4:", "BRCA1:"])
        out.append(target + prefix + body)
    return out


def generated_component(rng, prefix):
    if prefix == "p.":
        return f"{rng.choice(AA)}{rng.choice([3, 30, 400])}{rng.choice(AA + ['='])}"
    nt = "acgu" if prefix == "r." else "ACGT"
    return f"{rng.choice([4, 40, 500])}{rng.choice(nt)}>{rng.choice(nt)}"


def edits(rng, strings, n):
    alphabet = "ACGTacgu0123456789_.;[]()=>+-*delinsupfTerAlaXx: "
    out = []
    for _ in range(n):
        s = rng.choice(strings)
        if not s:
            continue
        i = rng.randrange(len(s))
        op = rng.choice(["delete", "insert", "replace", "swap"])
        if op == "delete":
            s = s[:i] + s[i + 1:]
        elif op == "insert":
            s = s[:i] + rng.choice(alphabet) + s[i:]
        elif op == "replace":
            s = s[:i] + rng.choice(alphabet) + s[i + 1:]
        elif i + 1 < len(s):
            s = s[:i] + s[i + 1] + s[i] + s[i + 2:]
        out.append(s)
    return out


def judge(s):
    try:
        v = Variant(s)
    except MaveHgvsParseError as e:
        return {"s": s, "ok": False, "error": str(e)}
    except Exception as e:  # anything else mavehgvs raises (it should not)
        return {"s": s, "ok": False, "error": f"{type(e).__name__}: {e}"}
    types = v.variant_type if isinstance(v.variant_type, list) else [v.variant_type]
    tuples = list(v.variant_tuples())
    return {
        "s": s, "ok": True, "canonical": str(v), "prefix": v.prefix, "target": v.target_id,
        "types": types,
        "positions": [None if p is None else (repr(p) if not isinstance(p, tuple) else [repr(p[0]), repr(p[1])]) for _, p, _ in tuples],
        "sequences": [None if q is None else (q if isinstance(q, str) else list(q)) for _, _, q in tuples],
        "synonymous": v.is_synonymous(), "identical": v.is_target_identical(),
    }


def main():
    rng = random.Random(20261008)
    literals = test_literals()
    base = set(literals)
    for s in literals:
        if not re.match(r"^([A-Za-z0-9_.-]+:)?[cgmnopr]\.", s) and len(s) < 40:
            for prefix in PREFIXES:
                base.add(prefix + s)
                if not s.startswith("["):
                    base.add(prefix + "[" + s + "]")
    data = data_identifiers(rng)
    gen = generated(rng, 3000)
    corpus = sorted(base) + data + gen
    corpus += edits(rng, corpus, 4000)
    seen = set()
    unique = [s for s in corpus if not (s in seen or seen.add(s))]
    results = [judge(s) for s in unique]
    valid = sum(r["ok"] for r in results)
    out = {
        "about": "mavehgvs's judgment of every string of a corpus (see generate_mavehgvs.py). "
                 "ok, and either error or prefix, canonical (str(Variant)), target, types, positions, sequences, synonymous, identical.",
        "versions": {"mavehgvs": metadata.version("mavehgvs"), "fqfa": metadata.version("fqfa")},
        "counts": {"strings": len(results), "valid": valid, "invalid": len(results) - valid},
        "results": results,
    }
    with open(OUT, "w") as f:
        json.dump(out, f, separators=(",", ":"), ensure_ascii=False)
        f.write("\n")
    print(f"wrote {OUT}: {len(results)} strings, {valid} valid ({os.path.getsize(OUT) / 1e6:.1f} MB)")


if __name__ == "__main__":
    main()
