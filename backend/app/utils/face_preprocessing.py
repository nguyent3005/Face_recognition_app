"""
Face image preprocessing utilities.
Handles face detection, padding crop, landmarks alignment, and PyTorch normalization.
"""

import os
import cv2
import numpy as np
import logging
from typing import List, Dict, Any, Tuple, Optional

logger = logging.getLogger(__name__)

_yunet_detector = None

def _get_yunet_detector(input_size=(320, 320)):
    global _yunet_detector
    if _yunet_detector is None:
        model_path = os.path.abspath(os.path.join(
            os.path.dirname(__file__), "..", "ml", "models", "face_detection_yunet.onnx"
        ))
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
        logger.info("YuNet face detector loaded successfully in face_preprocessing")
    else:
        _yunet_detector.setInputSize(input_size)
    return _yunet_detector


def _run_yunet_detect(image: np.ndarray, min_size: int, conf_threshold: float) -> List[Dict[str, Any]]:
    img_h, img_w = image.shape[:2]
    
    max_size = 1280
    scale = 1.0
    if max(img_h, img_w) > max_size:
        scale = max_size / max(img_h, img_w)
        detect_w = int(img_w * scale)
        detect_h = int(img_h * scale)
        detect_img = cv2.resize(image, (detect_w, detect_h))
        logger.info(f"[face_preprocessing] detect_faces: resized to {detect_w}x{detect_h} for detection (scale={scale:.4f})")
    else:
        detect_img = image
        detect_w = img_w
        detect_h = img_h

    try:
        detector = _get_yunet_detector(input_size=(detect_w, detect_h))
        status, faces = detector.detect(detect_img)
    except Exception as e:
        logger.error(f"Error during YuNet detection: {e}")
        return []

    if faces is None:
        return []

    results = []
    for i, face in enumerate(faces):
        face_scaled = face.copy()
        if scale != 1.0:
            face_scaled[:14] = face_scaled[:14] / scale
            
        x, y, w, h = map(int, face_scaled[:4])
        confidence = float(face_scaled[-1])
        landmarks = face_scaled[4:14].reshape(5, 2)
        
        logger.info(f"[face_preprocessing] face_{i}: bbox={(x,y,w,h)}, score={confidence:.4f}")
        if w >= min_size and h >= min_size and confidence >= conf_threshold:
            results.append({
                "bbox": (x, y, w, h),
                "confidence": confidence,
                "landmarks": landmarks
            })

    return results


def _map_bbox_back(bbox: Tuple[int, int, int, int], rotation: str, w_orig: int, h_orig: int) -> Tuple[int, int, int, int]:
    x_rot, y_rot, w_rot, h_rot = bbox
    if rotation == "90_CW":
        x = y_rot
        y = h_orig - (x_rot + w_rot)
        w = h_rot
        h = w_rot
    elif rotation == "180":
        x = w_orig - (x_rot + w_rot)
        y = h_orig - (y_rot + h_rot)
        w = w_rot
        h = h_rot
    elif rotation == "270_CW":
        x = w_orig - (y_rot + h_rot)
        y = x_rot
        w = h_rot
        h = w_rot
    else:
        x, y, w, h = x_rot, y_rot, w_rot, h_rot
    return (int(x), int(y), int(w), int(h))


def _map_landmarks_back(landmarks: np.ndarray, rotation: str, w_orig: int, h_orig: int) -> np.ndarray:
    mapped = landmarks.copy()
    if rotation == "90_CW":
        mapped[:, 0] = landmarks[:, 1]
        mapped[:, 1] = h_orig - 1 - landmarks[:, 0]
    elif rotation == "180":
        mapped[:, 0] = w_orig - 1 - landmarks[:, 0]
        mapped[:, 1] = h_orig - 1 - landmarks[:, 1]
    elif rotation == "270_CW":
        mapped[:, 0] = w_orig - 1 - landmarks[:, 1]
        mapped[:, 1] = landmarks[:, 0]
    return mapped


