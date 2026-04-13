#!/usr/bin/env python3
"""SENTINEL with Hunter.io Email Discovery"""
import asyncio
import logging
from typing import Dict, List, Optional
import httpx

logger = logging.getLogger("Sentinel")

class SentinelAgent:
    def __init__(self):
        self.http = httpx.AsyncClient(timeout=30)
        self.hunter_api_key = "138f878af5064d654d2f824a686c7660a7b7c234"
    
    async def investigate(self, name: str, **kwargs) -> Dict:
        logger.info(f"Hunting: {name}")
        
        email = kwargs.get('email')
        domain = None
        if email and '@' in email:
            domain = email.split('@')[1]
        
        hunter_emails = []
        if domain:
            hunter_emails = await self._hunter_domain_search(domain, name)
        
        return {
            "agent": "sentinel",
            "subject_name": name,
            "emails": hunter_emails,
            "confidence": 0.7 if hunter_emails else 0.3,
            "sources": ["hunter.io"]
        }
    
    async def _hunter_domain_search(self, domain: str, name: str) -> List[Dict]:
        try:
            url = "https://api.hunter.io/v2/domain-search"
            params = {
                "domain": domain,
                "api_key": self.hunter_api_key,
                "limit": 10
            }
            
            resp = await self.http.get(url, params=params)
            data = resp.json()
            
            emails = []
            for email_data in data.get('data', {}).get('emails', []):
                email = email_data.get('value')
                first_name = email_data.get('first_name', '').lower()
                last_name = email_data.get('last_name', '').lower()
                
                name_parts = name.lower().split()
                match_score = 0
                for part in name_parts:
                    if part in first_name or part in last_name:
                        match_score += 1
                
                if match_score > 0 or not first_name:
                    emails.append({
                        "email": email,
                        "first_name": email_data.get('first_name'),
                        "last_name": email_data.get('last_name'),
                        "position": email_data.get('position'),
                        "confidence": email_data.get('confidence'),
                        "match_score": match_score
                    })
            
            emails.sort(key=lambda x: x['match_score'], reverse=True)
            return emails[:5]
            
        except Exception as e:
            logger.error(f"Hunter API error: {e}")
            return []

if __name__ == "__main__":
    async def test():
        agent = SentinelAgent()
        result = await agent.investigate(
            name="John Smith",
            email="john.smith@example.com"
        )
        print(result)
    
    asyncio.run(test())
