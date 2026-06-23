"""Attendance router: check-in, history, and today's records."""

from datetime import date as date_type, datetime
from typing import Optional, List
import os
import tempfile
import cv2

from fastapi import APIRouter, Depends, HTTPException, Query, File, Form, UploadFile
from sqlalchemy.orm import Session

from ..config import settings
from ..database import get_db
from ..models.attendance import Attendance
from ..models.student import Student
from ..models.user import User
from ..models.session import Session as SessionModel
from ..schemas.attendance import (
    AttendanceMarkPresent,
    AttendanceResponse,
    AttendanceStats,
    AttendanceTodayResponse,
    GroupAttendanceResponse,
    GroupAttendanceResult,
    BBox,
    ScanFrameResponse,
    ScanFrameResult,
)
import logging
from ..services import face_service
from .auth import get_current_user

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/attendance", tags=["Attendance"])


def _build_response(record: Attendance) -> AttendanceResponse:
    emp = record.student
    sess = record.session
    c_name = emp.class_name if emp else None
    s_name = None
    if sess:
        s_name = sess.subject.subject_name if sess.subject else ""
        if sess.course_class:
            c_name = sess.course_class.class_name

    return AttendanceResponse(
        id=record.id,
        student_id=record.student_id,
        student_name=emp.full_name if emp else None,
        student_code=emp.student_code if emp else None,
        class_name=c_name,
        session_id=record.session_id,
        session_name=s_name,
        photo_path=emp.photo_path if emp else None,
        checkin_time=record.checkin_time,
        status=record.status,
        confidence=record.confidence,
        note=record.note,
    )


def _determine_status(check_in_time: datetime, session: SessionModel) -> str:
    """Determine attendance status based on session time."""
    start = session.start_time
    # handle tzinfo mismatch if any
    if start.tzinfo is not None and check_in_time.tzinfo is None:
        check_in_time = check_in_time.replace(tzinfo=start.tzinfo)
    elif start.tzinfo is None and check_in_time.tzinfo is not None:
        start = start.replace(tzinfo=check_in_time.tzinfo)

    late_minutes = getattr(session, 'late_after_minutes', 15)
    late_threshold = start + __import__("datetime").timedelta(minutes=late_minutes)

    if check_in_time <= late_threshold:
        return "present"
    else:
        return "late"


def resolve_threshold(threshold: Optional[float]) -> float:
    if threshold is None:
        return settings.FACE_MATCH_THRESHOLD

    try:
        value = float(threshold)
    except (TypeError, ValueError):
        return settings.FACE_MATCH_THRESHOLD

    return max(0.30, min(0.90, value))


