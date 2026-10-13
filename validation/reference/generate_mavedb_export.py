"""MaveDB's own validators on MaveScape's MaveDB deposits (validation/reference/mavedb-export.json).

Run from the repository root, after `node validation/fetch.mjs`:

    node validation/mavedb-export-cases.mjs --write /tmp/mavedb-packages
    uv venv --python 3.12 /tmp/mavedb-env
    VIRTUAL_ENV=/tmp/mavedb-env uv pip install mavedb==2026.2.7.4 biopython==1.88
    VIRTUAL_ENV=/tmp/mavedb-env uv pip install --no-deps hgvs==1.5.7 "cdot>=0.2.21,<0.3"
    VIRTUAL_ENV=/tmp/mavedb-env uv pip install "fastapi>=0.121,<0.122" "starlette>=0.49,<0.50" \
        "starlette-context>=0.3.6,<0.4" "arq>=0.25,<0.26" "aiocache[redis]>=0.12.2,<0.13" \
        "alembic>=1.14,<1.15" "alembic-utils==0.8.1" "authlib>=1.6.6,<1.7" "boto3>=1.34.97,<1.35" \
        "cryptography>=46.0.5,<46.1" "orcid>=1.0.3,<1.1" "python-jose[cryptography]>=3.5,<3.6" \
        "python-multipart>=0.0.22,<0.1" "requests>=2.33,<3" "slack-sdk>=3.21.3,<3.22" uvicorn \
        "watchtower>=3.2,<3.3" psycopg2-binary attrs bioutils parsley biocommons.seqrepo six
    /tmp/mavedb-env/bin/python -I validation/reference/generate_mavedb_export.py /tmp/mavedb-packages

The mavedb package (MaveDB's server, AGPL-3.0) is used only here, as an external reference; no
code of it is in MaveScape. Its server modules import their dependencies (fastapi and others) and
hgvs needs psycopg2, which it does not use here and which may not build: they are installed as
above, psycopg2 by its binary package and hgvs and cdot without their dependencies.

For each package (a folder of the files MaveScape writes), MaveDB's checks as its upload and API
make them:

- the tables: scores.csv and counts.csv read as MaveDB reads an upload (csv_data_to_df: ' as the
  quote character, its missing values), then validate_and_standardize_dataframe_pair with the
  column descriptions (score_columns.json, count_columns.json) and the score set's targets, as the
  variant-creation job does. A target given by its sequence is checked by mavehgvs (each name
  against the sequence); one named by a transcript by biocommons hgvs, given the transcript through
  a data provider of its own that holds MaveScape's cached copy (validation/fixtures/public-data),
  so no database or service is consulted;
- every name in the tables by mavehgvs 0.8.1 in strict mode (Variant(name), no relaxed ordering);
- the column descriptions: DatasetColumnMetadata, and DatasetColumnsCreate with the tables' columns;
- experiment.json as ExperimentCreate, its keywords by validate_keyword_list and each (key, label)
  in MaveDB's controlled vocabulary (validation/fixtures/public-data/mavedb-keywords.json, MaveDB's
  answers to /api/v1/controlled-keywords/{key});
- score_set.json as ScoreSetCreate. MaveDB gives a new experiment its URN when it is created; a
  score set whose experimentUrn is null (a new experiment) is checked with a temporary URN in its
  place, as MaveDB's own form does before the experiment is saved;
- score_calibrations.json (wave 8, slice 5), each calibration as ScoreCalibrationCreate with a
  temporary score set URN in place of the one MaveDB gives the score set, and the scores in each
  class with a range counted by MaveDB's FunctionalClassificationBase.is_contained_by_range.

Each result is recorded with the SHA-256 of every file checked, so the suite `mavedb-export` knows
the files it writes now are the ones these validators passed.
"""

import csv
import hashlib
import importlib
import io
import json
import os
import pkgutil
import sys
from importlib import metadata

import mavedb.models

for module in pkgutil.iter_modules(mavedb.models.__path__):
    importlib.import_module("mavedb.models." + module.name)

from Bio import SeqIO  # noqa: E402
from mavehgvs.exceptions import MaveHgvsParseError  # noqa: E402
from mavehgvs.variant import Variant  # noqa: E402
from mavedb.lib.score_sets import csv_data_to_df  # noqa: E402
from mavedb.lib.validation.dataframe.dataframe import validate_and_standardize_dataframe_pair  # noqa: E402
from mavedb.lib.validation.keywords import validate_keyword_list  # noqa: E402
from mavedb.models.target_accession import TargetAccession  # noqa: E402
from mavedb.models.target_gene import TargetGene  # noqa: E402
from mavedb.models.target_sequence import TargetSequence  # noqa: E402
from mavedb.view_models.experiment import ExperimentCreate  # noqa: E402
from mavedb.view_models.score_calibration import FunctionalClassificationBase, ScoreCalibrationCreate  # noqa: E402
from mavedb.view_models.score_set import ScoreSetCreate  # noqa: E402
from mavedb.view_models.score_set_dataset_columns import DatasetColumnMetadata, DatasetColumnsCreate  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
FIXTURES = os.path.join(ROOT, "validation", "fixtures", "public-data")
OUT = os.path.join(ROOT, "validation", "reference", "mavedb-export.json")
TMP_URN = "tmp:00000000-0000-4000-8000-000000000000"
TMP_SCORE_SET = "tmp:00000000-0000-4000-8000-000000000001"
HGVS_COLUMNS = ("hgvs_nt", "hgvs_splice", "hgvs_pro")


