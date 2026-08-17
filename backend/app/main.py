import logging
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.database import init_neo4j_constraints
from app.services.seed import seed_database
from app.routes.api import router as api_router
from app.auth.routes import router as auth_router
from app.routes.data import router as legacy_data_router
from app.routes.graph import router as legacy_graph_router

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
)
logger = logging.getLogger("backend")

app = FastAPI(
    title=settings.APP_NAME,
    description="Real-Time Fraud Syndicate Analytics API",
    version="2.0.0"
)

# CORS configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        settings.FRONTEND_ORIGIN,
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:3000",
        "http://localhost:5000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount primary API router & auth/legacy routers
app.include_router(api_router)
app.include_router(auth_router)
app.include_router(legacy_data_router)
app.include_router(legacy_graph_router)


@app.on_event("startup")
def on_startup():
    logger.info(f"[BACKEND] Initializing {settings.APP_NAME} services...")
    try:
        init_neo4j_constraints()
        if settings.SEED_DATA:
            seed_database()
    except Exception as e:
        logger.warning(f"[BACKEND] Startup seed initialization warning: {e}")


@app.get("/health")
def health_check():
    return {
        "status": "ok",
        "service": settings.APP_NAME,
        "port": settings.PORT,
        "env": settings.ENV
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host="0.0.0.0", port=settings.PORT, reload=True)
