from neo4j import GraphDatabase
import os

class Neo4jClient:
    def __init__(self):
        self.driver = GraphDatabase.driver(
            os.getenv("NEO4J_URI", "bolt://localhost:7687"),
            auth=(os.getenv("NEO4J_USER", "neo4j"), os.getenv("NEO4J_PASSWORD", "credx_secure_2024"))
        )
    
    def create_subject(self, investigation_id: str, name: str, aliases: list = None, email: str = None, phone: str = None):
        with self.driver.session() as session:
            session.run("""
                MERGE (s:Subject {id: $inv_id, name: $name})
                SET s.aliases = $aliases, s.email = $email, s.phone = $phone
            """, inv_id=investigation_id, name=name, aliases=aliases or [], email=email, phone=phone)
    
    def close(self):
        self.driver.close()
