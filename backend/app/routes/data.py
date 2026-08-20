from fastapi import APIRouter, UploadFile, File
from app.routes.api import upload_csv as api_upload_csv, generate_synthetic as api_generate_synthetic

router = APIRouter(prefix="/data", tags=["data"])


@router.post("/upload-csv")
async def upload_csv(file: UploadFile = File(...)):
    """Legacy endpoint wrapper for uploading transaction CSV."""
    return await api_upload_csv(file)


@router.post("/generate")
async def generate_synthetic_data(
    normal_accounts: int = 40,
    normal_transactions: int = 150,
    inject_smurfing_ring: bool = True,
):
    """Legacy endpoint wrapper for synthetic dataset generation."""
    return await api_generate_synthetic(
        normal_accounts=normal_accounts,
        normal_transactions=normal_transactions,
        inject_smurfing_ring=inject_smurfing_ring,
    )
