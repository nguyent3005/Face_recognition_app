"""
Face image preprocessing: detection, cropping, alignment, and normalization.
Uses OpenCV's YuNet for robust face detection in group photos.
"""

import os
import cv2
import numpy as np
import logging
from typing import List, Tuple, Optional

logger = logging.getLogger(__name__)

_yunet_detector = None

def _get_yunet_detector(input_size=(320, 320)):
    global _yunet_detector
    if _yunet_detector is None:
        model_path = os.path.join(os.path.dirname(__file__), "models", "face_detection_yunet.onnx")
        if not os.path.exists(model_path):
            logger.error(f"Failed to load YuNet model from {model_path}")
            raise RuntimeError("YuNet face detection model not found")
            
        _yunet_detector = cv2.FaceDetectorYN.create(
            model=model_path,
            config="",
            input_size=input_size,
            score_threshold=0.6,
            nms_threshold=0.3,
            top_k=5000
        )
        logger.info("YuNet face detector loaded successfully")
    else:
        _yunet_detector.setInputSize(input_size)
    return _yunet_detector


def detect_faces(image: np.ndarray, min_size: int = 40) -> List[Tuple[int, int, int, int, float]]:
    """
    Detect faces in an image using YuNet.

    Args:
        image: Input image (BGR numpy array)
        min_size: Minimum face size in pixels

    Returns:
        List of tuples (x, y, w, h, confidence)
    """
    img_h, img_w = image.shape[:2]
    logger.info(f"[GROUP_ATTENDANCE] detect_faces: original image_shape={image.shape}")

    max_size = 1280
    scale = 1.0
    if max(img_h, img_w) > max_size:
        scale = max_size / max(img_h, img_w)
        detect_w = int(img_w * scale)
        detect_h = int(img_h * scale)
        detect_img = cv2.resize(image, (detect_w, detect_h))
        logger.info(f"[GROUP_ATTENDANCE] detect_faces: resized to {detect_w}x{detect_h} for detection (scale={scale:.4f})")
    else:
        detect_img = image
        detect_w = img_w
        detect_h = img_h

    detector = _get_yunet_detector(input_size=(detect_w, detect_h))
    
    # YuNet expects BGR format, which is the default for OpenCV
    status, faces = detector.detect(detect_img)

    if faces is None:
        logger.info("[GROUP_ATTENDANCE] total_faces_detected=0")
        return []

    logger.info(f"[GROUP_ATTENDANCE] total_faces_detected={len(faces)}")

    results = []
    for i, face in enumerate(faces):
        if scale != 1.0:
            face[:14] = face[:14] / scale
            
        x, y, w, h = map(int, face[:4])
        confidence = float(face[-1])
        logger.info(f"[GROUP_ATTENDANCE] face_{i}: bbox={(x,y,w,h)}, score={confidence}")
        if w >= min_size and h >= min_size:
            results.append((x, y, w, h, confidence))

    return results


def crop_face(image: np.ndarray, bbox: Tuple[int, int, int, int], margin: float = 0.25) -> np.ndarray:
    """
    Crop a face region from an image with margin.

    Args:
        image: Input image
        bbox: (x, y, w, h) bounding box
        margin: Extra margin around the face (fraction of face size)

    Returns:
        Cropped face image
    """
    x, y, w, h = bbox
    img_h, img_w = image.shape[:2]

    margin_x = int(w * margin)
    margin_y = int(h * margin)

    x1 = max(0, x - margin_x)
    y1 = max(0, y - margin_y)
    x2 = min(img_w, x + w + margin_x)
    y2 = min(img_h, y + h + margin_y)

    face_crop = image[y1:y2, x1:x2]
    logger.info(f"[GROUP_ATTENDANCE] crop: shape={face_crop.shape}")

    return face_crop


def preprocess_face(face_image: np.ndarray, target_size: int = 112) -> np.ndarray:
    """
    Preprocess a cropped face image for model input.

    Args:
        face_image: Cropped face image (BGR)
        target_size: Model input size (width = height)

    Returns:
        Preprocessed image as float32 numpy array (H, W, C), normalized to [0, 1]
    """
    # Convert BGR to RGB
    if len(face_image.shape) == 3 and face_image.shape[2] == 3:
        face_rgb = cv2.cvtColor(face_image, cv2.COLOR_BGR2RGB)
    else:
        face_rgb = face_image

    # Resize
    face_resized = cv2.resize(face_rgb, (target_size, target_size), interpolation=cv2.INTER_LINEAR)

    # Normalize to [-1, 1] for InsightFace models
    face_normalized = (face_resized.astype(np.float32) - 127.5) / 127.5

    return face_normalized


def extract_largest_face(
    image: np.ndarray, target_size: int = 112, min_face_size: int = 40
) -> Optional[Tuple[np.ndarray, Tuple[int, int, int, int]]]:
    """
    Detect and extract the largest face from an image.

    Returns:
        Tuple of (preprocessed_face, bbox) or None if no face detected
    """
    faces = detect_faces(image, min_size=min_face_size)

    if not faces:
        return None

    # Pick the largest face (w * h)
    largest = max(faces, key=lambda f: f[2] * f[3])
    x, y, w, h, conf = largest
    bbox = (x, y, w, h)
    
    cropped = crop_face(image, bbox, margin=0.25)
    preprocessed = preprocess_face(cropped, target_size)

    return preprocessed, bbox


def extract_all_faces(
    image: np.ndarray, target_size: int = 112, min_face_size: int = 40
) -> List[Tuple[np.ndarray, Tuple[int, int, int, int], float]]:
    """
    Detect and extract all faces from an image.

    Returns:
        List of tuples of (preprocessed_face, bbox, detection_confidence). Empty list if no face detected.
    """
    faces = detect_faces(image, min_size=min_face_size)
    if not faces:
        return []

    results = []
    for face_data in faces:
        x, y, w, h, conf = face_data
        bbox = (x, y, w, h)
        cropped = crop_face(image, bbox, margin=0.25)
        preprocessed = preprocess_face(cropped, target_size)
        results.append((preprocessed, bbox, conf))

    return results
