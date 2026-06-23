import sys
import os
from datetime import timedelta, date, datetime

# Reconfigure stdout/stderr to UTF-8 for Vietnamese console printing
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8')

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.database import SessionLocal
from app.models.session import Session

def main():
    db = SessionLocal()
    try:
        # Current local time with timezone info
        now = datetime.now().astimezone()
        
        # We want to use the date of today
        today_date = now.date()
        
        # Get all sessions for today
        sessions = db.query(Session).filter(Session.study_date == today_date).all()
        
        if len(sessions) >= 1:
            s1 = sessions[0]
            # Set to start 10 minutes ago, end 2 hours from now
            # So student checking in now will be PRESENT (<= 15 mins)
            s1.start_time = now - timedelta(minutes=10)
            s1.end_time = now + timedelta(hours=2)
            s1.late_after_minutes = 15
            print(f"Updated Session {s1.id} ({s1.subject.subject_name if s1.subject else ''})")
            print(f"  Start: {s1.start_time}")
            print(f"  End: {s1.end_time}")
            print(f"  Status at {now.strftime('%H:%M:%S')}: Should be PRESENT (<= 15 mins late)")
            
        if len(sessions) >= 2:
            s2 = sessions[1]
            # Set to start 30 minutes ago, end 2 hours from now
            # So student checking in now will be LATE (> 15 mins)
            s2.start_time = now - timedelta(minutes=30)
            s2.end_time = now + timedelta(hours=2)
            s2.late_after_minutes = 15
            print(f"\nUpdated Session {s2.id} ({s2.subject.subject_name if s2.subject else ''})")
            print(f"  Start: {s2.start_time}")
            print(f"  End: {s2.end_time}")
            print(f"  Status at {now.strftime('%H:%M:%S')}: Should be LATE (> 15 mins late)")

        db.commit()
        print("\nSuccessfully updated session times to overlap with the current time!")
    except Exception as e:
        print(f"Error: {e}")
        db.rollback()
    finally:
        db.close()

if __name__ == "__main__":
    main()
