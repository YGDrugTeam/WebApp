import os
from torchvision import transforms, datasets
from torch.utils.data import DataLoader

def get_optimized_loader(root_path, batch_size=256)