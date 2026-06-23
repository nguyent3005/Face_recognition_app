import sqlite3
import os
from datetime import datetime

# Lấy ngày hiện tại động để phục vụ test
today_str = datetime.now().strftime('%Y-%m-%d')
start_time_str = f"{today_str} 00:00:00"
end_time_str = f"{today_str} 23:59:59"

db_paths = ['face_attendance.db', '../face_attendance.db']

for db_path in db_paths:
    if os.path.exists(db_path):
        try:
            conn = sqlite3.connect(db_path)
            cur = conn.cursor()
            cur.execute(
                "UPDATE sessions SET study_date=?, start_time=?, end_time=?",
                (today_str, start_time_str, end_time_str)
            )
            conn.commit()
            print(f'Updated {cur.rowcount} sessions to {today_str} in {db_path}')
            conn.close()
        except Exception as e:
            print(f"Error updating {db_path}: {e}")
    else:
        print(f"Database file not found: {db_path}")
