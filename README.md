# FinGraph — Real-Time AI Fraud Detection Platform

FinGraph is an enterprise-grade financial fraud and Anti-Money Laundering (AML) detection platform. It ingests transaction streams via **Apache Kafka**, evaluates real-time anomaly scores using **Scikit-Learn Isolation Forest & Graph Topology Engine**, persists relationship graphs in **Neo4j**, broadcasts zero-latency updates via **WebSockets**, and renders an interactive graph analytics workbench for financial crime analysts.

---

## 🚀 Key Improvements & Features

1. **Real-Time Event-Driven Architecture**:
   - Apache Kafka transaction ingestion & replay stream.
   - Python & PyFlink stream processing engine.
   - WebSocket connection for instant live feed updates and toast alerts without polling delay.

2. **AI-Powered Fraud Detection Engine**:
   - **Isolation Forest** Machine Learning model for anomaly detection.
   - Unified **Risk Score (0–100)** formula:
     $$\text{Risk Score} = \text{Velocity} + \text{Amount Anomaly} + \text{Graph Centrality} + \text{ML Anomaly Score}$$
   - **Explainable AI (XAI)** human-readable breakdowns detailing why transactions/accounts are flagged.

3. **Interactive Graph Analytics Workbench**:
   - Force-directed graph with interactive **Pan, Zoom, and Node Dragging**.
   - Dynamic node sizing by transaction volume & degree.
   - Risk color gradient: Emerald (`<30`) → Amber (`30-70`) → Red (`>70`).
   - Pattern Highlight Filters: **Starburst/Smurfing**, **Circular Loops**, and **High Risk Nodes**.

4. **Fraud Investigation Panel & Analyst Feedback**:
   - Slide-over workbench showing multi-hop account sub-graph, AI explanations, and transaction chain.
   - Interactive Analyst Action buttons: **"Mark as Confirmed Fraud"** and **"Mark as False Positive"** with audit logs.

5. **Security & Authentication**:
   - JWT-based authentication with role-based access control (`Admin`, `Fraud Analyst`).
   - Input validation & rate-limiting middleware.

---

## 🏗️ System Architecture

```
+-----------------------------------------------------------------------------------+
|                                 SYSTEM ARCHITECTURE                               |
+-----------------------------------------------------------------------------------+
|  [CSV Upload / Replay Script]   --->   [Kafka Topic: fingraph-transactions]       |
|                                                    |                              |
|                                                    v                              |
|                                      [Stream Processing Worker]                   |
|                                                    |                              |
|         +------------------------------------------+--------------------------+   |
|         |                                                                     |   |
|         v                                                                     v   |
|  [Neo4j Graph Database]                                       [FastAPI Microservices] |
|  (Person, Account, Bank, Edges)                               (Auth, ML, Graph, WS)  |
|                                                                               |   |
|                                                                               v   |
|                                                                     [WebSocket Server]|
|                                                                               |   |
|                                                                               v   |
|                                                               [React Live Dashboard] |
+-----------------------------------------------------------------------------------+
```

---

## ⚡ Quickstart Guide

### Option 1: Docker Compose (Recommended)

Start the entire platform (Kafka, Zookeeper, Neo4j, FastAPI Backend, Stream Processor, and React Dashboard) with a single command:

```bash
docker compose up --build
```

Access the applications:
- **React Analyst Dashboard**: [http://localhost:5173](http://localhost:5173)
- **FastAPI API & OpenAPI Docs**: [http://localhost:5001/docs](http://localhost:5001/docs)
- **Neo4j Browser UI**: [http://localhost:7474](http://localhost:7474) (Credentials: `neo4j` / `fingraph123`)

---

### Option 2: Local Development Setup

#### 1. Backend Setup
```bash
cd backend
python -m venv .venv
# On Windows: .venv\Scripts\activate | On Linux/macOS: source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 5001 --reload
```

#### 2. Run Backend Unit & Integration Tests
```bash
cd backend
pytest tests/
```

#### 3. Frontend Setup
```bash
cd frontend
npm install
npm run dev
```

#### 4. Continuous Stream Replay Script
```bash
python ingestion/replay.py --csv data/sample_transactions.csv --rate 2.0 --loop
```

---

## 🔐 Credentials & Demo Accounts

Default JWT Login Accounts:
- **Security Administrator**: `admin@fingraph.io` / `admin123`
- **Fraud Analyst**: `analyst@fingraph.io` / `analyst123`

---

## 📁 Repository Layout

```
/backend            FastAPI Backend (Auth, ML Engine, Neo4j queries, WebSockets)
/frontend           React Dashboard (Interactive Force Graph, Investigation Workbench)
/stream_processor   Python Kafka stream processor worker
/ingestion          Transaction CSV parser, stream replay script, latency verifier
/flink              PyFlink streaming job & consumer fallback
/data               Sample transaction datasets (IBM AML, PaySim compatible)
.github/workflows   GitHub Actions CI workflow
docker-compose.yml  Orchestration manifest for local/dev services
```
