"""GenBank records as Biopython reads them (validation/reference/genbank.json).

Run from the repository root (any Python with Biopython; the environment of
generate_consequences.py has it):

    /tmp/hgvs-env/bin/python -I validation/reference/generate_genbank.py

Biopython (Biopython License / BSD-3) reads each GenBank record MaveScape's fetcher cached in
validation/fixtures/public-data/ncbi/: two RefSeq mRNAs (BRCA1's NM_007294.3, TP53's
NM_000546.6), a plasmid with three coding features, one on the reverse strand (ON605209.1), and a
gene whose coding sequence is joined from three exons (HBB, MK476504.1). For each, the record's
name, length, molecule, topology, accession, version, organism and definition, and every feature's
type and location (its parts, 1-based, with their strands, in reading order); for each coding
feature, the bases it covers (their SHA-256 and length), its translation (standard code, or the
record's table) and the record's own /translation. web/lib/genbank.js must agree on all of it
(validation suite `consequences`).
"""

import hashlib
import json
import os
from importlib import metadata

from Bio import SeqIO

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
FIXTURES = os.path.join(ROOT, "validation", "fixtures", "public-data", "ncbi")
OUT = os.path.join(ROOT, "validation", "reference", "genbank.json")


def parts(location):
    return [[int(p.start) + 1, int(p.end), int(p.strand or 1)] for p in location.parts]


def main():
    records = []
    for name in sorted(f for f in os.listdir(FIXTURES) if f.endswith(".gb")):
        record = SeqIO.read(os.path.join(FIXTURES, name), "genbank")
        a = record.annotations
        features = []
        for f in record.features:
            entry = {"type": f.type, "parts": parts(f.location)}
            if f.type == "CDS":
                bases = str(f.extract(record.seq)).upper()
                start = int(f.qualifiers.get("codon_start", ["1"])[0]) - 1
                table = int(f.qualifiers.get("transl_table", ["1"])[0])
                coding = bases[start:]
                coding = coding[: len(coding) - len(coding) % 3]
                entry.update({
                    "length": len(bases),
                    "sha256": hashlib.sha256(bases.encode()).hexdigest(),
                    "translation": str(record.seq.__class__(coding).translate(table=table)),
                    "given": f.qualifiers.get("translation", [None])[0],
                    "gene": f.qualifiers.get("gene", [None])[0],
                })
            features.append(entry)
        records.append({
            "file": f"fixtures/public-data/ncbi/{name}",
            "name": record.name,
            "length": len(record.seq),
            "molecule": a.get("molecule_type"),
            "topology": a.get("topology"),
            "accession": record.id.split(".")[0] if record.id else None,
            "version": record.id,
            "organism": a.get("organism"),
            "definition": record.description,
            "sha256": hashlib.sha256(str(record.seq).upper().encode()).hexdigest(),
            "features": features,
        })
    out = {
        "about": "GenBank records as Biopython reads them (generate_genbank.py): each record's fields, every feature's location parts [start, end, strand] (1-based, in reading order), and each CDS's bases, translation and the record's own /translation.",
        "versions": {"biopython": metadata.version("biopython")},
        "records": records,
    }
    with open(OUT, "w") as f:
        json.dump(out, f, indent=1)
        f.write("\n")


if __name__ == "__main__":
    main()
