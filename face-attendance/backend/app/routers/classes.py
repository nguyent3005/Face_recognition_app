from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List

from ..database import get_db
from ..models.course_class import CourseClass
from ..models.session import Session as SessionModel
from ..schemas.course_class import CourseClassResponse, CourseClassCreate
from ..schemas.session import SessionResponse
from datetime import datetime
from zoneinfo import ZoneInfo

router = APIRouter(prefix="/api/classes", tags=["Classes"])

@router.get("/", response_model=List[CourseClassResponse])
def get_classes(db: Session = Depends(get_db)):
    classes = db.query(CourseClass).all()
    return classes

@router.post("/", response_model=CourseClassResponse)
def create_class(payload: CourseClassCreate, db: Session = Depends(get_db)):
    db_class = CourseClass(**payload.model_dump())
    db.add(db_class)
    db.commit()
    db.refresh(db_class)
    return db_class

@router.get("/{class_id}/sessions", response_model=List[SessionResponse])
def get_class_sessions(class_id: int, db: Session = Depends(get_db)):
    db_class = db.query(CourseClass).filter(CourseClass.id == class_id).first()
    if not db_class:
        raise HTTPException(status_code=404, detail="Class not found")
        
    sessions = db.query(SessionModel).filter(SessionModel.class_id == class_id).order_by(SessionModel.study_date, SessionModel.start_time).all()
    
    # Compute status based on time
    from ..utils.timezone import get_vn_now, to_vn_datetime
    now = get_vn_now()
    
    result = []
    for s in sessions:
        # Convert model to dict for response mapping, then we'll assign status
        # Better yet, map teachers to response format
        teachers_list = [{"id": st.teacher.id, "full_name": st.teacher.full_name, "email": st.teacher.email, "phone": st.teacher.phone} for st in s.teachers if st.teacher]
        subject_dict = {"id": s.subject.id, "subject_code": s.subject.subject_code, "subject_name": s.subject.subject_name, "description": s.subject.description} if s.subject else None
        
        status = "upcoming"
        status_label = "Sắp diễn ra"
        
        now_cmp = now
        start_cmp = to_vn_datetime(s.start_time)
        end_cmp = to_vn_datetime(s.end_time)
        
        if start_cmp <= now_cmp <= end_cmp:
            status = "ongoing"
            status_label = "Đang diễn ra"
        elif now_cmp > end_cmp:
            status = "finished"
            status_label = "Đã kết thúc"
            
        result.append({
            "id": s.id,
            "class_id": s.class_id,
            "subject_id": s.subject_id,
            "section_code": s.section_code,
            "study_date": s.study_date,
            "day_of_week": s.day_of_week,
            "lesson_start": s.lesson_start,
            "lesson_end": s.lesson_end,
            "start_time": s.start_time,
            "end_time": s.end_time,
            "room": s.room,
            "course_class": {"id": db_class.id, "class_code": db_class.class_code, "class_name": db_class.class_name},
            "subject": subject_dict,
            "teachers": teachers_list,
            "status": status,
            "status_label": status_label
        })
        
    return result
