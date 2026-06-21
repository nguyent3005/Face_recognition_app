import sys
import os
from datetime import timedelta, date, datetime

# Add parent directory to path to import app modules
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.database import SessionLocal
from app.models.session import Session

def get_offset_for_day(day_str):
    mapping = {
        "Thứ 2": 0,
        "Thứ 3": 1,
        "Thứ 4": 2,
        "Thứ 5": 3,
        "Thứ 6": 4,
        "Thứ 7": 5,
        "Chủ nhật": 6
    }
    return mapping.get(day_str, 0)

def main():
    db = SessionLocal()
    try:
        sessions = db.query(Session).all()
        # "This week" Monday is June 1, 2026 (based on current local time)
        base_date = date(2026, 6, 1)
        
        for s in sessions:
            if not s.day_of_week:
                continue
                
            offset = get_offset_for_day(s.day_of_week)
            new_date = base_date + timedelta(days=offset)
            
            # Calculate difference in days to shift start_time and end_time
            delta_days = (new_date - s.study_date).days
            
            s.study_date = new_date
            s.start_time = s.start_time + timedelta(days=delta_days)
            s.end_time = s.end_time + timedelta(days=delta_days)
            
            print(f"Shifted {s.id} to {s.study_date}")
            
        db.commit()
        print("Successfully updated all sessions to this week!")
    except Exception as e:
        print(f"Error: {e}")
        db.rollback()
    finally:
        db.close()

if __name__ == "__main__":
    main()
