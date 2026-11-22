"""Local web server: the static website plus a small JSON API for live forecasts.

    python3 -m coursewise serve            # http://127.0.0.1:8000

    GET /api/health                                    data range, upcoming terms
    GET /api/options?course=CS225                      upcoming terms + recent instructors
    GET /api/predict?course=CS225&term=2026-fa         "Any instructor"
        &instructor=Evans,%20Graham                    optional
        &format=online                                 optional: in-person | online

Only the Python standard library is used for HTTP. CORS is open, so the site
also works when served by another dev server (e.g. VS Code Live Server).
"""

import json
from functools import partial
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

from . import config
from .forecast import Forecaster
from .utils import log, to_builtin


class ApiError(Exception):
    def __init__(self, status: HTTPStatus, message: str):
        super().__init__(message)
        self.status = status


def _required(params: dict, name: str) -> str:
    if not params.get(name):
        raise ApiError(HTTPStatus.BAD_REQUEST, f"missing query parameter '{name}'")
    return params[name]


def _route(forecaster: Forecaster, endpoint: str, params: dict) -> dict:
    if endpoint == "health":
        return {"ok": True, **forecaster.info()}
    if endpoint == "options":
        return forecaster.options(_required(params, "course"))
    if endpoint == "predict":
        return forecaster.predict(
            _required(params, "course"), _required(params, "term"),
            params.get("instructor", ""), params.get("format", ""),
        )
    raise ApiError(HTTPStatus.NOT_FOUND, f"unknown endpoint '{endpoint}'")


class Handler(SimpleHTTPRequestHandler):
    """Serves files from the frontend folder; paths under /api/ go to the forecaster."""

    def __init__(self, *args, forecaster: Forecaster, **kwargs):
        self.forecaster = forecaster
        super().__init__(*args, **kwargs)

    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        super().end_headers()

    def do_GET(self):
        url = urlparse(self.path)
        if not url.path.startswith("/api/"):
            return super().do_GET()
        params = {key: values[0].strip() for key, values in parse_qs(url.query).items()}
        try:
            status, body = HTTPStatus.OK, _route(self.forecaster, url.path.removeprefix("/api/"), params)
        except ApiError as error:
            status, body = error.status, {"error": str(error)}
        except KeyError as error:  # unknown course / instructor
            status, body = HTTPStatus.NOT_FOUND, {"error": error.args[0]}
        except ValueError as error:  # bad term / format
            status, body = HTTPStatus.BAD_REQUEST, {"error": str(error)}
        except Exception:  # noqa: BLE001 - report, keep serving
            log.exception("request failed: %s", self.path)
            status, body = HTTPStatus.INTERNAL_SERVER_ERROR, {"error": "internal error"}
        self._send_json(status, body)

    def _send_json(self, status: HTTPStatus, body: dict) -> None:
        data = json.dumps(to_builtin(body)).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, format, *args):  # noqa: A002 - signature from the base class
        log.debug("%s %s", self.address_string(), format % args)


def run_server(port: int = config.API_PORT, host: str = config.API_HOST) -> None:
    forecaster = Forecaster()
    handler = partial(Handler, forecaster=forecaster, directory=str(config.FRONTEND_DIR))
    with ThreadingHTTPServer((host, port), handler) as server:
        log.info("CourseWise running on http://%s:%d  (Ctrl+C to stop)", host, port)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            log.info("stopped")
