# =============================================================================
# train_pro_v6_glint360k_iresnet.py — iResNet50 + Glint360K Pretrained
# =============================================================================
# MÔ TẢ: 
#   - Sử dụng kiến trúc iResNet-50 tương thích chuẩn InsightFace
#   - Load pretrained weights từ backbone_glint360k.pth
#   - ArcFace Loss + SGD Optimizer + Tự động Freezing ở các epoch đầu
#   - Đánh giá zero-shot đa chiều trên tập test (SCface)
# =============================================================================

import os
import json
import math
import random
import copy
import importlib.util
from pathlib import Path
from collections import defaultdict

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F
import torch.optim as optim
from torch.utils.data import Dataset, DataLoader
from torchvision import transforms
from PIL import Image, ImageFilter
from tqdm import tqdm
import matplotlib.pyplot as plt


from sklearn.metrics import (
    accuracy_score,
    precision_score,
    recall_score,
    f1_score,
    roc_auc_score,
    roc_curve,
    confusion_matrix,
)


# =============================================================================
# CONFIG
# =============================================================================

class Config:
    # Đường dẫn dữ liệu
    DATA_ROOT = "/kaggle/input/datasets/nguyent3005/real-test-data/Data_set/SCface_112_no_enhance"
    SPLIT_DIR = "/kaggle/input/datasets/nguyent3005/real-test-data/Data_set/split_files"
    OUTPUT_DIR = "/kaggle/working/output_iresnet50_glint360k"
    
    # 🔥 PRETRAINED WEIGHTS (Glint360K)
    # Sửa path này theo nơi bạn đặt file backbone_glint360k.pth trên Kaggle.
    # Ví dụ: /kaggle/input/<ten-dataset>/backbone_glint360k.pth
    PRETRAINED_WEIGHT_PATH = "/kaggle/input/datasets/nguyent3005/glint360k-backbone/backbone_glint360k.pth"
    # File iresnet.py chứa định nghĩa kiến trúc iResNet. Nếu để cùng thư mục với script này thì không cần sửa.
    IRESNET_FILE = "/kaggle/input/datasets/nguyent3005/glint360k-backbone/iresnet.py"
    STRICT_PRETRAINED_LOAD = True  # True để báo lỗi ngay nếu weight không khớp kiến trúc.
    
    EMBEDDING_DIM = 512
    DROPOUT_RATE = 0.4
    
    # ArcFace params
    ARC_MARGIN = 0.5
    ARC_SCALE = 64.0
    
    # Training params
    EPOCHS = 60
    BATCH_SIZE = 16  
    GRADIENT_ACCUMULATION_STEPS = 4  # Effective batch size = 64
    
    # Học tập phân biệt (Discriminative LR)
    LR_BACKBONE = 1e-4  # Cực nhỏ cho backbone vì glint360k đã rất tốt
    LR_HEAD = 1e-2      # Lớn hơn cho lớp ArcFace mới
    
    FREEZE_BACKBONE_EPOCHS = 3 # Đóng băng backbone trong 3 epoch đầu
    
    MOMENTUM = 0.9
    WEIGHT_DECAY = 5e-4
    
    USE_AUGMENTATION = True
    EARLY_STOPPING_ENABLED = True
    EARLY_STOP_PATIENCE = 10
    
    NUM_WORKERS = 2  
    PIN_MEMORY = True
    SEED = 42
    
    # Domains
    TRAIN_DOMAINS = ["mugshot", "dist1", "dist2", "dist3"]
    VAL_DOMAINS = ["mugshot", "dist1", "dist2", "dist3"]
    TEST_DOMAINS = ["mugshot", "dist1", "dist2", "dist3"]


# =============================================================================
# UTILITIES
# =============================================================================

def set_seed(seed):
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    torch.cuda.manual_seed_all(seed)
    torch.backends.cudnn.deterministic = True

