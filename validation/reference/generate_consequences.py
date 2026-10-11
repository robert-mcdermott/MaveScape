"""Protein consequences of nucleotide variants, from biocommons hgvs (validation/reference/consequences.json).

Run from the repository root, after `node validation/fetch.mjs`. hgvs needs psycopg2, which it
does not use here and which may not build; install it without its dependencies:

    uv venv --python 3.12 /tmp/hgvs-env
    VIRTUAL_ENV=/tmp/hgvs-env uv pip install --no-deps hgvs==1.5.7
    VIRTUAL_ENV=/tmp/hgvs-env uv pip install attrs bioutils parsley psycopg2-binary biocommons.seqrepo requests six biopython==1.88
    /tmp/hgvs-env/bin/python -I validation/reference/generate_consequences.py

biocommons hgvs (Apache-2.0) maps a c. variant to its protein change (VariantMapper.c_to_p, through
AltSeqBuilder and AltSeqToHgvsp). It is given each transcript through a data provider of its own
that holds the transcript's sequence and coding region and nothing else, so no database is
consulted. The transcripts are MaveScape's cached answers in validation/fixtures/public-data/ (the
RefSeq records NM_007294.3 and NM_000546.6 read with Biopython, the Ensembl transcript
ENST00000460680 from its sequence with the coding part in capitals). The variants:

- every name of three published score sets on them (validation/cache/): BRCA1's saturation genome
  editing (urn:mavedb:00000097-0-2), TP53's DNA-binding domain (urn:mavedb:00001277-a-1, mostly
  deletions and insertions), BAP1's exon 1 (urn:mavedb:00000662-a-2);
- variants generated on each transcript with a fixed seed: substitutions (every one of the first and
  last 30 coding bases, and a sample), deletions, insertions, duplications and deletion-insertions
  of 1 to 9 bases, across the coding sequence and its ends.

For each, biocommons' protein change as it writes it (p.(Ala2Ser), p.Met1?, p.(Gly5AlafsTer12),
p.(Ter7LysextTer?), p.?) or its error. web/lib/consequence.js must agree on every one, in
MAVE-HGVS's forms (validation suite `consequences`, which says what each form becomes).
"""

import csv
import json
import os
import random
from importlib import metadata

import hgvs
import hgvs.parser
from hgvs.enums import Datum
from Bio import SeqIO
from hgvs.utils.altseq_to_hgvsp import AltSeqToHgvsp
from hgvs.utils.altseqbuilder import AltSeqBuilder
from hgvs.utils.reftranscriptdata import RefTranscriptData

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
FIXTURES = os.path.join(ROOT, "validation", "fixtures", "public-data")
CACHE = os.path.join(ROOT, "validation", "cache")
OUT = os.path.join(ROOT, "validation", "reference", "consequences.json")
SEED = 20261011


class Transcript:
    """A data provider holding one transcript: its sequence and coding region."""

    def __init__(self, ac, seq, cds_start, cds_end):
        self.ac, self.seq, self.cds_start, self.cds_end = ac, seq, cds_start, cds_end

    def get_tx_identity_info(self, ac):
        return {"cds_start_i": self.cds_start, "cds_end_i": self.cds_end, "lengths": [len(self.seq)], "hgnc": None}

    def get_seq(self, ac, start=None, end=None):
        return self.seq[start:end] if ac == self.ac else None

    def get_pro_ac_for_tx_ac(self, ac):
        return "PROTEIN"

    def get_acs_for_protein_seq(self, seq):
        return ["PROTEIN"]


def refseq(accession):
    record = SeqIO.read(os.path.join(FIXTURES, "ncbi", accession + ".gb"), "genbank")
    cds = [f for f in record.features if f.type == "CDS"]
    assert len(cds) == 1 and cds[0].location.strand == 1, accession
    return Transcript(accession, str(record.seq).upper(), int(cds[0].location.start), int(cds[0].location.end))


def ensembl(identifier, named):
    with open(os.path.join(FIXTURES, "ensembl", identifier + ".json")) as f:
        seq = json.load(f)["seq"]
    upper = [i for i, c in enumerate(seq) if c.isupper()]
    return Transcript(named, seq.upper(), upper[0], upper[-1] + 1)


