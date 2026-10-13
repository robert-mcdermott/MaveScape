"""Remote control of a running MaveScape from Python.

MaveScape started with ``--remote-control`` accepts actions from programs on this computer: every
action an AI agent has (open data, describe the design, score, read the QC, select variants,
compare, make figures, export) is sent as JSON to ``/api/remote/action`` and performed by the open
MaveScape window, which shows what happens. A script's changes apply as the person's do (an AI
agent's are proposals); each goes into the workspace's history. After CytoWeave 0.8.0's client.

>>> import mavescape
>>> ms = mavescape.connect()                    # finds the running MaveScape
>>> ms.open_example(id="grb2-sh3")
>>> scores = ms.scores(limit=0).frame()         # a run's variants as a data frame (pandas)
>>> ms.render_map(file="map.png")               # the map as a picture
"""

from __future__ import annotations

import base64
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

from ._tools import Tools

DEFAULT_URL = "http://127.0.0.1:8820"
TOKEN_HEADER = "X-MaveScape-Token"
PNG = "data:image/png;base64,"


class MaveScapeError(Exception):
    """An action MaveScape refused or could not perform, or a connection that failed.

    The message is MaveScape's reason. ``status`` is the HTTP status (0 when MaveScape could not
    be reached); ``action`` the action.
    """

    def __init__(self, message: str, status: int = 0, action: str | None = None):
        super().__init__(message)
        self.status = status
        self.action = action


class Result:
    """MaveScape's answer to an action: ``message`` (a sentence) and ``data`` (JSON values)."""

    def __init__(self, action: str, message: str, data: Any):
        self.action = action
        self.message = message
        self.data = data

    def __repr__(self) -> str:
        return f"<mavescape.Result {self.action}: {self.message}>"

    def __getitem__(self, key):
        return self.data[key]

    def records(self, key: str | None = None) -> list[dict]:
        """A list of records in the data: ``data[key]``, or the first list of objects found (the
        rows of ``scores``: its ``variants``)."""
        if key is not None:
            value = self.data[key]
        elif isinstance(self.data, list):
            value = self.data
        else:
            value = next((v for v in (self.data or {}).values() if isinstance(v, list) and v and all(isinstance(x, dict) for x in v)), None)
            if value is None:
                raise KeyError(f"{self.action} returned no list of records; its data has {', '.join(self.data or {})}")
        return value

    def frame(self, key: str | None = None):
        """The records as a pandas DataFrame (pandas must be installed); null values are NaN or None."""
        try:
            import pandas
        except ImportError as error:
            raise ImportError("Result.frame() needs pandas; Result.records() gives the rows as dictionaries.") from error
        rows = self.records(key)
        columns = self.data.get("columns") if isinstance(self.data, dict) and key is None and isinstance(self.data.get("columns"), list) else None
        return pandas.DataFrame.from_records(rows, columns=columns)

    def images(self) -> list[dict]:
        """The pictures in the data (render_map with image, render_structure, figures with image),
        in order: [{"caption", "png"}], each PNG as bytes."""
        found: list[dict] = []

        def walk(value: Any, caption: str) -> None:
            if isinstance(value, dict):
                own = next((value[k] for k in ("caption", "title", "name") if isinstance(value.get(k), str) and value.get(k)), caption)
                for item in value.values():
                    walk(item, own)
            elif isinstance(value, list):
                for item in value:
                    walk(item, caption)
            elif isinstance(value, str) and value.startswith(PNG):
                found.append({"caption": caption, "png": base64.b64decode(value[len(PNG):])})

        walk(self.data, "")
        return found

    def save_image(self, path: str | os.PathLike, index: int | None = None) -> Path:
        """Writes a picture of the result to a PNG file (``index``: which one, when there are
        several, from 0); returns its path."""
        found = self.images()
        if not found:
            raise MaveScapeError(f"{self.action} returned no picture (render_map and figures give one with image=True)", action=self.action)
        if index is None and len(found) > 1:
            raise MaveScapeError(f"{self.action} returned {len(found)} pictures: give index (from 0), or name one figure", action=self.action)
        path = Path(path)
        path.write_bytes(found[index or 0]["png"])
        return path


