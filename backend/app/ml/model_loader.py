"""
Face Recognition Model Loader
Supports: ONNX, PyTorch, and a Demo mode for testing without a real model.
"""

import os
import logging
import numpy as np
import torch
import torch.nn as nn
from abc import ABC, abstractmethod
from typing import Optional

# ──────────────────────────────────────────────
# iResNet50 Architecture Loader
# ──────────────────────────────────────────────
try:
    from app.ml.iresnet import iresnet50
except ImportError:
    from .iresnet import iresnet50

logger = logging.getLogger(__name__)


def load_backbone_weights(model, pth_path):
    logger.info(f"Loading iResNet50 weights from {pth_path}")
    checkpoint = torch.load(pth_path, map_location="cpu")

    if isinstance(checkpoint, dict):
        if "state_dict" in checkpoint:
            checkpoint = checkpoint["state_dict"]
        elif "model_state_dict" in checkpoint:
            checkpoint = checkpoint["model_state_dict"]

    cleaned = {}
    for k, v in checkpoint.items():
        if not torch.is_tensor(v):
            continue

        key = k
        if key.startswith("module."):
            key = key[len("module."):]
        if key.startswith("backbone."):
            key = key[len("backbone."):]
        if key.startswith("arcface."):
            continue

        cleaned[key] = v

    model_state = model.state_dict()
    missing = [k for k in model_state.keys() if k not in cleaned]
    unexpected = [k for k in cleaned.keys() if k not in model_state.keys()]
    shape_mismatch = []
    
    for k in model_state.keys():
        if k in cleaned and model_state[k].shape != cleaned[k].shape:
            shape_mismatch.append((k, model_state[k].shape, cleaned[k].shape))

    # Log weights loading stats
    logger.info(f"Weights Load Stats for iResNet50:")
    logger.info(f"  Matched keys: {len(model_state.keys()) - len(missing)}/{len(model_state.keys())}")
    logger.info(f"  Missing keys count: {len(missing)} (first 10: {missing[:10]})")
    logger.info(f"  Unexpected keys count: {len(unexpected)} (first 10: {unexpected[:10]})")
    if shape_mismatch:
        logger.error(f"  Shape mismatch count: {len(shape_mismatch)} (first 5: {shape_mismatch[:5]})")

    # Strict compatibility checks:
    # 1. Any shape mismatch is a failure.
    if shape_mismatch:
        raise RuntimeError(f"Strict Weight Check: Shape mismatch detected: {shape_mismatch}")

    # 2. Check essential keys. Must include conv1, bn1, prelu, layer1->layer4, bn2, fc, features.
    essential_prefixes = ("conv1", "bn1", "prelu", "layer1", "layer2", "layer3", "layer4", "bn2", "fc", "features")
    missing_essential = [k for k in missing if k.startswith(essential_prefixes)]
    if missing_essential:
        raise RuntimeError(f"Strict Weight Check: Missing essential keys: {missing_essential}")

    # 3. Fail if too many missing or unexpected keys (threshold = 10)
    if len(missing) > 10 or len(unexpected) > 10:
        raise RuntimeError(
            f"Strict Weight Check: Too many missing or unexpected keys in checkpoint. "
            f"Missing count: {len(missing)}, Unexpected count: {len(unexpected)}"
        )

    model.load_state_dict(cleaned, strict=False)
    logger.info("Successfully loaded backbone weights into iResNet50.")
    return model


class FaceRecognitionModel(ABC):
    """Abstract base class for face recognition models."""

    @abstractmethod
    def get_embedding(self, face_image: np.ndarray) -> np.ndarray:
        """
        Extract face embedding from a preprocessed face image.

        Args:
            face_image: Preprocessed face image as numpy array (H, W, C) in RGB, float32, normalized.

        Returns:
            Embedding vector as numpy array of shape (embedding_dim,).
        """
        pass

    @staticmethod
    def cosine_similarity(embedding1: np.ndarray, embedding2: np.ndarray) -> float:
        """Compute cosine similarity between two embedding vectors."""
        norm1 = np.linalg.norm(embedding1)
        norm2 = np.linalg.norm(embedding2)
        if norm1 == 0 or norm2 == 0:
            return 0.0
        return float(np.dot(embedding1, embedding2) / (norm1 * norm2))


class ONNXModel(FaceRecognitionModel):
    """Load and run an ONNX face recognition model."""

    def __init__(self, model_path: str):
        try:
            import onnxruntime as ort
            self.session = ort.InferenceSession(model_path)
            self.input_name = self.session.get_inputs()[0].name
            input_shape = self.session.get_inputs()[0].shape
            logger.info(f"ONNX model loaded: {model_path}, input shape: {input_shape}")
        except Exception as e:
            logger.error(f"Failed to load ONNX model: {e}")
            raise

    def get_embedding(self, face_image: np.ndarray) -> np.ndarray:
        # Ensure NCHW format: (1, C, H, W)
        if face_image.ndim == 3:
            face_image = np.transpose(face_image, (2, 0, 1))  # HWC -> CHW
            face_image = np.expand_dims(face_image, axis=0)  # Add batch dim

        face_image = face_image.astype(np.float32)
        result = self.session.run(None, {self.input_name: face_image})
        embedding = result[0].flatten()
        # L2 normalize
        norm = np.linalg.norm(embedding)
        if norm > 0:
            embedding = embedding / norm
        return embedding


