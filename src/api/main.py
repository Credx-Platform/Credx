#!/usr/bin/env python3
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, List
import uvicorn

app = FastAPI(title="CredX Platform", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class SkipTraceRequest(BaseModel):
    subject_name: str
    last_known_city: Optional[str] = None
    last_known_state: Optional[str] = None
    known_email: Optional[str] = None
    known_phone: Optional[str] = None
    known_business: Optional[str] = None
    aliases: Optional[List[str]] = None
    case_number: Optional[str] = None


@app.get("/")
def root():
    return {"status": "CredX Running", "version": "1.0.0", "docs": "/docs"}


@app.post("/skip-trace")
async def skip_trace(r: SkipTraceRequest):
    from src.core.agent_zero import AgentZero

    agent_zero = AgentZero()
    result = await agent_zero.investigate(
        subject_name=r.subject_name,
        subject_aliases=r.aliases or [],
        known_city=r.last_known_city,
        known_state=r.last_known_state,
        known_email=r.known_email,
        known_phone=r.known_phone,
        known_business=r.known_business,
    )

    findings = result.get("findings", {})
    atlas = findings.get("atlas", {})
    sentinel = findings.get("sentinel", {})
    ledger = findings.get("ledger", {})

    # Normalize emails — may be list of dicts or strings
    emails_raw = sentinel.get("emails", [])
    emails = []
    for e in emails_raw:
        emails.append(e.get("email", "") if isinstance(e, dict) else str(e))

    return {
        "trace_id": f"ST-{result['investigation_id'][:8].upper()}",
        "investigation_id": result["investigation_id"],
        "subject": r.subject_name,
        "service_ready": True,
        "confidence": result["confidence_score"],
        "completed_agents": result["completed_agents"],
        "errors": result.get("errors", []),
        "addresses": atlas.get("addresses", []),
        "emails": [e for e in emails if e],
        "businesses": ledger.get("businesses", []),
        "findings": findings,
        "final_report": result.get("final_report"),
    }


@app.post("/investigate")
async def investigate(r: SkipTraceRequest):
    return await skip_trace(r)


@app.get("/agents")
def agents():
    return {
        "agents": [
            {"name": "SENTINEL",  "role": "Identity / Email discovery", "source": "hunter.io"},
            {"name": "ATLAS",     "role": "Address research",           "source": "property_records"},
            {"name": "LEDGER",    "role": "Business records",           "source": "opencorporates.com"},
            {"name": "JUSTICE",   "role": "Court records",              "source": "pacer / state courts"},
            {"name": "SPIDER",    "role": "Network mapping",            "source": "cross_reference"},
            {"name": "ECHO",      "role": "Digital footprint",          "source": "google / wayback"},
            {"name": "SIGNAL",    "role": "Contact intelligence",       "source": "hunter / hibp"},
            {"name": "ARCHIVIST", "role": "Report generation",          "source": "all_agents"},
        ]
    }


if __name__ == "__main__":
    port = int(os.getenv("PORT", 8081))
    uvicorn.run(app, host="0.0.0.0", port=port)
