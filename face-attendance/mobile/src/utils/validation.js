const patterns = {
  studentCode: /^\d{7}$/,
  email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  phone: /^(0|\+84)[0-9]{9,10}$/,
};

export function validateLogin(username, password) {
  const errors = {};
  const u = (username || '').trim();

  if (!u) errors.username = 'Vui lòng nhập tên đăng nhập';
  else if (u.length < 3) errors.username = 'Tên đăng nhập phải có ít nhất 3 ký tự';
  else if (/\s/.test(u)) errors.username = 'Tên đăng nhập không được chứa khoảng trắng';

  if (!password) errors.password = 'Vui lòng nhập mật khẩu';
  else if (password.length < 6) errors.password = 'Mật khẩu phải có ít nhất 6 ký tự';

  return { valid: Object.keys(errors).length === 0, errors };
}

export function validateStudent(form, isEditing) {
  const errors = {};
  const code = (form.student_code || '').trim();
  const name = (form.full_name || '').trim();
  const email = (form.email || '').trim();

  if (!isEditing) {
    if (!code) errors.student_code = 'Vui lòng nhập MSSV';
    else if (!patterns.studentCode.test(code)) {
      errors.student_code = 'MSSV phải là chính xác 7 chữ số';
    }
  }

  if (!name) errors.full_name = 'Vui lòng nhập họ và tên';
  else if (name.length < 2) errors.full_name = 'Họ tên phải có ít nhất 2 ký tự';

  if (email && !patterns.email.test(email)) errors.email = 'Email không hợp lệ';

  return { valid: Object.keys(errors).length === 0, errors };
}

export function validateDateRange(startDate, endDate) {
  if (!startDate || !endDate) {
    return 'Vui lòng chọn đầy đủ từ ngày và đến ngày';
  }
  const d1 = new Date(startDate);
  const d2 = new Date(endDate);
  d1.setHours(0, 0, 0, 0);
  d2.setHours(0, 0, 0, 0);

  const today = new Date();
  today.setHours(23, 59, 59, 999);

  if (d2 < d1) return 'Ngày kết thúc không được nhỏ hơn ngày bắt đầu';
  return null;
}

export function toImagePayload(base64) {
  if (!base64) return null;
  if (base64.startsWith('data:')) return base64;
  return `data:image/jpeg;base64,${base64}`;
}

export function parseApiError(error) {
  if (!error) return 'Có lỗi xảy ra';
  if (typeof error === 'string') return error;
  if (error instanceof Error && error.message) return error.message;
  if (error.detail) {
    if (typeof error.detail === 'string') return error.detail;
    if (Array.isArray(error.detail)) {
      return error.detail.map((d) => d.msg || d).join('. ');
    }
  }
  return error.message || 'Có lỗi xảy ra';
}
