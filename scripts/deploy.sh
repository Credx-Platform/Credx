#!/bin/bash
echo "🚀 Deploying CredX..."
cd ~/credx-platform/docker
sudo docker-compose up -d
sleep 20
echo "✅ Services started"
echo "Neo4j: http://localhost:7474"
echo "API will start on port 8080"
