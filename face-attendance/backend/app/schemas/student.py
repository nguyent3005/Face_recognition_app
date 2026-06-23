from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime


class StudentCreate(BaseModel):
    student_code: str
    full_name: str
    class_id: Optional[int] = None
    session_id: Optional[int] = None
    class_name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None


class StudentUpdate(BaseModel):
    full_name: Optional[str] = None
    class_name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    is_active: Optional[bool] = None


class StudentResponse(BaseModel):
    id: int
    student_code: str
    full_name: str
    class_name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    photo_path: Optional[str] = None
    is_active: bool
    has_face_data: bool = False
    created_at: datetime
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class StudentListResponse(BaseModel):
    students: List[StudentResponse]
    total: int
    page: int
    page_size: int