def get_domain(folder_name: str) -> str:
    name = folder_name.lower()
    if "mugshot" in name: return "mugshot"
    if "dist1" in name or "_1" in name: return "dist1"
    if "dist2" in name or "_2" in name: return "dist2"
    if "dist3" in name or "_3" in name: return "dist3"
    return "other"

set_seed(Config.SEED)
DEVICE = torch.device("cuda" if torch.cuda.is_available() else "cpu")
Path(Config.OUTPUT_DIR).mkdir(parents=True, exist_ok=True)


# =============================================================================
# DATASET & AUGMENTATION
# =============================================================================

class SCfaceDataset(Dataset):
    def __init__(self, root_dir, label_map, split_ids, domains=None,
                 transform_mugshot=None, transform_dist=None, only_frontal_mugshot=False):
        self.transform_mugshot = transform_mugshot
        self.transform_dist = transform_dist if transform_dist is not None else transform_mugshot
        self.samples = []
        
        for folder in sorted(Path(root_dir).iterdir()):
            if not folder.is_dir(): continue
            domain = get_domain(folder.name)
            if domains is not None and domain not in domains: continue
            
            for subj_dir in sorted(folder.iterdir()):
                if not subj_dir.is_dir() or subj_dir.name not in split_ids: continue
                label = label_map.get(subj_dir.name)
                if label is None: continue
                
                for p in sorted(subj_dir.glob("*.jpg")):
                    if domain == "mugshot" and only_frontal_mugshot:
                        if "frontal" not in p.stem.lower(): continue
                    self.samples.append((p, label))
        
        print(f"✅ Loaded {len(self.samples)} samples")
    
    def __len__(self): return len(self.samples)
    
    def __getitem__(self, idx):
        path, label = self.samples[idx]
        img = Image.open(path).convert("RGB")
        if "mugshot" in str(path).lower():
            if self.transform_mugshot: img = self.transform_mugshot(img)
        else:
            if self.transform_dist: img = self.transform_dist(img)
        return img, label


class RandomLowRes:
    def __init__(self, min_scale=0.5, max_scale=0.85, p=0.3):
        self.min_scale = min_scale
        self.max_scale = max_scale
        self.p = p
    def __call__(self, img):
        if random.random() > self.p: return img
        w, h = img.size
        scale = random.uniform(self.min_scale, self.max_scale)
        new_w, new_h = max(8, int(w * scale)), max(8, int(h * scale))
        small = img.resize((new_w, new_h), Image.BILINEAR)
        return small.resize((w, h), Image.BILINEAR)

class RandomGaussianBlur:
    def __init__(self, radius_range=(0.5, 1.5), p=0.3):
        self.radius_range = radius_range
        self.p = p
    def __call__(self, img):
        if random.random() > self.p: return img
        radius = random.uniform(*self.radius_range)
        return img.filter(ImageFilter.GaussianBlur(radius=radius))

def get_transform(mode: str, use_aug=True, is_mugshot=True):
    transform_list = [transforms.Resize((112, 112))]
    if mode == "train" and use_aug:
        transform_list.extend([
            transforms.RandomHorizontalFlip(p=0.5),
            transforms.ColorJitter(brightness=0.15, contrast=0.15),
        ])
        if not is_mugshot: # Áp dụng mờ và nhiễu mạnh cho ảnh CCTV
            transform_list.extend([
                transforms.RandomApply([RandomLowRes()], p=0.3),
                transforms.RandomApply([RandomGaussianBlur()], p=0.3),
            ])
    transform_list.extend([
        transforms.ToTensor(),
        transforms.Normalize(mean=[0.5, 0.5, 0.5], std=[0.5, 0.5, 0.5])
    ])
    return transforms.Compose(transform_list)


# =============================================================================
# 🔥 LOAD KIẾN TRÚC iResNet-50 TỪ FILE iresnet.py
# =============================================================================

