#!/usr/bin/env python3
"""LEDGER - OpenCorporates Business Data (FREE)"""
import asyncio
import logging
from typing import Dict, List, Optional
import httpx

logger = logging.getLogger("Ledger")

class LedgerAgent:
    """Free business lookup via OpenCorporates API"""
    
    def __init__(self):
        self.http = httpx.AsyncClient(timeout=30)
        self.base_url = "https://api.opencorporates.com/v0.4"
    
    async def investigate(self, name: str, **kwargs) -> Dict:
        logger.info(f"LEDGER searching business: {name}")
        
        businesses = []
        
        # Search by officer name
        officer_results = await self._search_by_officer(name)
        businesses.extend(officer_results)
        
        # Search by company name
        company_results = await self._search_companies(name)
        businesses.extend(company_results)
        
        return {
            "agent": "ledger",
            "total_found": len(businesses),
            "businesses": businesses[:10],  # Top 10
            "confidence": 0.7 if businesses else 0.2,
            "sources": ["opencorporates.com"]
        }
    
    async def _search_by_officer(self, name: str) -> List[Dict]:
        """Search for companies where person is officer"""
        try:
            resp = await self.http.get(
                f"{self.base_url}/officers/search",
                params={"q": name, "per_page": 10}
            )
            data = resp.json()
            
            results = []
            for officer in data.get('results', {}).get('officers', []):
                company = officer.get('company', {})
                results.append({
                    "company_name": company.get('name'),
                    "company_number": company.get('company_number'),
                    "jurisdiction": company.get('jurisdiction_code'),
                    "officer_role": officer.get('position'),
                    "company_status": company.get('current_status'),
                    "source_url": officer.get('opencorporates_url')
                })
            
            return results
            
        except Exception as e:
            logger.error(f"Officer search error: {e}")
            return []
    
    async def _search_companies(self, name: str) -> List[Dict]:
        """Search companies by name"""
        try:
            resp = await self.http.get(
                f"{self.base_url}/companies/search",
                params={"q": name, "per_page": 10}
            )
            data = resp.json()
            
            results = []
            for company in data.get('results', {}).get('companies', []):
                c = company.get('company', {})
                results.append({
                    "company_name": c.get('name'),
                    "company_number": c.get('company_number'),
                    "jurisdiction": c.get('jurisdiction_code'),
                    "company_status": c.get('current_status'),
                    "incorporation_date": c.get('incorporation_date'),
                    "source_url": c.get('opencorporates_url')
                })
            
            return results
            
        except Exception as e:
            logger.error(f"Company search error: {e}")
            return []

# Test
if __name__ == "__main__":
    async def test():
        agent = LedgerAgent()
        # Test with a common name
        result = await agent.investigate("John Smith")
        print(f"Found {result['total_found']} businesses")
        for b in result['businesses'][:3]:
            print(f"  - {b['company_name']} ({b['jurisdiction']})")
    
    asyncio.run(test())
