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
import numpy as np
from app.config import settings
from app.database import SessionLocal
from app.models.student import Student
from app.services.face_service import bytes_to_embedding, identify_face

def main():
    print("=" * 60)
    print("DIAGNOSTIC REPORT FOR NEW REGISTRATION")
    print("=" * 60)

    db = SessionLocal()
    try:
        # Fetch the student Bùi Mạnh Tiến
        student = db.query(Student).filter(Student.student_code == "0294368").first()
        if not student:
            print("[-] Student 0294368 (Bùi Mạnh Tiến) not found in DB.")
            sys.exit(1)

        print(f"[+] Student found: {student.full_name} ({student.student_code})")
        print(f"    Active: {student.is_active}")
        print(f"    Has face embedding: {student.face_embedding is not None}")
        
        if student.face_embedding is not None:
            emb = bytes_to_embedding(student.face_embedding)
            print(f"    Embedding shape: {emb.shape}")
            print(f"    Embedding L2 norm: {np.linalg.norm(emb):.4f}")
        else:
            print("    [WARNING] Face embedding is NULL in database!")

        print(f"    Photo path: {student.photo_path}")

        # Resolve path to the actual registered photo
        db_path = student.photo_path
        if db_path.startswith("/uploads/"):
            rel_path = db_path[len("/uploads/"):]
        elif db_path.startswith("uploads/"):
            rel_path = db_path[len("uploads/"):]
        else:
            rel_path = db_path
        abs_path = os.path.join(settings.UPLOAD_DIR, rel_path)

        print(f"    Absolute photo path on disk: {abs_path}")
        print(f"    File exists: {os.path.exists(abs_path)}")

        if os.path.exists(abs_path):
            # Test self-matching on this registered photo
            print("\n[INFO] Test matching of the student against their own registered photo...")
            with open(abs_path, "rb") as f:
                img_bytes = f.read()

            result = identify_face(img_bytes, db)
            if result:
                matched_student, score, face_box = result
                print(f"[+] SUCCESS: Self-match passed!")
                print(f"    Matched: {matched_student.full_name} ({matched_student.student_code})")
                print(f"    Similarity: {score:.4f} (threshold: {settings.FACE_MATCH_THRESHOLD})")
            else:
                print(f"[-] FAILED: Self-match failed!")
                # Let's manually calculate similarity to see why it failed
                # Load image, detect, crop, extract
                from app.services.face_service import detect_single_face, crop_face_with_margin, extract_embedding_from_face_crop
                
                image = cv2.imread(abs_path)
                face_box = detect_single_face(image)
                face_crop = crop_face_with_margin(image, face_box, margin_ratio=0.25)
                query_emb = extract_embedding_from_face_crop(face_crop)
                
                if student.face_embedding is not None:
                    db_emb = bytes_to_embedding(student.face_embedding)
                    sim = float(np.dot(query_emb, db_emb) / (np.linalg.norm(query_emb) * np.linalg.norm(db_emb)))
                    print(f"    Manual dot-product similarity: {sim:.4f}")
                else:
                    print("    Cannot compute manual similarity because DB embedding is NULL.")

    except Exception as e:
        print(f"[ERROR] Diagnostic failed: {e}")
        import traceback
        traceback.print_exc()
    finally:
        db.close()

if __name__ == "__main__":
    main()
