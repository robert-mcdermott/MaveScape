"""Remote control of a running MaveScape (multiplexed assays of variant effect) from Python."""

from .client import MaveScape, MaveScapeError, Result, connect, default_data_dir, find_connection

__version__ = "0.7.0"

__all__ = ["MaveScape", "MaveScapeError", "Result", "connect", "default_data_dir", "find_connection", "__version__"]
