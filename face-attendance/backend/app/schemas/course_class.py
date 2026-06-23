from pydantic import BaseModel
from typing import Optional

class CourseClassBase(BaseModel):
    class_code: str
    class_name: str

class CourseClassCreate(CourseClassBase):
    pass

class CourseClassResponse(CourseClassBase):
    id: int

    class Config:
        from_attributes = True
