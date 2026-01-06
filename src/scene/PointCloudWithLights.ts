import {
  BufferGeometry,
  Vector3,
  Points,
  PointsNodeMaterial,
  PointLight,
  Mesh,
  SphereGeometry,
  NodeMaterial,
  Group
} from 'three/webgpu';
import { color, lights } from 'three/tsl';
import { CustomLightingModel } from './CustomLightingModel';

// ライト情報
interface AnimatedLight {
  light: PointLight;
  mesh: Mesh;
}

// 50万ポイントのクラウドと3色アニメーションライト
export class PointCloudWithLights {
  group: Group;
  private pointCloud: Points;
  private animatedLights: AnimatedLight[] = [];
  private light1!: PointLight;
  private light2!: PointLight;
  private light3!: PointLight;

  constructor() {
    this.group = new Group();
    this.createLights();
    this.pointCloud = this.createPointCloud();
    this.group.add(this.pointCloud);
  }

  // 3色ライト作成
  private createLights(): void {
    const sphereGeometry = new SphereGeometry(0.02, 16, 8);

    const addLight = (hexColor: number): PointLight => {
      // ライトの可視化用メッシュ
      const material = new NodeMaterial();
      material.colorNode = color(hexColor);
      material.lightsNode = lights([]); // 空配列でライト影響なし（自発光に見える）
      const mesh = new Mesh(sphereGeometry, material);

      // ポイントライト
      const light = new PointLight(hexColor, 0.1, 1);
      light.add(mesh);
      this.group.add(light);

      this.animatedLights.push({ light, mesh });
      return light;
    };

    this.light1 = addLight(0xffaa00); // オレンジ
    this.light2 = addLight(0x0040ff); // 青
    this.light3 = addLight(0x80ff80); // 緑
  }

  // 50万ポイントのクラウド作成
  private createPointCloud(): Points {
    const points: Vector3[] = [];
    for (let i = 0; i < 500000; i++) {
      // -0.5〜0.5の範囲でランダム、6倍スケール => -3〜3
      const point = new Vector3()
        .random()
        .subScalar(0.5)
        .multiplyScalar(6);
      points.push(point);
    }

    const geometry = new BufferGeometry().setFromPoints(points);
    const material = new PointsNodeMaterial();

    // カスタムライティングモデルを使用
    const allLightsNode = lights([this.light1, this.light2, this.light3]);
    const lightingModel = new CustomLightingModel();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const lightingModelContext = (allLightsNode as any).context({ lightingModel });
    material.lightsNode = lightingModelContext;

    return new Points(geometry, material);
  }

  // アニメーション更新（time: ミリ秒）
  update(time: number): void {
    const t = time * 0.001; // 秒に変換
    const scale = 1.5;

    // サンプルと同じsin/cos組み合わせでアニメーション
    this.light1.position.set(
      Math.sin(t * 0.7) * scale,
      Math.cos(t * 0.5) * scale,
      Math.cos(t * 0.3) * scale
    );
    this.light2.position.set(
      Math.cos(t * 0.3) * scale,
      Math.sin(t * 0.5) * scale,
      Math.sin(t * 0.7) * scale
    );
    this.light3.position.set(
      Math.sin(t * 0.7) * scale,
      Math.cos(t * 0.3) * scale,
      Math.sin(t * 0.5) * scale
    );
  }

  // リソース解放
  dispose(): void {
    this.pointCloud.geometry.dispose();
    (this.pointCloud.material as PointsNodeMaterial).dispose();

    for (const { light, mesh } of this.animatedLights) {
      mesh.geometry.dispose();
      (mesh.material as NodeMaterial).dispose();
      light.dispose();
    }
  }
}
