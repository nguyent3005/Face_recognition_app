"""Reports router: summary, trends, and CSV/Excel export."""

from datetime import date as date_type, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
import io

from ..database import get_db
from ..models.user import User
from ..services import report_service
from .auth import get_current_user
from ..utils.timezone import get_vn_today

router = APIRouter(prefix="/api/reports", tags=["Reports"])


@router.get("/summary")
def get_summary(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    class_name: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get attendance summary statistics."""
    today = get_vn_today()
    sd = date_type.fromisoformat(start_date) if start_date else today - timedelta(days=30)
    ed = date_type.fromisoformat(end_date) if end_date else today

    return report_service.get_attendance_summary(db, sd, ed, class_name)


@router.get("/trend")
def get_trend(
    days: int = Query(7, ge=1, le=90),
    class_name: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get daily attendance trend for the last N days."""
    return report_service.get_daily_trend(db, days, class_name)


@router.get("/classes")
def get_class_stats(
    target_date: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get attendance breakdown by class."""
    d = date_type.fromisoformat(target_date) if target_date else None
    return report_service.get_department_stats(db, d)


@router.get("/export/csv")
def export_csv(
    start_date: str,
    end_date: str,
    class_name: Optional[str] = None,
    student_id: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Export attendance data as CSV."""
    sd = date_type.fromisoformat(start_date)
    ed = date_type.fromisoformat(end_date)

    csv_content = report_service.generate_csv_report(db, sd, ed, class_name, student_id)

    return StreamingResponse(
        io.StringIO(csv_content),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename=attendance_{start_date}_{end_date}.csv"},
    )


@router.get("/export/excel")
def export_excel(
    start_date: str,
    end_date: str,
    class_name: Optional[str] = None,
    student_id: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Export attendance data as Excel (.xlsx)."""
    sd = date_type.fromisoformat(start_date)
    ed = date_type.fromisoformat(end_date)

    excel_bytes = report_service.generate_excel_report(db, sd, ed, class_name, student_id)

    return StreamingResponse(
        io.BytesIO(excel_bytes),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename=attendance_{start_date}_{end_date}.xlsx"},
    )
