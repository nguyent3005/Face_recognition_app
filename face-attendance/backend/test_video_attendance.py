from fastapi.testclient import TestClient
import numpy as np
import cv2
import tempfile
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

def create_dummy_video():
    """Create a short 2-second dummy video (black frames) using OpenCV."""
    temp_dir = tempfile.gettempdir()
    video_path = os.path.join(temp_dir, "test_dummy_video.mp4")
    
    # 2 seconds at 30 fps = 60 frames
    fps = 30
    width, height = 320, 240
    
    fourcc = cv2.VideoWriter_fourcc(*'mp4v')
    out = cv2.VideoWriter(video_path, fourcc, fps, (width, height))
    
    for _ in range(60):
        # Create a black frame
        frame = np.zeros((height, width, 3), dtype=np.uint8)
        out.write(frame)
        
    out.release()
    return video_path

def run_tests():
    print("=== STARTING VIDEO ATTENDANCE TESTS ===")
    
    # 1. Create dummy video file
    video_path = create_dummy_video()
    print(f"Created dummy video at: {video_path}")
    
    try:
        # Test 1: Send request without video file
        print("\nTest 1: Request missing video file")
        response = client.post(
            "/api/attendance/mark-video",
            data={"session_id": 1, "threshold": 0.55}
        )
        print("Status Code:", response.status_code)
        print("Response:", response.json())
        assert response.status_code == 422, "Should return 422 validation error"

        # Test 2: Request missing session_id
        print("\nTest 2: Request missing session_id")
        with open(video_path, "rb") as f:
            response = client.post(
                "/api/attendance/mark-video",
                files={"video": ("test.mp4", f, "video/mp4")},
                data={"threshold": 0.55}
            )
        print("Status Code:", response.status_code)
        print("Response:", response.json())
        assert response.status_code == 422, "Should return 422 validation error"

        # Test 3: Request with non-existent session_id
        print("\nTest 3: Request with non-existent session_id")
        with open(video_path, "rb") as f:
            response = client.post(
                "/api/attendance/mark-video",
                files={"video": ("test.mp4", f, "video/mp4")},
                data={"session_id": 99999, "threshold": 0.55}
            )
        print("Status Code:", response.status_code)
        print("Response:", response.json())
        assert response.status_code == 400, "Should return 400 bad request (session does not exist)"
        assert response.json()["detail"] == "Ca học không tồn tại"

        # Test 4: Request with valid inputs (but mock video will have no faces)
        # We need a valid session_id that is currently active or mock session check
        # Let's inspect database first or check if we can query an existing session
        from app.database import SessionLocal
        from app.models.session import Session as SessionModel
        db = SessionLocal()
        session = db.query(SessionModel).first()
        db.close()
        
        if not session:
            print("\nSkipping Test 4 & 5: No sessions found in the database to test active session logic.")
        else:
            print(f"\nFound session ID in database: {session.id}")
            # Ensure the session times are mocked or we handle the start/end check error
            # If the session is not currently active, the endpoint will raise 400 "Ca học chưa bắt đầu" or "Ca học đã kết thúc"
            # Let's see what happens:
            with open(video_path, "rb") as f:
                response = client.post(
                    "/api/attendance/mark-video",
                    files={"video": ("test.mp4", f, "video/mp4")},
                    data={"session_id": session.id, "threshold": 0.55}
                )
            print("Status Code:", response.status_code)
            print("Response:", response.json())
            
            # Test 5: Verify threshold resolution and validation utility
            # We can import resolve_threshold directly and check its output
            print("\nTest 5: Verify resolve_threshold logic")
            from app.routers.attendance import resolve_threshold
            
            # None -> default
            t_none = resolve_threshold(None)
            print("resolve_threshold(None) ->", t_none)
            
            # Low value -> 0.30
            t_low = resolve_threshold(0.15)
            print("resolve_threshold(0.15) ->", t_low)
            assert t_low == 0.30
            
            # High value -> 0.90
            t_high = resolve_threshold(0.98)
            print("resolve_threshold(0.98) ->", t_high)
            assert t_high == 0.90
            
            # Valid value -> unmodified
            t_valid = resolve_threshold(0.65)
            print("resolve_threshold(0.65) ->", t_valid)
            assert t_valid == 0.65
            
            print("\nThreshold resolution checks passed successfully!")
            
    finally:
        # Cleanup dummy video
        if os.path.exists(video_path):
            os.remove(video_path)
            print(f"\nCleaned up dummy video at {video_path}")
            
    print("\n=== TESTS COMPLETED COMPLETED ===")

if __name__ == "__main__":
    run_tests()
