# FinGraph — Real-Time Fraud Syndicate Analytics

FinGraph is an enterprise-grade financial fraud and Anti-Money Laundering (AML) detection platform. It processes streaming transaction records through Apache Kafka, models graph topologies in Neo4j, executes real-time and windowed fraud detection rules, exposes standardized REST APIs, and renders an interactive force-directed graph dashboard for financial crime analysts.

---

## 1. System Architecture

```
                                  ┌────────────────────────┐
                                  │ Synthetic Generator /  │
                                  │ CSV Dataset Upload     │
                                  └───────────┬────────────┘
                                              │
                                              ▼
┌────────────────────────┐        ┌────────────────────────┐        ┌────────────────────────┐
│  React Analyst Desk    │ <====> │   FastAPI Backend API  │ ====>  │ Kafka Event Stream     │
│  (Port 5173)           │        │   (Port 5000)          │        │ (Topic: fingraph-tx)   │
└────────────────────────┘        └───────────┬────────────┘        └───────────┬────────────┘
                                              │                                 │
                                              ▼                                 ▼
                                  ┌────────────────────────┐        ┌────────────────────────┐
                                  │ Neo4j Graph Database   │ <====  │ Python Stream          │
                                  │ (Accounts, Transfers,  │        │ Processing Worker      │
                                  │  FraudAlerts)          │        │ (Real-Time Rules)      │
                                  └────────────────────────┘        └────────────────────────┘
```

---

## 2. Fraud Detection Rules Engine

FinGraph includes a modular fraud engine detecting four critical AML typologies:

1. **Smurfing & Structuring (`detect_smurfing`)**
   - Detects multiple lower-value transfers funneled from distinct sender accounts into a central receiver/shell account within a configurable time window.
   - Highlights shared infrastructure tells (IP address overlap) and structuring beneath reporting thresholds ($10,000).

2. **Circular Money Transfers (`detect_circular_transfers`)**
   - Performs graph traversal up to a configurable maximum cycle depth (`CIRCULAR_MAX_DEPTH`) to spot money cycling patterns (e.g. `A -> B -> C -> A` or `A -> B -> A`).

3. **High-Frequency Velocity (`detect_high_frequency`)**
   - Identifies accounts initiating or receiving an abnormally high number of transactions within a short timeframe (`HIGH_FREQUENCY_COUNT` in `HIGH_FREQUENCY_WINDOW_MINUTES`).

4. **Large Transaction Threshold Exceeded (`detect_large_transaction`)**
   - Flags individual transfers exceeding configurable financial thresholds (`LARGE_TRANSACTION_THRESHOLD`).

---

## 3. Prerequisites & Environment Setup