def detect_faces(image: np.ndarray, min_size: int = 50, conf_threshold: float = 0.7) -> List[Dict[str, Any]]:
    """
    Detect faces in an image using YuNet with orientation and rotation fallbacks.

    Args:
        image: Input image (BGR numpy array)
        min_size: Minimum face size in pixels (default 50)
        conf_threshold: Minimum face detection confidence (default 0.7)

    Returns:
        List of dicts with keys bbox, confidence, landmarks
    """
    # 1. Detect on original image
    results = _run_yunet_detect(image, min_size, conf_threshold)
    if results:
        return results

    # 2. Try rotation fallback if no faces found
    rotations = [
        (cv2.ROTATE_90_CLOCKWISE, "90_CW"),
        (cv2.ROTATE_180, "180"),
        (cv2.ROTATE_90_COUNTERCLOCKWISE, "270_CW")
    ]
    
    best_results = []
    best_rotation = None
    
    for rot_code, rot_name in rotations:
        rotated_image = cv2.rotate(image, rot_code)
        rot_results = _run_yunet_detect(rotated_image, min_size, conf_threshold)
        if rot_results:
            mapped_results = []
            h_orig, w_orig = image.shape[:2]
            for res in rot_results:
                bbox = res["bbox"]
                landmarks = res["landmarks"]
                conf = res["confidence"]
                
                mapped_bbox = _map_bbox_back(bbox, rot_name, w_orig, h_orig)
                mapped_landmarks = _map_landmarks_back(landmarks, rot_name, w_orig, h_orig)
                
                mapped_results.append({
                    "bbox": mapped_bbox,
                    "confidence": conf,
                    "landmarks": mapped_landmarks
                })
            
            if not best_results or len(mapped_results) > len(best_results):
                best_results = mapped_results
                best_rotation = rot_name
            elif len(mapped_results) == len(best_results):
                max_conf_new = max(r["confidence"] for r in mapped_results)
                max_conf_best = max(r["confidence"] for r in best_results)
                if max_conf_new > max_conf_best:
                    best_results = mapped_results
                    best_rotation = rot_name
                    
    if best_results:
        logger.info(f"[face_preprocessing] Face detected with rotation: {best_rotation}")
        return best_results
        
    return []


def crop_face_with_padding(image: np.ndarray, bbox: Tuple[int, int, int, int], padding: float = 0.25) -> Optional[np.ndarray]:
    """
    Crop face based on bounding box and add padding.
    Padding is limited to image boundaries.
    """
    x, y, w, h = bbox
    img_h, img_w = image.shape[:2]

    # Validate bbox size
    if w <= 0 or h <= 0:
        raise ValueError(f"Invalid bounding box size: {w}x{h}")

    # Calculate padding pixels
    pad_x = int(w * padding)
    pad_y = int(h * padding)

    # Determine bounds
    x1 = max(0, x - pad_x)
    y1 = max(0, y - pad_y)
    x2 = min(img_w, x + w + pad_x)
    y2 = min(img_h, y + h + pad_y)

    # Validate cropped region coordinates
    if (x2 - x1) <= 0 or (y2 - y1) <= 0:
        raise ValueError("Calculated crop boundaries are invalid")

    return image[y1:y2, x1:x2]


def align_face(image: np.ndarray, landmarks: np.ndarray) -> Optional[np.ndarray]:
    """
    Align a face image to standard 112x112 template using 5 landmarks.
    
    Args:
        image: Original BGR/RGB image
        landmarks: numpy array of shape (5, 2)
        
    Returns:
        Aligned image of size 112x112 or None if alignment fails
    """
    try:
        # Standard template coordinates (ArcFace 112x112 layout)
        dst = np.array([
            [30.2946, 51.6963],  # left eye
            [65.5318, 51.5014],  # right eye
            [48.0252, 71.7366],  # nose
            [33.5493, 92.3655],  # left mouth corner
            [68.4490, 92.2041]   # right mouth corner
        ], dtype=np.float32)
        
        src = np.array(landmarks, dtype=np.float32)
        
        # Estimate similarity transform matrix (2x3)
        M, inliers = cv2.estimateAffinePartial2D(src, dst)
        if M is None:
            # Fallback to standard affine transform of first 3 points
            M = cv2.getAffineTransform(src[:3], dst[:3])
            
        if M is None:
            raise ValueError("Không thể tính toán ma trận chuyển đổi hình học (Affine matrix)")
            
        aligned = cv2.warpAffine(image, M, (112, 112), borderValue=0)
        return aligned
    except Exception as e:
        logger.warning(f"Failed to align face: {e}.")
        raise ValueError(f"Lỗi căn chỉnh khuôn mặt: {str(e)}")


