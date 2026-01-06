import { LightingModel } from 'three/webgpu';

// webgpu_lights_customサンプルと同様のカスタムライティングモデル
// direct()でlightColorをそのまま拡散光に加算する（Lambert等の計算なし）
export class CustomLightingModel extends LightingModel {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  direct({ lightColor, reflectedLight }: any): void {
    reflectedLight.directDiffuse.addAssign(lightColor);
  }
}