class Transcripts:
    """A data provider holding transcripts: each one's sequence and coding region, nothing else."""

    def __init__(self):
        self.tx = {}

    def add(self, ac, seq, cds_start, cds_end):
        self.tx[ac] = (seq, cds_start, cds_end)

    def data_version(self):
        return "mavescape-fixtures"

    def schema_version(self):
        return "1"

    def get_tx_identity_info(self, ac):
        if ac not in self.tx:
            return None
        seq, start, end = self.tx[ac]
        return {"tx_ac": ac, "alt_ac": ac, "alt_aln_method": "transcript", "cds_start_i": start, "cds_end_i": end, "lengths": [len(seq)], "hgnc": None}

    def get_seq(self, ac, start=None, end=None):
        return self.tx[ac][0][start:end] if ac in self.tx else None

    def get_pro_ac_for_tx_ac(self, ac):
        return None


def transcripts():
    hdp = Transcripts()
    for name in sorted(os.listdir(os.path.join(FIXTURES, "ncbi"))):
        if not name.endswith(".gb"):
            continue
        record = SeqIO.read(os.path.join(FIXTURES, "ncbi", name), "genbank")
        cds = [f for f in record.features if f.type == "CDS" and f.location.strand == 1]
        if record.id.startswith(("NM_", "NR_", "XM_")) and len(cds) == 1:
            hdp.add(record.id, str(record.seq).upper(), int(cds[0].location.start), int(cds[0].location.end))
    for name in sorted(os.listdir(os.path.join(FIXTURES, "ensembl"))):
        if not name.endswith(".json") or name.endswith(".meta.json"):
            continue
        with open(os.path.join(FIXTURES, "ensembl", name)) as f:
            answer = json.load(f)
        seq = answer["seq"]
        upper = [i for i, c in enumerate(seq) if c.isupper()]
        hdp.add(f"{answer['id']}.{answer['version']}", seq.upper(), upper[0], upper[-1] + 1)
    return hdp


