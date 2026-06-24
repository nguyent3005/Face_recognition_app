# Face Recognition App — Hệ thống điểm danh bằng khuôn mặt

Ứng dụng điểm danh sinh viên sử dụng **nhận diện khuôn mặt** (Face Recognition), gồm backend **FastAPI + PyTorch** và mobile app **React Native (Expo)**.

## Tính năng chính

- **Điểm danh bằng khuôn mặt**: chụp ảnh, quét video real-time hoặc upload ảnh từ thư viện
- **Đăng ký khuôn mặt sinh viên**: đăng ký từ ảnh hoặc video
- **Quản lý lớp học & buổi học**: xem lịch, chi tiết buổi học, danh sách sinh viên
- **Lịch sử điểm danh**: theo dõi trạng thái có mặt / muộn / vắng
- **Báo cáo & xuất dữ liệu**: thống kê, xuất CSV/Excel
- **Xác thực JWT**: đăng nhập giáo viên, đổi mật khẩu

## Công nghệ sử dụng

| Thành phần | Công nghệ |
|------------|-----------|
| Backend API | FastAPI, SQLAlchemy, SQLite |
| Nhận diện khuôn mặt | PyTorch (iResNet50), OpenCV, ONNX Runtime |
| Mobile | React Native, Expo 54, React Navigation |
| Auth | JWT (python-jose), bcrypt |

## Cấu trúc dự án

```
Face_recognition_app/
├── face-attendance/
│   ├── backend/              # API server FastAPI
│   │   ├── app/
│   │   │   ├── routers/      # auth, students, attendance, recognition, ...
│   │   │   ├── services/     # face_service, report_service, ...
│   │   │   ├── ml/           # model loader, face processor, iResNet
│   │   │   └── models/       # SQLAlchemy models
│   │   ├── scripts/          # import dữ liệu, rebuild embeddings, ...
│   │   └── requirements.txt
│   └── mobile/               # Ứng dụng Expo React Native
│       ├── src/screens/      # Home, Attendance, History, Settings, ...
│       └── src/utils/        # API client, auth
├── iresnet.py                # Kiến trúc iResNet (InsightFace-compatible)
├── tienxuli.py               # Pipeline tiền xử lý dataset SCface
└── train_pro_v6_glint360k_iresnet.py   # Script huấn luyện iResNet50 + Glint360K
```

## Yêu cầu hệ thống

- **Python** 3.10+
- **Node.js** 18+ và npm
- **Expo Go** (trên điện thoại) hoặc Android Emulator / iOS Simulator
- (Khuyến nghị) GPU CUDA khi huấn luyện model; backend có thể chạy CPU

## Cài đặt & chạy Backend

```powershell
cd face-attendance/backend

# Tạo và kích hoạt virtual environment
python -m venv venv
.\venv\Scripts\Activate.ps1

# Cài dependencies
pip install -r requirements.txt

# Chạy server
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Sau khi khởi động:

- API docs (Swagger): [http://localhost:8000/docs](http://localhost:8000/docs)
- Health check: [http://localhost:8000/api/health](http://localhost:8000/api/health)

### Model nhận diện khuôn mặt

Backend dùng **iResNet50** với embedding 512 chiều. Đặt file weights tại:

```
face-attendance/backend/app/ml/models/best_model.pth
```

Cấu hình model trong `face-attendance/backend/app/config.py`:

| Biến | Mặc định | Mô tả |
|------|----------|-------|
| `MODEL_TYPE` | `pytorch` | `pytorch`, `onnx`, hoặc `demo` |
| `FACE_MATCH_THRESHOLD` | `0.55` | Ngưỡng cosine similarity |
| `DATABASE_URL` | SQLite local | Đường dẫn database |

Tạo file `.env` trong `face-attendance/backend/` để ghi đè cấu hình (tuỳ chọn).

### Tài khoản mặc định

Lần chạy đầu tiên, hệ thống tự tạo tài khoản admin nếu chưa có user:

| Username | Password |
|----------|----------|
| `admin` | `admin123` |

> Đổi mật khẩu ngay sau khi triển khai thực tế.

## Cài đặt & chạy Mobile App

```powershell
cd face-attendance/mobile

