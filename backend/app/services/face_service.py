"""
Face Recognition Service
Orchestrates face detection, embedding extraction, and identity matching.
"""

import base64
import io
import os
import logging
import numpy as np
from typing import Optional, Tuple, List, Union
from datetime import datetime
from fastapi import HTTPException

import cv2
from PIL import Image, ImageOps
from sqlalchemy.orm import Session

from ..config import settings
from ..models.student import Student
from ..ml.model_loader import FaceRecognitionModel, load_model
from ..utils.face_preprocessing import (
    detect_faces,
    crop_face_with_padding,
    align_face,
    preprocess_face,
    preprocess_all_faces,
)

def l2_normalize(embedding: np.ndarray) -> np.ndarray:
    """Explicitly L2 normalize an embedding vector."""
    norm = np.linalg.norm(embedding)
    if norm > 0:
        return embedding / norm
    return embedding

logger = logging.getLogger(__name__)

# Singleton model instance
_model: Optional[FaceRecognitionModel] = None


def get_model() -> FaceRecognitionModel:
    """Get or initialize the face recognition model."""
    global _model
    if _model is None:
        _model = load_model(
            model_type=settings.MODEL_TYPE,
            model_path=settings.MODEL_PATH,
            embedding_dim=settings.EMBEDDING_DIM,
        )
    return _model


def load_image_from_bytes(image_bytes: bytes) -> np.ndarray:
    """Decode raw image bytes, apply EXIF transpose, and return BGR numpy array."""
    try:
        image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
        # Ensure image orientation is correct based on EXIF
        image = ImageOps.exif_transpose(image)
        image_np = np.array(image)
        # Convert RGB to BGR for OpenCV
        image_bgr = cv2.cvtColor(image_np, cv2.COLOR_RGB2BGR)
        return image_bgr
    except Exception as e:
        logger.error(f"Error decoding image: {e}")
        raise HTTPException(status_code=400, detail="Định dạng ảnh không được hỗ trợ hoặc file ảnh không hợp lệ")


def load_image_from_base64(base64_str: str) -> np.ndarray:
    """Decode a base64-encoded image string to a numpy array (BGR)."""
    if "," in base64_str:
        base64_str = base64_str.split(",", 1)[1]
    
    try:
        image_bytes = base64.b64decode(base64_str)
        return load_image_from_bytes(image_bytes)
    except Exception as e:
        logger.error(f"Error decoding base64 image: {e}")
        raise HTTPException(status_code=400, detail="File ảnh không hợp lệ")

def load_image(image_data: Union[str, bytes, np.ndarray]) -> np.ndarray:
    """Helper to load image from either base64 string, raw bytes, or numpy array."""
    if isinstance(image_data, np.ndarray):
        return image_data
    elif isinstance(image_data, str):
        return load_image_from_base64(image_data)
    elif isinstance(image_data, bytes):
        return load_image_from_bytes(image_data)
    else:
        raise HTTPException(status_code=400, detail="Dữ liệu ảnh không hợp lệ")


def detect_single_face(image: np.ndarray) -> Tuple[int, int, int, int]:
    """
    Detect faces on full image. Ensure exactly 1 face exists.
    Raises HTTPException if 0 or >1 face is found.
    """
    faces = detect_faces(image)
    if not faces:
        raise HTTPException(status_code=400, detail="Không phát hiện khuôn mặt trong ảnh")
    if len(faces) > 1:
        raise HTTPException(status_code=400, detail="Ảnh chỉ được chứa một khuôn mặt")
    x, y, w, h = faces[0]["bbox"]
    return (x, y, w, h)


def crop_face_with_margin(image: np.ndarray, face_box: Tuple[int, int, int, int], margin_ratio: float = 0.25) -> np.ndarray:
    """
    Crop face based on bounding box and add a safety margin.
    Compatibility wrapper around crop_face_with_padding.
    """
    cropped = crop_face_with_padding(image, face_box, padding=margin_ratio)
    if cropped is None:
        x, y, w, h = face_box
        cropped = image[max(0, y):y+h, max(0, x):x+w]
    return cropped


