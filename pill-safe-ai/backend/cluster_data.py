import os
import shutil
import torch
import numpy as np
from torch.utils.data import DataLoader
import torchvision.models as models
import torchvision.transforms as transforms
import torchvision.datasets as datasets
from sklearn.cluster import MiniBatchKMeans # 대규모 데이터용 클러스터링
from tqdm import tqdm

# 하드웨어 설정
DEVICE = torch.device("cuda" if torch.cuda.is_available() else "cpu")

def run_clustering(data_path, output_path, num_clusters=5000):
    # 모델 준비(ResNet50 Feature Extractor)
    model = models.resnet50(pretrained=True)
    model= torch.nn.Sequential(*(list(model.children())[:-1]))
    model = model.to(DEVICE).eval()
    
    # 전처리 및 로더
    transform = transforms.Compose([
        transforms.Resize((224, 224)),
        transforms.ToTensor(),
        transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225])
    ])
    
    dataset = datasets.ImageFolder(root=data_path, transform=transform)
    
    loader = DataLoader(dataset, batch_size=256, num_workers=16, pin_memory=True)
    
    # 특징 추출
    features = []
    print("특징 추출 중...")
    with torch.no_grad():
        for inputs, _ in tqdm(loader):
            inputs = inputs.to(DEVICE)
            output = model(inputs)
            features.append(output.cpu().numpy().reshape(output.size(0), -1))
            
    features = np.vstack(features)
    
    # 클러스터링
    print(f"{num_clusters}개 그룹으로 분류 중...")
    kmeans = MiniBatchKMeans(n_clusters=num_clusters, batch_size=2048, random_state=42)
    labels = kmeans.fit_predict(features)
    
    # 결과 저장(파일 복사)
    image_paths = [item[0] for item in dataset.imgs]
    for path, label in tqdm(zip(image_paths, labels), total=len(image_paths)):
        target_dir = os.path.join(output_path, f"pill_group_{label}")
        os.makedirs(target_dir, exist_ok=True)
        shutil.copy(path, target_dir)
        
if __name__ == "__main__":
    base_dir = os.path.dirname(os.path.abspath(__file__))

    run_clustering(
        os.path.join(base_dir, "unlabeled_pills"),
        os.path.join(base_dir, "clustered_results")
    )