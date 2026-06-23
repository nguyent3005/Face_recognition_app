# =============================================================================
# SCface Dataset - CORRECT Preprocessing Pipeline (NO ENHANCE)
# - KHÔNG dùng GFPGAN/Real-ESRGAN
# - Crop trực tiếp ảnh gốc bằng RetinaFace
# - Xử lý detect fail bằng upscale tạm thời
# =============================================================================

import os, sys, json, zipfile, random, time, warnings
from pathlib import Path
from collections import defaultdict

import cv2
import numpy as np
import matplotlib.pyplot as plt
from tqdm import tqdm
from skimage import transform as trans
import torch

warnings.filterwarnings("ignore")

# =============================================================================
# CONFIG — CHỈ CẦN CHỈNH PHẦN NÀY
# =============================================================================

SCFACE_ROOT  = "/kaggle/input/datasets/quan130806/scfaca/SCface_database"
OUTPUT_ROOT  = "/kaggle/working/SCface_112_no_enhance"
IMG_SIZE     = 112
ZIP_OUTPUT   = True

# =============================================================================

def check_environment():
    print("=" * 60)
    print("  SCface Preprocessing Pipeline (NO ENHANCE)")
    print("  - Crop trực tiếp bằng RetinaFace")
    print("  - KHÔNG dùng GFPGAN/Real-ESRGAN")
    print("=" * 60)

    v = sys.version_info
    print(f"  Python     : {v.major}.{v.minor}.{v.micro}")

    cuda_ok  = torch.cuda.is_available()
    gpu_name = torch.cuda.get_device_name(0) if cuda_ok else "không có"
    print(f"  GPU / CUDA : {'✅' if cuda_ok else '❌'}  {gpu_name}")
    print(f"  Device     : {'cuda' if cuda_ok else 'cpu'}")

    scface = Path(SCFACE_ROOT)
    if not scface.exists():
        print(f"\n❌ SCFACE_ROOT không tồn tại: {SCFACE_ROOT}")
        sys.exit(1)

    print(f"\n  Dataset    : {SCFACE_ROOT}")
    print(f"  Output     : {OUTPUT_ROOT}")
    print()

    print("📂 Cấu trúc SCface tìm thấy:")
    total_found = 0
    for p in sorted(scface.iterdir()):
        if p.is_dir():
            imgs = (list(p.glob("**/*.jpg")) +
                    list(p.glob("**/*.png")) +
                    list(p.glob("**/*.bmp")))
            print(f"   {p.name:<40} {len(imgs):>5} ảnh")
            total_found += len(imgs)
    print(f"   {'TOTAL':<40} {total_found:>5} ảnh\n")

    Path(OUTPUT_ROOT).mkdir(parents=True, exist_ok=True)
    return cuda_ok


# ─────────────────────────────────────────────────────────────────────────────
# KHỞI TẠO DETECTOR (RetinaFace qua InsightFace)
# ─────────────────────────────────────────────────────────────────────────────

def init_detector():
    """Khởi tạo InsightFace với buffalo_l (RetinaFace bên trong)."""
    from insightface.app import FaceAnalysis
    print("⏳ Đang load InsightFace (RetinaFace)...")
    app = FaceAnalysis(
        name="buffalo_l",
        providers=["CUDAExecutionProvider", "CPUExecutionProvider"]
    )
    # det_size cân bằng giữa speed và accuracy
    app.prepare(ctx_id=0, det_size=(640, 640))
    print("✅ RetinaFace sẵn sàng\n")
    return app


# ─────────────────────────────────────────────────────────────────────────────
# ALIGN AN TOÀN (SimilarityTransform)
# ─────────────────────────────────────────────────────────────────────────────

ARCFACE_DST = np.array([
    [38.2946, 51.6963],   # mắt trái
    [73.5318, 51.5014],   # mắt phải
    [56.0252, 71.7366],   # mũi
    [41.5493, 92.3655],   # miệng trái
    [70.7299, 92.2041],   # miệng phải
], dtype=np.float32)


