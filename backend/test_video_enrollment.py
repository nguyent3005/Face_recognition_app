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
from app.database import SessionLocal
from app.models.student import Student

client = TestClient(app)

# Mock authenticated user
def override_get_current_user():
    return User(id=1, username="test_admin", role="admin")

app.dependency_overrides[get_current_user] = override_get_current_user

def create_dummy_video():
    """Create a short 2-second dummy video (black frames) using OpenCV."""
    temp_dir = tempfile.gettempdir()
    video_path = os.path.join(temp_dir, "test_dummy_enroll_video.mp4")
    
    fps = 30
    width, height = 320, 240
    
    fourcc = cv2.VideoWriter_fourcc(*'mp4v')
    out = cv2.VideoWriter(video_path, fourcc, fps, (width, height))
    
    for _ in range(60):
        frame = np.zeros((height, width, 3), dtype=np.uint8)
        out.write(frame)
        
    out.release()
    return video_path

def run_tests():
    print("=== STARTING VIDEO ENROLLMENT TESTS ===")
    
    video_path = create_dummy_video()
    print(f"Created dummy video at: {video_path}")
    
    db = SessionLocal()
    try:
        # Get or create a test student
        student = db.query(Student).first()
        if not student:
            print("Creating a temporary test student...")
            student = Student(student_code="9999999", full_name="Nguyễn Văn Test")
            db.add(student)
            db.commit()
            db.refresh(student)
        
        student_id = student.id
        print(f"Using student ID: {student_id} ({student.full_name})")

        # Test 1: Register video for non-existent student (e.g. 999999)
        print("\nTest 1: Register video for non-existent student")
        with open(video_path, "rb") as f:
            response = client.post(
                f"/api/students/999999/register-face-video",
                files={"face_video": ("test.mp4", f, "video/mp4")}
            )
        print("Status Code:", response.status_code)
        print("Response:", response.json())
        assert response.status_code == 404, "Should return 404 student not found"
        assert response.json()["detail"] == "Không tìm thấy sinh viên"

        # Test 2: Register video without video file parameter
        print("\nTest 2: Register video with missing face_video parameter")
        response = client.post(
            f"/api/students/{student_id}/register-face-video"
        )
        print("Status Code:", response.status_code)
        print("Response:", response.json())
        assert response.status_code == 422, "Should return 422 validation error"

        # Test 3: Register dummy video (black frames, no faces)
        print("\nTest 3: Register dummy video (no faces)")
        with open(video_path, "rb") as f:
            response = client.post(
                f"/api/students/{student_id}/register-face-video",
                files={"face_video": ("test.mp4", f, "video/mp4")}
            )
        print("Status Code:", response.status_code)
        print("Response:", response.json())
        assert response.status_code == 400, "Should return 400 bad request"
        assert response.json()["detail"] == "Không phát hiện khuôn mặt trong video"
        
        print("\nAll automated integration checks for video enrollment passed successfully!")

    finally:
        db.close()
        # Cleanup dummy video
        if os.path.exists(video_path):
            os.remove(video_path)
            print(f"\nCleaned up dummy video at {video_path}")
            
    print("\n=== TESTS COMPLETED ===")

if __name__ == "__main__":
    run_tests()
