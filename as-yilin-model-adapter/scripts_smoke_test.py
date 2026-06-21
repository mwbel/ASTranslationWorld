from __future__ import annotations

import json
import sys
from urllib.request import Request, urlopen


def request_json(url: str, method: str = "GET", data: dict | None = None, token: str | None = None) -> dict:
    body = None
    headers = {"Content-Type": "application/json"}
    if data is not None:
        body = json.dumps(data).encode("utf-8")
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = Request(url, data=body, method=method, headers=headers)
    with urlopen(req, timeout=10) as res:
        return json.loads(res.read().decode("utf-8"))


def main() -> int:
    base = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:18081"
    print("health", request_json(f"{base}/health"))
    login = request_json(
        f"{base}/auth/login",
        "POST",
        {"username": "demo", "password": "demo-password", "reseller_code": "demo"},
    )
    print("login ok", bool(login.get("token")))
    models = request_json(f"{base}/models", token=login["token"])
    print("models", models.get("total"), [m.get("id") for m in models.get("models", [])])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