| Requirement | Supported Version | Purpose |
|---|---|---|
| [Docker Desktop](https://www.docker.com/products/docker-desktop/) | Latest | Container orchestration for Kafka, Neo4j, Backend, Worker & Frontend |
| [Node.js](https://nodejs.org/) | 18+ | Frontend dashboard runtime |
| [Python](https://www.python.org/) | 3.11+ | Backend API & stream processor worker |

### Environment Configuration

Copy `.env.example` to create your active `.env` file:

```bash
cp .env.example .env
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
```

#### Core Environment Variables

| Variable | Default Value | Description |
|---|---|---|
| `PORT` | `5000` | Backend REST API server port |
| `KAFKA_BOOTSTRAP_SERVERS` | `kafka:9092` (Docker) / `localhost:9092` (Local) | Kafka broker address |
| `KAFKA_TOPIC_TRANSACTIONS` | `fingraph-transactions` | Primary streaming event topic |
| `NEO4J_URI` | `bolt://neo4j:7687` (Docker) / `bolt://localhost:7687` (Local) | Neo4j Bolt protocol URI |
| `NEO4J_USER` | `neo4j` | Database username |
| `NEO4J_PASSWORD` | `fingraph123` | Database password |
| `SEED_DATA` | `true` | Idempotent demo data generator switch |
| `DATA_PATH` | `./data/sample_transactions.csv` | Default CSV dataset location |
| `VITE_API_URL` | `http://localhost:5000` | Frontend backend API target URL |

---

## 4. Automated Startup (Docker Compose)

Run the entire FinGraph stack end-to-end with a single command:

```bash
docker compose up --build
```

### Services Started:

- **Frontend Analyst Dashboard**: http://localhost:5173
- **FastAPI Backend REST API**: http://localhost:5000 (Interactive OpenAPI Docs: http://localhost:5000/docs)
- **Neo4j Browser Console**: http://localhost:7474 (Credentials: `neo4j` / `fingraph123`)
- **Kafka Broker**: `localhost:9092` / `localhost:29092`
- **Stream Processing Consumer**: Containerized worker consuming events in real-time.

---

## 5. Local Development Startup (Without Docker)

If running individual components locally outside Docker containers:

### Step 1: Start Databases (Kafka & Neo4j)
```bash
docker compose up kafka neo4j zookeeper
```

### Step 2: Start Backend API
```bash
cd backend
pip install -r requirements.txt
python -m app.main
```

### Step 3: Start Stream Processing Worker
```bash
pip install -r stream_processor/requirements.txt
python stream_processor/main.py
```

### Step 4: Start Frontend Analyst Dashboard
```bash
cd frontend
npm install
npm run dev
```

Open **http://localhost:5173** to launch the analyst dashboard desk.

---

## 6. REST API Endpoint Reference

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/health` | API health check & service status |
| `GET` | `/api/stats` | Executive metrics (total accounts, transactions, alert counts) |
| `GET` | `/api/accounts` | Graph account nodes list & risk scores |
| `GET` | `/api/transactions` | Recent transactions log payload |
| `GET` | `/api/fraud-alerts` | Active stored fraud alerts list |
| `GET` | `/api/fraud-alerts/{id}` | Detailed alert inspection by ID |
| `GET` | `/api/graph` | Force-directed graph topology (nodes & links) |
| `POST` | `/api/fraud/detect` | Execute modular fraud detection engine |
| `POST` | `/api/data/upload-csv` | Upload custom transaction CSV dataset |
| `POST | `/api/data/generate` | Generate synthetic dataset with planted syndicate ring |

---

## 7. Automated Testing Suite

Execute the Python test suite verifying API routes, dataset ingestion, and fraud detection logic:

```bash
python -m pytest backend/tests/test_pipeline.py
```

Validate frontend production build:

```bash
cd frontend
npm run build
```

---

## 8. Windows & Docker Troubleshooting Guide

### 1. Docker Desktop / Engine Connection Failure
- **Symptom**: `failed to connect to docker API`, `npipe`, or `Docker Desktop Linux Engine not found`.
- **Solution**: Open Docker Desktop on Windows. Ensure "Use the WSL 2 based engine" is enabled under Settings -> General. Run PowerShell as Administrator and verify `docker info` completes cleanly.

### 2. Kafka Connection Refused / Advertised Listener Error
- **Symptom**: `NoBrokersAvailable` or connection timeouts.
- **Solution**: Inside Docker containers, use `kafka:9092`. For applications running directly on Windows host, set `KAFKA_BOOTSTRAP_SERVERS=localhost:9092` or `localhost:29092`.

### 3. `EADDRINUSE: address already in use :::5000`
- **Symptom**: Backend server fails to start because port 5000 is occupied.
- **Solution**: Find the running process on Windows using PowerShell:
  ```powershell
  Get-NetTCPConnection -LocalPort 5000 | Select-Object OwningProcess
  ```
  Terminate the process if appropriate, or set a custom port in `.env` (e.g. `PORT=8000`).

### 4. PowerShell Script Execution Policy
- **Symptom**: `npm` or `vite` commands blocked by execution policy.
- **Solution**: Run PowerShell as Administrator and execute:
  ```powershell
  Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
  ```

### 5. Frontend Cannot Reach Backend / CORS Error
- **Symptom**: Dashboard displays "Unable to reach backend API server".
- **Solution**: Verify `VITE_API_URL` in `frontend/.env` matches the backend host/port (`http://localhost:5000`), and `FRONTEND_ORIGIN` in `backend/.env` allows `http://localhost:5173`.
