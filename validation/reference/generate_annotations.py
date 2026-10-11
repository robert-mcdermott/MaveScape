# Writes validation/reference/annotations.json: what MaveScape's conservation tracks (wave 3,
# slice 5) must reproduce, from Capra & Singh's score_conservation.py (Bioinformatics 2007;
# https://compbio.cs.princeton.edu/conservation/), which MaveScape's conservation.js (copied from
# Proteoscope) follows:
#
#   - the GRB2 SH3 alignment (validation/fixtures/annotations/grb2-sh3.fasta: Pfam PF00018's seed
#     with the human GRB2 C-terminal SH3 first), scored by the tool itself with its defaults, each
#     residue of the first sequence (-a);
#   - PDBe-KB's conservation profiles of GRB2, factor IX and Hsp90 (validation/fixtures/public-data/
#     pdbe), each position's amino-acid probabilities scored by the tool's own divergence (its
#     js_divergence, lines 380-410, for a column already given as frequencies: no pseudocount, no
#     sequence weights, no gap) against the tool's own BLOSUM62 background.
#
#   SCORE_CONSERVATION=/path/to/conservation_code python3 validation/reference/generate_annotations.py
#
# The tool is Python 2 code under the GPL and is not part of MaveScape: it is run here, as an
# external reference, in a Python 3 copy made the way Proteoscope's
# validation/scripts/port-score-conservation.py makes it (tabs as Python 2 reads them, print(),
# "except E as e", 12 decimals printed instead of 5).

import hashlib
import importlib.util
import json
import math
import os
import re
import subprocess
import sys
import tempfile
from contextlib import redirect_stdout
from io import StringIO

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
FIXTURES = os.path.join(ROOT, 'validation', 'fixtures')
OUT = os.path.join(ROOT, 'validation', 'reference', 'annotations.json')


def sha256(path):
    with open(path, 'rb') as f:
        return hashlib.sha256(f.read()).hexdigest()


def port(folder, work):
    """A Python 3 copy of the tool (as Proteoscope's port-score-conservation.py makes it)."""
    source = open(os.path.join(folder, 'score_conservation.py')).read().expandtabs(8)
    lines = []
    in_usage = False
    for line in source.split('\n'):
        if re.match(r'^\s*print """', line):
            line = line.replace('print """', 'print("""', 1)
            in_usage = True
        elif in_usage and line.strip() == '"""':
            line = line.replace('"""', '""")')
            in_usage = False
        else:
            match = re.match(r'^(\s*(?:else:\s*)?)print (.*)$', line)
            if match and not in_usage:
                line = '%sprint(%s)' % (match.group(1), match.group(2))
        line = re.sub(r'except (\w+), e:', r'except \1 as e:', line)
        line = line.replace('distribution = map(float, distribution)', 'distribution = list(map(float, distribution))')
        line = line.replace('"%d\\t%s\\t%.5f"', '"%d\\t%s\\t%.12f"').replace('"%d\\t%s\\t%5f\\n"', '"%d\\t%s\\t%.12f\\n"')
        line = line.replace('"%d\\t%.5f\\t%s"', '"%d\\t%.12f\\t%s"').replace('"%d\\t%5f\\t%s\\n"', '"%d\\t%.12f\\t%s\\n"')
        lines.append(line)
    path = os.path.join(work, 'score_conservation_py3.py')
    open(path, 'w').write('\n'.join(lines))
    # The tool reads its matrices and distributions relative to where it runs.
    for name in ('matrix', 'distributions'):
        if os.path.isdir(os.path.join(folder, name)) and not os.path.exists(os.path.join(work, name)):
            os.symlink(os.path.join(folder, name), os.path.join(work, name))
    return path


