import sys
import os
import argparse
import csv
import logging
import cv2
import numpy as np

# Set up python sys path so we can import from app
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Reconfigure stdout/stderr to UTF-8 to handle Vietnamese accents in Windows console
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8')

from app.config import settings
from app.database import SessionLocal
from app.models.student import Student
from app.services.face_service import bytes_to_embedding, get_model, l2_normalize
from app.utils.face_preprocessing import preprocess_face

logging.basicConfig(level=logging.WARNING)
logger = logging.getLogger("FindUnaligned")

def parse_args():
    parser = argparse.ArgumentParser(description="Find students whose face embeddings are unaligned or low quality.")
    parser.add_argument(
        "--threshold",
        type=float,
        default=0.90,
        help="Cosine similarity threshold for self-matching (default: 0.90)"
    )
    return parser.parse_args()

def main():
    args = parse_args()
    threshold = args.threshold

    print("=" * 70)
    print(" HỆ THỐNG CHẨN ĐOÁN CĂN CHỈNH KHUÔN MẶT SINH VIÊN (ALIGNMENT DIAGNOSIS)")
    print("=" * 70)
    print("[NHẮC NHỞ] Hãy sao lưu (backup) cơ sở dữ liệu trước khi thực hiện các yêu cầu đăng ký lại hàng loạt.")
    print(f"[CẤU HÌNH] Ngưỡng tự so khớp (Self-match Threshold): {threshold:.2f}")
    print("=" * 70)

    db = SessionLocal()
    reports_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "reports")
    os.makedirs(reports_dir, exist_ok=True)
    csv_path = os.path.join(reports_dir, "unaligned_registrations.csv")

    try:
        students = db.query(Student).all()
        print(f"Tổng số sinh viên trong cơ sở dữ liệu: {len(students)}")
        
        # Stats counters
        total_count = len(students)
        ok_count = 0
        missing_emb_count = 0
        missing_photo_count = 0
        photo_not_readable_count = 0
        no_landmarks_count = 0
        low_self_match_count = 0
        error_count = 0

        csv_rows = []

        model = get_model()

        for idx, std in enumerate(students):
            student_id = std.id
            student_code = std.student_code
            full_name = std.full_name
            photo_path = std.photo_path

            # Default status variables
            status = "ok"
            similarity = 0.0
            reason = ""

            print(f"[{idx+1}/{total_count}] Đang xử lý: {full_name} ({student_code})...", end="", flush=True)

            if std.face_embedding is None:
                status = "missing_embedding"
                reason = "Sinh viên chưa có dữ liệu face embedding trong database"
                missing_emb_count += 1
                print(" CHƯA ĐĂNG KÝ")
            elif not photo_path:
                status = "missing_photo"
                reason = "Không có đường dẫn ảnh gốc lưu trong database"
                missing_photo_count += 1
                print(" THIẾU ẢNH GỐC")
            else:
                # Resolve photo path on disk
                if photo_path.startswith("/uploads/"):
                    rel_path = photo_path[len("/uploads/"):]
                elif photo_path.startswith("uploads/"):
                    rel_path = photo_path[len("uploads/"):]
                else:
                    rel_path = photo_path
                
                abs_photo_path = os.path.join(settings.UPLOAD_DIR, rel_path)
                
                if not os.path.exists(abs_photo_path):
                    # Fallback to backend dir directly
                    backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
                    abs_photo_path = os.path.join(backend_dir, "uploads", rel_path)

                if not os.path.exists(abs_photo_path):
                    status = "missing_photo"
                    reason = f"Không tìm thấy tệp ảnh gốc trên đĩa: {abs_photo_path}"
                    missing_photo_count += 1
                    print(" TỆP ẢNH GỐC KHÔNG TỒN TẠI")
                else:
                    # Read image
                    img = cv2.imread(abs_photo_path)
                    if img is None:
                        status = "photo_not_readable"
                        reason = "Không thể đọc tệp ảnh bằng OpenCV (có thể file bị lỗi)"
                        photo_not_readable_count += 1
                        print(" LỖI ĐỌC ẢNH")
                    else:
                        try:
                            # Preprocess with require_alignment=True
                            face_preprocessed, bbox, confidence = preprocess_face(img, require_alignment=True)
                            
                            # Extract new embedding using PyTorch model
                            new_emb = model.get_embedding(face_preprocessed)
                            new_emb = l2_normalize(new_emb)

                            # Load saved embedding from DB
                            db_emb = bytes_to_embedding(std.face_embedding)
                            db_emb = l2_normalize(db_emb)

                            # Compute cosine similarity
                            similarity = float(np.dot(new_emb, db_emb))
                            
                            if similarity >= threshold:
                                status = "ok"
                                ok_count += 1
                                print(f" OK (Self-match: {similarity:.4f})")
                            else:
                                status = "low_self_match"
                                reason = f"Điểm tự so khớp thấp ({similarity:.4f} < {threshold:.2f}), cần đăng ký lại để align chuẩn"
                                low_self_match_count += 1
                                print(f" TỰ SO KHỚP THẤP ({similarity:.4f})")
                        except ValueError as ve:
                            status = "no_valid_landmarks"
                            reason = f"Lỗi tiền xử lý hoặc căn chỉnh: {str(ve)}"
                            no_landmarks_count += 1
                            print(" KHÔNG ĐỦ LANDMARKS / CĂN CHỈNH LỖI")
                        except Exception as e:
                            status = "error"
                            reason = f"Lỗi hệ thống: {str(e)}"
                            error_count += 1
                            print(" LỖI HỆ THỐNG")

            csv_rows.append({
                "student_id": student_id,
                "student_code": student_code,
                "full_name": full_name,
                "status": status,
                "similarity": f"{similarity:.4f}" if similarity > 0 else "N/A",
                "photo_path": photo_path or "N/A",
                "reason": reason
            })

        # Save to CSV
        with open(csv_path, mode="w", encoding="utf-8", newline="") as f:
            fieldnames = ["student_id", "student_code", "full_name", "status", "similarity", "photo_path", "reason"]
            writer = csv.DictWriter(f, fieldnames=fieldnames)
            writer.writeheader()
            writer.writerows(csv_rows)

        print("\n" + "=" * 70)
        print(" TÓM TẮT KẾT QUẢ CHẨN ĐOÁN:")
        print("=" * 70)
        print(f"Tổng số sinh viên: {total_count}")
        print(f"OK (Đạt chuẩn): {ok_count}")
        print(f"Chưa đăng ký: {missing_emb_count}")
        print(f"Thiếu ảnh gốc: {missing_photo_count}")
        print(f"Không đọc được ảnh: {photo_not_readable_count}")
        print(f"Không đủ landmarks để align: {no_landmarks_count}")
        print(f"Độ tương đồng tự so khớp thấp: {low_self_match_count}")
        print(f"Lỗi hệ thống khác: {error_count}")
        
        need_re_enroll = no_landmarks_count + low_self_match_count
        print("-" * 70)
        print(f"SỐ SINH VIÊN CẦN ĐĂNG KÝ LẠI KHUÔN MẶT: {need_re_enroll}")
        print(f"Báo cáo chi tiết đã lưu tại: {csv_path}")
        print("=" * 70)

    except Exception as e:
        print(f"\n[ERROR] Lỗi trong quá trình chạy script chẩn đoán: {e}")
        import traceback
        traceback.print_exc()
    finally:
        db.close()

if __name__ == "__main__":
    main()