def extract_embedding_from_face_crop(face_crop: np.ndarray) -> np.ndarray:
    """
    Preprocess the cropped face and extract its embedding.
    Deprecated: use preprocess_face directly on full image.
    """
    model = get_model()
    # Convert BGR to RGB
    if len(face_crop.shape) == 3 and face_crop.shape[2] == 3:
        face_rgb = cv2.cvtColor(face_crop, cv2.COLOR_BGR2RGB)
    else:
        face_rgb = face_crop
    face_resized = cv2.resize(face_rgb, (112, 112), interpolation=cv2.INTER_LINEAR)
    face_normalized = (face_resized.astype(np.float32) - 127.5) / 127.5
    embedding = model.get_embedding(face_normalized)
    return l2_normalize(embedding)


def save_snapshot(image: np.ndarray, prefix: str = "snapshot") -> str:
    """Save an image snapshot (resized to max 1280px edge) and return the relative file path."""
    h, w = image.shape[:2]
    max_edge = 1280
    if max(h, w) > max_edge:
        scale = max_edge / max(h, w)
        new_w = int(w * scale)
        new_h = int(h * scale)
        image_resized = cv2.resize(image, (new_w, new_h), interpolation=cv2.INTER_AREA)
    else:
        image_resized = image

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
    filename = f"{prefix}_{timestamp}.jpg"
    filepath = os.path.join(settings.UPLOAD_DIR, "photos", filename)
    cv2.imwrite(filepath, image_resized)
    return f"photos/{filename}"


def embedding_to_bytes(embedding: np.ndarray) -> bytes:
    """Serialize a numpy embedding to bytes for database storage."""
    return embedding.tobytes()


def bytes_to_embedding(data: bytes, dim: int = None) -> np.ndarray:
    """Deserialize bytes back to a numpy embedding."""
    if dim is None:
        dim = settings.EMBEDDING_DIM
    return np.frombuffer(data, dtype=np.float32).copy()


def identify_face(
    image_data: Union[str, bytes, np.ndarray], db: Session, threshold: Optional[float] = None
) -> Optional[Tuple[Student, float, Tuple[int, int, int, int]]]:
    """
    Identify a person from a base64-encoded image, raw bytes, or numpy array.
    Enforces exactly 1 face to be present.
    """
    image = load_image(image_data)
    
    # 1. Preprocess single face (aligns/crops, converts to RGB, normalizes)
    try:
        face_preprocessed, bbox, confidence = preprocess_face(image, require_alignment=False)
    except ValueError as ve:
        logger.info(f"preprocess_face failed: {ve}")
        raise HTTPException(status_code=400, detail=str(ve))
    
    # 2. Extract embedding and L2 normalize
    query_embedding = get_model().get_embedding(face_preprocessed)
    query_embedding = l2_normalize(query_embedding)

    # 3. Compare
    students = db.query(Student).filter(
        Student.is_active == True,
        Student.face_embedding.isnot(None),
    ).all()

    if not students:
        logger.info("No registered students with face data")
        return None

    best_match = None
    best_score = -1.0
    
    match_threshold = threshold if threshold is not None else settings.FACE_MATCH_THRESHOLD

    for std in students:
        stored_embedding = bytes_to_embedding(std.face_embedding)
        stored_embedding = l2_normalize(stored_embedding)
        score = get_model().cosine_similarity(query_embedding, stored_embedding)
        logger.info(
            f"[FACE_MATCH] student_id={std.id}, similarity={score:.4f}, threshold={match_threshold}"
        )

        if score > best_score:
            best_score = score
            best_match = std

    if best_score >= match_threshold:
        logger.info(f"Face matched: {best_match.full_name} (confidence: {best_score:.3f}), bbox: {bbox}")
        return best_match, best_score, bbox
    else:
        logger.info(f"No match found (best score: {best_score:.3f}, threshold: {match_threshold})")
        return None


