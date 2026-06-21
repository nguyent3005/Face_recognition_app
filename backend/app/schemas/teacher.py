from pydantic import BaseModel
from typing import Optional

class TeacherBase(BaseModel):
    full_name: str
    email: Optional[str] = None
    phone: Optional[str] = None

class TeacherResponse(TeacherBase):
    id: int

    class Config:
        from_attributes = True
