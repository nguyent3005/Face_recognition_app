from .auth import router as auth_router, get_current_user
from .students import router as students_router
from .attendance import router as attendance_router
from .recognition import router as recognition_router
from .reports import router as reports_router
from .classes import router as classes_router
from .sessions import router as sessions_router

__all__ = [
    "auth_router", "students_router", "attendance_router",
    "recognition_router", "reports_router", "get_current_user",
    "classes_router", "sessions_router",
]
