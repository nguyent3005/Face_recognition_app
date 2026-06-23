import sys
import os
import argparse
import shutil
import json
from datetime import datetime

# Reconfigure stdout/stderr to UTF-8 to handle Vietnamese accents in Windows console
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8')

# Set up python sys path so we can import from app
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import cv2
import numpy as np
from app.config import settings
from app.database import SessionLocal
from app.models.student import Student
from app.services.face_service import (
    get_model,
    bytes_to_embedding,
    embedding_to_bytes,
    detect_single_face,
    crop_face_with_margin,
    extract_embedding_from_face_crop
)


def get_model_version():
    """Read the model version from model_metadata.json."""
    metadata_path = os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        "app",
        "ml",
        "models",
        "model_metadata.json"
    )
    if os.path.exists(metadata_path):
        try:
            with open(metadata_path, "r") as f:
                meta = json.load(f)
                return meta.get("version", "unknown")
        except Exception as e:
            print(f"[WARNING] Failed to parse model_metadata.json: {e}")
    return "unknown"


def backup_database():
    """Backup SQLite database using a timestamp prefix."""
    db_url = settings.DATABASE_URL
    if db_url.startswith("sqlite:///"):
        db_path = db_url[len("sqlite:///"):]
    else:
        db_path = "face_attendance.db"

    abs_db_path = os.path.abspath(db_path)
    if os.path.exists(abs_db_path):
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        backup_path = f"{os.path.splitext(abs_db_path)[0]}_{timestamp}.db.bak"
        shutil.copy2(abs_db_path, backup_path)
        print(f"[INFO] Database backed up successfully to: {backup_path}")
        return backup_path
    else:
        print(f"[WARNING] Database file not found at {abs_db_path}, skipping backup.")
        return None


def main():
    parser = argparse.ArgumentParser(description="Rebuild student face embeddings using the new iResNet50 model.")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Simulate the rebuild process without backing up the database or saving updates."
    )
    args = parser.parse_args()

    model_version = get_model_version()
    print("=" * 60)
    print(f"REBUILD FACE EMBEDDINGS SCRIPT (Model: {model_version})")
    print(f"Mode: {'DRY-RUN (Simulation)' if args.dry_run else 'LIVE UPDATE'}")
    print("=" * 60)

    # 1. Backup DB if live run
    if not args.dry_run:
        backup_database()

    # 2. Pre-load model to verify it works
    print("[INFO] Initializing face recognition model...")
    try:
        model = get_model()
        print("[INFO] Model loaded successfully.")
    except Exception as e:
        print(f"[ERROR] Failed to load the new model: {e}")
        sys.exit(1)

    # 3. Process students
    db = SessionLocal()
    try:
        students = db.query(Student).filter(Student.is_active == True).all()
        total_students = len(students)
        print(f"[INFO] Found {total_students} active student records in the database.")

        no_photo_path = 0
        photo_not_found = 0
        success_count = 0
        failed_count = 0
        
        success_students = []
        missing_photo_students = []

        for idx, student in enumerate(students, 1):
            print(f"[{idx}/{total_students}] Processing: {student.full_name} ({student.student_code})...")
            
            if not student.photo_path:
                print(f"  [-] No photo path in database. Rebuild skipped.")
                no_photo_path += 1
                missing_photo_students.append(student)
                continue

            # Resolve absolute path using UPLOAD_DIR
            db_path = student.photo_path
            if db_path.startswith("/uploads/"):
                rel_path = db_path[len("/uploads/"):]
            elif db_path.startswith("uploads/"):
                rel_path = db_path[len("uploads/"):]
            else:
                rel_path = db_path
            abs_path = os.path.join(settings.UPLOAD_DIR, rel_path)

            if not os.path.exists(abs_path):
                print(f"  [-] Photo not found on disk: {abs_path}. Skip.")
                photo_not_found += 1
                missing_photo_students.append(student)
                continue

            try:
                # Read image using OpenCV
                image = cv2.imread(abs_path)
                if image is None:
                    raise ValueError(f"Failed to read image file: {abs_path}")

                # Preprocess: Detect, crop and extract embedding
                face_box = detect_single_face(image)
                face_crop = crop_face_with_margin(image, face_box, margin_ratio=0.25)
                embedding = extract_embedding_from_face_crop(face_crop)

                # Ensure shape and type are correct
                if embedding.shape != (512,):
                    raise ValueError(f"Extracted embedding shape mismatch: expected (512,), got {embedding.shape}")

                # Save new embedding in DB if not dry-run
                if not args.dry_run:
                    student.face_embedding = embedding_to_bytes(embedding)
                
                print(f"  [+] Success. L2 norm: {np.linalg.norm(embedding):.4f}")
                success_count += 1
                success_students.append(student)
            except Exception as e:
                print(f"  [x] Failed to process photo: {e}")
                failed_count += 1

        print("=" * 60)
        print("REBUILD SUMMARY:")
        print(f"  Total Active Students:      {total_students}")
        print(f"  Successfully Rebuilt:      {success_count}")
        print(f"  Failed to Process:         {failed_count}")
        print(f"  Skipped (No Path in DB):   {no_photo_path}")
        print(f"  Skipped (File Missing):    {photo_not_found}")
        print("=" * 60)

        if missing_photo_students:
            print("\n[IMPORTANT] The following students do not have registered photos on disk and MUST register again:")
            for s in missing_photo_students:
                print(f"  - {s.full_name} ({s.student_code}) - Photo Path: {s.photo_path or 'None'}")
            print()

        if args.dry_run:
            print("[DRY-RUN] Simulation finished. No database changes were saved.")
            db.rollback()
        else:
            if success_count > 0:
                print("[INFO] Committing transaction to database...")
                db.commit()
                print("[SUCCESS] All successful embeddings saved to database.")
            else:
                print("[INFO] No embeddings were successfully rebuilt. Transaction rolled back.")
                db.rollback()

    except Exception as e:
        print(f"[FATAL ERROR] An unexpected error occurred: {e}")
        db.rollback()
        sys.exit(1)
    finally:
        db.close()


if __name__ == "__main__":
    main()
