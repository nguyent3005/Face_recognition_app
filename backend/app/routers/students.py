"""Student management CRUD router."""

from typing import Optional
import base64
from fastapi import APIRouter, Depends, HTTPException, Query, Form, File, UploadFile
from sqlalchemy.orm import Session

from ..database import get_db
from ..models.student import Student
from ..models.user import User
from ..schemas.student import StudentCreate, StudentUpdate, StudentResponse, StudentListResponse
from .auth import get_current_user

router = APIRouter(prefix="/api/students", tags=["Students"])


@router.get("", response_model=StudentListResponse)
def list_students(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    search: Optional[str] = None,
    class_name: Optional[str] = None,
    is_active: Optional[bool] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List students with search, filter, and pagination."""
    query = db.query(Student)

    if search:
        query = query.filter(
            (Student.full_name.ilike(f"%{search}%"))
            | (Student.student_code.ilike(f"%{search}%"))
            | (Student.email.ilike(f"%{search}%"))
        )

    if class_name:
        query = query.filter(Student.class_name == class_name)

    if is_active is not None:
        query = query.filter(Student.is_active == is_active)

    total = query.count()
    
    # Lấy tất cả để sort bằng python cho chuẩn tiếng Việt
    all_students = query.all()
    
    from ..utils.sorting import student_sort_key
    sorted_students = sorted(all_students, key=student_sort_key)
    
    # Phân trang bằng list slicing
    start_idx = (page - 1) * page_size
    end_idx = start_idx + page_size
    students = sorted_students[start_idx:end_idx]

    return StudentListResponse(
        students=[
            StudentResponse(
                **{c.name: getattr(emp, c.name) for c in Student.__table__.columns if c.name != "face_embedding"},
                has_face_data=emp.has_face_data,
            )
            for emp in students
        ],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.get("/classes")
def list_classes(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get list of unique classes."""
    classes = (
        db.query(Student.class_name)
        .filter(Student.class_name.isnot(None), Student.is_active == True)
        .distinct()
        .all()
    )
    return [d[0] for d in classes if d[0]]


@router.get("/{student_id}", response_model=StudentResponse)
def get_student(
    student_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get a single student by ID."""
    emp = db.query(Student).filter(Student.id == student_id).first()
    if not emp:
        raise HTTPException(status_code=404, detail="Không tìm thấy sinh viên")

    return StudentResponse(
        **{c.name: getattr(emp, c.name) for c in Student.__table__.columns if c.name != "face_embedding"},
        has_face_data=emp.has_face_data,
    )


@router.post("", response_model=StudentResponse, status_code=200)
def create_student(
    data: StudentCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Create a new student or update existing one's class."""
    if data.session_id and not data.class_id:
        from ..models.session import Session as SessionModel
        sess = db.query(SessionModel).filter(SessionModel.id == data.session_id).first()
        if sess:
            data.class_id = sess.class_id
            if sess.course_class:
                data.class_name = sess.course_class.class_name

    existing = db.query(Student).filter(Student.student_code == data.student_code).first()
    
    if existing:
        # Update existing student's class and info instead of failing
        if data.full_name:
            existing.full_name = data.full_name
        if data.class_id:
            existing.class_id = data.class_id
        if data.class_name:
            existing.class_name = data.class_name
        if data.email:
            existing.email = data.email
        if data.phone:
            existing.phone = data.phone
            
        db.commit()
        db.refresh(existing)
        emp = existing
    else:
        # Create new
        create_data = data.model_dump(exclude={"session_id"})
        emp = Student(**create_data)
        db.add(emp)
        db.commit()
        db.refresh(emp)

    return StudentResponse(
        **{c.name: getattr(emp, c.name) for c in Student.__table__.columns if c.name != "face_embedding"},
        has_face_data=emp.has_face_data,
    )


@router.post("/with-face", response_model=StudentResponse, status_code=200)
async def create_student_with_face(
    student_code: str = Form(...),
    full_name: str = Form(...),
    phone: Optional[str] = Form(None),
    email: Optional[str] = Form(None),
    class_id: Optional[int] = Form(None),
    session_id: Optional[int] = Form(None),
    face_image: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Create or update a student and enroll their face."""
    from ..services.face_service import detect_faces_in_image, enroll_face
    import re
    
    # 1. Validate text fields
    if not re.match(r"^\d{7}$", student_code):
        raise HTTPException(status_code=400, detail="MSSV phải gồm đúng 7 chữ số")
    if not full_name or not full_name.strip():
        raise HTTPException(status_code=400, detail="Vui lòng nhập họ và tên")
    if phone and not re.match(r"^\d{9,11}$", phone):
        raise HTTPException(status_code=400, detail="Số điện thoại không hợp lệ")
    if email and not re.match(r"^[^\s@]+@[^\s@]+\.[^\s@]+$", email):
        raise HTTPException(status_code=400, detail="Email không hợp lệ")

    # 2. Validate image format
    allowed_types = ["image/jpeg", "image/png", "image/jpg"]
    if face_image.content_type not in allowed_types:
        raise HTTPException(status_code=400, detail="Chỉ chấp nhận ảnh định dạng jpg, jpeg, png")
        
    # 3. Read image bytes
    try:
        image_bytes = await face_image.read()
    except Exception as e:
        raise HTTPException(status_code=400, detail="Lỗi khi đọc file ảnh")
        
    # 4. Check face count
    try:
        faces = detect_faces_in_image(image_bytes)
        if len(faces) == 0:
            raise HTTPException(status_code=400, detail="Không phát hiện khuôn mặt trong ảnh")
        elif len(faces) > 1:
            raise HTTPException(status_code=400, detail="Ảnh đăng ký chỉ được chứa đúng 1 khuôn mặt")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail="Không thể xử lý khuôn mặt, vui lòng thử ảnh khác")

    # 5. Resolve class_id from session_id if needed
    resolved_class_id = class_id
    resolved_class_name = None
    if session_id and not resolved_class_id:
        from ..models.session import Session as SessionModel
        sess = db.query(SessionModel).filter(SessionModel.id == session_id).first()
        if sess:
            resolved_class_id = sess.class_id
            if sess.course_class:
                resolved_class_name = sess.course_class.class_name

    # 6. Create or Update Student
    existing = db.query(Student).filter(Student.student_code == student_code).first()
    
    if existing:
        if full_name:
            existing.full_name = full_name
        if resolved_class_id:
            existing.class_id = resolved_class_id
        if resolved_class_name:
            existing.class_name = resolved_class_name
        if email:
            existing.email = email
        if phone:
            existing.phone = phone
            
        db.commit()
        db.refresh(existing)
        emp = existing
    else:
        emp = Student(
            student_code=student_code,
            full_name=full_name,
            phone=phone,
            email=email,
            class_id=resolved_class_id,
            class_name=resolved_class_name
        )
        db.add(emp)
        db.commit()
        db.refresh(emp)

    # 7. Enroll face embedding
    try:
        success = enroll_face(emp, image_bytes, db)
        if not success:
            raise HTTPException(status_code=400, detail="Không thể xử lý khuôn mặt, vui lòng thử ảnh khác")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail="Không thể xử lý khuôn mặt, vui lòng thử ảnh khác")

    return StudentResponse(
        **{c.name: getattr(emp, c.name) for c in Student.__table__.columns if c.name != "face_embedding"},
        has_face_data=emp.has_face_data,
    )


@router.post("/{student_id}/register-face")
async def register_student_face(
    student_id: int,
    face_image: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Register or update a face for an existing student."""
    from ..services.face_service import enroll_face
    
    # Check student
    emp = db.query(Student).filter(Student.id == student_id).first()
    if not emp:
        raise HTTPException(status_code=404, detail="Không tìm thấy sinh viên")

    # Validate image format
    allowed_types = ["image/jpeg", "image/png", "image/jpg"]
    if face_image.content_type not in allowed_types:
        raise HTTPException(status_code=400, detail="Chỉ chấp nhận ảnh định dạng jpg, jpeg, png")
        
    # Read raw image bytes
    try:
        image_bytes = await face_image.read()
    except Exception as e:
        raise HTTPException(status_code=400, detail="Lỗi khi đọc file ảnh")

    # Enroll face embedding (enroll_face will raise HTTPException if duplicate or invalid)
    try:
        enroll_face(emp, image_bytes, db)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail="Không thể xử lý khuôn mặt, vui lòng thử ảnh khác")

    return {
        "success": True,
        "message": "Đăng ký khuôn mặt thành công",
        "student_id": emp.id,
        "face_registered": True
    }


@router.post("/{student_id}/register-face-video")
async def register_student_face_video(
    student_id: int,
    face_video: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Register or update a face for an existing student using a short video."""
    import tempfile
    import os
    import shutil
    import cv2
    import numpy as np
    from ..services.face_service import get_model, l2_normalize, save_snapshot, embedding_to_bytes, bytes_to_embedding
    from ..utils.face_preprocessing import preprocess_face, detect_faces
    from ..config import settings

    # Check student
    student = db.query(Student).filter(Student.id == student_id).first()
    if not student:
        raise HTTPException(status_code=404, detail="Không tìm thấy sinh viên")

    temp_path = None
    try:
        # Save upload to a temporary file
        suffix = os.path.splitext(face_video.filename)[1] or ".mp4"
        fd, temp_path = tempfile.mkstemp(suffix=suffix)
        os.close(fd)

        with open(temp_path, "wb") as buffer:
            shutil.copyfileobj(face_video.file, buffer)

        # Open video file
        cap = cv2.VideoCapture(temp_path)
        if not cap.isOpened():
            raise HTTPException(status_code=400, detail="Không thể đọc được video, vui lòng quay lại")

        fps = cap.get(cv2.CAP_PROP_FPS)
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        if fps <= 0:
            fps = 30.0

        # Constants
        MAX_VIDEO_SECONDS = 2
        VIDEO_SAMPLE_FPS = 3
        MAX_VIDEO_FRAMES = 8
        MIN_VALID_FACE_FRAMES_FOR_ENROLL = 3

        max_idx = min(total_frames, int(MAX_VIDEO_SECONDS * fps))
        if max_idx <= 0:
            raise HTTPException(status_code=400, detail="Video không chứa dữ liệu hình ảnh")

        # Sample frames (~3 frames per second, up to 8 frames)
        step = max(1, int(fps / VIDEO_SAMPLE_FPS))
        frame_indices = [i for i in range(0, max_idx, step)][:MAX_VIDEO_FRAMES]
        if not frame_indices:
            frame_indices = [0]

        valid_frames_data = []

        for idx in frame_indices:
            cap.set(cv2.CAP_PROP_POS_FRAMES, idx)
            ret, frame = cap.read()
            if not ret or frame is None:
                continue

            # Detect faces in the frame
            faces = detect_faces(frame)

            # If any frame has more than 1 face, raise error immediately
            if len(faces) > 1:
                raise HTTPException(status_code=400, detail="Video đăng ký chỉ được chứa một khuôn mặt")

            if len(faces) == 1:
                try:
                    face_preprocessed, bbox, confidence = preprocess_face(frame, require_alignment=True)
                    valid_frames_data.append({
                        "image": frame,
                        "face_preprocessed": face_preprocessed,
                        "bbox": bbox,
                        "confidence": confidence
                    })
                except Exception:
                    # Skip frame if preprocessing fails (e.g. alignment issue)
                    continue

        cap.release()

        if not valid_frames_data:
            raise HTTPException(status_code=400, detail="Không phát hiện khuôn mặt trong video")

        if len(valid_frames_data) < MIN_VALID_FACE_FRAMES_FOR_ENROLL:
            raise HTTPException(status_code=400, detail="Video chưa đủ rõ khuôn mặt, vui lòng quay lại")

        # Extract embeddings and L2 normalize
        model = get_model()
        embeddings = []
        for item in valid_frames_data:
            emb = model.get_embedding(item["face_preprocessed"])
            emb = l2_normalize(emb)
            embeddings.append(emb)

        # Check consistency of embeddings using pairwise cosine similarity
        similarities = []
        for i in range(len(embeddings)):
            for j in range(i + 1, len(embeddings)):
                sim = float(model.cosine_similarity(embeddings[i], embeddings[j]))
                similarities.append(sim)

        if len(similarities) > 0:
            avg_sim = sum(similarities) / len(similarities)
            min_sim = min(similarities)
            # If average similarity < 0.45 or min similarity < 0.35, video is considered unstable
            if avg_sim < 0.45 or min_sim < 0.35:
                raise HTTPException(status_code=400, detail="Video đăng ký không ổn định, vui lòng quay lại")

        # Compute average embedding
        avg_embedding = np.mean(embeddings, axis=0)
        avg_embedding = l2_normalize(avg_embedding)

        # Check for duplicates among other students
        other_students = db.query(Student).filter(
            Student.is_active == True,
            Student.face_embedding.isnot(None),
            Student.id != student.id
        ).all()

        best_score = -1.0
        for os_std in other_students:
            stored_emb = bytes_to_embedding(os_std.face_embedding)
            stored_emb = l2_normalize(stored_emb)
            score = model.cosine_similarity(avg_embedding, stored_emb)
            if score > best_score:
                best_score = score

        if best_score >= settings.FACE_MATCH_THRESHOLD:
            raise HTTPException(
                status_code=400,
                detail="Khuôn mặt này đã được đăng ký cho sinh viên khác"
            )

        # Choose the best representative frame: confidence > bbox size > first frame
        def sort_key(item):
            w, h = item["bbox"][2], item["bbox"][3]
            area = w * h
            return (item["confidence"], area)

        best_frame_item = max(valid_frames_data, key=sort_key)

        # Update student face data
        student.face_embedding = embedding_to_bytes(avg_embedding)

        # Save representative photo snapshot
        photo_path = save_snapshot(best_frame_item["image"], prefix=f"photo_{student.student_code}")
        student.photo_path = f"/uploads/{photo_path}"

        db.commit()
        db.refresh(student)

        return {
            "success": True,
            "message": "Đăng ký khuôn mặt bằng video thành công",
            "student_id": student.id,
            "face_registered": True
        }

    except HTTPException:
        # Re-raise HTTPExceptions as-is
        raise
    except Exception as e:
        # Wrap any unexpected errors and return a clean Vietnamese error message
        import traceback
        print(f"Unexpected error in register_student_face_video: {e}")
        traceback.print_exc()
        raise HTTPException(status_code=400, detail="Không thể xử lý khuôn mặt từ video, vui lòng thử lại")
    finally:
        # Always remove temp file
        if temp_path and os.path.exists(temp_path):
            try:
                os.remove(temp_path)
            except Exception as e:
                print(f"Error removing temp video file: {e}")


@router.put("/{student_id}", response_model=StudentResponse)
def update_student(
    student_id: int,
    data: StudentUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Update a student's information."""
    emp = db.query(Student).filter(Student.id == student_id).first()
    if not emp:
        raise HTTPException(status_code=404, detail="Không tìm thấy sinh viên")

    update_data = data.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(emp, key, value)

    db.commit()
    db.refresh(emp)

    return StudentResponse(
        **{c.name: getattr(emp, c.name) for c in Student.__table__.columns if c.name != "face_embedding"},
        has_face_data=emp.has_face_data,
    )


@router.delete("/{student_id}")
def delete_student(
    student_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Permanently delete a student from the database."""
    emp = db.query(Student).filter(Student.id == student_id).first()
    if not emp:
        raise HTTPException(status_code=404, detail="Không tìm thấy sinh viên")

    db.delete(emp)
    db.commit()

    return {"message": "Đã xóa sinh viên hoàn toàn", "id": student_id}