def published(dataset, column="hgvs_nt"):
    with open(os.path.join(CACHE, dataset, "scores.csv"), newline="") as f:
        return [row[column].split(":", 1)[1] for row in csv.DictReader(f) if row[column] not in ("", "NA")]


def generated(t, rng):
    """Variants across the coding sequence and its ends, in c. positions."""
    n = t.cds_end - t.cds_start
    base = lambda c: t.seq[t.cds_start + c - 1]
    bases = "ACGT"
    out = []
    edges = list(range(1, 31)) + list(range(n - 29, n + 1))
    for c in edges + rng.sample(range(31, n - 29), 300):
        out += [f"c.{c}{base(c)}>{b}" for b in bases if b != base(c)]
    for _ in range(400):
        c = rng.choice(edges + list(range(1, n + 1)))
        k = rng.randint(1, 9)
        e = min(n, c + k - 1)
        kind = rng.choice(["del", "dup", "ins", "delins"])
        if kind == "ins":
            if c >= n:
                continue
            out.append(f"c.{c}_{c + 1}ins{''.join(rng.choice(bases) for _ in range(k))}")
        elif kind == "delins":
            out.append(f"c.{c}_{e}delins{''.join(rng.choice(bases) for _ in range(rng.randint(1, 9)))}" if e > c else f"c.{c}delins{''.join(rng.choice(bases) for _ in range(rng.randint(2, 9)))}")
        else:
            out.append(f"c.{c}_{e}{kind}" if e > c else f"c.{c}{kind}")
    return out


def protein_change(parser, t, name):
    v = parser.parse_hgvs_variant(f"{t.ac}:{name}")
    edit = v.posedit.edit
    if edit.type in ("del", "dup") and not edit.ref and v.posedit.pos.start.offset == 0 and v.posedit.pos.end.offset == 0:
        # biocommons reads the deleted or duplicated bases from the reference; give them.
        start, end = v.posedit.pos.start.base, v.posedit.pos.end.base
        offset = lambda c: t.cds_start + c - 1 if c > 0 else t.cds_start + c
        if not (v.posedit.pos.start.datum == v.posedit.pos.end.datum == Datum.CDS_START):  # not *N
            raise ValueError("del/dup outside the coding numbering")
        edit.ref = t.seq[offset(start): offset(end) + 1]
    ref = RefTranscriptData(t, t.ac, "PROTEIN")
    alt = AltSeqBuilder(v, ref).build_altseq()
    return str(AltSeqToHgvsp(ref, alt[0]).build_hgvsp()).split(":", 1)[1]


def main():
    rng = random.Random(SEED)
    parser = hgvs.parser.Parser()
    transcripts = [
        (refseq("NM_007294.3"), "fixtures/public-data/ncbi/NM_007294.3.gb", "mavedb-brca1-sge"),
        (refseq("NM_000546.6"), "fixtures/public-data/ncbi/NM_000546.6.gb", "mavedb-tp53-dbd"),
        (ensembl("ENST00000460680", "ENST00000460680.5"), "fixtures/public-data/ensembl/ENST00000460680.json", "mavedb-bap1-sge"),
    ]
    results = []
    for t, source, dataset in transcripts:
        names = list(dict.fromkeys(published(dataset)))
        made = [x for x in dict.fromkeys(generated(t, rng)) if x not in set(names)]
        rows = []
        for name in names + made:
            try:
                rows.append([name, protein_change(parser, t, name)])
            except Exception as error:  # noqa: BLE001 — recorded, not hidden
                rows.append([name, None, f"{type(error).__name__}: {error}"])
        results.append({"transcript": t.ac, "source": source, "dataset": dataset, "cds": [t.cds_start + 1, t.cds_end], "published": len(names), "generated": len(made), "variants": rows})
        print(t.ac, len(names), "published,", len(made), "generated,", sum(1 for r in rows if r[1] is None), "errors")
    out = {
        "about": "Protein changes of nucleotide variants by biocommons hgvs, on cached transcripts (generate_consequences.py). Each variant: [c. name, biocommons' p. name or null, error].",
        "versions": {"hgvs": metadata.version("hgvs"), "biopython": metadata.version("biopython")},
        "seed": SEED,
        "transcripts": results,
    }
    with open(OUT, "w") as f:
        json.dump(out, f, separators=(",", ":"))
        f.write("\n")


if __name__ == "__main__":
    main()