def safe_align_face(img: np.ndarray, landmarks: np.ndarray, image_size: int = 112):
    """
    Align khuôn mặt với kiểm tra an toàn.
    """
    if landmarks is None:
        return None, "no_landmarks"
    
    # 1. NaN / Inf
    if np.any(np.isnan(landmarks)) or np.any(np.isinf(landmarks)):
        return None, "landmarks NaN/Inf"
    
    # 2. Kiểm tra landmark trong ảnh
    h, w = img.shape[:2]
    in_frame = (
        (landmarks[:, 0] >= -w*0.3) & (landmarks[:, 0] < w*1.3) &
        (landmarks[:, 1] >= -h*0.3) & (landmarks[:, 1] < h*1.3)
    )
    if in_frame.sum() < 3:
        return None, "landmarks ngoài ảnh"
    
    # 3. Swap mắt nếu bị ngược
    lmk = landmarks.copy()
    if lmk[0][0] > lmk[1][0]:
        lmk[0], lmk[1] = lmk[1].copy(), lmk[0].copy()
        lmk[3], lmk[4] = lmk[4].copy(), lmk[3].copy()
    
    # 4. Tính transform
    try:
        dst = ARCFACE_DST.copy()
        if image_size != 112:
            dst = dst * (image_size / 112.0)
        
        tform = trans.SimilarityTransform()
        tform.estimate(lmk, dst)
        M = tform.params[0:2, :]
    except Exception as e:
        return None, f"transform_error: {e}"
    
    # 5. Kiểm tra determinant (không bị lật)
    det = M[0, 0] * M[1, 1] - M[0, 1] * M[1, 0]
    if det < 0:
        return None, "determinant_negative"
    
    # 6. Warp
    aligned = cv2.warpAffine(
        img, M, (image_size, image_size),
        flags=cv2.INTER_LINEAR,
        borderMode=cv2.BORDER_CONSTANT,
        borderValue=(0, 0, 0)
    )
    
    # 7. Kiểm tra ảnh không bị đen
    if np.mean(aligned) < 5:
        return None, "image_too_dark"
    
    return aligned, "ok"


# ─────────────────────────────────────────────────────────────────────────────
# XỬ LÝ MỘT ẢNH - KHÔNG ENHANCE, CROP TRỰC TIẾP
# ─────────────────────────────────────────────────────────────────────────────

def detect_with_fallback(img, detector, max_upscale=3):
    """
    Detect mặt với fallback upscale nếu ảnh quá nhỏ.
    Trả về face object hoặc None.
    """
    # Lần 1: detect trên ảnh gốc
    faces = detector.get(img)
    
    if len(faces) > 0:
        return max(faces, key=lambda f: f.det_score)
    
    # Lần 2: thử upscale ảnh để detect (chỉ để lấy landmark, không giữ ảnh upscale)
    h, w = img.shape[:2]
    if max(h, w) < 200:
        for scale in [2, 3]:
            img_up = cv2.resize(img, (w * scale, h * scale), interpolation=cv2.INTER_CUBIC)
            faces_up = detector.get(img_up)
            if len(faces_up) > 0:
                best = max(faces_up, key=lambda f: f.det_score)
                # Scale landmark về ảnh gốc
                best.kps = best.kps / scale
                return best
    
    return None


def process_one_image(img_path, detector, image_size: int = 112):
    """
    Pipeline xử lý một ảnh:
      1. Đọc ảnh gốc (KHÔNG enhance)
      2. Detect mặt bằng RetinaFace (có fallback upscale)
      3. Align khuôn mặt
    """
    # Đọc ảnh gốc - KHÔNG ENHANCE
    img = cv2.imread(str(img_path))
    if img is None:
        return None, "cannot_read"
    
    # Detect mặt với fallback
    best_face = detect_with_fallback(img, detector)
    
    if best_face is None:
        return None, "no_face_detected"
    
    if best_face.det_score < 0.3:
        return None, f"low_confidence_{best_face.det_score:.2f}"
    
    if best_face.kps is None:
        return None, "no_landmarks"
    
    # Align
    aligned, status = safe_align_face(img, best_face.kps, image_size)
    
    return aligned, status


# ─────────────────────────────────────────────────────────────────────────────
# PARSE TÊN FILE SCFACE
# ─────────────────────────────────────────────────────────────────────────────

def parse_scface_filename(img_path):
    """Parse tên file SCface để phân loại."""
    stem = Path(img_path).stem
    parts = stem.split('_')
    subject_id = parts[0].zfill(3)
    
    # Mugshot (chỉ có subject ID)
    if len(parts) == 1:
        return 'mugshot', subject_id, None, None
    
    # Camera IR (cam8)
    if len(parts) >= 2 and parts[1] == 'cam8':
        return 'ir', subject_id, 'cam8', None
    
    # Pose image (có góc)
    pose_angles = ['-90', '-67.5', '-45', '-22.5', '0', '22.5', '45', '67.5', '90']
    if len(parts) >= 2 and parts[1] in pose_angles:
        return 'pose', subject_id, None, parts[1]
    
    # Surveillance camera (subject_cam_distance)
    if len(parts) >= 3:
        cam = parts[1]
        dist = parts[2]
        return 'surveillance', subject_id, cam, dist
    
    return 'unknown', subject_id, None, None


