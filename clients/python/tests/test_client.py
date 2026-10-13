"""The Python client against a running MaveScape (wave 7, slice 4): GRB2 opened and scored through
the client, its scores table every number of Node's, a figure and the map written as files, errors
carrying MaveScape's reason, results equal to the HTTP API's for the same actions, and MaveScape
found through its connection file.

clients/test-clients.mjs starts MaveScape with remote control and a browser page, writes Node's
scores of the GRB2 example, then runs these tests with MAVESCAPE_TEST_URL, MAVESCAPE_TEST_TOKEN,
MAVESCAPE_TEST_DIR, MAVESCAPE_TEST_EXPECTED and MAVESCAPE_DATA_DIR set. Without them the tests
that need MaveScape are skipped.

    PYTHONPATH=clients/python/src python3 -m unittest discover -s clients/python/tests -v
"""

import csv
import json
import os
import unittest
import urllib.request
from pathlib import Path

import mavescape

URL = os.environ.get("MAVESCAPE_TEST_URL")
TOKEN = os.environ.get("MAVESCAPE_TEST_TOKEN")
OUT = Path(os.environ.get("MAVESCAPE_TEST_DIR", "."))
EXPECTED = os.environ.get("MAVESCAPE_TEST_EXPECTED")
PNG = b"\x89PNG\r\n\x1a\n"


def http(action, args=None):
    """The same action sent to the HTTP API directly, as docs/MCP.md shows."""
    body = json.dumps({"action": action, "args": args or {}, "client": "Python"}).encode("utf-8")
    request = urllib.request.Request(URL + "/api/remote/action", data=body, headers={"Content-Type": "application/json", "X-MaveScape-Token": TOKEN})
    with urllib.request.urlopen(request, timeout=600) as response:
        return json.loads(response.read().decode("utf-8"))


def differences(rows, columns, path):
    """Where rows (as scores gives them) differ from an exported CSV: [text]. Each number the
    same double, NA as None, text as written."""
    with open(path, newline="", encoding="utf-8") as handle:
        table = list(csv.reader(handle))
    header, lines = table[0], table[1:]
    out = []
    if header != columns:
        out.append(f"columns {columns} against {header}")
    if len(lines) != len(rows):
        out.append(f"{len(rows)} rows against {len(lines)}")
    for row, line in zip(rows, lines):
        for column, written in zip(header, line):
            value = row.get(column)
            if written == "NA":
                same = value is None
            elif isinstance(value, (int, float)) and not isinstance(value, bool):
                same = float(written) == value
            else:
                same = written == str(value)
            if not same:
                out.append(f"{row.get('hgvs_pro')} {column}: {value!r} against {written}")
    return out[:10]


