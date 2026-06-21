import sqlite3
import os

DB_PATH = os.path.join(os.path.dirname(__file__), 'face_attendance.db')

def upgrade_db():
    print(f"Upgrading database at {DB_PATH}")
    if not os.path.exists(DB_PATH):
        print("Database not found. Let FastAPI create it automatically on startup.")
        return

    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    # 1. Update `sessions` table
    # Add new columns if they don't exist
    cursor.execute("PRAGMA table_info(sessions)")
    columns = [col[1] for col in cursor.fetchall()]
    
    if "subject_id" not in columns:
        print("Adding columns to sessions...")
        cursor.execute("ALTER TABLE sessions ADD COLUMN subject_id INTEGER")
        cursor.execute("ALTER TABLE sessions ADD COLUMN section_code VARCHAR(50)")
        cursor.execute("ALTER TABLE sessions ADD COLUMN study_date DATE")
        cursor.execute("ALTER TABLE sessions ADD COLUMN day_of_week VARCHAR(20)")
        cursor.execute("ALTER TABLE sessions ADD COLUMN lesson_start INTEGER")
        cursor.execute("ALTER TABLE sessions ADD COLUMN lesson_end INTEGER")
        cursor.execute("ALTER TABLE sessions ADD COLUMN late_after_minutes INTEGER DEFAULT 15")
        cursor.execute("ALTER TABLE sessions ADD COLUMN created_at DATETIME")
        cursor.execute("ALTER TABLE sessions ADD COLUMN updated_at DATETIME")
        # Migrate data from `date` to `study_date` if possible
        if "date" in columns:
            cursor.execute("UPDATE sessions SET study_date = date")

    # 2. Update `attendances` table
    cursor.execute("PRAGMA table_info(attendances)")
    att_columns = [col[1] for col in cursor.fetchall()]
    
    if "checkin_time" not in att_columns:
        print("Adding columns to attendances...")
        cursor.execute("ALTER TABLE attendances ADD COLUMN checkin_time DATETIME")
        cursor.execute("ALTER TABLE attendances ADD COLUMN created_at DATETIME")
        cursor.execute("ALTER TABLE attendances ADD COLUMN updated_at DATETIME")
        if "timestamp" in att_columns:
            cursor.execute("UPDATE attendances SET checkin_time = timestamp")

    # We need a UNIQUE constraint on attendances. In SQLite, the safest way is to recreate the table.
    # Check if index exists first to avoid double recreation.
    cursor.execute("PRAGMA index_list(attendances)")
    indexes = [idx[1] for idx in cursor.fetchall()]
    
    if "_student_session_uc" not in indexes:
        print("Recreating attendances table to add UNIQUE constraint...")
        cursor.execute("CREATE TABLE attendances_new (id INTEGER NOT NULL, student_id INTEGER NOT NULL, session_id INTEGER, checkin_time DATETIME, status VARCHAR(20), confidence FLOAT, note VARCHAR(255), created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME, PRIMARY KEY (id), CONSTRAINT _student_session_uc UNIQUE (student_id, session_id), FOREIGN KEY(student_id) REFERENCES students (id), FOREIGN KEY(session_id) REFERENCES sessions (id))")
        
        # Copy data (ignoring timestamp/date as they are deprecated, we use checkin_time)
        try:
            cursor.execute("""
            INSERT OR IGNORE INTO attendances_new (id, student_id, session_id, checkin_time, status, confidence, note, created_at, updated_at)
            SELECT id, student_id, session_id, checkin_time, status, confidence, note, created_at, updated_at FROM attendances
            """)
        except sqlite3.OperationalError as e:
            print(f"Could not copy attendance data: {e}")
            
        cursor.execute("DROP TABLE attendances")
        cursor.execute("ALTER TABLE attendances_new RENAME TO attendances")
        
    print("Database upgrade completed successfully.")
    conn.commit()
    conn.close()

if __name__ == "__main__":
    upgrade_db()
