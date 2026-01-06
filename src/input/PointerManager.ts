import { Vector2, Vector3, Raycaster, Plane, PerspectiveCamera } from 'three/webgpu';

// スポーンポイント情報
export interface SpawnPoint {
  position: Vector3;
  active: boolean;
}

// マウス/コントローラー入力の抽象化
export class PointerManager {
  private camera: PerspectiveCamera;
  private raycaster: Raycaster;
  private raycastPlane: Plane;

  // マウス用
  private screenPointer: Vector2;
  private scenePointer: Vector3;
  private mouseActive = false;

  // コントローラー位置（左右）
  private controllerPositions: Vector3[] = [new Vector3(), new Vector3()];
  private controllerActive: boolean[] = [false, false];

  // モード
  private xrMode = false;

  // イベントハンドラの参照（解除用）
  private onPointerMoveBound: (e: PointerEvent) => void;
  private onPointerEnterBound: () => void;
  private onPointerLeaveBound: () => void;
  private element: HTMLElement | null = null;

  constructor(camera: PerspectiveCamera) {
    this.camera = camera;
    this.raycaster = new Raycaster();
    this.raycastPlane = new Plane(new Vector3(0, 0, 1), 0);
    this.screenPointer = new Vector2();
    this.scenePointer = new Vector3();

    // バインドされたイベントハンドラ
    this.onPointerMoveBound = this.onPointerMove.bind(this);
    this.onPointerEnterBound = () => { this.mouseActive = true; };
    this.onPointerLeaveBound = () => { this.mouseActive = false; };
  }

  // マウスイベントリスナー登録
  setupMouseListeners(element: HTMLElement): void {
    this.element = element;
    element.addEventListener('pointermove', this.onPointerMoveBound);
    element.addEventListener('pointerenter', this.onPointerEnterBound);
    element.addEventListener('pointerleave', this.onPointerLeaveBound);
  }

  // マウス移動イベント
  private onPointerMove(e: PointerEvent): void {
    const rect = this.element?.getBoundingClientRect();
    if (!rect) return;

    // スクリーン座標を正規化(-1 to 1)
    this.screenPointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.screenPointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    this.mouseActive = true;
  }

  // XRモード設定
  setXRMode(enabled: boolean): void {
    this.xrMode = enabled;
    if (enabled) {
      this.mouseActive = false;
    }
  }

  // カメラ参照更新
  setCamera(camera: PerspectiveCamera): void {
    this.camera = camera;
  }

  // XRフレームからコントローラー位置を更新
  updateFromXRFrame(
    frame: XRFrame,
    refSpace: XRReferenceSpace,
    inputSources: XRInputSourceArray
  ): void {
    // 一旦全コントローラーを非アクティブに
    this.controllerActive[0] = false;
    this.controllerActive[1] = false;

    let idx = 0;
    for (const inputSource of inputSources) {
      if (idx >= 2) break;

      // gripSpaceを優先、なければtargetRaySpace
      const space = inputSource.gripSpace || inputSource.targetRaySpace;
      if (!space) continue;

      const pose = frame.getPose(space, refSpace);
      if (pose) {
        this.controllerPositions[idx].set(
          pose.transform.position.x,
          pose.transform.position.y,
          pose.transform.position.z
        );
        this.controllerActive[idx] = true;
      }
      idx++;
    }
  }

  // 非XR時のマウス位置更新
  updateMousePosition(): void {
    if (this.xrMode || !this.mouseActive) return;

    // raycastPlaneをカメラに向ける
    this.raycastPlane.normal.set(0, 0, 1);
    this.raycastPlane.normal.applyEuler(this.camera.rotation);

    // raycasterでシーン座標を計算
    this.raycaster.setFromCamera(this.screenPointer, this.camera);
    this.raycaster.ray.intersectPlane(this.raycastPlane, this.scenePointer);
  }

  // 現在の生成ポイントを取得
  getSpawnPoints(): SpawnPoint[] {
    if (this.xrMode) {
      // XRモード: コントローラー位置
      return [
        { position: this.controllerPositions[0].clone(), active: this.controllerActive[0] },
        { position: this.controllerPositions[1].clone(), active: this.controllerActive[1] }
      ];
    } else {
      // 非XRモード: マウス位置
      return [
        { position: this.scenePointer.clone(), active: this.mouseActive }
      ];
    }
  }

  // リソース解放
  dispose(): void {
    if (this.element) {
      this.element.removeEventListener('pointermove', this.onPointerMoveBound);
      this.element.removeEventListener('pointerenter', this.onPointerEnterBound);
      this.element.removeEventListener('pointerleave', this.onPointerLeaveBound);
      this.element = null;
    }
  }
}
