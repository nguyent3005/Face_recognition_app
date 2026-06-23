from sqlalchemy import Column, Integer, String, Date, DateTime, ForeignKey
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from ..database import Base

class Session(Base):
    """Study session records (Ca học/Buổi học)."""
    __tablename__ = "sessions"

    id = Column(Integer, primary_key=True, index=True)
    class_id = Column(Integer, ForeignKey("classes.id"), nullable=False, index=True)
    subject_id = Column(Integer, ForeignKey("subjects.id"), nullable=True, index=True)
    
    section_code = Column(String(50), nullable=True) # e.g. 60881503
    study_date = Column(Date, nullable=False, index=True)
    day_of_week = Column(String(20), nullable=True) # e.g. "Thứ 2"
    lesson_start = Column(Integer, nullable=True)
    lesson_end = Column(Integer, nullable=True)
    
    start_time = Column(DateTime(timezone=True), nullable=False)
    end_time = Column(DateTime(timezone=True), nullable=False)
    room = Column(String(50), nullable=True)
    late_after_minutes = Column(Integer, default=15, nullable=False)
    
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # Relationships
    course_class = relationship("CourseClass", back_populates="sessions")
    subject = relationship("Subject", back_populates="sessions")
    teachers = relationship("SessionTeacher", back_populates="session", cascade="all, delete-orphan")
    attendances = relationship("Attendance", back_populates="session", cascade="all, delete-orphan")
