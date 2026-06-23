import sys
import os
from datetime import datetime, date, time, timezone, timedelta

# Add parent directory to path to import app modules
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.database import SessionLocal, init_db
from app.models.course_class import CourseClass
from app.models.subject import Subject
from app.models.teacher import Teacher
from app.models.session import Session
from app.models.session_teacher import SessionTeacher

VN_TZ = timezone(timedelta(hours=7))

def seed():
    print("Initializing database tables if they don't exist...")
    init_db()

    db = SessionLocal()
    try:
        print("Seeding Course Class...")
        class_name = "68CS3"
        cls = db.query(CourseClass).filter(CourseClass.class_name == class_name).first()
        if not cls:
            cls = CourseClass(class_name=class_name, class_code=class_name)
            db.add(cls)
            db.commit()
            db.refresh(cls)

        print("Seeding Teachers...")
        teacher_names = ["Nguyễn Đình Quý", "Đào Việt Cường", "Hoàng Nam Thắng", "Lê Văn Minh"]
        teachers = {}
        for name in teacher_names:
            t = db.query(Teacher).filter(Teacher.full_name == name).first()
            if not t:
                t = Teacher(full_name=name)
                db.add(t)
                db.commit()
                db.refresh(t)
            teachers[name] = t

        print("Seeding Subjects...")
        subjects_data = [
            ("Đồ án Thị giác máy tính", "DA_TGMT"),
            ("Thị giác máy tính", "TGMT"),
            ("Xử lý ngôn ngữ tự nhiên", "XLNNTN"),
            ("Đồ án Phát triển ứng dụng đa nền tảng", "DA_PTUD"),
            ("Phát triển ứng dụng đa nền tảng", "PTUD"),
        ]
        subjects = {}
        for name, code in subjects_data:
            s = db.query(Subject).filter(Subject.subject_name == name).first()
            if not s:
                s = Subject(subject_name=name, subject_code=code)
                db.add(s)
                db.commit()
                db.refresh(s)
            subjects[name] = s

        print("Seeding Sessions...")
        sessions_data = [
            {
                "subject": "Đồ án Thị giác máy tính", "section_code": "60881503",
                "study_date": date(2026, 5, 25), "day_of_week": "Thứ 2",
                "lesson_start": 7, "lesson_end": 9,
                "start_time": time(12, 30), "end_time": time(15, 10),
                "room": "H3.53", "teachers": ["Nguyễn Đình Quý"]
            },
            {
                "subject": "Thị giác máy tính", "section_code": "60881403",
                "study_date": date(2026, 5, 26), "day_of_week": "Thứ 3",
                "lesson_start": 10, "lesson_end": 12,
                "start_time": time(15, 20), "end_time": time(18, 00),
                "room": "H3.35", "teachers": ["Nguyễn Đình Quý"]
            },
            {
                "subject": "Xử lý ngôn ngữ tự nhiên", "section_code": "60881103",
                "study_date": date(2026, 5, 27), "day_of_week": "Thứ 4",
                "lesson_start": 7, "lesson_end": 9,
                "start_time": time(12, 30), "end_time": time(15, 10),
                "room": "P.MAY 2", "teachers": ["Đào Việt Cường", "Nguyễn Đình Quý"]
            },
            {
                "subject": "Đồ án Phát triển ứng dụng đa nền tảng", "section_code": "60881903",
                "study_date": date(2026, 5, 27), "day_of_week": "Thứ 4",
                "lesson_start": 10, "lesson_end": 12,
                "start_time": time(15, 20), "end_time": time(18, 00),
                "room": "H3.55", "teachers": ["Hoàng Nam Thắng", "Lê Văn Minh"]
            },
            {
                "subject": "Phát triển ứng dụng đa nền tảng", "section_code": "60881803",
                "study_date": date(2026, 5, 28), "day_of_week": "Thứ 5",
                "lesson_start": 7, "lesson_end": 9,
                "start_time": time(12, 30), "end_time": time(15, 10),
                "room": "H3.34", "teachers": ["Hoàng Nam Thắng", "Lê Văn Minh"]
            },
            {
                "subject": "Xử lý ngôn ngữ tự nhiên", "section_code": "60881103",
                "study_date": date(2026, 5, 29), "day_of_week": "Thứ 6",
                "lesson_start": 10, "lesson_end": 12,
                "start_time": time(15, 20), "end_time": time(18, 00),
                "room": "H3.23", "teachers": ["Đào Việt Cường", "Nguyễn Đình Quý"]
            }
        ]

        for s_data in sessions_data:
            # Construct aware datetime objects
            st = datetime.combine(s_data["study_date"], s_data["start_time"], tzinfo=VN_TZ)
            et = datetime.combine(s_data["study_date"], s_data["end_time"], tzinfo=VN_TZ)
            
            subject_obj = subjects[s_data["subject"]]
            
            # Check if session exists to be idempotent
            session = db.query(Session).filter(
                Session.class_id == cls.id,
                Session.section_code == s_data["section_code"],
                Session.study_date == s_data["study_date"],
                Session.lesson_start == s_data["lesson_start"]
            ).first()

            if not session:
                session = Session(
                    class_id=cls.id,
                    subject_id=subject_obj.id,
                    section_code=s_data["section_code"],
                    study_date=s_data["study_date"],
                    day_of_week=s_data["day_of_week"],
                    lesson_start=s_data["lesson_start"],
                    lesson_end=s_data["lesson_end"],
                    start_time=st,
                    end_time=et,
                    room=s_data["room"]
                )
                db.add(session)
                db.commit()
                db.refresh(session)
                
                # Add teachers
                for t_name in s_data["teachers"]:
                    t_obj = teachers[t_name]
                    st_mapping = SessionTeacher(session_id=session.id, teacher_id=t_obj.id)
                    db.add(st_mapping)
                db.commit()
                print(f"Added session: {subject_obj.subject_name} on {s_data['study_date']}")
            else:
                print(f"Session already exists: {subject_obj.subject_name} on {s_data['study_date']}")

        print("Seed completed successfully!")
    except Exception as e:
        print(f"Error seeding: {e}")
        db.rollback()
    finally:
        db.close()

if __name__ == "__main__":
    seed()