# ─────────────────────────────────────────────────────────────────────────────
# PIPELINE CHÍNH
# ─────────────────────────────────────────────────────────────────────────────

def process_scface(scface_root, output_root, detector, img_size=112):
    """
    Xử lý toàn bộ SCface dataset.
    KHÔNG dùng GFPGAN/Real-ESRGAN.
    """
    scface_root = Path(scface_root)
    output_root = Path(output_root)
    
    stats = {"total": 0, "success": 0, 
             "fail_read": 0, "fail_detect": 0, "fail_align": 0}
    fail_log = []
    
    # Tìm tất cả ảnh
    image_paths = []
    for ext in ['*.jpg', '*.jpeg', '*.png', '*.bmp']:
        image_paths.extend(scface_root.rglob(ext))
    
    print(f"\n📸 Tổng số ảnh: {len(image_paths)}")
    
    # Thống kê theo loại ảnh
    category_stats = defaultdict(lambda: {"total": 0, "success": 0})
    
    for img_path in tqdm(image_paths, desc="Processing"):
        stats["total"] += 1
        
        # Parse tên file
        category, subject_id, cam, dist = parse_scface_filename(img_path)
        category_stats[category]["total"] += 1
        
        # Xử lý ảnh (KHÔNG enhance)
        aligned, status = process_one_image(img_path, detector, img_size)
        
        if aligned is not None and status == "ok":
            stats["success"] += 1
            category_stats[category]["success"] += 1
            
            # Xác định thư mục output
            if category == 'mugshot':
                save_dir = output_root / 'mugshot' / subject_id
            elif category == 'ir':
                save_dir = output_root / 'ir_cam8' / subject_id
            elif category == 'pose':
                save_dir = output_root / 'pose' / f'angle_{dist}' / subject_id
            elif category == 'surveillance':
                save_dir = output_root / f'cam{cam}_dist{dist}' / subject_id
            else:
                save_dir = output_root / 'unknown' / subject_id
            
            save_dir.mkdir(parents=True, exist_ok=True)
            cv2.imwrite(str(save_dir / img_path.name), aligned)
            
        else:
            if "read" in status:
                stats["fail_read"] += 1
            elif "detect" in status or "face" in status or "confidence" in status:
                stats["fail_detect"] += 1
            else:
                stats["fail_align"] += 1
            fail_log.append(f"[{category}] {img_path.name}: {status}")
    
    # In báo cáo
    print("\n" + "="*60)
    print("📊 KẾT QUẢ TIỀN XỬ LÝ (KHÔNG ENHANCE)")
    print("="*60)
    print(f"  Tổng ảnh        : {stats['total']}")
    print(f"  ✅ Thành công   : {stats['success']} ({100*stats['success']/max(stats['total'],1):.1f}%)")
    print(f"  ❌ Lỗi đọc      : {stats['fail_read']}")
    print(f"  ❌ Không detect : {stats['fail_detect']}")
    print(f"  ❌ Align lỗi    : {stats['fail_align']}")
    print("="*60)
    
    # Thống kê theo category
    print("\n📂 Thống kê theo loại ảnh:")
    for cat, stat in sorted(category_stats.items()):
        rate = 100 * stat['success'] / max(stat['total'], 1)
        print(f"   {cat:<15}: {stat['success']:>4}/{stat['total']:<4} ({rate:.1f}%)")
    
    # Lưu fail log
    if fail_log:
        log_path = output_root / "fail_log.txt"
        with open(log_path, "w", encoding="utf-8") as f:
            f.write("\n".join(fail_log))
        print(f"\n📝 Fail log ({len(fail_log)} ảnh) → {log_path}")
    
    return stats


# ─────────────────────────────────────────────────────────────────────────────
# PREVIEW & THỐNG KÊ
# ─────────────────────────────────────────────────────────────────────────────