def alignment_reference(script, work):
    path = os.path.join(FIXTURES, 'annotations', 'grb2-sh3.fasta')
    names = []
    rows = []
    for line in open(path):
        line = line.strip()
        if line.startswith('>'):
            names.append(line[1:])
            rows.append('')
        elif line:
            rows[-1] += line
    # The tool's names: s0, s1, … (it splits names at spaces and slashes are fine, but keep it plain).
    fasta = os.path.join(work, 'alignment.fasta')
    with open(fasta, 'w') as f:
        for i, row in enumerate(rows):
            f.write('>s%d\n%s\n' % (i, row.upper().replace('.', '-')))
    output = subprocess.run([sys.executable, script, '-a', 's0', fasta], cwd=work, capture_output=True, text=True, check=True).stdout
    columns = []
    scores = []
    for line in output.split('\n'):
        if not line or line.startswith('#'):
            continue
        column, _, score = line.split('\t')[:3]
        columns.append(int(column))
        # -1000 marks a column with too many gaps to score.
        scores.append(None if float(score) == -1000 else float(score))
    return {'file': 'annotations/grb2-sh3.fasta', 'sha256': sha256(path), 'query': names[0], 'sequences': len(rows), 'columns': columns, 'scores': scores}


def profile_reference(tool, accession):
    path = os.path.join(FIXTURES, 'public-data', 'pdbe', '%s.conservation.json' % accession)
    data = json.load(open(path))['data']
    order = tool.amino_acids[:20]  # the tool's order: A R N D C Q E G H I L K M F P S T W Y V
    distr = tool.blosum_background_distr[:]
    divergence = []
    for j in range(len(data['index'])):
        fc = [float(data['probability_' + a][j]) for a in order]
        s = sum(fc)
        fc = [x / s for x in fc]
        # The tool's js_divergence, from "make r distribution" on.
        r = [.5 * fc[i] + .5 * distr[i] for i in range(len(fc))]
        d = 0.
        for i in range(len(fc)):
            if r[i] != 0.0:
                if fc[i] == 0.0:
                    d += distr[i] * math.log(distr[i] / r[i], 2)
                elif distr[i] == 0.0:
                    d += fc[i] * math.log(fc[i] / r[i], 2)
                else:
                    d += fc[i] * math.log(fc[i] / r[i], 2) + distr[i] * math.log(distr[i] / r[i], 2)
        d /= 2
        divergence.append(d)
    return {'accession': accession, 'file': 'public-data/pdbe/%s.conservation.json' % accession, 'sha256': sha256(path), 'positions': data['index'], 'divergence': divergence}


def main():
    folder = os.environ.get('SCORE_CONSERVATION')
    if not folder:
        sys.exit('Set SCORE_CONSERVATION to the folder of score_conservation.py (conservation_code).')
    with tempfile.TemporaryDirectory() as work:
        script = port(folder, work)
        spec = importlib.util.spec_from_file_location('score_conservation_py3', script)
        tool = importlib.util.module_from_spec(spec)
        sys.argv = ['score_conservation_py3.py']
        # Loading it runs its command line, which prints its usage and exits: quietly.
        try:
            with redirect_stdout(StringIO()):
                spec.loader.exec_module(tool)
        except SystemExit:
            pass
        reference = {
            'source': "score_conservation.py (Capra & Singh 2007) under Python 3, 12 decimals: the alignment's first sequence's residues as the tool scores them by default (null where the column has too many gaps); PDBe-KB's profiles scored by the tool's js_divergence against its BLOSUM62 background",
            'tool': {'name': 'score_conservation.py', 'url': 'https://compbio.cs.princeton.edu/conservation/', 'sha256': sha256(os.path.join(folder, 'score_conservation.py')), 'python': sys.version.split()[0]},
            'alignment': alignment_reference(script, work),
            'profiles': [profile_reference(tool, a) for a in ('P62993', 'P00740', 'P02829')],
        }
    with open(OUT, 'w') as f:
        json.dump(reference, f, indent=1)
        f.write('\n')
    print('wrote %s: %d query residues; %s' % (OUT, len(reference['alignment']['columns']), ', '.join('%s %d positions' % (p['accession'], len(p['positions'])) for p in reference['profiles'])))


if __name__ == '__main__':
    main()
