import unicodedata

def normalize_vietnamese_text(text: str) -> str:
    if not text:
        return ""

    text = text.strip().lower()
    text = unicodedata.normalize("NFD", text)
    text = "".join(ch for ch in text if unicodedata.category(ch) != "Mn")
    text = text.replace("đ", "d")
    return " ".join(text.split())

def student_sort_key(student):
    """
    Sort key that handles dictionaries and objects.
    Extracts full_name and student_code, normalizes the name,
    and returns a tuple for proper Vietnamese sorting:
    (last_name, middle_and_family_name, student_code)
    """
    if isinstance(student, dict):
        full_name = student.get("full_name", "") or ""
        student_code = student.get("student_code", "") or ""
    else:
        full_name = getattr(student, "full_name", "") or ""
        student_code = getattr(student, "student_code", "") or ""
        
    normalized = normalize_vietnamese_text(full_name)
    parts = normalized.split()

    last_name = parts[-1] if parts else ""
    middle_and_family = " ".join(parts[:-1]) if len(parts) > 1 else ""

    return (last_name, middle_and_family, str(student_code))