def default_data_dir() -> Path:
    """MaveScape's data folder when it is started without --data-dir (Go's os.UserConfigDir)."""
    home = Path.home()
    if sys.platform == "win32":
        base = os.environ.get("APPDATA")
        return Path(base) / "MaveScape" if base else home / ".mavescape"
    if sys.platform == "darwin":
        return home / "Library" / "Application Support" / "MaveScape"
    base = os.environ.get("XDG_CONFIG_HOME") or str(home / ".config")
    return Path(base) / "MaveScape"


def find_connection(data_dir: str | os.PathLike | None = None) -> dict:
    """Where the running MaveScape is: {"url", "token"}.

    From the environment (MAVESCAPE_URL and MAVESCAPE_TOKEN), else from the remote.json that
    MaveScape writes to its data folder (``data_dir``, MAVESCAPE_DATA_DIR or the default folder),
    else MaveScape's default address without a token.
    """
    url = os.environ.get("MAVESCAPE_URL")
    token = os.environ.get("MAVESCAPE_TOKEN")
    if url:
        return {"url": url, "token": token}
    folder = Path(data_dir or os.environ.get("MAVESCAPE_DATA_DIR") or default_data_dir())
    try:
        info = json.loads((folder / "remote.json").read_text(encoding="utf-8"))
        return {"url": info["url"], "token": token or info.get("token")}
    except (OSError, ValueError, KeyError):
        return {"url": DEFAULT_URL, "token": token}


class MaveScape(Tools):
    """A connection to a running MaveScape; each action is a method (see ``tools()``).

    url, token: MaveScape's address and the token it printed at startup (needed to open and write
    files); found by ``find_connection`` when not given. client: the name MaveScape's log shows for
    your actions. timeout: seconds to wait for an action (scoring a large table takes a while).
    """

    def __init__(self, url: str | None = None, token: str | None = None, *, client: str = "Python", timeout: float = 3600, data_dir: str | os.PathLike | None = None):
        found = find_connection(data_dir) if url is None or token is None else {}
        self.url = (url or found.get("url") or DEFAULT_URL).rstrip("/")
        self.token = token if token is not None else found.get("token")
        self.client = client
        self.timeout = timeout

    def __repr__(self) -> str:
        return f"<mavescape.MaveScape {self.url}{'' if self.token else ' (no token)'}>"

    def _request(self, method: str, path: str, body: bytes | None = None, action: str | None = None) -> Any:
        headers = {"Accept": "application/json"}
        if body is not None:
            headers["Content-Type"] = "application/json"
        if self.token:
            headers[TOKEN_HEADER] = self.token
        request = urllib.request.Request(self.url + path, data=body, method=method, headers=headers)
        try:
            with urllib.request.urlopen(request, timeout=self.timeout) as response:
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as error:
            with error:
                text = error.read().decode("utf-8", "replace")
            try:
                message = json.loads(text).get("error") or text
            except ValueError:
                message = text or error.reason
            if error.code == 404 and path.startswith("/api/remote/"):
                message = f"{self.url} does not accept actions: start MaveScape with --remote-control."
            raise MaveScapeError(message, error.code, action) from None
        except urllib.error.URLError as error:
            raise MaveScapeError(f"MaveScape is not running at {self.url} ({error.reason}). Start it with: mavescape --remote-control", 0, action) from None

    def call(self, action: str, **args: Any) -> Result:
        """Performs any action by its name, with its arguments as MaveScape names them; arguments
        that are None are left out. Raises MaveScapeError, with MaveScape's reason, when the action
        is refused."""
        body = json.dumps({"action": action, "args": {k: v for k, v in args.items() if v is not None}, "client": self.client}).encode("utf-8")
        answer = self._request("POST", "/api/remote/action", body, action)
        if not answer.get("ok"):
            raise MaveScapeError(answer.get("message") or answer.get("error") or f"{action} failed", 200, action)
        return Result(action, answer.get("message", ""), answer.get("data"))

    def tools(self) -> list[dict]:
        """The actions this MaveScape performs: name, title, description and argument schema."""
        return self._request("GET", "/api/remote/tools")["tools"]

    def version(self) -> str:
        """The version of the running MaveScape."""
        return self._request("GET", "/api/remote/tools")["version"]


def connect(url: str | None = None, token: str | None = None, **options: Any) -> MaveScape:
    """Connects to the running MaveScape (see ``MaveScape``) and checks that it answers."""
    ms = MaveScape(url, token, **options)
    ms.version()
    return ms
