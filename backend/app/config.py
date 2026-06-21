import os
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # Database
    DATABASE_URL: str = "sqlite:///./face_attendance.db"

    # JWT Auth
    SECRET_KEY: str = "face-attendance-secret-key-change-in-production-2024"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 480

    # Face Recognition Model
    MODEL_PATH: str = os.path.join(os.path.dirname(__file__), "ml", "models")
    MODEL_TYPE: str = "pytorch"  # "onnx", "pytorch", or "demo"
    MODEL_INPUT_SIZE: int = 112  # Model input image size (e.g., 112, 160, 224)
    EMBEDDING_DIM: int = 512  # Embedding vector dimension

    # Face matching
    FACE_CONFIDENCE_THRESHOLD: float = 0.4
    FACE_MATCH_THRESHOLD: float = 0.55  # Cosine similarity threshold
    DEBUG_FACE_CROP: bool = False  # Enable to save debug crop images

    # Attendance rules
    WORK_START_HOUR: int = 8
    WORK_START_MINUTE: int = 30
    LATE_THRESHOLD_MINUTES: int = 15  # Minutes after work start to be considered late

    # File uploads
    UPLOAD_DIR: str = os.path.join(os.path.dirname(__file__), "..", "uploads")

    class Config:
        env_file = ".env"
        extra = "ignore"


settings = Settings()

# Ensure upload directory exists
os.makedirs(settings.UPLOAD_DIR, exist_ok=True)
os.makedirs(os.path.join(settings.UPLOAD_DIR, "photos"), exist_ok=True)
os.makedirs(settings.MODEL_PATH, exist_ok=True)
