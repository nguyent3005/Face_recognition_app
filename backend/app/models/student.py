from sqlalchemy import Column, Integer, String, DateTime, Boolean, LargeBinary, ForeignKey
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from ..database import Base


class Student(Base):
    """Student records with face embedding data."""
    __tablename__ = "students"

    id = Column(Integer, primary_key=True, index=True)
    student_code = Column(String(20), unique=True, nullable=False, index=True)
    full_name = Column(String(100), nullable=False, index=True)
    class_name = Column(String(50), nullable=True) # Retain for backward compatibility or simple naming
    class_id = Column(Integer, ForeignKey("classes.id"), nullable=True, index=True)
    email = Column(String(100), nullable=True)
    phone = Column(String(20), nullable=True)
    face_embedding = Column(LargeBinary, nullable=True)  # Serialized numpy array
    photo_path = Column(String(255), nullable=True)  # Reference photo path
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # Relationships
    attendances = relationship("Attendance", back_populates="student", cascade="all, delete-orphan")
    course_class = relationship("CourseClass", back_populates="students")

    @property
    def has_face_data(self):
        return self.face_embedding is not None
