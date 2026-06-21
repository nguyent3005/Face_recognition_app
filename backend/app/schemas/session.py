from pydantic import BaseModel
from typing import Optional, List
from datetime import date, datetime
from .course_class import CourseClassResponse
from .subject import SubjectResponse
from .teacher import TeacherResponse

class SessionBase(BaseModel):
    class_id: int
    subject_id: Optional[int] = None
    section_code: Optional[str] = None
    study_date: date
    day_of_week: Optional[str] = None
    lesson_start: Optional[int] = None
    lesson_end: Optional[int] = None
    start_time: datetime
    end_time: datetime
    room: Optional[str] = None
    late_after_minutes: int = 15

class SessionCreate(SessionBase):
    pass

class SessionResponse(SessionBase):
    id: int
    course_class: Optional[CourseClassResponse] = None
    subject: Optional[SubjectResponse] = None
    teachers: List[TeacherResponse] = []
    status: Optional[str] = None # Added dynamically in routers
    status_label: Optional[str] = None # Added dynamically in routers

    class Config:
        from_attributes = True
