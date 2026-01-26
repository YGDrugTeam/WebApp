import torch
import torch.nn as nn
import wandb # 실시간 대시보드용
from torch.cuda.amp import autocast, GradScaler
from torch.utils.data import DataLoader

wandb.init(project="medic_lens", name = "AMP-Training")

def train_engine(model, train_loader, val_loader, epochs=50):
    DEVICE = torch.device("cuda")
    optimizer = torch.optim.AdamW(model.parameters(), lr=1e-4)
    criterion = nn.CrossEntropyLoss()
    
    scaler = GradScaler()
    
    model.to(DEVICE)
    
    for epoch in range(epochs):
        model.train()
        total_loss = 0
        
        for i, (images, labels) in enumerate(train_loader):
            images, labels = images.to(DEVICE, non_blocking=True), labels.to(DEVICE, non_blocking=True)
            
            optimizer.zero_grad(set_to_none=True) # 메모리 효율 최적화
            
            # Mixed Precision Forward
            with autocast():
                outputs = model(images)
                loss = criterion(outputs, labels)
                
            # Backward with Scaling
            scaler.scale(loss).backward()
            scaler.step(optimizer)
            scaler.update()
            
            if i % 100 == 0:
                wandb.log({
                    "batch_loss": loss.item(),
                    "vram_usage": torch.cuda.memory_allocated(DEVICE) / 1e9, # GB 단위
                    "gpu_temp": 0 # (추후 pynvml로 연동 가능)
                })
        
        avg_loss = total_loss / len(train_loader)
        print(f"Epoch {epoch} 완성! 평균 손실: {avg_loss:.4f}")
        wandb.log({"epoch_loss": avg_loss})
        
        # 모델 자동 저장
        torch.save(model.state_dict(), f"modelspill_v1_epoch_{epoch}.pth")

if __name__ == "__main__":
    # pip install wandb 후 사용하세요
    pass