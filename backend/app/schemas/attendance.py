from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime, date


class AttendanceMarkPresent(BaseModel):
    image: str  # base64 encoded image from camera
    session_id: int
    threshold: Optional[float] = None


class BBox(BaseModel):
    x: int
    y: int
    width: int
    height: int


class GroupAttendanceResult(BaseModel):
    student_id: Optional[int] = None
    student_name: str
    status: str
    confidence: float
    bbox: Optional[BBox] = None
    checkin_time: Optional[datetime] = None


class GroupAttendanceResponse(BaseModel):
    success: bool
    total_faces_detected: int
    recognized_count: int
    unknown_count: int
    results: List[GroupAttendanceResult]


class RecognitionResult(BaseModel):
    student_id: int
    student_code: str
    student_name: str
    class_name: Optional[str] = None
    confidence: float
    photo_path: Optional[str] = None
    already_marked: bool = False


class AttendanceResponse(BaseModel):
    id: int
    student_id: int
    student_name: Optional[str] = None
    student_code: Optional[str] = None
    class_name: Optional[str] = None
    session_id: Optional[int] = None
    session_name: Optional[str] = None
    photo_path: Optional[str] = None
    checkin_time: Optional[datetime] = None
    status: str
    confidence: Optional[float] = None
    note: Optional[str] = None

    class Config:
        from_attributes = True


class AttendanceTodayResponse(BaseModel):
    records: List[AttendanceResponse]
    stats: "AttendanceStats"


class AttendanceStats(BaseModel):
    total_students: int
    present: int
    absent: int
    late: int
    on_time: int
    date: date


class AttendanceHistoryQuery(BaseModel):
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    student_id: Optional[int] = None
    class_name: Optional[str] = None
    status: Optional[str] = None


class ScanFrameResult(BaseModel):
    student_id: Optional[int] = None
    student_name: str
    confidence: float
    recognition_status: str  # recognized / unknown / already_marked
    suggested_attendance_status: str  # present / late / unknown
    bbox: Optional[BBox] = None
    is_committed: bool = False
    message: Optional[str] = None


class ScanFrameResponse(BaseModel):
    success: bool
    total_faces_detected: int
    recognized_count: int
    unknown_count: int
    results: List[ScanFrameResult]