def identify_all_faces(
    image_data: Union[str, bytes, np.ndarray], db: Session, threshold: Optional[float] = None
) -> List[Tuple[Optional[Student], float, Tuple[int, int, int, int]]]:
    """
    Identify all persons from a base64-encoded image, raw bytes, or numpy array.
    Does not crash on multiple faces.
    """
    model = get_model()
    image = load_image(image_data)

    # Detect and extract all faces
    faces = preprocess_all_faces(image)
    
    if not faces:
        logger.info("No face detected in the image")
        return []

    # Get all registered students
    students = db.query(Student).filter(
        Student.is_active == True,
        Student.face_embedding.isnot(None),
    ).all()
    
    logger.info(f"[GROUP_ATTENDANCE] registered_embeddings_count={len(students)}")

    results = []
    
    match_threshold = threshold if threshold is not None else settings.FACE_MATCH_THRESHOLD

    for i, (face_preprocessed, bbox, det_conf) in enumerate(faces):
        x, y, w, h = bbox
        if w < 50 or h < 50:
            logger.info(f"identify_all_faces: Ignored face of size {w}x{h} at ({x}, {y}) because it is too small (<50px)")
            continue

        query_embedding = model.get_embedding(face_preprocessed)
        query_embedding = l2_normalize(query_embedding)
        
        best_match = None
        best_score = -1.0

        if students:
            for std in students:
                stored_embedding = bytes_to_embedding(std.face_embedding)
                stored_embedding = l2_normalize(stored_embedding)
                score = model.cosine_similarity(query_embedding, stored_embedding)
                logger.info(
                    f"[FACE_MATCH] student_id={std.id}, similarity={score:.4f}, threshold={match_threshold}"
                )

                if score > best_score:
                    best_score = score
                    best_match = std

        logger.info(
            f"[GROUP_ATTENDANCE] face_{i} best_match={best_match.student_code if best_match else 'None'}, "
            f"similarity={best_score:.3f}, threshold={match_threshold}"
        )

        if best_score >= match_threshold:
            logger.info(f"Face matched: {best_match.full_name} (confidence: {best_score:.3f})")
            results.append((best_match, best_score, bbox))
        else:
            logger.info(f"No match found for a face (best score: {best_score:.3f})")
            results.append((None, best_score, bbox))

    return results


def enroll_face(student: Student, image_data: Union[str, bytes], db: Session) -> bool:
    """
    Enroll a face for a student: detect face, extract embedding, and save.
    Raises HTTPException if validation fails.
    """
    image = load_image(image_data)

    # 1. Preprocess single face (checks for exactly 1 face, aligns/crops to 112x112, normalizes to [-1, 1])
    try:
        face_preprocessed, bbox, confidence = preprocess_face(image, require_alignment=True)
    except ValueError as ve:
        logger.info(f"preprocess_face failed for enrollment: {ve}")
        raise HTTPException(status_code=400, detail=str(ve))
    
    # 2. Extract embedding and L2 normalize
    model = get_model()
    query_embedding = model.get_embedding(face_preprocessed)
    query_embedding = l2_normalize(query_embedding)

    # Check for duplicates
    students = db.query(Student).filter(
        Student.is_active == True,
        Student.face_embedding.isnot(None),
    ).all()

    best_match = None
    best_score = -1.0

    for std in students:
        stored_embedding = bytes_to_embedding(std.face_embedding)
        stored_embedding = l2_normalize(stored_embedding)
        score = get_model().cosine_similarity(query_embedding, stored_embedding)
        logger.info(
            f"[FACE_MATCH] student_id={std.id}, similarity={score:.4f}, threshold={settings.FACE_MATCH_THRESHOLD}"
        )

        if score > best_score:
            best_score = score
            best_match = std

    if best_score >= settings.FACE_MATCH_THRESHOLD:
        if best_match.id != student.id:
            raise HTTPException(
                status_code=400,
                detail=f"Khuôn mặt này đã được đăng ký cho sinh viên {best_match.full_name}"
            )

    # Save embedding
    student.face_embedding = embedding_to_bytes(query_embedding)

    # Save reference photo
    photo_path = save_snapshot(image, prefix=f"photo_{student.student_code}")
    student.photo_path = f"/uploads/{photo_path}"

    db.commit()
    db.refresh(student)

    logger.info(f"Face enrolled for student: {student.full_name}, bbox: {bbox}")
    return True


def detect_faces_in_image(image_data: Union[str, bytes]) -> List[dict]:
    """Detect all faces in an image and return bounding boxes/confidence."""
    image = load_image(image_data)
    faces = detect_faces(image)
    return [{"x": face["bbox"][0], "y": face["bbox"][1], "w": face["bbox"][2], "h": face["bbox"][3], "confidence": face["confidence"]} for face in faces]

