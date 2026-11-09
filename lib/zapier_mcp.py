"""Thin async wrapper over Zapier's MCP endpoint.

Zapier MCP exposes meta-tools: discover_zapier_actions, enable_zapier_action,
execute_zapier_read_action, execute_zapier_write_action.
Each execute_* call = 1 Zapier task. Discovery/enable calls are free.
"""
from __future__ import annotations

import json
from typing import Any

from mcp import ClientSession
from mcp.client.streamable_http import streamablehttp_client

from lib.config import require


async def list_tools() -> list[dict[str, Any]]:
    url = require("ZAPIER_MCP_URL")
    async with streamablehttp_client(url) as (read, write, _):
        async with ClientSession(read, write) as session:
            await session.initialize()
            res = await session.list_tools()
            return [
                {
                    "name": t.name,
                    "description": t.description or "",
                    "schema": t.inputSchema,
                }
                for t in res.tools
            ]


async def call_tool(name: str, args: dict[str, Any]) -> dict[str, Any]:
    url = require("ZAPIER_MCP_URL")
    async with streamablehttp_client(url) as (read, write, _):
        async with ClientSession(read, write) as session:
            await session.initialize()
            result = await session.call_tool(name, args)
            text_chunks: list[str] = []
            for c in result.content:
                text = getattr(c, "text", None)
                if text:
                    text_chunks.append(text)
            return {
                "content": text_chunks,
                "is_error": bool(result.isError),
            }


def _parse_first_json(content: list[str]) -> Any:
    for c in content:
        try:
            return json.loads(c)
        except (json.JSONDecodeError, TypeError):
            continue
    return None


class ZapierTaskError(RuntimeError):
    """Raised when Zapier rejects with insufficient_tasks or similar."""


def _raise_if_error(result: dict[str, Any]) -> None:
    if not result.get("is_error"):
        return
    payload = _parse_first_json(result.get("content", []))
    msg = ""
    if isinstance(payload, dict):
        msg = str(payload.get("error") or payload.get("errorDetails") or payload)
    if not msg:
        msg = " | ".join(result.get("content", [])) or "Unknown Zapier MCP error"
    if "insufficient tasks" in msg.lower() or "402" in msg:
        raise ZapierTaskError(
            "Zapier account has no tasks remaining. "
            "Check https://zapier.com/app/billing for your free-tier balance."
        )
    raise RuntimeError(f"Zapier MCP error: {msg}")


async def execute_read(
    selected_api: str,
    action: str,
    params: dict[str, Any],
    instructions: str,
    output: str,
) -> Any:
    """Execute a Zapier read action. Returns parsed JSON payload from the action."""
    result = await call_tool(
        "execute_zapier_read_action",
        {
            "selected_api": selected_api,
            "action": action,
            "instructions": instructions,
            "params": params,
            "output": output,
        },
    )
    _raise_if_error(result)
    return _parse_first_json(result.get("content", []))


async def execute_write(
    selected_api: str,
    action: str,
    params: dict[str, Any],
    instructions: str,
    output: str = "Confirmation of the action.",
) -> Any:
    """Execute a Zapier write action. Returns parsed JSON payload from the action."""
    result = await call_tool(
        "execute_zapier_write_action",
        {
            "selected_api": selected_api,
            "action": action,
            "instructions": instructions,
            "params": params,
            "output": output,
        },
    )
    _raise_if_error(result)
    return _parse_first_json(result.get("content", []))


async def ensure_enabled(selected_api: str, app_display_name: str) -> None:
    """Idempotent enable. Free (does not cost a task)."""
    result = await call_tool(
        "enable_zapier_action",
        {
            "selected_api": selected_api,
            "app_display_name": app_display_name,
            "action": "*",
        },
    )
    _raise_if_error(result)