def build_iresnet50_from_file(dropout=0.0, num_features=512, fp16=False):
    """
    Dùng đúng kiến trúc trong file iresnet.py thay vì copy lại class IResNet trong file train.
    Cách này tránh lệch architecture giữa file train và file backbone_glint360k.pth.
    """
    iresnet_path = Path(Config.IRESNET_FILE)
    if not iresnet_path.exists():
        raise FileNotFoundError(
            f"Không tìm thấy iresnet.py tại: {iresnet_path}\n"
            "Hãy đặt iresnet.py cùng thư mục với file train, hoặc set Config.IRESNET_FILE cho đúng."
        )

    spec = importlib.util.spec_from_file_location("iresnet_external", str(iresnet_path))
    iresnet_external = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(iresnet_external)

    model = iresnet_external.iresnet50(
        pretrained=False,
        dropout=dropout,
        num_features=num_features,
        fp16=fp16,
    )
    return model


# =============================================================================
# 🔥 NẠP TRỌNG SỐ GLINT360K
# =============================================================================

def _extract_state_dict(checkpoint):
    """
    File backbone_glint360k.pth bạn gửi là OrderedDict trực tiếp.
    Hàm này vẫn hỗ trợ thêm các dạng checkpoint phổ biến khác.
    """
    if isinstance(checkpoint, dict):
        for key in ["state_dict", "model_state_dict", "backbone", "backbone_state_dict", "model"]:
            if key in checkpoint and isinstance(checkpoint[key], dict):
                return checkpoint[key]
    return checkpoint


def _clean_key_name(key: str) -> str:
    """
    Xóa prefix thường gặp khi lưu bằng DataParallel hoặc wrapper model.
    Với file backbone_glint360k.pth bạn gửi thì key đã sạch sẵn: conv1.weight, bn1.weight, layer1...
    """
    prefixes = ["module.", "backbone.", "model.", "net."]
    changed = True
    while changed:
        changed = False
        for prefix in prefixes:
            if key.startswith(prefix):
                key = key[len(prefix):]
                changed = True
    return key


def load_glint360k_weights(model_backbone, weight_path, strict=True):
    if not os.path.exists(weight_path):
        raise FileNotFoundError(f"Không tìm thấy trọng số Glint360K tại: {weight_path}")

    print(f"\n🔄 Đang nạp trọng số Glint360K từ: {weight_path}")
    checkpoint = torch.load(weight_path, map_location="cpu")
    state_dict = _extract_state_dict(checkpoint)

    if not isinstance(state_dict, dict):
        raise TypeError("File .pth không chứa state_dict hợp lệ.")

    cleaned_dict = {}
    for k, v in state_dict.items():
        if torch.is_tensor(v):
            cleaned_dict[_clean_key_name(k)] = v

    model_dict = model_backbone.state_dict()
    matched, shape_mismatch, unexpected = [], [], []

    for k, v in cleaned_dict.items():
        if k not in model_dict:
            unexpected.append(k)
            continue
        if tuple(v.shape) != tuple(model_dict[k].shape):
            shape_mismatch.append((k, tuple(v.shape), tuple(model_dict[k].shape)))
            continue
        matched.append(k)

    missing = [k for k in model_dict.keys() if k not in cleaned_dict]

    print(f"   Matched keys: {len(matched)}/{len(model_dict)}")
    print(f"   Missing keys: {len(missing)}")
    print(f"   Unexpected keys: {len(unexpected)}")
    print(f"   Shape mismatch: {len(shape_mismatch)}")

    if strict and (missing or unexpected or shape_mismatch):
        msg = [
            "Weight Glint360K không khớp hoàn toàn với kiến trúc iresnet.py.",
            f"Missing ví dụ: {missing[:5]}",
            f"Unexpected ví dụ: {unexpected[:5]}",
            f"Shape mismatch ví dụ: {shape_mismatch[:3]}",
        ]
        raise RuntimeError("\n".join(msg))

    # Nếu strict=False, chỉ load các tensor khớp shape.
    if strict:
        model_backbone.load_state_dict(cleaned_dict, strict=True)
    else:
        filtered_dict = {k: cleaned_dict[k] for k in matched}
        model_dict.update(filtered_dict)
        model_backbone.load_state_dict(model_dict, strict=False)

    print("✅ Đã nạp thành công trọng số Glint360K vào iResNet-50.")
    return model_backbone


