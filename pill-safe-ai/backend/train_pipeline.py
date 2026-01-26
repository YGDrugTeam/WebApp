import os
import torch
import torch.nn as nn
import torch.optim as optim
from torch.utils.data import Dataset, DataLoader, random_split, WeightedRandomSampler
from torchvision import transforms, models
from PIL import Image
import wandb
from tqdm import tqdm
import gc

# 1. 커스텀 데이터셋 (기존과 동일)
class DualPillDataset(Dataset):
    def __init__(self, root_dir, transform=None):
        self.root_dir = root_dir
        self.transform = transform
        self.classes = sorted([f for f in os.listdir(root_dir) if os.path.isdir(os.path.join(root_dir, f))])
        self.samples = []
        self.class_to_idx = {cls: i for i, cls in enumerate(self.classes)}
        
        for class_name in self.classes:
            class_path = os.path.join(root_dir, class_name)
            for img_name in os.listdir(class_path):
                self.samples.append({
                    "path": os.path.join(class_path, img_name),
                    "label": self.class_to_idx[class_name]
                })
                
    def __len__(self): return len(self.samples)
    def __getitem__(self, idx):
        sample = self.samples[idx]
        try:
            img = Image.open(sample["path"]).convert("RGB")
            if self.transform: img = self.transform(img)
            return img, sample["label"]
        except: return torch.zeros(3, 224, 224), sample["label"]

# 2. 모델 아키텍처
def get_model(num_classes):
    model = models.efficientnet_v2_s(weights=models.EfficientNet_V2_S_Weights.DEFAULT)
    model.classifier[1] = nn.Linear(model.classifier[1].in_features, num_classes)
    return model

def train():
    # --- [환경 설정] ---
    DEVICE = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    DATA_ROOT = 'D:\\Data\\pre_trained'
    BATCH_SIZE = 256  # 안정성을 위해 512에서 하향 조정
    EPOCHS = 50
    
    wandb.init(
        project="pill-safe-ai", 
        name="RTX5080-Stable-Run",
        config={"batch_size": BATCH_SIZE, "lr": 1e-4, "arch": "EfficientNet-V2-S"}
    )
    
    transform = transforms.Compose([
        transforms.Resize((224, 224)),
        transforms.RandomHorizontalFlip(),
        transforms.ToTensor(),
        transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225])
    ])

    full_dataset = DualPillDataset(DATA_ROOT, transform=transform)
    num_classes = len(full_dataset.classes)
    
    # 6:2:2 분할
    total = len(full_dataset)
    train_size, val_size = int(0.6*total), int(0.2*total)
    test_size = total - train_size - val_size
    train_ds, val_ds, _ = random_split(full_dataset, [train_size, val_size, test_size])

    # Sampler 설정
    train_labels = [full_dataset.samples[i]['label'] for i in train_ds.indices]
    class_counts = torch.bincount(torch.tensor(train_labels))
    weights = 1. / class_counts.float()
    samples_weights = weights[torch.tensor(train_labels)]
    sampler = WeightedRandomSampler(samples_weights, len(samples_weights))

    # 데이터 로더 (병목 최소화)
    train_loader = DataLoader(train_ds, batch_size=BATCH_SIZE, sampler=sampler, num_workers=12, pin_memory=True)
    val_loader = DataLoader(val_ds, batch_size=BATCH_SIZE, shuffle=False, num_workers=8, pin_memory=True)

    model = get_model(num_classes).to(DEVICE)
    optimizer = optim.AdamW(model.parameters(), lr=1e-4)
    criterion = nn.CrossEntropyLoss()
    
    # 최신 AMP 설정
    scaler = torch.amp.GradScaler('cuda')

    for epoch in range(EPOCHS):
        model.train()
        pbar = tqdm(train_loader, desc=f"Epoch {epoch} [Train]")
        for images, labels in pbar:
            images, labels = images.to(DEVICE, non_blocking=True), labels.to(DEVICE, non_blocking=True)
            
            optimizer.zero_grad(set_to_none=True)
            with torch.amp.autocast('cuda'):
                outputs = model(images)
                loss = criterion(outputs, labels)
            
            scaler.scale(loss).backward()
            scaler.step(optimizer)
            scaler.update()

        # [검증 및 메모리 비우기]
        model.eval()
        correct, total_val = 0, 0
        with torch.no_grad():
            for images, labels in val_loader:
                images, labels = images.to(DEVICE), labels.to(DEVICE)
                with torch.amp.autocast('cuda'):
                    outputs = model(images)
                    correct += (outputs.argmax(1) == labels).sum().item()
                    total_val += labels.size(0)

        val_acc = 100 * correct / total_val
        wandb.log({"epoch": epoch, "val_accuracy": val_acc})
        print(f"Epoch {epoch} 완성! Accuracy: {val_acc:.2f}%")
        
        # 에폭 종료 후 메모리 정리
        torch.cuda.empty_cache()
        gc.collect()
        
        torch.save(model.state_dict(), f"checkpoints/pill_best.pth")

if __name__ == "__main__":
    train()