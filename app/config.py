"""Environment-driven settings. No external config library -- just os.environ
with defaults, loaded once at import time. A .env file (if present) is read
manually so we don't need python-dotenv as a dependency.
"""
from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent


def _load_dotenv(path: Path) -> None:
    if not path.exists():
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip()
        os.environ.setdefault(key, value)


_load_dotenv(REPO_ROOT / ".env")


@dataclass(frozen=True)
class Settings:
    host: str = os.environ.get("APITEST_HOST", "127.0.0.1")
    port: int = int(os.environ.get("APITEST_PORT", "8420"))
    db_path: str = os.environ.get("APITEST_DB_PATH", "./apitest.db")

    default_base_url: str = os.environ.get("APITEST_DEFAULT_BASE_URL", "")
    default_adapter: str = os.environ.get("APITEST_DEFAULT_ADAPTER", "openai_compat")
    default_api_key: str = os.environ.get("APITEST_DEFAULT_API_KEY", "")
    default_model: str = os.environ.get("APITEST_DEFAULT_MODEL", "")


settings = Settings()