def preprocess_face(image: np.ndarray, require_alignment: bool = False) -> Tuple[np.ndarray, Tuple[int, int, int, int], float]:
    """
    Preprocess a single face for enrollment/registration or recognition.
    
    Returns:
        Tuple of (preprocessed_face_normalized, bbox, confidence)
    """
    faces = detect_faces(image)
    if not faces:
        raise ValueError("Không phát hiện khuôn mặt trong ảnh. Vui lòng chụp lại rõ mặt hơn.")
    if require_alignment and len(faces) > 1:
        raise ValueError("Ảnh đăng ký chỉ được chứa một khuôn mặt.")
        
    face = faces[0]
    bbox = face["bbox"]
    landmarks = face["landmarks"]
    confidence = face["confidence"]
    
    aligned_face = None
    if landmarks is not None and len(landmarks) == 5:
        try:
            aligned_face = align_face(image, landmarks)
        except Exception as ae:
            if require_alignment:
                raise ValueError(f"Không thể căn chỉnh khuôn mặt: {str(ae)}")
            else:
                logger.warning(f"Face alignment failed in preprocess_face: {ae}. Falling back to crop.")
        
    if aligned_face is not None:
        face_cropped = aligned_face
        logger.info("[face_preprocessing] Face alignment succeeded.")
    else:
        if require_alignment:
            raise ValueError("Không tìm thấy đủ 5 điểm mốc trên khuôn mặt. Vui lòng chụp thẳng mặt, đủ ánh sáng và thử lại.")
        else:
            logger.info("[face_preprocessing] Face alignment failed or no landmarks. Fallback to crop+padding.")
            cropped = crop_face_with_padding(image, bbox, padding=0.25)
            if cropped is None or cropped.size == 0:
                # Absolute fallback
                x, y, w, h = bbox
                cropped = image[max(0, y):y+h, max(0, x):x+w]
            face_cropped = cv2.resize(cropped, (112, 112), interpolation=cv2.INTER_LINEAR)
        
    # Convert BGR to RGB
    if len(face_cropped.shape) == 3 and face_cropped.shape[2] == 3:
        face_rgb = cv2.cvtColor(face_cropped, cv2.COLOR_BGR2RGB)
    else:
        face_rgb = face_cropped
        
    # Normalize to [-1, 1]
    face_normalized = (face_rgb.astype(np.float32) - 127.5) / 127.5
    
    logger.info(f"[face_preprocessing] Preprocessed face shape: {face_normalized.shape}, value range: [{face_normalized.min():.2f}, {face_normalized.max():.2f}]")
    return face_normalized, bbox, confidence


def preprocess_all_faces(image: np.ndarray) -> List[Tuple[np.ndarray, Tuple[int, int, int, int], float]]:
    """
    Preprocess all faces in the image for attendance.
    
    Returns:
        List of tuples: [(preprocessed_face_normalized, bbox, confidence), ...]
    """
    faces = detect_faces(image)
    if not faces:
        return []
        
    results = []
    for face in faces:
        bbox = face["bbox"]
        landmarks = face["landmarks"]
        confidence = face["confidence"]
        
        aligned_face = None
        if landmarks is not None and len(landmarks) == 5:
            aligned_face = align_face(image, landmarks)
            
        if aligned_face is not None:
            face_cropped = aligned_face
        else:
            logger.info(f"[face_preprocessing] Alignment failed/no landmarks for face at {bbox}. Fallback to crop.")
            try:
                cropped = crop_face_with_padding(image, bbox, padding=0.25)
            except Exception as e:
                logger.warning(f"Padding crop failed for bbox {bbox}: {e}. Simple crop fallback.")
                cropped = None
                
            if cropped is None or cropped.size == 0:
                x, y, w, h = bbox
                cropped = image[max(0, y):y+h, max(0, x):x+w]
            face_cropped = cv2.resize(cropped, (112, 112), interpolation=cv2.INTER_LINEAR)
            
        # Convert BGR to RGB
        if len(face_cropped.shape) == 3 and face_cropped.shape[2] == 3:
            face_rgb = cv2.cvtColor(face_cropped, cv2.COLOR_BGR2RGB)
        else:
            face_rgb = face_cropped
            
        # Normalize to [-1, 1]
        face_normalized = (face_rgb.astype(np.float32) - 127.5) / 127.5
        
        results.append((face_normalized, bbox, confidence))
        
    logger.info(f"[face_preprocessing] Preprocessed {len(results)} faces for attendance.")
    return results
