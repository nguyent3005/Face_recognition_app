"""
Test script for face preprocessing pipeline:
- detect_faces
- crop_face_with_padding
- align_face
- preprocess_face
- preprocess_all_faces
- model compatibility and L2 normalization
"""

import os
import sys
import cv2
import numpy as np
import logging

# Ensure backend directory is in path
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from app.utils.face_preprocessing import (
    detect_faces,
    crop_face_with_padding,
    align_face,
    preprocess_face,
    preprocess_all_faces,
)
from app.services.face_service import get_model, l2_normalize

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("TestFacePrep")

def find_test_image() -> str:
    """Find a valid photo file in the uploads/photos folder."""
    photos_dir = os.path.join(os.path.dirname(__file__), "uploads", "photos")
    if not os.path.exists(photos_dir):
        return None
    for f in os.listdir(photos_dir):
        if f.lower().endswith((".jpg", ".jpeg", ".png")) and os.path.getsize(os.path.join(photos_dir, f)) > 50000:
            return os.path.join(photos_dir, f)
    return None

def test_pipeline():
    logger.info("Starting face preprocessing pipeline tests...")
    
    # Find a sample image
    img_path = find_test_image()
    if img_path is None:
        logger.error("No valid test images found in uploads/photos. Cannot run full test.")
        sys.exit(1)
        
    logger.info(f"Using test image: {img_path}")
    image = cv2.imread(img_path)
    if image is None:
        logger.error(f"Failed to read test image {img_path}")
        sys.exit(1)
        
    logger.info(f"Original image shape: {image.shape}")
    
    # 1. Test detect_faces
    faces = detect_faces(image)
    logger.info(f"Detected {len(faces)} faces.")
    
    if len(faces) == 0:
        logger.warning("No faces detected in the test image. Please use an image with a clear face.")
        # We can still test synthetic cases below
    else:
        # Check first face
        face = faces[0]
        bbox = face["bbox"]
        landmarks = face["landmarks"]
        conf = face["confidence"]
        
        logger.info(f"First face bbox: {bbox}, conf: {conf:.4f}")
        assert len(bbox) == 4, f"Bbox must be a tuple of 4, got {bbox}"
        assert conf > 0.0, f"Confidence must be positive, got {conf}"
        
        # 2. Test crop_face_with_padding
        cropped = crop_face_with_padding(image, bbox, padding=0.25)
        assert cropped is not None, "crop_face_with_padding returned None"
        logger.info(f"Cropped face with padding shape: {cropped.shape}")
        
        # 3. Test align_face
        if landmarks is not None:
            logger.info(f"Landmarks shape: {landmarks.shape}")
            assert landmarks.shape == (5, 2), f"Landmarks shape must be (5, 2), got {landmarks.shape}"
            aligned = align_face(image, landmarks)
            assert aligned is not None, "align_face returned None"
            assert aligned.shape == (112, 112, 3), f"Aligned shape must be (112, 112, 3), got {aligned.shape}"
            logger.info("Face alignment successful and matches 112x112 format.")
            
        # 4. Test preprocess_all_faces
        preprocessed_list = preprocess_all_faces(image)
        logger.info(f"preprocess_all_faces returned {len(preprocessed_list)} results.")
        assert len(preprocessed_list) == len(faces), "Results count must match faces count"
        
        for idx, (face_img, face_bbox, face_conf) in enumerate(preprocessed_list):
            assert face_img.shape == (112, 112, 3), f"Preprocessed shape must be (112, 112, 3), got {face_img.shape}"
            assert face_img.dtype == np.float32, f"Preprocessed dtype must be float32, got {face_img.dtype}"
            assert face_img.min() >= -1.0 and face_img.max() <= 1.0, f"Values must be normalized to [-1, 1], got range [{face_img.min()}, {face_img.max()}]"
            logger.info(f"Face {idx} preprocessed correctly. Box: {face_bbox}, range: [{face_img.min():.2f}, {face_img.max():.2f}]")

    # 5. Test 0-face error condition
    logger.info("Testing 0-face condition...")
    blank_img = np.zeros((300, 300, 3), dtype=np.uint8)
    try:
        preprocess_face(blank_img)
        assert False, "Should have raised ValueError for 0 faces"
    except ValueError as ve:
        assert "Không phát hiện khuôn mặt" in str(ve), f"Unexpected error message: {ve}"
        logger.info("0-face condition raised correct exception.")

    # 6. Test multi-face error condition & multi-face detection using synthetic image
    if len(faces) > 0:
        logger.info("Testing multi-face condition using synthetic image...")
        # Crop the face out of the original image
        x, y, w, h = bbox
        face_crop = image[max(0, y):y+h, max(0, x):x+w]
        
        # Create a large black canvas dynamically
        h_crop, w_crop = face_crop.shape[:2]
        canvas = np.zeros((h_crop * 3 + 100, w_crop * 3 + 100, 3), dtype=np.uint8)
        
        # Paste the face crop at two separate positions
        canvas[50:50+h_crop, 50:50+w_crop] = face_crop
        canvas[h_crop + 80:h_crop + 80 + h_crop, w_crop + 80:w_crop + 80 + w_crop] = face_crop
        
        # Now call preprocess_face on canvas
        try:
            preprocess_face(canvas, require_alignment=True)
            assert False, "Should have raised ValueError for >1 face"
        except ValueError as ve:
            assert "chỉ được chứa một khuôn mặt" in str(ve), f"Unexpected error message: {ve}"
            logger.info("Multi-face condition raised correct exception.")
            
        # Test preprocess_all_faces on synthetic canvas
        multi_preprocessed = preprocess_all_faces(canvas)
        logger.info(f"Synthetic canvas faces detected: {len(multi_preprocessed)}")
        assert len(multi_preprocessed) >= 2, f"Should detect at least 2 faces, got {len(multi_preprocessed)}"
        
        # 6b. Test rotation fallback detection
        logger.info("Testing rotation fallback detection...")
        rotated_90 = cv2.rotate(image, cv2.ROTATE_90_CLOCKWISE)
        detected_rot = detect_faces(rotated_90)
        assert len(detected_rot) > 0, "Should detect face in 90-degree rotated image"
        logger.info("Rotation fallback detection successfully verified.")
        
        # 7. Test edge/border clamping padding
        logger.info("Testing face at image boundary...")
        border_canvas = np.zeros((h_crop * 2, w_crop * 2, 3), dtype=np.uint8)
        # Paste face at top-left edge
        border_canvas[0:h_crop, 0:w_crop] = face_crop
        
        border_preprocessed = preprocess_all_faces(border_canvas)
        logger.info(f"Boundary image face detected: {len(border_preprocessed)}")
        # Verify it successfully preprocessed without raising any out-of-bounds errors
        for p_img, p_bbox, p_conf in border_preprocessed:
            assert p_img.shape == (112, 112, 3), "Boundary crop should still be 112x112"
        logger.info("Clamped padding and border handling successfully verified.")

    # 8. Test Model Inference & L2 Normalization
    logger.info("Testing model loading and inference with normalized image...")
    try:
        model = get_model()
        logger.info("Model loaded successfully.")
        
        # Generate dummy normalized face array
        dummy_face = np.random.uniform(-1, 1, (112, 112, 3)).astype(np.float32)
        
        # Extract embedding
        emb = model.get_embedding(dummy_face)
        logger.info(f"Embedding extracted. Shape: {emb.shape}")
        assert emb.shape == (512,), f"Embedding shape must be (512,), got {emb.shape}"
        
        # Verify model/service L2 normalization
        normalized_emb = l2_normalize(emb)
        l2_norm = np.linalg.norm(normalized_emb)
        logger.info(f"L2 Norm of normalized embedding: {l2_norm:.6f}")
        assert np.isclose(l2_norm, 1.0, atol=1e-5), f"L2 Norm must be close to 1.0, got {l2_norm}"
        logger.info("Embedding L2 normalization verified.")
    except Exception as e:
        logger.error(f"Model inference or normalization check failed: {e}")
        sys.exit(1)

    logger.info("\nSUCCESS: All face preprocessing pipeline tests passed!")

if __name__ == "__main__":
    test_pipeline()
