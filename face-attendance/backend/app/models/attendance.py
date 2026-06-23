from sqlalchemy import Column, Integer, String, DateTime, Float, Date, ForeignKey, UniqueConstraint
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from ..database import Base


class Attendance(Base):
    """Attendance records linking students to check-in times."""
    __tablename__ = "attendances"

    id = Column(Integer, primary_key=True, index=True)
    student_id = Column(Integer, ForeignKey("students.id"), nullable=False, index=True)
    session_id = Column(Integer, ForeignKey("sessions.id"), nullable=True, index=True)
    
    checkin_time = Column(DateTime(timezone=True), nullable=True) # Replace timestamp
    status = Column(String(20), default="present")  # present, late, absent
    confidence = Column(Float, nullable=True)  # Face match confidence score
    note = Column(String(255), nullable=True)
    
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    __table_args__ = (
        UniqueConstraint("student_id", "session_id", name="_student_session_uc"),
    )

    # Relationships
    student = relationship("Student", back_populates="attendances")
    session = relationship("Session", back_populates="attendances")
