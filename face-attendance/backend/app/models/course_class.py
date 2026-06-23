from sqlalchemy import Column, Integer, String
from sqlalchemy.orm import relationship
from ..database import Base

class CourseClass(Base):
    """Class records (Lớp học)."""
    __tablename__ = "classes"

    id = Column(Integer, primary_key=True, index=True)
    class_code = Column(String(20), unique=True, nullable=False, index=True)
    class_name = Column(String(100), nullable=False)

    # Relationships
    students = relationship("Student", back_populates="course_class")
    sessions = relationship("Session", back_populates="course_class", cascade="all, delete-orphan")
