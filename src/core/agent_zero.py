#!/usr/bin/env python3
"""
AGENT ZERO - Master Controller
Orchestrates all investigation agents
"""
import os
import json
import asyncio
import logging
from typing import Dict, List, Any, Optional
from datetime import datetime
from dataclasses import dataclass, field
import uuid

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("AgentZero")


@dataclass
class InvestigationState:
    investigation_id: str
    subject_name: str
    subject_aliases: List[str] = field(default_factory=list)
    known_city: Optional[str] = None
    known_state: Optional[str] = None
    known_email: Optional[str] = None
    known_phone: Optional[str] = None
    known_business: Optional[str] = None
    current_step: str = "initialized"
    completed_agents: List[str] = field(default_factory=list)
    pending_agents: List[str] = field(default_factory=list)
    findings: Dict[str, Any] = field(default_factory=dict)
    errors: List[str] = field(default_factory=list)
    confidence_score: float = 0.0
    final_report: Optional[Dict] = None


class AgentZero:
    AGENT_PRIORITY = ["sentinel", "atlas", "ledger", "justice", "spider", "echo", "signal", "archivist"]

    def __init__(self):
        logger.info("Agent Zero initialized")

    async def _execute_sentinel(self, state: InvestigationState):
        from src.agents.sentinel import SentinelAgent
        agent = SentinelAgent()
        result = await agent.investigate(
            name=state.subject_name,
            aliases=state.subject_aliases,
            email=state.known_email,
            phone=state.known_phone,
        )
        state.findings["sentinel"] = result
        state.completed_agents.append("sentinel")
        if "sentinel" in state.pending_agents:
            state.pending_agents.remove("sentinel")
        state.confidence_score += result.get("confidence", 0) * 0.15
        return state

    async def _execute_atlas(self, state: InvestigationState):
        from src.agents.atlas import AtlasAgent
        agent = AtlasAgent()
        search_names = [state.subject_name] + state.subject_aliases
        if "sentinel" in state.findings:
            search_names.extend(state.findings["sentinel"].get("aliases_found", []))
        result = await agent.investigate(
            names=list(set(search_names)),
            city=state.known_city,
            state=state.known_state,
        )
        state.findings["atlas"] = result
        state.completed_agents.append("atlas")
        if "atlas" in state.pending_agents:
            state.pending_agents.remove("atlas")
        state.confidence_score += result.get("confidence", 0) * 0.15
        return state

    async def _execute_ledger(self, state: InvestigationState):
        from src.agents.ledger import LedgerAgent
        agent = LedgerAgent()
        result = await agent.investigate(
            name=state.subject_name,
            business_hint=state.known_business,
            addresses=state.findings.get("atlas", {}).get("addresses", []),
        )
        state.findings["ledger"] = result
        state.completed_agents.append("ledger")
        if "ledger" in state.pending_agents:
            state.pending_agents.remove("ledger")
        state.confidence_score += result.get("confidence", 0) * 0.10
        return state

    async def _execute_justice(self, state: InvestigationState):
        from src.agents.justice import JusticeAgent
        agent = JusticeAgent()
        result = await agent.investigate(
            name=state.subject_name,
            aliases=state.findings.get("sentinel", {}).get("aliases_found", []),
            locations=state.findings.get("atlas", {}).get("addresses", []),
        )
        state.findings["justice"] = result
        state.completed_agents.append("justice")
        if "justice" in state.pending_agents:
            state.pending_agents.remove("justice")
        state.confidence_score += result.get("confidence", 0) * 0.10
        return state

    async def _execute_spider(self, state: InvestigationState):
        from src.agents.spider import SpiderAgent
        agent = SpiderAgent()
        result = await agent.investigate(
            subject_name=state.subject_name,
            investigation_id=state.investigation_id,
            all_findings=state.findings,
        )
        state.findings["spider"] = result
        state.completed_agents.append("spider")
        if "spider" in state.pending_agents:
            state.pending_agents.remove("spider")
        state.confidence_score += result.get("confidence", 0) * 0.10
        return state

    async def _execute_echo(self, state: InvestigationState):
        from src.agents.echo import EchoAgent
        agent = EchoAgent()
        result = await agent.investigate(
            name=state.subject_name,
            usernames=state.findings.get("sentinel", {}).get("usernames", []),
            emails=state.findings.get("sentinel", {}).get("emails", []),
        )
        state.findings["echo"] = result
        state.completed_agents.append("echo")
        if "echo" in state.pending_agents:
            state.pending_agents.remove("echo")
        state.confidence_score += result.get("confidence", 0) * 0.10
        return state

    async def _execute_signal(self, state: InvestigationState):
        from src.agents.signal import SignalAgent
        agent = SignalAgent()
        result = await agent.investigate(
            name=state.subject_name,
            emails=state.findings.get("sentinel", {}).get("emails", []),
            phones=state.findings.get("sentinel", {}).get("phones", []),
        )
        state.findings["signal"] = result
        state.completed_agents.append("signal")
        if "signal" in state.pending_agents:
            state.pending_agents.remove("signal")
        state.confidence_score += result.get("confidence", 0) * 0.10
        return state

    async def _execute_archivist(self, state: InvestigationState):
        from src.agents.archivist import ArchivistAgent
        agent = ArchivistAgent()
        result = await agent.generate_report(
            investigation_id=state.investigation_id,
            subject_name=state.subject_name,
            findings=state.findings,
            confidence_score=state.confidence_score,
        )
        state.findings["archivist"] = result
        state.completed_agents.append("archivist")
        if "archivist" in state.pending_agents:
            state.pending_agents.remove("archivist")
        state.final_report = result.get("report")
        return state

    def _try_save_to_db(self, state: InvestigationState, status: str = "active"):
        """Attempt Postgres/Neo4j writes; skip gracefully if DB unavailable."""
        try:
            from src.database.postgres_client import PostgresClient
            pg = PostgresClient()
            pg.create_investigation(
                id=state.investigation_id,
                subject_name=state.subject_name,
                subject_aliases=state.subject_aliases,
                known_city=state.known_city,
                known_state=state.known_state,
                known_email=state.known_email,
                known_phone=state.known_phone,
                status=status,
            )
        except Exception as e:
            logger.warning(f"Postgres unavailable: {e}")

        try:
            from src.database.neo4j_client import Neo4jClient
            neo = Neo4jClient()
            neo.create_subject(
                investigation_id=state.investigation_id,
                name=state.subject_name,
                aliases=state.subject_aliases,
                email=state.known_email,
                phone=state.known_phone,
            )
            neo.close()
        except Exception as e:
            logger.warning(f"Neo4j unavailable: {e}")

    def _try_update_db(self, state: InvestigationState, status: str = "completed"):
        try:
            from src.database.postgres_client import PostgresClient
            pg = PostgresClient()
            pg.update_investigation(
                investigation_id=state.investigation_id,
                status=status,
                confidence_score=state.confidence_score,
                final_report=state.final_report,
            )
        except Exception as e:
            logger.warning(f"Postgres update unavailable: {e}")

    async def investigate(self, **kwargs) -> Dict:
        investigation_id = kwargs.get("investigation_id") or str(uuid.uuid4())
        state = InvestigationState(
            investigation_id=investigation_id,
            subject_name=kwargs.get("subject_name", ""),
            subject_aliases=kwargs.get("subject_aliases", []),
            known_city=kwargs.get("known_city"),
            known_state=kwargs.get("known_state"),
            known_email=kwargs.get("known_email"),
            known_phone=kwargs.get("known_phone"),
            known_business=kwargs.get("known_business"),
        )
        state.pending_agents = self.AGENT_PRIORITY.copy()

        self._try_save_to_db(state, status="active")

        steps = [
            self._execute_sentinel,
            self._execute_atlas,
            self._execute_ledger,
            self._execute_justice,
            self._execute_spider,
            self._execute_echo,
            self._execute_signal,
            self._execute_archivist,
        ]

        for step in steps:
            try:
                state = await step(state)
            except Exception as e:
                agent_name = step.__name__.replace("_execute_", "")
                logger.error(f"{agent_name} failed: {e}")
                state.errors.append(f"{agent_name}: {str(e)}")

        self._try_update_db(state, status="completed")

        return {
            "investigation_id": state.investigation_id,
            "status": "completed",
            "confidence_score": round(state.confidence_score, 3),
            "completed_agents": state.completed_agents,
            "errors": state.errors,
            "final_report": state.final_report,
            "findings": state.findings,
        }