@router.post("/mark", response_model=GroupAttendanceResponse)
def mark_attendance(
    payload: AttendanceMarkPresent,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Mark attendance using group face recognition."""
    # Lấy thông tin ca học
    session_obj = db.query(SessionModel).filter(SessionModel.id == payload.session_id).first()
    if not session_obj:
        raise HTTPException(status_code=400, detail="Ca học không tồn tại")

    from ..utils.timezone import get_vn_now, to_vn_datetime
    now = get_vn_now()
    start_cmp = to_vn_datetime(session_obj.start_time)
    end_cmp = to_vn_datetime(session_obj.end_time)
    
    if now < start_cmp:
        raise HTTPException(status_code=400, detail="Ca học chưa bắt đầu")
        
    if now > end_cmp:
        raise HTTPException(status_code=400, detail="Ca học đã kết thúc")

    # Resolve threshold
    validated_threshold = resolve_threshold(payload.threshold)

    # Identify all faces
    faces_results = face_service.identify_all_faces(payload.image, db, threshold=validated_threshold)
    
    logger.info(f"Group Attendance: Detected {len(faces_results)} faces in the image with threshold {validated_threshold}")
    
    if not faces_results:
        return GroupAttendanceResponse(
            success=False,
            total_faces_detected=0,
            recognized_count=0,
            unknown_count=0,
            results=[]
        )

    unknown_results = []
    best_matches = {}

    for student, confidence, bbox in faces_results:
        x, y, w, h = bbox
        bbox_obj = BBox(x=x, y=y, width=w, height=h)
        
        if student is None:
            logger.info(f"Group Attendance: Unknown face at bbox {x,y,w,h} (confidence {confidence:.3f})")
            unknown_results.append({
                "student_name": "Không xác định",
                "status": "unknown",
                "confidence": confidence,
                "bbox": bbox_obj
            })
        else:
            student_id = student.id
            if student_id not in best_matches:
                best_matches[student_id] = {
                    "student": student,
                    "confidence": confidence,
                    "bbox": bbox_obj
                }
            else:
                old_match = best_matches[student_id]
                if confidence > old_match["confidence"]:
                    # Push old match to unknowns
                    unknown_results.append({
                        "student_name": "Không xác định",
                        "status": "unknown",
                        "confidence": old_match["confidence"],
                        "bbox": old_match["bbox"]
                    })
                    best_matches[student_id] = {
                        "student": student,
                        "confidence": confidence,
                        "bbox": bbox_obj
                    }
                else:
                    # Push new match to unknowns
                    unknown_results.append({
                        "student_name": "Không xác định",
                        "status": "unknown",
                        "confidence": confidence,
                        "bbox": bbox_obj
                    })
                    
    results = []
    
    from sqlalchemy.exc import IntegrityError
    
    for student_id, match in best_matches.items():
        student = match["student"]
        confidence = match["confidence"]
        bbox_obj = match["bbox"]
        
        if student.class_id != session_obj.class_id:
            results.append(GroupAttendanceResult(
                student_id=student.id,
                student_name=student.full_name,
                status="not_in_class",
                confidence=confidence,
                bbox=bbox_obj
            ))
            continue
            
        existing = (
            db.query(Attendance)
            .filter(Attendance.student_id == student.id, Attendance.session_id == session_obj.id)
            .first()
        )

        if existing:
            results.append(GroupAttendanceResult(
                student_id=student.id,
                student_name=student.full_name,
                status="already_marked",
                confidence=confidence,
                bbox=bbox_obj,
                checkin_time=existing.checkin_time
            ))
            continue

        status = _determine_status(now, session_obj)
        attendance = Attendance(
            student_id=student.id,
            session_id=session_obj.id,
            checkin_time=now,
            status=status,
            confidence=confidence,
        )
        try:
            db.add(attendance)
            db.commit()
            results.append(GroupAttendanceResult(
                student_id=student.id,
                student_name=student.full_name,
                status=status,
                confidence=confidence,
                bbox=bbox_obj,
                checkin_time=attendance.checkin_time
            ))
        except IntegrityError:
            db.rollback()
            existing_err = (
                db.query(Attendance)
                .filter(Attendance.student_id == student.id, Attendance.session_id == session_obj.id)
                .first()
            )
            checkin_time_err = existing_err.checkin_time if existing_err else None
            results.append(GroupAttendanceResult(
                student_id=student.id,
                student_name=student.full_name,
                status="already_marked",
                confidence=confidence,
                bbox=bbox_obj,
                checkin_time=checkin_time_err
            ))

    for u in unknown_results:
        results.append(GroupAttendanceResult(
            student_id=None,
            student_name=u["student_name"],
            status=u["status"],
            confidence=u["confidence"],
            bbox=u["bbox"]
        ))
        
    recognized_count = sum(1 for r in results if r.status in ("present", "late", "already_marked"))
    unknown_count = len(unknown_results)
    
    logger.info(f"Group Attendance Summary: {recognized_count} recognized, {unknown_count} unknown.")
    
    return GroupAttendanceResponse(
        success=True,
        total_faces_detected=len(faces_results),
        recognized_count=recognized_count,
        unknown_count=unknown_count,
        results=results
    )


@router.post("/scan-frame", response_model=ScanFrameResponse)
def scan_attendance_frame(
    payload: AttendanceMarkPresent,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Scan a frame to identify faces without writing to the database."""
    # 1. Validate session
    session_obj = db.query(SessionModel).filter(SessionModel.id == payload.session_id).first()
    if not session_obj:
        raise HTTPException(status_code=400, detail="Ca học không tồn tại")

    from ..utils.timezone import get_vn_now, to_vn_datetime
    now = get_vn_now()
    start_cmp = to_vn_datetime(session_obj.start_time)
    end_cmp = to_vn_datetime(session_obj.end_time)
    
    if now < start_cmp:
        raise HTTPException(status_code=400, detail="Ca học chưa bắt đầu")
        
    if now > end_cmp:
        raise HTTPException(status_code=400, detail="Ca học đã kết thúc")

    # 2. Resolve threshold
    validated_threshold = resolve_threshold(payload.threshold)

    # 3. Identify all faces
    faces_results = face_service.identify_all_faces(payload.image, db, threshold=validated_threshold)
    
    results = []
    total_faces_detected = 0
    recognized_count = 0
    unknown_count = 0

    best_matches = {}
    unknown_results = []

    for student, confidence, bbox in faces_results:
        x, y, w, h = bbox
        
        # Filter out faces that are too small (width < 50px or height < 50px)
        if w < 50 or h < 50:
            logger.info(f"Scan Frame: Ignored face of size {w}x{h} at ({x}, {y}) because it is too small (<50px)")
            continue

        total_faces_detected += 1
        bbox_obj = BBox(x=x, y=y, width=w, height=h)

        if student is None:
            unknown_count += 1
            unknown_results.append({
                "student_name": "Không xác định",
                "confidence": confidence,
                "bbox": bbox_obj
            })
        else:
            student_id = student.id
            if student_id not in best_matches:
                best_matches[student_id] = {
                    "student": student,
                    "confidence": confidence,
                    "bbox": bbox_obj
                }
            else:
                old_match = best_matches[student_id]
                if confidence > old_match["confidence"]:
                    unknown_count += 1
                    unknown_results.append({
                        "student_name": "Không xác định",
                        "confidence": old_match["confidence"],
                        "bbox": old_match["bbox"]
                    })
                    best_matches[student_id] = {
                        "student": student,
                        "confidence": confidence,
                        "bbox": bbox_obj
                    }
                else:
                    unknown_count += 1
                    unknown_results.append({
                        "student_name": "Không xác định",
                        "confidence": confidence,
                        "bbox": bbox_obj
                    })

    for student_id, match in best_matches.items():
        student = match["student"]
        confidence = match["confidence"]
        bbox_obj = match["bbox"]

        # Determine suggested status
        suggested_status = _determine_status(now, session_obj)
        
        # Check if they are in this class
        if student.class_id != session_obj.class_id:
            results.append(ScanFrameResult(
                student_id=student.id,
                student_name=student.full_name,
                confidence=confidence,
                recognition_status="recognized",
                suggested_attendance_status="unknown",  # not in class
                bbox=bbox_obj,
                is_committed=False,
                message="Sinh viên không thuộc lớp học này"
            ))
            recognized_count += 1
            continue

        # Check duplicate checkin
        existing = (
            db.query(Attendance)
            .filter(Attendance.student_id == student.id, Attendance.session_id == session_obj.id)
            .first()
        )

        if existing:
            results.append(ScanFrameResult(
                student_id=student.id,
                student_name=student.full_name,
                confidence=confidence,
                recognition_status="already_marked",
                suggested_attendance_status=existing.status,
                bbox=bbox_obj,
                is_committed=False,
                message="Đã điểm danh"
            ))
        else:
            results.append(ScanFrameResult(
                student_id=student.id,
                student_name=student.full_name,
                confidence=confidence,
                recognition_status="recognized",
                suggested_attendance_status=suggested_status,
                bbox=bbox_obj,
                is_committed=False,
                message="Chưa điểm danh (Sẵn sàng quét)"
            ))
        recognized_count += 1

    for u in unknown_results:
        results.append(ScanFrameResult(
            student_id=None,
            student_name=u["student_name"],
            confidence=u["confidence"],
            recognition_status="unknown",
            suggested_attendance_status="unknown",
            bbox=u["bbox"],
            is_committed=False,
            message="Không nhận diện được khuôn mặt"
        ))

    return ScanFrameResponse(
        success=True,
        total_faces_detected=total_faces_detected,
        recognized_count=recognized_count,
        unknown_count=unknown_count,
        results=results
    )


# Constants for video processing
MAX_VIDEO_SECONDS = 2
VIDEO_SAMPLE_FPS = 3
MAX_VIDEO_FRAMES = 8
MIN_FRAMES_TO_CONFIRM = 1


@router.post("/mark-video", response_model=GroupAttendanceResponse)
async def mark_attendance_video(
    video: UploadFile = File(...),
    session_id: int = Form(...),
    threshold: Optional[float] = Form(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Mark attendance using a short recorded video clip."""
    # 1. Validate session
    session_obj = db.query(SessionModel).filter(SessionModel.id == session_id).first()
    if not session_obj:
        raise HTTPException(status_code=400, detail="Ca học không tồn tại")

    from ..utils.timezone import get_vn_now, to_vn_datetime
    now = get_vn_now()
    start_cmp = to_vn_datetime(session_obj.start_time)
    end_cmp = to_vn_datetime(session_obj.end_time)
    
    if now < start_cmp:
        raise HTTPException(status_code=400, detail="Ca học chưa bắt đầu")
        
    if now > end_cmp:
        raise HTTPException(status_code=400, detail="Ca học đã kết thúc")

    # 2. Validate threshold
    validated_threshold = resolve_threshold(threshold)

    # 3. Save uploaded video to temp file
    temp_path = None
    frames = []
    
    try:
        # Create temp file
        temp_dir = settings.UPLOAD_DIR
        fd, temp_path = tempfile.mkstemp(suffix=".mp4", dir=temp_dir)
        with os.fdopen(fd, 'wb') as tmp:
            content = await video.read()
            tmp.write(content)
            
        # 4. Open video with OpenCV
        cap = cv2.VideoCapture(temp_path)
        if not cap.isOpened():
            raise HTTPException(status_code=400, detail="Không thể mở hoặc đọc file video")
            
        fps = cap.get(cv2.CAP_PROP_FPS)
        if not fps or fps <= 0:
            fps = 30.0
            
        # Calculate frame sample interval
        sample_interval = max(1, int(fps / VIDEO_SAMPLE_FPS))
        
        # Process frames within the first MAX_VIDEO_SECONDS
        max_duration_frames = int(fps * MAX_VIDEO_SECONDS)
        
        frame_idx = 0
        extracted_count = 0
        while True:
            ret, frame = cap.read()
            if not ret:
                break
            if frame_idx >= max_duration_frames:
                break
            if frame_idx % sample_interval == 0:
                frames.append(frame)
                extracted_count += 1
                if extracted_count >= MAX_VIDEO_FRAMES:
                    break
            frame_idx += 1
            
        cap.release()
    except Exception as e:
        logger.error(f"Error reading video upload: {e}")
        raise HTTPException(status_code=400, detail=f"Lỗi xử lý file video: {str(e)}")
    finally:
        if temp_path and os.path.exists(temp_path):
            try:
                os.remove(temp_path)
            except Exception as ex:
                logger.error(f"Failed to delete temp file {temp_path}: {ex}")

    if not frames:
        raise HTTPException(status_code=400, detail="Không trích xuất được khung hình nào từ video")

    # 5. Recognize faces in each frame and aggregate
    # student_id -> {student, max_confidence, seen_frames, bbox}
    aggregated_matches = {}
    unknowns_per_frame = []
    max_faces_in_single_frame = 0

    for idx, frame in enumerate(frames):
        try:
            # frame is a numpy array (BGR), identify_all_faces handles np.ndarray directly
            faces_results = face_service.identify_all_faces(frame, db, threshold=validated_threshold)
        except Exception as fe:
            logger.info(f"identify_all_faces failed on frame {idx}: {fe}")
            continue
            
        # Track max faces detected in a single frame
        if len(faces_results) > max_faces_in_single_frame:
            max_faces_in_single_frame = len(faces_results)
            
        unknowns_in_frame = 0
        for student, confidence, bbox in faces_results:
            if student is None:
                unknowns_in_frame += 1
            else:
                student_id = student.id
                if student_id not in aggregated_matches:
                    aggregated_matches[student_id] = {
                        "student": student,
                        "max_confidence": confidence,
                        "seen_frames": 1,
                        "bbox": bbox
                    }
                else:
                    match_data = aggregated_matches[student_id]
                    match_data["seen_frames"] += 1
                    if confidence > match_data["max_confidence"]:
                        match_data["max_confidence"] = confidence
                        match_data["bbox"] = bbox
                        
        unknowns_per_frame.append(unknowns_in_frame)

    max_unknown_count = max(unknowns_per_frame) if unknowns_per_frame else 0
    
    # 6. Apply filters and perform attendance marking
    results = []
    from sqlalchemy.exc import IntegrityError
    
    # Track student ids that are successfully matched
    for student_id, match in aggregated_matches.items():
        student = match["student"]
        confidence = match["max_confidence"]
        seen_frames = match["seen_frames"]
        x, y, w, h = match["bbox"]
        bbox_obj = BBox(x=x, y=y, width=w, height=h)
        
        # Check if student met the confirmation criteria
        if seen_frames < MIN_FRAMES_TO_CONFIRM:
            logger.info(f"Student {student.full_name} skipped: seen in {seen_frames} frames < {MIN_FRAMES_TO_CONFIRM}")
            # Count them as unknown
            max_unknown_count += 1
            continue
            
        if student.class_id != session_obj.class_id:
            results.append(GroupAttendanceResult(
                student_id=student.id,
                student_name=student.full_name,
                status="not_in_class",
                confidence=confidence,
                bbox=bbox_obj
            ))
            continue

        existing = (
            db.query(Attendance)
            .filter(Attendance.student_id == student.id, Attendance.session_id == session_obj.id)
            .first()
        )

        if existing:
            results.append(GroupAttendanceResult(
                student_id=student.id,
                student_name=student.full_name,
                status="already_marked",
                confidence=confidence,
                bbox=bbox_obj,
                checkin_time=existing.checkin_time
            ))
            continue

        status = _determine_status(now, session_obj)
        attendance = Attendance(
            student_id=student.id,
            session_id=session_obj.id,
            checkin_time=now,
            status=status,
            confidence=confidence,
        )
        try:
            db.add(attendance)
            db.commit()
            results.append(GroupAttendanceResult(
                student_id=student.id,
                student_name=student.full_name,
                status=status,
                confidence=confidence,
                bbox=bbox_obj,
                checkin_time=attendance.checkin_time
            ))
        except IntegrityError:
            db.rollback()
            existing_err = (
                db.query(Attendance)
                .filter(Attendance.student_id == student.id, Attendance.session_id == session_obj.id)
                .first()
            )
            checkin_time_err = existing_err.checkin_time if existing_err else None
            results.append(GroupAttendanceResult(
                student_id=student.id,
                student_name=student.full_name,
                status="already_marked",
                confidence=confidence,
                bbox=bbox_obj,
                checkin_time=checkin_time_err
            ))

    # Add unknown faces to results
    for _ in range(max_unknown_count):
        results.append(GroupAttendanceResult(
            student_id=None,
            student_name="Không xác định",
            status="unknown",
            confidence=0.0,
            bbox=None
        ))

    recognized_count = sum(1 for r in results if r.status in ("present", "late", "already_marked"))
    total_faces_detected = recognized_count + max_unknown_count

    logger.info(f"Group Video Attendance Summary: {recognized_count} recognized, {max_unknown_count} unknown.")

    return GroupAttendanceResponse(
        success=True,
        total_faces_detected=total_faces_detected,
        recognized_count=recognized_count,
        unknown_count=max_unknown_count,
        results=results
    )


@router.get("/today", response_model=AttendanceTodayResponse)
def get_today(
    session_id: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get today's attendance records and stats."""
    from sqlalchemy import func
    from ..utils.timezone import get_vn_now, get_vn_today
    now = get_vn_now()
    today_date_str = get_vn_today().strftime("%Y-%m-%d")

    # Assuming sqlite, func.date works on datetime. For cross-DB, might need cast
    query = db.query(Attendance).join(Student).filter(func.date(Attendance.checkin_time) == today_date_str)
    
    if session_id:
        query = query.filter(Attendance.session_id == session_id)
        
    records = query.order_by(Attendance.checkin_time.desc()).all()

    # Tính tổng số sinh viên (Nên tính theo lớp của ca học đó)
    if session_id:
        sess = db.query(SessionModel).filter(SessionModel.id == session_id).first()
        if sess:
            total_students = db.query(Student).filter(Student.class_id == sess.class_id, Student.is_active == True).count()
        else:
            total_students = 0
    else:
        total_students = db.query(Student).filter(Student.is_active == True).count()

    present = len(records)
    late = sum(1 for r in records if r.status == "late")
    on_time = sum(1 for r in records if r.status in ["on_time", "present"])

    return AttendanceTodayResponse(
        records=[_build_response(r) for r in records],
        stats=AttendanceStats(
            total_students=total_students,
            present=present,
            absent=total_students - present,
            late=late,
            on_time=on_time,
            date=now.date(),
        ),
    )


@router.get("/history")
def get_history(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    student_id: Optional[int] = None,
    class_name: Optional[str] = None,
    session_id: Optional[int] = None,
    status: Optional[str] = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get attendance history with filters and pagination."""
    from sqlalchemy import func
    query = db.query(Attendance).join(Student)

    if start_date:
        query = query.filter(func.date(Attendance.checkin_time) >= start_date)
    if end_date:
        query = query.filter(func.date(Attendance.checkin_time) <= end_date)
    if student_id:
        query = query.filter(Attendance.student_id == student_id)
    if class_name:
        query = query.filter(Student.class_name == class_name)
    if session_id:
        query = query.filter(Attendance.session_id == session_id)
    if status:
        query = query.filter(Attendance.status == status)

    total = query.count()
    records = (
        query.order_by(Attendance.checkin_time.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )

    return {
        "records": [_build_response(r) for r in records],
        "total": total,
        "page": page,
        "page_size": page_size,
    }
