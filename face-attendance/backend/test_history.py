from app.database import SessionLocal
from app.models.attendance import Attendance
from app.models.student import Student
from sqlalchemy import func
from app.routers.attendance import get_history, _build_response
from fastapi.encoders import jsonable_encoder

db = SessionLocal()

query = db.query(Attendance).join(Student)
total = query.count()
records = (
    query.order_by(Attendance.checkin_time.desc())
    .offset(0)
    .limit(20)
    .all()
)

print(f"Testing {len(records)} records")

data = {
    "records": [_build_response(r) for r in records],
    "total": total,
    "page": 1,
    "page_size": 20,
}

try:
    encoded = jsonable_encoder(data)
    import json
    json.dumps(encoded)
    print("JSON Encode success")
except Exception as e:
    import traceback
    traceback.print_exc()
