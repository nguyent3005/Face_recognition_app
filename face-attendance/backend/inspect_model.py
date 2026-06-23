import torch

model_path = r"C:\Users\Admin\Downloads\best_model (3).pth"

model_data = torch.load(model_path, map_location='cpu')

layers = [k for k in model_data.keys() if 'backbone.layer' in k]
# Group by layer prefix (e.g., backbone.layer1.0, backbone.layer1.1)
blocks = set()
for l in layers:
    parts = l.split('.')
    if len(parts) >= 3:
        blocks.add(f"{parts[1]}.{parts[2]}")

blocks = sorted(list(blocks))
print("Blocks found:", blocks)
print("Number of blocks in each layer:")
layer_counts = {}
for b in blocks:
    layer_name = b.split('.')[0]
    layer_counts[layer_name] = layer_counts.get(layer_name, 0) + 1

print(layer_counts)