@unittest.skipUnless(URL, "needs a running MaveScape (node clients/test-clients.mjs)")
class ClientTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # No address or token given: found in remote.json in MAVESCAPE_DATA_DIR.
        cls.ms = mavescape.connect(client="Python")
        cls.opened = cls.ms.open_example(id="grb2-sh3")

    def test_connects_through_the_connection_file(self):
        self.assertEqual(self.ms.url, URL)
        self.assertEqual(self.ms.token, TOKEN)
        self.assertEqual(self.ms.version(), mavescape.__version__, "the client's version is the program's")

    def test_every_action_is_a_method(self):
        names = [tool["name"] for tool in self.ms.tools()]
        missing = [name for name in names if not callable(getattr(self.ms, name, None))]
        self.assertGreater(len(names), 50)
        self.assertEqual(missing, [])
        self.assertIn("scores.csv", self.ms.scores.__doc__)

    def test_grb2_scored_its_scores_table_nodes(self):
        self.assertIn("grb2-sh3", self.opened.data["id"])
        scored = self.ms.score(preset="enrich2")
        self.assertEqual(scored["name"], "Run 2")
        result = self.ms.scores(run="Run 1", limit=0)
        self.assertEqual(result["total"], 1121)
        self.assertEqual(differences(result.records(), result["columns"], EXPECTED), [])
        lower = self.ms.scores(run="Run 1", query="lower and position 30-40", columns=["hgvs_pro", "score"], limit=0)
        self.assertTrue(all(30 <= int("".join(c for c in row["hgvs_pro"][5:] if c.isdigit())) <= 40 for row in lower.records()))
        try:
            import pandas  # noqa: F401
        except ImportError:
            self.skipTest("pandas is not installed")
        frame = result.frame()
        self.assertEqual(list(frame.columns), result["columns"])
        self.assertEqual(len(frame), 1121)
        self.assertEqual(frame["score"].isna().sum(), sum(1 for row in result.records() if row["score"] is None))

    def test_results_equal_the_http_api(self):
        ms = self.ms
        cases = [
            (lambda: ms.qc_findings(run="Run 1"), "qc_findings", {"run": "Run 1"}),
            (lambda: ms.scores(run="Run 1", kinds=["nonsense"], sort="score", limit=5), "scores", {"run": "Run 1", "kinds": ["nonsense"], "sort": "score", "limit": 5}),
            (lambda: ms.inspect_variant("p.Trp36Ala", run="Run 1"), "inspect_variant", {"variant": "p.Trp36Ala", "run": "Run 1"}),
            (lambda: ms.call("provenance", run="Run 1"), "provenance", {"run": "Run 1"}),
        ]
        for method, action, args in cases:
            with self.subTest(action=action):
                mine = method()
                theirs = http(action, args)
                self.assertTrue(theirs["ok"], theirs.get("message"))
                self.assertEqual(mine.message, theirs["message"])
                self.assertEqual(mine.data, theirs["data"])

    def test_a_figure_and_pictures_written_as_files(self):
        self.ms.create_figure(name="Python figure", size="single")
        self.ms.add_figure_panel(figure="Python figure", run="Run 1")
        svg = OUT / "python-figure.svg"
        svg.unlink(missing_ok=True)
        written = self.ms.export_figure(figure="Python figure", path=str(svg))
        self.assertTrue(svg.read_text(encoding="utf-8").startswith("<svg"), written.message)
        page = OUT / "python-figure.png"
        result = self.ms.figures(figure="Python figure", file=str(page), dpi=100)
        self.assertEqual(page.read_bytes()[:8], PNG)
        self.assertEqual(len(result.images()), 1)
        drawn = OUT / "python-map.png"
        self.ms.render_map(run="Run 1", file=str(drawn), from_=30, to=40)
        self.assertEqual(drawn.read_bytes()[:8], PNG)
        self.ms.open_structure(pdb="2VWF")
        view = OUT / "python-structure.png"
        self.ms.render_structure(file=str(view), scale=1)
        self.assertEqual(view.read_bytes()[:8], PNG)

    def test_exports_need_the_token_and_never_replace_a_file(self):
        path = OUT / "python-scores.csv"
        path.unlink(missing_ok=True)
        result = self.ms.export("scores", path=str(path), run="Run 1")
        self.assertEqual(path.read_text(encoding="utf-8"), Path(EXPECTED).read_text(encoding="utf-8"), result.message)
        with self.assertRaises(mavescape.MaveScapeError) as again:
            self.ms.export("scores", path=str(path), run="Run 1")
        self.assertIn("overwrite", str(again.exception))
        without = mavescape.MaveScape(URL, "")
        with self.assertRaises(mavescape.MaveScapeError) as refused:
            without.export("scores", path=str(OUT / "python-other.csv"))
        self.assertEqual(refused.exception.status, 401)

    def test_errors_carry_the_reason(self):
        with self.assertRaises(mavescape.MaveScapeError) as unknown:
            self.ms.call("no_such_action")
        self.assertIn("Unknown action", str(unknown.exception))
        with self.assertRaises(mavescape.MaveScapeError) as wrong:
            self.ms.scores(run="Run 9")
        self.assertIn('No score run "Run 9"', str(wrong.exception))
        self.assertEqual(wrong.exception.action, "scores")
        with self.assertRaises(mavescape.MaveScapeError) as gone:
            mavescape.connect("http://127.0.0.1:9", "")
        self.assertEqual(gone.exception.status, 0)


class OfflineTest(unittest.TestCase):
    """What the client does without a MaveScape."""

    def test_the_connection_file_and_the_environment(self):
        import tempfile

        saved = {k: os.environ.pop(k, None) for k in ("MAVESCAPE_URL", "MAVESCAPE_TOKEN", "MAVESCAPE_DATA_DIR")}
        try:
            with tempfile.TemporaryDirectory() as folder:
                self.assertEqual(mavescape.find_connection(folder), {"url": "http://127.0.0.1:8820", "token": None})
                Path(folder, "remote.json").write_text(json.dumps({"url": "http://127.0.0.1:8899", "token": "abc", "version": "x", "pid": 1}))
                self.assertEqual(mavescape.find_connection(folder), {"url": "http://127.0.0.1:8899", "token": "abc"})
                os.environ["MAVESCAPE_URL"] = "http://127.0.0.1:8900"
                self.assertEqual(mavescape.find_connection(folder)["url"], "http://127.0.0.1:8900")
        finally:
            for key, value in saved.items():
                os.environ.pop(key, None)
                if value is not None:
                    os.environ[key] = value

    def test_arguments_and_pictures(self):
        sent = {}

        class Recorder(mavescape.MaveScape):
            def call(self, action, **args):
                sent[action] = args
                return mavescape.Result(action, "", {"caption": "The map", "image": "data:image/png;base64,iVBORw0KGgo="})

        ms = Recorder("http://127.0.0.1:1", "")
        ms.render_map(from_=30, to=40)
        self.assertEqual(sent["render_map"]["from"], 30)
        self.assertIsNone(sent["render_map"]["image"])
        result = ms.render_map(file=os.devnull)
        self.assertTrue(sent["render_map"]["image"], "a file asks for the picture")
        self.assertEqual(result.images(), [{"caption": "The map", "png": PNG}])


if __name__ == "__main__":
    unittest.main()
