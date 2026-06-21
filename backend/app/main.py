"""
Face Attendance System — FastAPI Backend
Main application entry point.
"""

import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from .config import settings
from .database import init_db
from .routers import (
    auth_router,
    students_router,
    attendance_router,
    recognition_router,
    reports_router,
    classes_router,
    sessions_router,
)
from .services.face_service import get_model

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifecycle: startup and shutdown events."""
    # Startup
    logger.info("🚀 Starting Face Attendance System...")
    init_db()
    logger.info("✅ Database initialized")

    # Pre-load face recognition model
    model = get_model()
    logger.info(f"✅ Face recognition model loaded ({settings.MODEL_TYPE})")

    # Seed default admin user if none exists
    _seed_admin()

    yield

    # Shutdown
    logger.info("👋 Shutting down Face Attendance System")


def _seed_admin():
    """Create a default admin user if no users exist."""
    from .database import SessionLocal
    from .models.user import User
    from .routers.auth import get_password_hash

    db = SessionLocal()
    try:
        if db.query(User).count() == 0:
            admin = User(
                username="admin",
                hashed_password=get_password_hash("admin123"),
                full_name="Administrator",
                role="teacher",
            )
            db.add(admin)
            db.commit()
            logger.info("✅ Default admin user created (admin / admin123)")
    finally:
        db.close()


# Create FastAPI app
app = FastAPI(
    title="Face Attendance System",
    description="Hệ thống điểm danh bằng nhận diện khuôn mặt",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, restrict to your frontend domain
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount static files for uploaded photos
uploads_dir = os.path.abspath(settings.UPLOAD_DIR)
if os.path.exists(uploads_dir):
    app.mount("/uploads", StaticFiles(directory=uploads_dir), name="uploads")

# Include routers
app.include_router(auth_router)
app.include_router(students_router)
app.include_router(attendance_router)
app.include_router(recognition_router)
app.include_router(reports_router)
app.include_router(classes_router)
app.include_router(sessions_router)

# Mount frontend static files
frontend_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "frontend"))
if os.path.exists(frontend_dir):
    app.mount("/", StaticFiles(directory=frontend_dir, html=True), name="frontend")
else:
    logger.warning(f"Frontend directory not found at {frontend_dir}")



@app.get("/api/health")
def health_check():
    return {"status": "healthy"}
