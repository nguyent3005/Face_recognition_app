from fastapi.testclient import TestClient
import numpy as np
import cv2
import base64
import os
import sys
import io

# Fix unicode encode errors on print
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

from app.main import app
from app.routers.auth import get_current_user
from app.models.user import User

client = TestClient(app)

# Mock authenticated user
def override_get_current_user():
    return User(id=1, username="test_admin", role="admin")

app.dependency_overrides[get_current_user] = override_get_current_user

def run_tests():
    print("=== STARTING SCAN FRAME ENDPOINT TESTS ===")
    
    # 1. Test missing session_id
    print("\nTest 1: Request missing session_id")
    response = client.post(
        "/api/attendance/scan-frame",
        json={"image": "dummy_base64", "threshold": 0.55}
    )
    print("Status Code:", response.status_code)
    print("Response:", response.json())
    assert response.status_code == 422, "Should return 422 validation error"

    # 2. Test missing image payload
    print("\nTest 2: Request missing image payload")
    response = client.post(
        "/api/attendance/scan-frame",
        json={"session_id": 1, "threshold": 0.55}
    )
    print("Status Code:", response.status_code)
    print("Response:", response.json())
    assert response.status_code == 422, "Should return 422 validation error"

    # 3. Test non-existent session_id
    print("\nTest 3: Request with non-existent session_id")
    response = client.post(
        "/api/attendance/scan-frame",
        json={"image": "dummy_base64", "session_id": 99999, "threshold": 0.55}
    )
    print("Status Code:", response.status_code)
    print("Response:", response.json())
    assert response.status_code == 400, "Should return 400 bad request"

    # 4. Test active session check
    from app.database import SessionLocal
    from app.models.session import Session as SessionModel
    db = SessionLocal()
    session = db.query(SessionModel).first()
    db.close()
    
    if not session:
        print("\nSkipping further tests: No sessions found in the database.")
    else:
        print(f"\nFound session ID in database: {session.id}")
        
        # Load a valid photo to convert to base64
        photos_dir = os.path.join(os.path.dirname(__file__), "uploads", "photos")
        photo_file = None
        if os.path.exists(photos_dir):
            for f in os.listdir(photos_dir):
                if f.lower().endswith((".jpg", ".jpeg", ".png")):
                    photo_file = os.path.join(photos_dir, f)
                    break
        
        if not photo_file:
            print("Skipping valid image test: No sample photo found in uploads/photos")
            # We can test with a blank/invalid base64
            img_b64 = "data:image/jpeg;base64," + base64.b64encode(np.zeros((100, 100, 3), dtype=np.uint8)).decode('utf-8')
        else:
            print(f"Using test photo: {photo_file}")
            with open(photo_file, "rb") as f:
                img_b64 = "data:image/jpeg;base64," + base64.b64encode(f.read()).decode('utf-8')
        
        # Test call
        print("\nTest 4: Request scan-frame with session")
        response = client.post(
            "/api/attendance/scan-frame",
            json={"image": img_b64, "session_id": session.id, "threshold": 0.55}
        )
        print("Status Code:", response.status_code)
        json_data = response.json()
        print("Response Success:", json_data.get("success"))
        print("Total Faces Detected:", json_data.get("total_faces_detected"))
        print("Results length:", len(json_data.get("results", [])))
        
        if len(json_data.get("results", [])) > 0:
            first_res = json_data["results"][0]
            print("First Result:", first_res)
            # Ensure is_committed is false
            assert first_res["is_committed"] is False, "is_committed must be False in scan-frame"
            assert "recognition_status" in first_res, "recognition_status must be in the result"
            assert "suggested_attendance_status" in first_res, "suggested_attendance_status must be in the result"

    print("\n=== SCAN FRAME ENDPOINT TESTS COMPLETED SUCCESSFULLY ===")

if __name__ == "__main__":
    run_tests()
