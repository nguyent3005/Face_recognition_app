from datetime import datetime, date
from zoneinfo import ZoneInfo

VN_TZ = ZoneInfo("Asia/Ho_Chi_Minh")

def get_vn_now() -> datetime:
    """Get the current datetime in the Asia/Ho_Chi_Minh timezone."""
    return datetime.now(VN_TZ)

def to_vn_datetime(dt: datetime) -> datetime:
    """Convert a datetime (timezone-naive or timezone-aware) to the Asia/Ho_Chi_Minh timezone."""
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=VN_TZ)
    return dt.astimezone(VN_TZ)

def get_vn_today() -> date:
    """Get the current date in the Asia/Ho_Chi_Minh timezone."""
    return get_vn_now().date()
