import sys
import os

# Set up python sys path so we can import from app
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Reconfigure stdout/stderr to UTF-8 to handle Vietnamese accents in Windows console
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8')

import cv2
import logging

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)

from app.config import settings
from app.database import SessionLocal
from app.models.student import Student
from app.services.face_service import identify_face


def main():
    print("=" * 60)
    print("TESTING ATTENDANCE SCENARIOS")
    print("=" * 60)

    db = SessionLocal()
    try:
        # Fetch Nguyễn Anh Tuấn
        student = db.query(Student).filter(Student.student_code == "0214768").first()
        if not student:
            print("[ERROR] Student 0214768 not found in database.")
            sys.exit(1)

        print(f"[INFO] Found student: {student.full_name} ({student.student_code})")
        print(f"[INFO] Photo path in DB: {student.photo_path}")

        # Resolve path
        db_path = student.photo_path
        if db_path.startswith("/uploads/"):
            rel_path = db_path[len("/uploads/"):]
        elif db_path.startswith("uploads/"):
            rel_path = db_path[len("uploads/"):]
        else:
            rel_path = db_path
        abs_path = os.path.join(settings.UPLOAD_DIR, rel_path)

        if not os.path.exists(abs_path):
            print(f"[ERROR] Student's registered photo not found at: {abs_path}")
            sys.exit(1)

        print(f"[INFO] Running Case 1: Match student using their own registered photo...")
        # Read the image bytes
        with open(abs_path, "rb") as f:
            img_bytes = f.read()

        # Run face identification
        result = identify_face(img_bytes, db)
        if result:
            matched_student, score, face_box = result
            print(f"[SUCCESS] Case 1 passed!")
            print(f"  Matched: {matched_student.full_name} ({matched_student.student_code})")
            print(f"  Similarity score: {score:.4f}")
            print(f"  Bounding box: {face_box}")
        else:
            print("[FAILED] Case 1 failed: student was not recognized.")

        print("-" * 60)

        print(f"[INFO] Running Case 2: Match using an unregistered student's photo...")
        # Resolve path for an unregistered student (HUY)
        unregistered_photo = os.path.join(settings.UPLOAD_DIR, "photos", "photo_HUY_20260530_031009_484465.jpg")
        if not os.path.exists(unregistered_photo):
            # Fallback to any photo that is not Nguyễn Anh Tuấn's
            photo_dir = os.path.join(settings.UPLOAD_DIR, "photos")
            for f in os.listdir(photo_dir):
                if not f.startswith("photo_0214768"):
                    unregistered_photo = os.path.join(photo_dir, f)
                    break

        if os.path.exists(unregistered_photo):
            print(f"[INFO] Using unregistered photo: {unregistered_photo}")
            with open(unregistered_photo, "rb") as f:
                unregistered_bytes = f.read()

            result = identify_face(unregistered_bytes, db)
            if result is None:
                print(f"[SUCCESS] Case 2 passed! Unregistered person correctly returned unknown.")
            else:
                matched_student, score, face_box = result
                print(f"[FAILED] Case 2 failed: Unregistered person matched {matched_student.full_name} with score {score:.4f}")
        else:
            print("[WARNING] Could not find any other photos to test Case 2.")

    except Exception as e:
        print(f"[ERROR] Unexpected error during testing: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
    finally:
        db.close()


if __name__ == "__main__":
    main()
