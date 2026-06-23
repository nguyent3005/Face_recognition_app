import sys
import os
import re
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

def parse_sql_file(file_path):
    with open(file_path, 'r', encoding='utf-8') as f:
        content = f.read()

    # Find the INSERT block for ClassSchedules
    insert_block_match = re.search(r'INSERT INTO ClassSchedules.*?VALUES\s*(.*?)(?:ON DUPLICATE KEY|;)', content, re.DOTALL | re.IGNORECASE)
    if not insert_block_match:
        print("Could not find INSERT INTO ClassSchedules in the SQL file.")
        return []

    values_str = insert_block_match.group(1).strip()
    
    # regex to match each row: ('...', '...', 2, '...', 7, 9, '...', '...', '...', '...', 15)
    row_pattern = re.compile(r"\('(.*?)',\s*'(.*?)',\s*(\d+),\s*'(.*?)',\s*(\d+),\s*(\d+),\s*'(.*?)',\s*'(.*?)',\s*'(.*?)',\s*'(.*?)',\s*(\d+)\)")
    
    schedules = []
    for match in row_pattern.finditer(values_str):
        schedules.append({
            'subject_name': match.group(1),
            'class_code': match.group(2),
            'day_of_week': int(match.group(3)),
            'weekday_name': match.group(4),
            'period_start': int(match.group(5)),
            'period_end': int(match.group(6)),
            'start_time': match.group(7),
            'end_time': match.group(8),
            'room': match.group(9),
            'teacher_name': match.group(10),
            'late_after_minutes': int(match.group(11))
        })
    return schedules

def seed(sql_file_path):
    print("Initializing database tables if they don't exist...")
    init_db()

    print(f"Reading SQL file: {sql_file_path}")
    schedules = parse_sql_file(sql_file_path)
    if not schedules:
        print("No schedules to import.")
        return

    db = SessionLocal()
    try:
        for s_data in schedules:
            print(f"Importing schedule: {s_data['subject_name']} - {s_data['class_code']}")
            
            # 1. CourseClass
            parts = s_data['class_code'].split(' - ')
            c_name = parts[0].strip()
            section_code = parts[1].strip() if len(parts) > 1 else s_data['class_code']

            cls = db.query(CourseClass).filter(CourseClass.class_name == c_name).first()
            if not cls:
                cls = CourseClass(class_name=c_name, class_code=c_name)
                db.add(cls)
                db.commit()
                db.refresh(cls)

            # 2. Subject
            subject_name = s_data['subject_name']
            subject_code = ''.join(word[0] for word in subject_name.split() if word[0].isupper() or word[0].isalpha()).upper()
            if not subject_code:
                subject_code = subject_name[:4].upper()
                
            subject_obj = db.query(Subject).filter(Subject.subject_name == subject_name).first()
            if not subject_obj:
                subject_obj = Subject(subject_name=subject_name, subject_code=subject_code)
                db.add(subject_obj)
                db.commit()
                db.refresh(subject_obj)

            # 3. Teachers
            teacher_names = [t.strip() for t in s_data['teacher_name'].split(',')]
            t_objs = []
            for t_name in teacher_names:
                t = db.query(Teacher).filter(Teacher.full_name == t_name).first()
                if not t:
                    t = Teacher(full_name=t_name)
                    db.add(t)
                    db.commit()
                    db.refresh(t)
                t_objs.append(t)

            # 4. Session
            # Base date: Monday, May 25, 2026
            offset = s_data['day_of_week'] - 2
            study_date = date(2026, 5, 25) + timedelta(days=offset)

            # Parse times
            start_t = datetime.strptime(s_data['start_time'], '%H:%M:%S').time()
            end_t = datetime.strptime(s_data['end_time'], '%H:%M:%S').time()
            st = datetime.combine(study_date, start_t, tzinfo=VN_TZ)
            et = datetime.combine(study_date, end_t, tzinfo=VN_TZ)

            session = db.query(Session).filter(
                Session.class_id == cls.id,
                Session.subject_id == subject_obj.id,
                Session.section_code == section_code,
                Session.study_date == study_date,
                Session.lesson_start == s_data['period_start']
            ).first()

            if not session:
                session = Session(
                    class_id=cls.id,
                    subject_id=subject_obj.id,
                    section_code=section_code,
                    study_date=study_date,
                    day_of_week=s_data['weekday_name'],
                    lesson_start=s_data['period_start'],
                    lesson_end=s_data['period_end'],
                    start_time=st,
                    end_time=et,
                    room=s_data['room'],
                    late_after_minutes=s_data['late_after_minutes']
                )
                db.add(session)
                db.commit()
                db.refresh(session)
                
                # Add teachers
                for t_obj in t_objs:
                    st_mapping = SessionTeacher(session_id=session.id, teacher_id=t_obj.id)
                    db.add(st_mapping)
                db.commit()
                print(f"Added session: {subject_obj.subject_name} on {study_date}")
            else:
                # Update late_after_minutes if needed
                if getattr(session, 'late_after_minutes', None) != s_data['late_after_minutes']:
                    session.late_after_minutes = s_data['late_after_minutes']
                    db.commit()
                    print(f"Updated late_after_minutes for session: {subject_obj.subject_name} on {study_date}")
                else:
                    print(f"Session already exists: {subject_obj.subject_name} on {study_date}")

        print("Import completed successfully!")
    except Exception as e:
        print(f"Error importing: {e}")
        db.rollback()
    finally:
        db.close()

if __name__ == "__main__":
    sql_path = r"C:\Users\Admin\Downloads\database_updated_with_schedule.sql"
    if len(sys.argv) > 1:
        sql_path = sys.argv[1]
    
    if not os.path.exists(sql_path):
        print(f"Error: Could not find SQL file at {sql_path}")
        sys.exit(1)
        
    seed(sql_path)
