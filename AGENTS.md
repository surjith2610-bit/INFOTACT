# FinGraph — Real-Time Fraud Syndicate Analytics

## What this project is
A team academic/portfolio project (Infotact Solutions brief, team of 3-4) that detects money-laundering syndicates in bank transactions using streaming graph analytics instead of relational rule checks. The insight to protect everywhere in this codebase: laundering rings hide by splitting large transfers into many small ones through accounts that look unrelated ("smurfing"/"starburst" patterns), and by moving money in loops (A→B→C→A). A graph makes both visible; a table of transactions doesn't.

## Current status — read this before touching anything
This folder may already contain a partial build from earlier AI-assisted work: a Kafka+Flink+Neo4j version and a separate MEAN-stack exploration. We're standardizing on the **Kafka + Flink + Neo4j** stack described below. Before writing any new code:
1. Explore the repo.
2. Report exactly what already works, what's stubbed, and what's missing or broken, against this spec.
3. If you find MEAN-stack code, flag it — don't delete anything until it's confirmed.
4. Propose a plan and wait for a go-ahead before starting Phase 1.

## Tech stack — ask before substituting anything here
- **Data source**: the "IBM Transactions for Anti-Money Laundering (AML)" dataset on Kaggle — it has labeled laundering patterns and real sender→receiver account structure (verify it's still up; PaySim is the backup). Avoid datasets like the ULB Credit Card Fraud set — those are single anonymized rows with no account-to-account structure, so there's nothing to graph.
- **Ingestion/replay**: a Python script streaming rows from that dataset into Kafka at a controlled rate, to simulate live arrivals.
- **Batch path**: a separate CSV-upload endpoint + page for one-off analysis on an arbitrary uploaded file, outside the live stream.
- **Streaming**: Kafka + Apache Flink — consume, clean/dedupe, stateful aggregation, continuous upsert into Neo4j.
- **Graph DB**: Neo4j Community Edition. Nodes: `Person`, `Account`, `Bank`. Edges: `TRANSFERRED_TO` (amount, timestamp), `SHARED_IP` if the dataset supports it.
- **Graph algorithms**: Neo4j GDS, free/community tier (double-check current limits when set up) — PageRank + Weakly Connected Components for centrality/clustering, Louvain for community detection. Persist scores back onto nodes as a risk score.
- **Backend**: Python FastAPI — owns the Cypher query layer, auth, and the CSV-upload endpoint.
- **Frontend**: React. For the graph view, default to **Neovis.js or react-force-graph** (free/open-source) instead of Linkurious (commercial) unless told otherwise. Superset is fine as an optional second dashboard for aggregate counts/trends — it isn't built for interactive node graphs, so don't use it for the main view.
- **Alerts**: Slack incoming webhook (free) + email via SMTP (free tier), fired when a node's risk score crosses a threshold.
- **Auth**: email+password signup/login, Google reCAPTCHA (free), Google OAuth login (free). OTP defaults to **email** (free via SMTP) — mobile/SMS OTP is a stretch goal only, since providers like Twilio/MSG91 are paid past a small trial credit; build it behind a flag and report the real cost before wiring it up live.
- **Orchestration**: one `docker compose up` should start Kafka, Flink, Neo4j, the backend, and the frontend together.

## Suggested repo layout
```
/ingestion    Python replay script, Kafka producer, CSV-upload parser
/streaming    Flink job(s)
/graph        Neo4j schema, Cypher queries, GDS pipeline scripts
/api          FastAPI backend (auth, query endpoints, CSV upload)
/frontend     React app
/infra        docker-compose.yml, .env.example
/docs         README, architecture diagram, demo script
```
Adjust this if a better structure fits — it's a starting point, not a rule. Keep the boundaries clean either way, since 3-4 people will be working in this repo at once.

## Non-negotiables
- No real customer financial data or PII — Kaggle dataset or synthetic data only.
- Everything runs locally via `docker compose up`, so it's demoable on a laptop in an interview.
- Kafka, Flink, Neo4j/Cypher and GDS are all new — comment the *why*, not just the *what*, in those parts. Python basics, Pandas, SQL up to GROUP BY, HTML/CSS/React, and Java full-stack are already familiar — no need to over-explain those.

## Definition of done — from the actual assignment brief
- A replayed transaction appears as a connected edge in Neo4j in under 1 second. Write a small script that proves this, and re-run it whenever the pipeline changes.
- Multi-hop Cypher queries (circular-flow detection, cluster lookups) run in under 100ms — the assignment's own target. Add indexes/constraints to get there, but treat it as a goal, not a blocker: if the real number lands around 120–150ms after reasonable optimization on a student-sized dataset, report it honestly rather than losing days chasing the last bit.
- The dashboard visually surfaces at least one starburst/funnel pattern and one circular-flow pattern, and a flagged cluster is clickable through to the underlying accounts.
- A Slack or email alert fires automatically when a risk score crosses the threshold.
- The README explains the architecture and how to demo the whole thing in under 5 minutes.

## How to work
- Propose a plan before writing code; wait for a go-ahead on anything architectural.
- One phase at a time. Finish a phase, summarize what changed / how to run it / how to test it, then stop for review before starting the next.
- Commit to git after each working milestone, with a clear message.
- State assumptions and proceed on small ambiguities; flag anything bigger instead of guessing.
- If Flink setup becomes a major time sink, fall back to a plain Python Kafka consumer doing the same job, note it as a known simplification, and keep moving.
