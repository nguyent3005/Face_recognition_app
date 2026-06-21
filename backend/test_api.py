from fastapi.testclient import TestClient
from app.main import app
import traceback
import sys
import io

# Fix unicode encode errors on print
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

client = TestClient(app)

from app.routers.auth import get_current_user
from app.models.user import User
def override_get_current_user():
    return User(id=1, username="test", role="admin")

app.dependency_overrides[get_current_user] = override_get_current_user

try:
    response = client.get("/api/attendance/history?start_date=2026-05-25&end_date=2026-06-01")
    print("History status:", response.status_code)
    if response.status_code != 200:
        print(response.json())
except Exception as e:
    traceback.print_exc()

try:
    response = client.get("/api/reports/summary?start_date=2026-05-25&end_date=2026-06-01")
    print("Summary status:", response.status_code)
    if response.status_code != 200:
        print(response.json())
except Exception as e:
    traceback.print_exc()
