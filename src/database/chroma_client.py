import chromadb
import os

class ChromaClient:
    def __init__(self):
        self.client = chromadb.HttpClient(
            host=os.getenv("CHROMADB_HOST", "localhost"),
            port=int(os.getenv("CHROMADB_PORT", "8000"))
        )
    
    def get_collection(self, name: str):
        return self.client.get_or_create_collection(name=name)