# =============================================================================
# ARCFACE & FACE MODEL
# =============================================================================

class ArcFaceLoss(nn.Module):
    def __init__(self, num_classes, embedding_dim, margin=0.5, scale=64.0):
        super().__init__()
        self.num_classes = num_classes
        self.margin = margin
        self.scale = scale
        self.weight = nn.Parameter(torch.FloatTensor(num_classes, embedding_dim))
        nn.init.normal_(self.weight, mean=0.0, std=0.01)
        
        self.cos_m = math.cos(margin)
        self.sin_m = math.sin(margin)
        self.th = math.cos(math.pi - margin)
        self.mm = math.sin(math.pi - margin) * margin
    
    def forward(self, embeddings, labels):
        emb_norm = F.normalize(embeddings, p=2, dim=1)
        w_norm = F.normalize(self.weight, p=2, dim=1)
        
        cosine = F.linear(emb_norm, w_norm)
        cosine = cosine.clamp(-1 + 1e-7, 1 - 1e-7)
        
        sine = torch.sqrt(1.0 - cosine ** 2)
        phi = cosine * self.cos_m - sine * self.sin_m
        phi = torch.where(cosine > self.th, phi, cosine - self.mm)
        
        one_hot = torch.zeros_like(cosine)
        one_hot.scatter_(1, labels.view(-1, 1).long(), 1.0)
        
        logits = (one_hot * phi + (1.0 - one_hot) * cosine) * self.scale
        loss = F.cross_entropy(logits, labels.long())
        return loss, logits

class FaceModel(nn.Module):
    def __init__(self, num_classes, embedding_dim=512, margin=0.5, scale=64.0):
        super().__init__()
        # Sử dụng đúng kiến trúc iresnet50 chuẩn InsightFace
        self.backbone = build_iresnet50_from_file(dropout=Config.DROPOUT_RATE, num_features=embedding_dim, fp16=False)
        self.arcface = ArcFaceLoss(num_classes, embedding_dim, margin, scale)
    
    def forward(self, x, labels=None):
        emb = self.backbone(x)
        if labels is not None:
            loss, logits = self.arcface(emb, labels)
            return loss, logits
        return emb

# =============================================================================
# (CÁC HÀM TRAIN, VAL, TEST GIỮ NGUYÊN HOÀN TOÀN LOGIC CŨ)
# =============================================================================

class EarlyStopping:
    def __init__(self, patience=10, min_delta=0.001, enabled=True):
        self.patience = patience; self.min_delta = min_delta; self.enabled = enabled
        self.counter = 0; self.best_score = None; self.early_stop = False
    
    def __call__(self, val_acc):
        if not self.enabled: return False
        if self.best_score is None: self.best_score = val_acc
        elif val_acc <= self.best_score + self.min_delta:
            self.counter += 1
            if self.counter >= self.patience: self.early_stop = True
        else:
            self.best_score = val_acc; self.counter = 0
        return self.early_stop

def train_one_epoch(model, loader, optimizer, device, epoch, accumulation_steps=1):
    model.train()
    total_loss, total_correct, total_samples = 0, 0, 0
    optimizer.zero_grad()
    
    pbar = tqdm(loader, desc=f"Epoch {epoch:02d} [Train]", ncols=100)
    for batch_idx, (imgs, labels) in enumerate(pbar):
        imgs, labels = imgs.to(device, non_blocking=True), labels.to(device, non_blocking=True)
        
        loss, logits = model(imgs, labels)
        loss = loss / accumulation_steps
        loss.backward()
        
        if (batch_idx + 1) % accumulation_steps == 0:
            nn.utils.clip_grad_norm_(model.parameters(), max_norm=5.0)
            optimizer.step()
            optimizer.zero_grad()
        
        preds = logits.argmax(dim=1)
        correct = (preds == labels).sum().item()
        total_loss += loss.item() * accumulation_steps * imgs.size(0)
        total_correct += correct
        total_samples += imgs.size(0)
        
        pbar.set_postfix(loss=f"{total_loss / total_samples:.4f}", acc=f"{100.0 * total_correct / total_samples:.1f}%")
    
    if (batch_idx + 1) % accumulation_steps != 0:
        nn.utils.clip_grad_norm_(model.parameters(), max_norm=5.0)
        optimizer.step()
        optimizer.zero_grad()
    return total_loss / total_samples, 100.0 * total_correct / total_samples

