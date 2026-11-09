from supabase import Client, create_client

from lib.config import require

_client: Client | None = None


def sb() -> Client:
    global _client
    if _client is None:
        _client = create_client(require("SUPABASE_URL"), require("SUPABASE_SERVICE_KEY"))
    return _client


def log_run(agent: str, status: str, count: int = 0, error: str | None = None) -> None:
    sb().table("runs_log").insert(
        {"agent": agent, "status": status, "payload_count": count, "error": error}
    ).execute()