def show_samples(output_root, n_cols=6, n_rows=3):
    """Hiển thị mẫu ảnh kết quả."""
    output_root = Path(output_root)
    all_imgs = list(output_root.rglob("*.jpg")) + list(output_root.rglob("*.png"))
    if not all_imgs:
        print("Không có ảnh để preview.")
        return
    
    import random
    samples = random.sample(all_imgs, min(n_cols * n_rows, len(all_imgs)))
    fig, axes = plt.subplots(n_rows, n_cols, figsize=(n_cols * 2, n_rows * 2.4))
    
    for ax, p in zip(axes.flat, samples):
        img = cv2.imread(str(p))
        ax.imshow(cv2.cvtColor(img, cv2.COLOR_BGR2RGB))
        parts = p.parts
        ax.set_title(f"{parts[-2]}", fontsize=8)
        ax.axis("off")
    
    for ax in axes.flat[len(samples):]:
        ax.axis("off")
    
    plt.tight_layout()
    save_path = output_root / "sample_preview.png"
    plt.savefig(str(save_path), dpi=120, bbox_inches="tight")
    plt.show()
    print(f"✅ Preview lưu tại: {save_path}")


def dataset_stats(output_root):
    """In thống kê dataset."""
    output_root = Path(output_root)
    fstats = defaultdict(lambda: {"subjects": set(), "images": 0})
    
    for p in output_root.rglob("*.jpg"):
        parts = p.parts
        if len(parts) < 3:
            continue
        fstats[parts[-3]]["subjects"].add(parts[-2])
        fstats[parts[-3]]["images"] += 1
    
    print(f"\n{'─'*58}")
    print(f"  📊 THỐNG KÊ SAU TIỀN XỬ LÝ")
    print(f"{'─'*58}")
    print(f"  {'Folder':<22} {'Subjects':>9} {'Images':>9}")
    
    total = 0
    for folder in sorted(fstats):
        ns = len(fstats[folder]["subjects"])
        ni = fstats[folder]["images"]
        print(f"  {folder:<22} {ns:>9} {ni:>9}")
        total += ni
    
    print(f"  {'─'*22} {'─'*9} {'─'*9}")
    print(f"  {'TOTAL':<22} {'':>9} {total:>9}")
    print(f"{'─'*58}\n")


def create_label_map(output_root):
    """Tạo label_map.json."""
    output_root = Path(output_root)
    subjects = sorted({p.parts[-2] for p in output_root.rglob("*.jpg")})
    label_map = {s: i for i, s in enumerate(subjects)}
    
    save_path = output_root / "label_map.json"
    with open(save_path, "w", encoding="utf-8") as f:
        json.dump(label_map, f, indent=2)
    
    print(f"✅ Label map: {len(label_map)} subjects → {save_path}")
    return label_map


def zip_output(output_root):
    """Nén kết quả."""
    output_root = Path(output_root)
    zip_path = output_root.parent / f"{output_root.name}.zip"
    
    files = [f for f in output_root.rglob("*") if f.is_file()]
    print(f"\n📦 Đang nén {len(files):,} files...")
    
    t0 = time.time()
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for f in tqdm(files, desc="Zipping"):
            zf.write(f, f.relative_to(output_root.parent))
    
    size_mb = zip_path.stat().st_size / (1024 ** 2)
    print(f"✅ Zip hoàn tất! Kích thước: {size_mb:.1f} MB")
    return zip_path


# =============================================================================
# MAIN
# =============================================================================

if __name__ == "__main__":
    t_start = time.time()
    
    # 1. Kiểm tra môi trường
    check_environment()
    
    # 2. Load detector (RetinaFace)
    detector = init_detector()
    
    # 3. Xử lý dataset (KHÔNG ENHANCE)
    stats = process_scface(
        scface_root=SCFACE_ROOT,
        output_root=OUTPUT_ROOT,
        detector=detector,
        img_size=IMG_SIZE
    )
    
    # 4. Thống kê
    dataset_stats(OUTPUT_ROOT)
    
    # 5. Preview
    show_samples(OUTPUT_ROOT)
    
    # 6. Label map
    create_label_map(OUTPUT_ROOT)
    
    # 7. Zip
    if ZIP_OUTPUT:
        zip_path = zip_output(OUTPUT_ROOT)
        from IPython.display import FileLink, display
        display(FileLink(zip_path))
    
    total_min = (time.time() - t_start) / 60
    print(f"\n{'='*60}")
    print(f"🎉 HOÀN TẤT! Thời gian: {total_min:.1f} phút")
    print(f"📁 Output: {OUTPUT_ROOT}")
    print(f"{'='*60}")