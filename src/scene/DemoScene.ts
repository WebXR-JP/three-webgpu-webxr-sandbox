import {
  Scene,
  BoxGeometry,
  SphereGeometry,
  MeshStandardMaterial,
  Mesh,
  GridHelper,
  AmbientLight,
  DirectionalLight,
  Color
} from 'three/webgpu';
import { PointCloudWithLights } from './PointCloudWithLights';

// デモ用Three.jsシーン
export class DemoScene {
  scene: Scene;
  private box: Mesh;
  private sphere: Mesh;
  private pointCloudWithLights: PointCloudWithLights;

  constructor() {
    this.scene = new Scene();
    this.scene.background = new Color(0x000000);

    // ライティング
    const ambientLight = new AmbientLight(0xffffff, 0.5);
    this.scene.add(ambientLight);

    const directionalLight = new DirectionalLight(0xffffff, 1);
    directionalLight.position.set(5, 10, 7.5);
    this.scene.add(directionalLight);

    // グリッド
    const grid = new GridHelper(10, 10, 0x444444, 0x222222);
    this.scene.add(grid);

    // ボックス
    const boxGeometry = new BoxGeometry(0.5, 0.5, 0.5);
    const boxMaterial = new MeshStandardMaterial({
      color: 0x4a90d9,
      roughness: 0.4,
      metalness: 0.3
    });
    this.box = new Mesh(boxGeometry, boxMaterial);
    this.box.position.set(-1, 1, -2);
    this.scene.add(this.box);

    // スフィア
    const sphereGeometry = new SphereGeometry(0.3, 32, 32);
    const sphereMaterial = new MeshStandardMaterial({
      color: 0xe94560,
      roughness: 0.3,
      metalness: 0.5
    });
    this.sphere = new Mesh(sphereGeometry, sphereMaterial);
    this.sphere.position.set(1, 1.2, -2);
    this.scene.add(this.sphere);

    // 追加オブジェクト（奥行き確認用）
    this.addDepthMarkers();

    // ポイントクラウドと3色ライト（WebGPU感演出）
    this.pointCloudWithLights = new PointCloudWithLights();
    this.pointCloudWithLights.group.position.set(0, 1.5, -1);
    this.scene.add(this.pointCloudWithLights.group);
  }

  // 奥行き確認用のマーカー
  private addDepthMarkers(): void {
    const markerGeometry = new BoxGeometry(0.2, 0.2, 0.2);
    const markerMaterial = new MeshStandardMaterial({
      color: 0x16c79a,
      roughness: 0.5
    });

    // Z軸方向に複数配置
    for (let z = -5; z <= 0; z += 1) {
      const marker = new Mesh(markerGeometry, markerMaterial);
      marker.position.set(0, 0.1, z);
      this.scene.add(marker);
    }
  }

  // アニメーション更新
  update(time: number): void {
    const t = time * 0.001; // 秒に変換

    // ボックス回転
    this.box.rotation.x = t * 0.5;
    this.box.rotation.y = t * 0.7;

    // スフィア浮遊
    this.sphere.position.y = 1.2 + Math.sin(t * 2) * 0.2;

    // ポイントクラウドライトのアニメーション
    this.pointCloudWithLights.update(time);
  }

  // リソース解放
  dispose(): void {
    this.scene.traverse((object) => {
      if (object instanceof Mesh) {
        object.geometry.dispose();
        if (Array.isArray(object.material)) {
          object.material.forEach(m => m.dispose());
        } else {
          object.material.dispose();
        }
      }
    });

    // ポイントクラウド解放
    this.pointCloudWithLights.dispose();
  }
}