npm install
npx expo start
```

Quét QR bằng **Expo Go** (Android/iOS) hoặc nhấn `a` (Android emulator) / `i` (iOS simulator).

### Kết nối tới Backend

Trong app, mở tab **Cài đặt** và nhập địa chỉ API backend, ví dụ:

| Môi trường | URL gợi ý |
|------------|-----------|
| Android Emulator | `http://10.0.2.2:8000` |
| iOS Simulator | `http://localhost:8000` |
| Điện thoại thật (cùng Wi-Fi) | `http://<IP-máy-tính>:8000` |
| Tunnel (ngrok, ...) | `https://<subdomain>.ngrok-free.dev` |

App tự thêm suffix `/api` nếu bạn chỉ nhập host và port.

## Luồng sử dụng cơ bản

1. **Đăng nhập** bằng tài khoản giáo viên
2. **Đăng ký sinh viên** và đăng ký khuôn mặt (ảnh/video)
3. Tạo **lớp học** và **buổi học** (qua API hoặc script seed)
4. Mở buổi học → **Điểm danh** bằng camera
5. Xem **Lịch sử** và **Báo cáo** trên app hoặc qua API

## API chính

| Nhóm | Prefix | Mô tả |
|------|--------|-------|
| Auth | `/api/auth` | Đăng ký, đăng nhập, đổi mật khẩu |
| Students | `/api/students` | CRUD sinh viên, đăng ký khuôn mặt |
| Classes | `/api/classes` | Quản lý lớp học |
| Sessions | `/api/sessions` | Buổi học / ca học |
| Attendance | `/api/attendance` | Điểm danh ảnh, video, quét frame |
| Recognition | `/api/recognition` | Nhận diện, enroll, detect |
| Reports | `/api/reports` | Thống kê, export CSV/Excel |

Chi tiết đầy đủ: [http://localhost:8000/docs](http://localhost:8000/docs)

## Huấn luyện & tiền xử lý dữ liệu (thư mục gốc)

Các script ở root phục vụ nghiên cứu/huấn luyện model:

| File | Mục đích |
|------|----------|
| `iresnet.py` | Định nghĩa kiến trúc iResNet18/34/50/100/200 |
| `tienxuli.py` | Tiền xử lý dataset SCface (RetinaFace crop, 112×112) |
| `train_pro_v6_glint360k_iresnet.py` | Fine-tune iResNet50 với pretrained Glint360K + ArcFace |

Chạy huấn luyện (cần GPU và dataset đã chuẩn bị):

```bash
python train_pro_v6_glint360k_iresnet.py
```

Sau huấn luyện, copy file `.pth` tốt nhất vào `face-attendance/backend/app/ml/models/best_model.pth`.

## Scripts hỗ trợ (backend)

```powershell
cd face-attendance/backend

# Import sinh viên từ Excel
python scripts/import_students_from_excel.py

# Rebuild embedding vectors sau khi đổi model
python scripts/rebuild_embeddings.py
```

## Ghi chú triển khai

- Database mặc định: SQLite (`face_attendance.db`) — phù hợp dev; production nên dùng PostgreSQL/MySQL
- Ảnh upload lưu tại `face-attendance/backend/uploads/photos/`
- Đổi `SECRET_KEY` trong `.env` trước khi deploy production
- CORS hiện đang mở `*` — nên giới hạn domain khi đưa lên server thật

## Tác giả

**nguyent3005**

- GitHub: [https://github.com/nguyent3005/Face_recognition_app](https://github.com/nguyent3005/Face_recognition_app)

## License

Dự án học thuật / nộp bài. Xem thêm `face-attendance/mobile/LICENSE` nếu có.