class PyTorchModel(FaceRecognitionModel):
    """Load and run a PyTorch face recognition model using iResNet50."""

    def __init__(self, model_path: str):
        try:
            self.device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
            logger.info(f"Initializing PyTorch model on device: {self.device}")
            
            # Khởi tạo kiến trúc model (iResNet50)
            self.model = iresnet50(
                pretrained=False,
                dropout=0.4,
                num_features=512,
                fp16=False,
            )
            
            # Load weights
            self.model = load_backbone_weights(self.model, model_path)
            
            self.model.to(self.device)
            self.model.eval()
                
            logger.info(f"PyTorch iResNet50 model loaded and evaluated successfully: {model_path}")
        except Exception as e:
            logger.error(f"Failed to load PyTorch model: {e}")
            raise

    def get_embedding(self, face_image: np.ndarray) -> np.ndarray:
        import torch
        import torch.nn.functional as F

        # Ensure NCHW format
        if face_image.ndim == 3:
            face_image = np.transpose(face_image, (2, 0, 1))  # HWC -> CHW
            face_image = np.expand_dims(face_image, axis=0)  # Add batch dim

        tensor = torch.from_numpy(face_image.astype(np.float32)).to(self.device)

        with torch.no_grad():
            # TTA: original + horizontal flip
            emb1 = self.model(tensor)
            emb2 = self.model(torch.flip(tensor, dims=[3]))
            emb = emb1 + emb2
            # L2 normalize before matching
            emb = F.normalize(emb, p=2, dim=1)

        embedding = emb.cpu().numpy().flatten()
        return embedding


class DemoModel(FaceRecognitionModel):
    """
    Demo model that generates deterministic embeddings from face images.
    Uses average pixel values across spatial grid cells as a simple descriptor.
    Good enough for testing the UI flow without a real model.
    """

    def __init__(self, embedding_dim: int = 512):
        self.embedding_dim = embedding_dim
        logger.info(f"Demo model initialized (embedding_dim={embedding_dim})")

    def get_embedding(self, face_image: np.ndarray) -> np.ndarray:
        # Resize to a small grid and use as a simple feature vector
        from PIL import Image

        if face_image.ndim == 3:
            h, w, c = face_image.shape
        else:
            return np.random.randn(self.embedding_dim).astype(np.float32)

        # Create a deterministic embedding from image content
        # Divide image into grid cells and compute mean color per cell
        grid_size = int(np.ceil(np.sqrt(self.embedding_dim // 3)))
        cell_h = max(1, h // grid_size)
        cell_w = max(1, w // grid_size)

        features = []
        for i in range(grid_size):
            for j in range(grid_size):
                y1, y2 = i * cell_h, min((i + 1) * cell_h, h)
                x1, x2 = j * cell_w, min((j + 1) * cell_w, w)
                cell = face_image[y1:y2, x1:x2]
                if cell.size > 0:
                    features.extend(cell.mean(axis=(0, 1)).tolist())
                else:
                    features.extend([0.0] * 3)

        # Pad or truncate to embedding_dim
        embedding = np.array(features[:self.embedding_dim], dtype=np.float32)
        if len(embedding) < self.embedding_dim:
            embedding = np.pad(embedding, (0, self.embedding_dim - len(embedding)))

        # L2 normalize
        norm = np.linalg.norm(embedding)
        if norm > 0:
            embedding = embedding / norm
        return embedding


def load_model(model_type: str, model_path: str, embedding_dim: int = 512) -> FaceRecognitionModel:
    """
    Factory function to load the appropriate face recognition model.

    Args:
        model_type: "onnx", "pytorch", or "demo"
        model_path: Path to model directory or file
        embedding_dim: Dimension of face embeddings (for demo mode)
    """
    if model_type == "demo":
        return DemoModel(embedding_dim=embedding_dim)

    # Find model file in directory
    if os.path.isdir(model_path):
        for f in os.listdir(model_path):
            if model_type == "onnx" and f.endswith(".onnx"):
                model_path = os.path.join(model_path, f)
                break
            elif model_type == "pytorch" and f.endswith((".pt", ".pth")):
                model_path = os.path.join(model_path, f)
                break

    if not os.path.isfile(model_path):
        logger.warning(f"Model file not found at {model_path}, falling back to demo mode")
        return DemoModel(embedding_dim=embedding_dim)

    if model_type == "onnx":
        return ONNXModel(model_path)
    elif model_type == "pytorch":
        return PyTorchModel(model_path)
    else:
        logger.warning(f"Unknown model type '{model_type}', using demo mode")
        return DemoModel(embedding_dim=embedding_dim)
