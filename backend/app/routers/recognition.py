"""Face recognition API router: identify, enroll, and detect."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session
from pydantic import BaseModel

from ..database import get_db
from ..models.student import Student
from ..models.user import User
from ..schemas.attendance import RecognitionResult
from ..services import face_service
from .auth import get_current_user
from ..utils.timezone import get_vn_today

router = APIRouter(prefix="/api/recognition", tags=["Face Recognition"])


class ImagePayload(BaseModel):
    image: str  # base64 encoded


class EnrollPayload(BaseModel):
    student_id: int
    image: str  # base64 encoded


@router.post("/identify", response_model=RecognitionResult)
def identify_face(
    payload: ImagePayload,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Identify a person from a camera image."""
    result = face_service.identify_face(payload.image, db)
    if result is None:
        raise HTTPException(
            status_code=404,
            detail="Không nhận diện được khuôn mặt hoặc không tìm thấy sinh viên phù hợp",
        )

    student, confidence, bbox = result

    # Check if already checked in today
    from ..models.attendance import Attendance
    today = get_vn_today()
    existing = (
        db.query(Attendance)
        .filter(
            Attendance.student_id == student.id,
            func.date(Attendance.checkin_time) == today.strftime("%Y-%m-%d")
        )
        .first()
    )

    return RecognitionResult(
        student_id=student.id,
        student_code=student.student_code,
        student_name=student.full_name,
        class_name=student.class_name,
        confidence=round(confidence, 4),
        photo_path=student.photo_path,
        already_marked=existing is not None,
    )


from typing import List

class MultipleRecognitionResult(BaseModel):
    results: List[dict]


@router.post("/identify-multiple", response_model=MultipleRecognitionResult)
def identify_multiple_faces(
    payload: ImagePayload,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Identify multiple persons from a camera image or uploaded image."""
    faces = face_service.identify_all_faces(payload.image, db)
    
    if not faces:
        raise HTTPException(
            status_code=404,
            detail="Không tìm thấy khuôn mặt nào trong ảnh",
        )
        
    from ..models.attendance import Attendance
    today = get_vn_today()

    response_results = []
    
    for student, confidence, bbox in faces:
        if student is None:
            response_results.append({
                "student_id": None,
                "student_name": "Unknown",
                "student_code": None,
                "class_name": None,
                "similarity": round(confidence, 4),
                "confidence": round(confidence, 4),
                "bbox": {"x": bbox[0], "y": bbox[1], "width": bbox[2], "height": bbox[3], "w": bbox[2], "h": bbox[3]},
                "status": "unknown",
                "already_marked": False
            })
            continue

        # Check if already checked in today
        existing = (
            db.query(Attendance)
            .filter(
                Attendance.student_id == student.id,
                func.date(Attendance.checkin_time) == today.strftime("%Y-%m-%d")
            )
            .first()
        )
        
        response_results.append({
            "student_id": student.id,
            "student_code": student.student_code,
            "student_name": student.full_name,
            "class_name": student.class_name,
            "similarity": round(confidence, 4),
            "confidence": round(confidence, 4),
            "photo_path": student.photo_path,
            "bbox": {"x": bbox[0], "y": bbox[1], "width": bbox[2], "height": bbox[3], "w": bbox[2], "h": bbox[3]},
            "status": "recognized",
            "already_marked": existing is not None
        })

    return MultipleRecognitionResult(results=response_results)


@router.post("/enroll")
def enroll_face(
    payload: EnrollPayload,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Enroll a face for a student."""
    student = db.query(Student).filter(Student.id == payload.student_id).first()
    if not student:
        raise HTTPException(status_code=404, detail="Không tìm thấy sinh viên")

    success = face_service.enroll_face(student, payload.image, db)
    if not success:
        raise HTTPException(
            status_code=400,
            detail="Không phát hiện được khuôn mặt trong ảnh. Vui lòng thử lại.",
        )

    return {
        "message": f"Đã đăng ký khuôn mặt cho {student.full_name}",
        "student_id": student.id,
        "photo_path": student.photo_path,
    }


@router.post("/detect")
def detect_faces(
    payload: ImagePayload,
    current_user: User = Depends(get_current_user),
):
    """Detect faces in an image (returns bounding boxes only)."""
    faces = face_service.detect_faces_in_image(payload.image)
    return {"faces": faces, "count": len(faces)}
