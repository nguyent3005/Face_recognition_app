import os
import sys
import re
import pandas as pd
from datetime import datetime

if sys.stdout.encoding != 'utf-8':
    sys.stdout.reconfigure(encoding='utf-8')

# Add the parent directory to sys.path so we can import app modules
current_dir = os.path.dirname(os.path.abspath(__file__))
parent_dir = os.path.dirname(current_dir)
sys.path.append(parent_dir)

from app.database import SessionLocal
from app.models.student import Student
from app.models.course_class import CourseClass

def clean_string(val):
    if pd.isna(val):
        return None
    val = str(val).strip()
    return val if val else None

def get_column_name(columns, possible_names):
    """Helper to find the actual column name from possible variants"""
    for col in columns:
        col_clean = str(col).strip().lower()
        for name in possible_names:
            if name.lower() in col_clean:
                return col
    return None

def import_students(excel_path):
    report_lines = []
    
    def log(msg):
        print(msg)
        report_lines.append(msg)

    log(f"--- BẮT ĐẦU IMPORT TỪ EXCEL: {excel_path} ---")
    log(f"Thời gian: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    
    if not os.path.exists(excel_path):
        log(f"LỖI: Không tìm thấy file {excel_path}")
        return
        
    try:
        df = pd.read_excel(excel_path, dtype=str)
    except Exception as e:
        log(f"LỖI: Không thể đọc file Excel. Chi tiết: {e}")
        return

    # Xác định các cột
    cols = df.columns.tolist()
    
    col_mssv = get_column_name(cols, ['mssv', 'mã sv', 'mã sinh viên', 'mã'])
    col_name = get_column_name(cols, ['họ và tên', 'họ tên', 'tên sinh viên', 'tên'])
    col_class = get_column_name(cols, ['lớp học', 'lớp sinh hoạt', 'lớp', 'class'])
    col_phone = get_column_name(cols, ['sđt', 'số điện thoại', 'điện thoại', 'phone'])
    col_email = get_column_name(cols, ['email', 'thư điện tử', 'thư'])
    
    if not col_mssv:
        # Nếu file không có header chuẩn, thử dùng heuristic dòng đầu
        # Tuy nhiên, thông thường danh sách DSDK_CN_KS... sẽ có header.
        # Fallback: lấy cột 1 làm mssv, 2 làm họ tên, 3 làm lớp
        if len(cols) >= 3:
            col_mssv = cols[1]
            col_name = cols[2]
            col_class = cols[3] if len(cols) > 3 else None
        else:
            log("LỖI: Không thể nhận diện cấu trúc cột (MSSV, Họ tên).")
            return

    log(f"Map cột: MSSV='{col_mssv}', Tên='{col_name}', Lớp='{col_class}'")

    db = SessionLocal()
    
    # Cache class to avoid multiple queries
    class_cache = {}
    
    # Thống kê
    stats = {
        'total': 0,
        'inserted': 0,
        'updated': 0,
        'skipped': 0,
        'errors': []
    }

    mssv_regex = re.compile(r"^\d{6,7}$")
    email_regex = re.compile(r"^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+$")

    for index, row in df.iterrows():
        stats['total'] += 1
        row_num = index + 2 # Header is row 1
        
        mssv = clean_string(row.get(col_mssv)) if col_mssv else None
        name = clean_string(row.get(col_name)) if col_name else None
        class_name_raw = clean_string(row.get(col_class)) if col_class else "68CS3"
        phone = clean_string(row.get(col_phone)) if col_phone else None
        email = clean_string(row.get(col_email)) if col_email else None
        
        # Nếu cột cuối cùng chứa NaN và các cột khác bị lệch, dùng fillna hoặc cẩn thận
        # Chúng ta chỉ lấy thông tin cần thiết.

        # Bỏ qua các dòng trống hoàn toàn
        if not mssv and not name:
            stats['skipped'] += 1
            continue

        # Validate MSSV
        if not mssv:
            err = f"Dòng {row_num}: Thiếu MSSV"
            stats['errors'].append(err)
            stats['skipped'] += 1
            continue
            
        if not mssv_regex.match(mssv):
            # Có thể do parse file tự thêm .0 vào cuối số
            mssv = mssv.split('.')[0]
            if not mssv_regex.match(mssv):
                err = f"Dòng {row_num}: MSSV không hợp lệ ({mssv})"
                stats['errors'].append(err)
                stats['skipped'] += 1
                continue

        # Validate Tên
        if not name:
            err = f"Dòng {row_num}: Thiếu họ và tên"
            stats['errors'].append(err)
            stats['skipped'] += 1
            continue

        # Validate email nếu có
        if email and not email_regex.match(email):
            email = None # Bỏ qua email lỗi, vẫn import
            
        if not class_name_raw:
            class_name_raw = "68CS3"

        # Lấy hoặc tạo Class
        if class_name_raw not in class_cache:
            db_class = db.query(CourseClass).filter(CourseClass.class_name == class_name_raw).first()
            if not db_class:
                # Tạo class mới
                db_class = CourseClass(class_code=class_name_raw, class_name=class_name_raw)
                db.add(db_class)
                db.commit()
                db.refresh(db_class)
                log(f"-> Đã tạo lớp mới: {class_name_raw}")
            class_cache[class_name_raw] = db_class.id
            
        class_id = class_cache[class_name_raw]

        # Kiểm tra sinh viên đã tồn tại chưa
        student = db.query(Student).filter(Student.student_code == mssv).first()
        
        if student:
            # Cập nhật thông tin
            updated = False
            if student.full_name != name:
                student.full_name = name
                updated = True
            if student.class_id != class_id:
                student.class_id = class_id
                student.class_name = class_name_raw
                updated = True
            if phone and student.phone != phone:
                student.phone = phone
                updated = True
            if email and student.email != email:
                student.email = email
                updated = True
                
            # Lưu ý: Tuyệt đối không chạm vào face_embedding
            if updated:
                stats['updated'] += 1
            else:
                stats['skipped'] += 1
        else:
            # Tạo mới
            new_student = Student(
                student_code=mssv,
                full_name=name,
                class_id=class_id,
                class_name=class_name_raw,
                phone=phone,
                email=email
            )
            # Không gán face_embedding = None vì mặc định model đã là None,
            # tức là "chưa đăng ký khuôn mặt"
            db.add(new_student)
            stats['inserted'] += 1

    try:
        db.commit()
    except Exception as e:
        db.rollback()
        log(f"LỖI: Lỗi database khi lưu: {e}")

    db.close()

    log("\n--- BÁO CÁO KẾT QUẢ IMPORT ---")
    log(f"Tổng số dòng xử lý: {stats['total']}")
    log(f"Import mới thành công: {stats['inserted']}")
    log(f"Đã tồn tại & cập nhật: {stats['updated']}")
    log(f"Bỏ qua: {stats['skipped']}")
    
    if stats['errors']:
        log("\nChi tiết lỗi:")
        for err in stats['errors']:
            log(f"- {err}")

    # Ghi file report
    report_path = os.path.join(current_dir, "import_students_report.txt")
    with open(report_path, "w", encoding="utf-8") as f:
        f.write("\n".join(report_lines))
        
    print(f"\nĐã lưu báo cáo chi tiết tại: {report_path}")

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Sử dụng: python import_students_from_excel.py <đường_dẫn_file_excel>")
        sys.exit(1)
        
    excel_file = sys.argv[1]
    import_students(excel_file)