@torch.no_grad()
def validate(model, loader, device, epoch):
    model.eval()
    all_embeddings, all_labels = [], []
    for imgs, labels in tqdm(loader, desc=f"Epoch {epoch:02d} [Val]", ncols=100):
        imgs = imgs.to(device, non_blocking=True)
        emb = F.normalize(model.backbone(imgs), p=2, dim=1)
        all_embeddings.append(emb.cpu()); all_labels.append(labels.cpu())
    
    embeddings = torch.cat(all_embeddings, dim=0)
    labels_all = torch.cat(all_labels, dim=0)
    
    sim_matrix = torch.mm(embeddings, embeddings.t())
    sim_matrix.fill_diagonal_(-1.0)
    nn_idx = sim_matrix.argmax(dim=1)
    acc = 100.0 * (labels_all[nn_idx] == labels_all).sum().item() / len(labels_all)
    print(f"  Val KNN-Acc: {acc:.2f}%")
    return 1.0 - acc / 100, acc

def load_split_info(split_dir):
    with open(Path(split_dir) / "split_info.json", "r") as f: split_info = json.load(f)
    train_label_map = {str(k): v for k, v in split_info["train_label_map"].items()}
    return set(split_info["train_ids"]), set(split_info["val_ids"]), set(split_info["test_ids"]), train_label_map

def plot_history(history, test_acc, save_dir):
    epochs = list(range(1, len(history["train_loss"]) + 1))
    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(15, 6))
    ax1.plot(epochs, history["train_loss"], 'b-o', label="Train Loss")
    ax1.plot(epochs, history["val_loss"], 'r-o', label="Val Loss")
    ax1.set_title("Loss"); ax1.legend(); ax1.grid(True, alpha=0.3)
    ax2.plot(epochs, history["train_acc"], 'b-o', label="Train Acc")
    ax2.plot(epochs, history["val_acc"], 'r-o', label="Val Acc (KNN)")
    ax2.axhline(y=test_acc, color='g', linestyle='--', label=f"Test Acc: {test_acc:.2f}%")
    ax2.set_title("Accuracy"); ax2.set_ylim(0, 105); ax2.legend(); ax2.grid(True, alpha=0.3)
    plt.tight_layout()
    plt.savefig(Path(save_dir) / "training_curves.png", dpi=150); plt.close()

