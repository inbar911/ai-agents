import os
from pathlib import Path
from dotenv import load_dotenv

_PROJECT_ROOT = Path(__file__).resolve().parent.parent
load_dotenv(_PROJECT_ROOT / ".env")


def require(key: str) -> str:
    val = os.getenv(key)
    if not val or val.startswith("YOUR_"):
        raise RuntimeError(
            f"Missing or placeholder env var: {key}. "
            f"Edit {_PROJECT_ROOT / '.env'} and set a real value."
        )
    return val


def optional(key: str, default: str = "") -> str:
    return os.getenv(key, default)


PROJECT_ROOT = _PROJECT_ROOT
