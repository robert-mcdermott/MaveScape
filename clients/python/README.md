# mavescape (Python)

Remote control of a running [MaveScape](https://github.com/robert-mcdermott/MaveScape), the
workbench for multiplexed assays of variant effect, from Python: every action an AI agent can take
in MaveScape is a method, performed by the open MaveScape window.

```bash
pip install "git+https://github.com/robert-mcdermott/MaveScape#subdirectory=clients/python"
mavescape --remote-control        # MaveScape itself, in another terminal
```

```python
import mavescape

ms = mavescape.connect()          # finds the running MaveScape
ms.open_example(id="grb2-sh3")
print(ms.qc_findings().message)
scores = ms.scores(run="Run 1", limit=0).frame()      # needs pandas
ms.render_map(run="Run 1", file="grb2-map.png")
```

`help(ms.scores)` describes each action's arguments. See
[clients/README.md](https://github.com/robert-mcdermott/MaveScape/tree/main/clients) for how the
connection is found, tables, pictures and errors.
