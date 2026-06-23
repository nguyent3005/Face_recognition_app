import numpy as np
import sys
from app.ml.model_loader import load_model

try:
    print("Loading PyTorch model...")
    model = load_model("pytorch", "app/ml/models/best_model.pth")
    print("Model loaded successfully.")
    
    # Preprocess expects RGB normalized face images, so let's generate values in range [-1, 1]
    fake_img = np.random.uniform(-1, 1, (112, 112, 3)).astype(np.float32)
    
    print("Extracting embedding...")
    emb = model.get_embedding(fake_img)
    
    print("Embedding shape:", emb.shape)
    norm = np.linalg.norm(emb)
    print("L2 Norm:", norm)
    
    # Assertions
    assert emb.shape == (512,), f"Expected shape (512,), got {emb.shape}"
    assert np.isclose(norm, 1.0, atol=1e-5), f"Expected L2 norm to be close to 1.0, got {norm}"
    
    print("SUCCESS: Model load and inference shape/norm verified!")
except Exception as e:
    print(f"FAILED: {e}")
    sys.exit(1)
