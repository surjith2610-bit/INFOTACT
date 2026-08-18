from fastapi import APIRouter, Depends

from app.auth.routes import get_current_user
from app.services.detection import run_gds_algorithms, find_starburst_patterns, get_graph_sample

router = APIRouter(prefix="/graph", tags=["graph"])


@router.get("/overview")
async def graph_overview(limit: int = 300, user=Depends(get_current_user)):
    """Nodes + edges for the network visualization."""
    return get_graph_sample(limit)


@router.post("/run-detection")
async def run_detection(min_distinct_senders: int = 8, user=Depends(get_current_user)):
    """
    Runs GDS PageRank/WCC (syndicate scoring) then the starburst heuristic
    (which accounts actually look like a smurfing hub). This is the button
    the analyst clicks on the dashboard.
    """
    gds_result = run_gds_algorithms()
    alerts = find_starburst_patterns(min_distinct_senders)
    return {"gds": gds_result, "alerts": alerts, "alert_count": len(alerts)}