def evaluate_verification_pairs(model, test_ds, device, num_pairs=2000):
    print(f"\n{'='*60}\n🕵️ FACE VERIFICATION (1:1)\n{'='*60}")

    label_to_indices = defaultdict(list)
    for idx, (_, label) in enumerate(test_ds.samples):
        label_to_indices[label].append(idx)

    valid_labels = [lbl for lbl, idxs in label_to_indices.items() if len(idxs) >= 2]

    pos_pairs, neg_pairs = [], []

    for _ in range(num_pairs // 2):
        lbl = random.choice(valid_labels)
        a, b = random.sample(label_to_indices[lbl], 2)
        pos_pairs.append((a, b, 1))

    all_labels = list(label_to_indices.keys())

    for _ in range(num_pairs // 2):
        lbl1, lbl2 = random.sample(all_labels, 2)
        a = random.choice(label_to_indices[lbl1])
        b = random.choice(label_to_indices[lbl2])
        neg_pairs.append((a, b, 0))

    pairs = pos_pairs + neg_pairs
    random.shuffle(pairs)

    sim_scores = []
    true_labels = []

    model.eval()

    with torch.no_grad():
        for i in tqdm(range(0, len(pairs), Config.BATCH_SIZE),
                      desc="Extracting Pairs"):
            batch = pairs[i:i + Config.BATCH_SIZE]

            imgs1 = torch.stack(
                [test_ds[p[0]][0] for p in batch]
            ).to(device)

            imgs2 = torch.stack(
                [test_ds[p[1]][0] for p in batch]
            ).to(device)

            emb1 = F.normalize(model.backbone(imgs1), p=2, dim=1)
            emb2 = F.normalize(model.backbone(imgs2), p=2, dim=1)

            sims = (emb1 * emb2).sum(dim=1)

            sim_scores.extend(sims.cpu().numpy())
            true_labels.extend([p[2] for p in batch])

    sim_scores = np.array(sim_scores)
    true_labels = np.array(true_labels)

    # ===== TÌM THRESHOLD TỐI ƯU =====
    best_acc = 0
    best_thresh = 0

    for th in np.arange(-0.5, 1.0, 0.005):
        pred = (sim_scores >= th).astype(int)
        acc = accuracy_score(true_labels, pred)

        if acc > best_acc:
            best_acc = acc
            best_thresh = th

    y_pred = (sim_scores >= best_thresh).astype(int)

    accuracy = accuracy_score(true_labels, y_pred)
    precision = precision_score(true_labels, y_pred)
    recall = recall_score(true_labels, y_pred)
    f1 = f1_score(true_labels, y_pred)
    auc = roc_auc_score(true_labels, sim_scores)

    tn, fp, fn, tp = confusion_matrix(
        true_labels,
        y_pred
    ).ravel()

    far = fp / (fp + tn + 1e-8)
    frr = fn / (fn + tp + 1e-8)

    # ===== EER =====
    fpr, tpr, thresholds = roc_curve(true_labels, sim_scores)
    fnr = 1 - tpr
    eer_idx = np.nanargmin(np.abs(fnr - fpr))
    eer = (fpr[eer_idx] + fnr[eer_idx]) / 2

    print("\n========== FACE VERIFICATION REPORT ==========")
    print(f"Threshold : {best_thresh:.4f}")
    print(f"Accuracy  : {accuracy*100:.2f}%")
    print(f"Precision : {precision*100:.2f}%")
    print(f"Recall    : {recall*100:.2f}%")
    print(f"F1-Score  : {f1*100:.2f}%")
    print(f"AUC       : {auc:.4f}")
    print(f"FAR       : {far*100:.2f}%")
    print(f"FRR       : {frr*100:.2f}%")
    print(f"EER       : {eer*100:.2f}%")

    # ===== CONFUSION MATRIX =====
    plt.figure(figsize=(5,5))
    cm = confusion_matrix(true_labels, y_pred)

    plt.imshow(cm)
    plt.title("Confusion Matrix")
    plt.colorbar()

    plt.xticks([0,1], ["Different", "Same"])
    plt.yticks([0,1], ["Different", "Same"])

    for i in range(2):
        for j in range(2):
            plt.text(j, i, str(cm[i,j]), ha="center")

    plt.tight_layout()
    plt.savefig(Path(Config.OUTPUT_DIR) / "confusion_matrix.png")
    plt.close()

    # ===== ROC CURVE =====
    plt.figure(figsize=(6,6))
    plt.plot(fpr, tpr, label=f"AUC={auc:.4f}")
    plt.plot([0,1], [0,1])
    plt.xlabel("False Positive Rate")
    plt.ylabel("True Positive Rate")
    plt.title("ROC Curve")
    plt.legend()
    plt.grid(True)
    plt.savefig(Path(Config.OUTPUT_DIR) / "roc_curve.png")
    plt.close()

    report = {
        "threshold": float(best_thresh),
        "accuracy": float(accuracy),
        "precision": float(precision),
        "recall": float(recall),
        "f1_score": float(f1),
        "auc": float(auc),
        "far": float(far),
        "frr": float(frr),
        "eer": float(eer),
        "tp": int(tp),
        "tn": int(tn),
        "fp": int(fp),
        "fn": int(fn)
    }

    with open(
        Path(Config.OUTPUT_DIR) / "verification_metrics.json",
        "w",
        encoding="utf-8"
    ) as f:
        json.dump(report, f, indent=4)

    return accuracy * 100, best_thresh

@torch.no_grad()
def extract_embeddings(loader, model, device):
    model.eval()
    all_embs, all_labels = [], []
    for imgs, labels in tqdm(loader, desc="Extracting (TTA)"):
        imgs = imgs.to(device)
        emb_orig = model.backbone(imgs)
        emb_flip = model.backbone(torch.flip(imgs, dims=[3]))
        emb_fused = F.normalize(emb_orig + emb_flip, p=2, dim=1) # Rút gọn TTA để chạy nhanh hơn
        all_embs.append(emb_fused.cpu()); all_labels.append(labels.cpu())
    return torch.cat(all_embs), torch.cat(all_labels)

# =============================================================================
# MAIN
# =============================================================================

def main():
    print("=" * 70)
    print("🚀 SCFace Training - iResNet50 + Glint360K")
    print("=" * 70)
    
    train_ids, val_ids, test_ids, train_label_map = load_split_info(Path(Config.SPLIT_DIR))
    val_label_map = {sid: i for i, sid in enumerate(sorted(val_ids))}
    test_label_map = {sid: i for i, sid in enumerate(sorted(test_ids))}
    NUM_CLASSES = len(train_label_map)
    
    train_ds = SCfaceDataset(Config.DATA_ROOT, train_label_map, train_ids, domains=Config.TRAIN_DOMAINS,
                             transform_mugshot=get_transform("train", True, True),
                             transform_dist=get_transform("train", True, False))
    val_ds = SCfaceDataset(Config.DATA_ROOT, val_label_map, val_ids, domains=Config.VAL_DOMAINS,
                           transform_mugshot=get_transform("val", False), only_frontal_mugshot=True)
    test_ds = SCfaceDataset(Config.DATA_ROOT, test_label_map, test_ids, domains=Config.TEST_DOMAINS,
                            transform_mugshot=get_transform("val", False), only_frontal_mugshot=True)
    
    train_loader = DataLoader(train_ds, batch_size=Config.BATCH_SIZE, shuffle=True, pin_memory=True, drop_last=True)
    val_loader = DataLoader(val_ds, batch_size=Config.BATCH_SIZE, shuffle=False, pin_memory=True)
    
    # 🌟 Khởi tạo Model
    # Load weight khi model còn ở CPU, sau đó mới đưa toàn bộ model lên GPU/CPU.
    model = FaceModel(NUM_CLASSES, Config.EMBEDDING_DIM, Config.ARC_MARGIN, Config.ARC_SCALE)
    model.backbone = load_glint360k_weights(
        model.backbone,
        Config.PRETRAINED_WEIGHT_PATH,
        strict=Config.STRICT_PRETRAINED_LOAD,
    )
    model = model.to(DEVICE)

    # Thiết lập Optimizer với 2 mức LR khác nhau (Backbone nhỏ, Head lớn)
    optimizer = optim.SGD([
        {'params': model.backbone.parameters(), 'lr': Config.LR_BACKBONE},
        {'params': model.arcface.parameters(), 'lr': Config.LR_HEAD}
    ], momentum=Config.MOMENTUM, weight_decay=Config.WEIGHT_DECAY)
    
    scheduler = optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=Config.EPOCHS, eta_min=1e-6)
    early_stopping = EarlyStopping(patience=Config.EARLY_STOP_PATIENCE, enabled=Config.EARLY_STOPPING_ENABLED)
    
    history = {"train_loss": [], "train_acc": [], "val_loss": [], "val_acc": []}
    best_val_acc, best_model_state = 0.0, None
    
    for epoch in range(1, Config.EPOCHS + 1):
        # 🔥 Đóng băng/Mở khóa backbone theo số epoch
        if epoch <= Config.FREEZE_BACKBONE_EPOCHS:
            if epoch == 1: print("\n❄️ ĐANG ĐÓNG BĂNG BACKBONE (Chỉ train lớp ArcFace).")
            for param in model.backbone.parameters(): param.requires_grad = False
        elif epoch == Config.FREEZE_BACKBONE_EPOCHS + 1:
            print("\n🔥 ĐÃ MỞ KHÓA BACKBONE (Fine-tune toàn bộ mạng).")
            for param in model.backbone.parameters(): param.requires_grad = True

        print(f"\n=== Epoch {epoch}/{Config.EPOCHS} ===")
        train_loss, train_acc = train_one_epoch(model, train_loader, optimizer, DEVICE, epoch, Config.GRADIENT_ACCUMULATION_STEPS)
        val_loss, val_acc = validate(model, val_loader, DEVICE, epoch)
        
        history["train_loss"].append(train_loss); history["train_acc"].append(train_acc)
        history["val_loss"].append(val_loss); history["val_acc"].append(val_acc)
        
        if val_acc > best_val_acc:
            best_val_acc = val_acc
            best_model_state = copy.deepcopy(model.state_dict())
            torch.save(model.state_dict(), Path(Config.OUTPUT_DIR) / "best_model.pth")
            print(f"★ New best model! (Val Acc: {val_acc:.2f}%)")
        
        scheduler.step()
        if early_stopping(val_acc):
            print(f"🛑 Early stopping at epoch {epoch}"); break

    # --- ĐÁNH GIÁ TEST ---
    print("\n" + "=" * 70 + "\n🎯 FINAL TEST EVALUATION\n" + "=" * 70)
    if best_model_state: model.load_state_dict(best_model_state)
    
    gallery_ds = SCfaceDataset(Config.DATA_ROOT, test_label_map, test_ids, domains=["mugshot"], transform_mugshot=get_transform("val", False), only_frontal_mugshot=True)
    probe_ds = SCfaceDataset(Config.DATA_ROOT, test_label_map, test_ids, domains=["dist1", "dist2", "dist3"], transform_mugshot=get_transform("val", False), only_frontal_mugshot=False)
    
    gallery_emb, gallery_labels = extract_embeddings(DataLoader(gallery_ds, batch_size=Config.BATCH_SIZE), model, DEVICE)
    probe_emb, probe_labels = extract_embeddings(DataLoader(probe_ds, batch_size=Config.BATCH_SIZE), model, DEVICE)
    
    # sim = torch.mm(probe_emb, gallery_emb.t())
    # rank1_acc = 100.0 * (gallery_labels[sim.argmax(dim=1)] == probe_labels).sum().item() / len(probe_labels)

    sim = torch.mm(probe_emb, gallery_emb.t())  # [num_probe, num_gallery]

    correct = 0
    for i in range(len(probe_labels)):
        probe_id = probe_labels[i]
        sim_scores = sim[i]  # similarity với tất cả gallery ảnh
        
        # Tìm các gallery ảnh có cùng identity với probe
        same_id_mask = (gallery_labels == probe_id)
        if same_id_mask.sum() == 0:
            continue  # Không có gallery ảnh nào cùng identity
        
        # Lấy similarity cao nhất trong số các ảnh cùng identity
        max_sim_same_id = sim_scores[same_id_mask].max()
        
        # Lấy similarity cao nhất trong số các ảnh khác identity
        max_sim_diff_id = sim_scores[~same_id_mask].max() if (~same_id_mask).sum() > 0 else -1
        
        # Rank-1 đúng nếu max_sim_same_id > max_sim_diff_id
        if max_sim_same_id > max_sim_diff_id:
            correct += 1
    
    rank1_acc = 100.0 * correct / len(probe_labels)
    
    print(f"   Rank-1 Accuracy: {rank1_acc:.2f}%")
    verif_acc, _ = evaluate_verification_pairs(model, test_ds, DEVICE)
    plot_history(history, verif_acc, Path(Config.OUTPUT_DIR))

if __name__ == "__main__":
    main()