def sha(path):
    with open(path, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()


def message(error):
    text = f"{type(error).__name__}: {error}"
    triggers = getattr(error, "triggers", None)
    if triggers:
        text += " " + "; ".join(str(t) for t in triggers[:5])
    return text


def targets_of(score_set):
    out = []
    for t in score_set["targetGenes"]:
        gene = TargetGene(name=t["name"], category=t["category"])
        if t.get("targetSequence"):
            s = t["targetSequence"]
            gene.target_sequence = TargetSequence(sequence=s["sequence"], sequence_type=s["sequenceType"], label=s.get("label"))
        else:
            a = t["targetAccession"]
            gene.target_accession = TargetAccession(accession=a["accession"], gene=a.get("gene"), assembly=a.get("assembly"), is_base_editor=a.get("isBaseEditor", False))
        out.append(gene)
    return out


def strict_names(path):
    """Every name in the table's HGVS columns, by mavehgvs in strict mode (without its target
    prefix, as MaveDB splits it)."""
    bad = []
    count = 0
    with open(path, newline="") as f:
        for row in csv.DictReader(f):
            for column in HGVS_COLUMNS:
                value = row.get(column)
                if value in (None, "", "NA"):
                    continue
                for name in value.split(" "):
                    count += 1
                    try:
                        Variant(name.split(":", 1)[1] if ":" in name else name)
                    except MaveHgvsParseError as e:
                        bad.append(f"{name}: {e}")
    return count, bad


def check(folder, vocabulary, hdp):
    files = {name: sha(os.path.join(folder, name)) for name in sorted(os.listdir(folder)) if name not in ("README.md", "mavescape.json")}
    result = {"files": files}
    with open(os.path.join(folder, "score_set.json")) as f:
        score_set = json.load(f)
    with open(os.path.join(folder, "experiment.json")) as f:
        experiment = json.load(f)
    load = lambda name: json.load(open(os.path.join(folder, name))) if os.path.exists(os.path.join(folder, name)) else None  # noqa: E731
    score_meta = load("score_columns.json")
    count_meta = load("count_columns.json")

    # The tables, as MaveDB's upload and variant-creation job read and check them.
    try:
        with open(os.path.join(folder, "scores.csv"), "rb") as f:
            scores = csv_data_to_df(io.BytesIO(f.read()))
        counts = None
        if os.path.exists(os.path.join(folder, "counts.csv")):
            with open(os.path.join(folder, "counts.csv"), "rb") as f:
                counts = csv_data_to_df(io.BytesIO(f.read()))
        meta = lambda m: {k: DatasetColumnMetadata.model_validate(v) for k, v in m.items()} if m else None  # noqa: E731
        s, c, sm, cm = validate_and_standardize_dataframe_pair(scores, counts, meta(score_meta), meta(count_meta), targets_of(score_set), hdp)
        DatasetColumnsCreate(
            score_columns=[x for x in s.columns if x not in HGVS_COLUMNS],
            count_columns=[x for x in c.columns if x not in HGVS_COLUMNS] if c is not None else None,
            score_columns_metadata=sm,
            count_columns_metadata=cm,
        )
        result["tables"] = {"ok": True, "scores": {"rows": int(len(s)), "columns": [x for x in s.columns if x not in HGVS_COLUMNS or not s[x].isna().all()]}, "counts": {"rows": int(len(c)), "columns": [x for x in c.columns if x not in HGVS_COLUMNS or not c[x].isna().all()]} if c is not None else None}
    except Exception as e:  # noqa: BLE001
        result["tables"] = {"ok": False, "error": message(e)}

    count, bad = strict_names(os.path.join(folder, "scores.csv"))
    result["names"] = {"checked": count, "invalid": bad[:10], "ok": not bad}

    # The experiment, and its keywords against MaveDB's vocabulary.
    try:
        model = ExperimentCreate.model_validate(experiment)
        if model.keywords:
            validate_keyword_list(model.keywords)
        unknown = [f"{k['keyword']['key']}: {k['keyword']['label']}" for k in experiment.get("keywords", []) if k["keyword"]["label"].lower() not in [x.lower() for x in vocabulary.get(k["keyword"]["key"], [])]]
        result["experiment"] = {"ok": not unknown, **({"error": f"not in MaveDB's vocabulary: {unknown}"} if unknown else {})}
    except Exception as e:  # noqa: BLE001
        result["experiment"] = {"ok": False, "error": message(e)}

    # The score set, its experiment's URN given when MaveDB has not made it yet.
    body = dict(score_set)
    if not body.get("experimentUrn"):
        body["experimentUrn"] = TMP_URN
    try:
        ScoreSetCreate.model_validate(body)
        result["scoreSet"] = {"ok": True}
    except Exception as e:  # noqa: BLE001
        result["scoreSet"] = {"ok": False, "error": message(e)}

    # Its score calibrations (wave 8, slice 5): each as MaveDB's ScoreCalibrationCreate, the score
    # set's URN given as MaveDB gives it once the score set is made; and the scores in each class
    # with a range, counted by MaveDB's own is_contained_by_range.
    calibrations = load("score_calibrations.json")
    if calibrations is not None:
        with open(os.path.join(folder, "scores.csv"), "rb") as f:
            values = [float(x) for x in csv_data_to_df(io.BytesIO(f.read()))["score"].tolist() if x == x]
        out = []
        for body in calibrations:
            entry = {"title": body.get("title")}
            try:
                ScoreCalibrationCreate.model_validate({**body, "scoreSetUrn": body.get("scoreSetUrn") or TMP_SCORE_SET})
                entry["ok"] = True
            except Exception as e:  # noqa: BLE001
                entry["ok"] = False
                entry["error"] = message(e)
            classes = []
            for k in body.get("functionalClassifications") or []:
                fc = FunctionalClassificationBase.model_validate(k)
                classes.append({"label": k["label"], "class": k["functionalClassification"], "n": sum(1 for x in values if fc.is_contained_by_range(x))})
            entry["classes"] = classes
            out.append(entry)
        result["calibrations"] = out
    return result


def main():
    if len(sys.argv) != 2:
        sys.exit("usage: generate_mavedb_export.py PACKAGES_FOLDER")
    root = sys.argv[1]
    with open(os.path.join(FIXTURES, "mavedb-keywords.json")) as f:
        vocabulary = {key: [x["label"] for x in answer] for key, answer in json.load(f)["keywords"].items()}
    hdp = transcripts()
    packages = {}
    for name in sorted(os.listdir(root)):
        folder = os.path.join(root, name)
        if os.path.isdir(folder):
            packages[name] = check(folder, vocabulary, hdp)
            r = packages[name]
            print(name, "tables", r["tables"]["ok"], "names", r["names"]["ok"], "experiment", r["experiment"]["ok"], "score set", r["scoreSet"]["ok"], "calibrations", [c["ok"] for c in r.get("calibrations", [])], file=sys.stderr)
    out = {
        "generated": "2026-10-13",
        "tools": {name: metadata.version(name) for name in ("mavedb", "mavehgvs", "hgvs", "pandas", "pydantic", "biopython")},
        "transcripts": sorted(hdp.tx),
        "packages": packages,
    }
    with open(OUT, "w") as f:
        json.dump(out, f, indent=1, sort_keys=True)
        f.write("\n")


if __name__ == "__main__":
    main()
