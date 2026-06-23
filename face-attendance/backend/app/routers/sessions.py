from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import List, Optional
from datetime import date, datetime
from zoneinfo import ZoneInfo

from ..database import get_db
from ..models.session import Session as SessionModel
from ..models.student import Student
from ..models.attendance import Attendance
from ..schemas.session import SessionResponse, SessionCreate

router = APIRouter(prefix="/api/sessions", tags=["Sessions"])

def _format_session(s: SessionModel) -> dict:
    from ..utils.timezone import get_vn_now, to_vn_datetime
    now = get_vn_now()
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
        
    return {
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
        "course_class": {"id": s.course_class.id, "class_code": s.course_class.class_code, "class_name": s.course_class.class_name} if s.course_class else None,
        "subject": subject_dict,
        "teachers": teachers_list,
        "status": status,
        "status_label": status_label
    }

@router.get("/", response_model=List[SessionResponse])
def get_sessions(
    db: Session = Depends(get_db),
    date_filter: Optional[date] = Query(None, alias="date"),
    start_date: Optional[date] = Query(None),
    end_date: Optional[date] = Query(None),
    class_id: Optional[int] = Query(None),
):
    query = db.query(SessionModel)
    if date_filter:
        query = query.filter(SessionModel.study_date == date_filter)
    if start_date:
        query = query.filter(SessionModel.study_date >= start_date)
    if end_date:
        query = query.filter(SessionModel.study_date <= end_date)
    if class_id:
        query = query.filter(SessionModel.class_id == class_id)
        
    sessions = query.order_by(SessionModel.study_date, SessionModel.start_time).all()
    return [_format_session(s) for s in sessions]

@router.get("/{session_id}", response_model=SessionResponse)
def get_session(session_id: int, db: Session = Depends(get_db)):
    session = db.query(SessionModel).filter(SessionModel.id == session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return _format_session(session)

@router.get("/{session_id}/students")
def get_session_students(session_id: int, db: Session = Depends(get_db)):
    session = db.query(SessionModel).filter(SessionModel.id == session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
        
    # Get all students in the class
    students = db.query(Student).filter(Student.class_id == session.class_id, Student.is_active == True).all()
    
    # Get all attendances for this session
    attendances = db.query(Attendance).filter(Attendance.session_id == session_id).all()
    att_map = {a.student_id: a for a in attendances}
    
    from ..utils.timezone import get_vn_now, to_vn_datetime
    now = get_vn_now()
    now_cmp = now
    end_cmp = to_vn_datetime(session.end_time)
    is_finished = now_cmp > end_cmp
    
    result = []
    for std in students:
        att = att_map.get(std.id)
        
        status = "not_checked_in"
        status_label = "Chưa điểm danh"
        
        if att:
            status = att.status
            if status == "present":
                status_label = "Có mặt"
            elif status == "late":
                status_label = "Đi muộn"
            elif status == "absent":
                status_label = "Vắng"
        else:
            if is_finished:
                status = "absent"
                status_label = "Vắng"
                
        result.append({
            "student_id": std.id,
            "full_name": std.full_name,
            "student_code": std.student_code,
            "photo_path": std.photo_path,
            "checkin_time": att.checkin_time if att else None,
            "status": status,
            "status_label": status_label,
            "confidence": att.confidence if att else None,
            "has_face_data": std.has_face_data,
            "face_registered": std.has_face_data
        })
        
    from ..utils.sorting import student_sort_key
    result = sorted(result, key=student_sort_key)
        
    return result
