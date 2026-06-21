import os
import sqlite3
from app.database import engine, Base
# Import all models so Base knows about them
from app.models import User, Student, Attendance, CourseClass, Session

DB_PATH = "./face_attendance.db"

def run_migration():
    print("Starting database migration...")
    
    # 1. Create new tables (classes, sessions) if they don't exist
    Base.metadata.create_all(bind=engine)
    print("Ensured all tables exist (classes, sessions created if missing).")

    # 2. Add new columns to existing tables manually using SQLite connection
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    # Add class_id to students table
    try:
        cursor.execute("ALTER TABLE students ADD COLUMN class_id INTEGER REFERENCES classes(id)")
        print("Added column 'class_id' to 'students' table.")
    except sqlite3.OperationalError as e:
        if "duplicate column name" in str(e):
            print("Column 'class_id' already exists in 'students'. Skipping.")
        else:
            print(f"Error adding class_id to students: {e}")

    # Add session_id to attendances table
    try:
        cursor.execute("ALTER TABLE attendances ADD COLUMN session_id INTEGER REFERENCES sessions(id)")
        print("Added column 'session_id' to 'attendances' table.")
    except sqlite3.OperationalError as e:
        if "duplicate column name" in str(e):
            print("Column 'session_id' already exists in 'attendances'. Skipping.")
        else:
            print(f"Error adding session_id to attendances: {e}")

    # (Optional) Migrate existing student class_names to a default Class if needed
    cursor.execute("SELECT id, class_name FROM students WHERE class_name IS NOT NULL AND class_id IS NULL")
    students_with_class = cursor.fetchall()
    
    for std_id, class_name in students_with_class:
        # Check if class exists
        cursor.execute("SELECT id FROM classes WHERE class_name = ?", (class_name,))
        row = cursor.fetchone()
        if row:
            class_id = row[0]
        else:
            # Create the class
            cursor.execute("INSERT INTO classes (class_code, class_name) VALUES (?, ?)", (class_name.upper()[:20].replace(" ", "_"), class_name))
            class_id = cursor.lastrowid
            print(f"Created new class '{class_name}' with ID {class_id}")
            
        # Update student
        cursor.execute("UPDATE students SET class_id = ? WHERE id = ?", (class_id, std_id))
        print(f"Migrated student ID {std_id} to class '{class_name}'")

    conn.commit()
    conn.close()
    print("Migration completed successfully!")

if __name__ == "__main__":
    run_migration()
