from pydantic import BaseModel
from typing import Optional

class SubjectBase(BaseModel):
    subject_code: Optional[str] = None
    subject_name: str
    description: Optional[str] = None

class SubjectResponse(SubjectBase):
    id: int

    class Config:
        from_attributes = True
