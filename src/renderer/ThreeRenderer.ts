import {
  Scene,
  Camera,
  PerspectiveCamera,
  WebGPURenderer,
  RenderTarget,
  RGBAFormat,
  UnsignedByteType,
  Matrix4,
  Vector3,
  Quaternion
} from 'three/webgpu';

export interface ThreeRendererOptions {
  width: number;
  height: number;
  canvas?: HTMLCanvasElement;
  colorFormat?: GPUTextureFormat;
}

// Three.js WebGPURendererのラッパークラス
export class ThreeRenderer {
  renderer: WebGPURenderer;
  renderTarget: RenderTarget | null = null;
  camera: PerspectiveCamera;

  private width: number;
  private height: number;
  private colorFormat: GPUTextureFormat;
  private _initialized = false;

  constructor(options: ThreeRendererOptions) {
    const { width, height, canvas, colorFormat = 'rgba8unorm' } = options;

    this.width = width;
    this.height = height;
    this.colorFormat = colorFormat;

    // WebGPURendererの作成
    this.renderer = new WebGPURenderer({
      canvas,
      antialias: true,
      alpha: true
    });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(1);

    // デフォルトカメラ
    this.camera = new PerspectiveCamera(70, width / height, 0.1, 100);
    this.camera.position.set(0, 1.6, 3);
  }

  // 非同期初期化
  async init(): Promise<void> {
    await this.renderer.init();
    this._initialized = true;
    console.log('ThreeRenderer initialized');
  }

  // RenderTargetの作成（XR用）
  createRenderTarget(width: number, height: number): void {
    // 既存のRenderTargetがあれば破棄
    if (this.renderTarget) {
      this.renderTarget.dispose();
    }

    // RenderTargetの作成
    // フォーマットをXRProjectionLayerと一致させる
    this.renderTarget = new RenderTarget(width, height, {
      format: RGBAFormat,
      type: UnsignedByteType,
      depthBuffer: true,
      stencilBuffer: false,
      samples: 1
    });

    console.log('RenderTarget created', { width, height });
  }

  // シーンをcanvasに直接描画（非XRモード）
  renderToCanvas(scene: Scene, camera?: Camera): void {
    if (!this._initialized) {
      console.warn('Renderer not initialized');
      return;
    }

    this.renderer.setRenderTarget(null);
    this.renderer.render(scene, camera || this.camera);
  }

  // シーンをRenderTargetに描画（XRモード）
  renderToTarget(scene: Scene, camera: Camera): void {
    if (!this._initialized) {
      console.warn('Renderer not initialized');
      return;
    }

    if (!this.renderTarget) {
      console.warn('RenderTarget not created');
      return;
    }

    this.renderer.setRenderTarget(this.renderTarget);
    this.renderer.render(scene, camera);
    this.renderer.setRenderTarget(null);
  }

  // XRViewからカメラ行列を更新
  updateCameraFromXRView(view: XRView, camera: PerspectiveCamera): void {
    // プロジェクション行列
    camera.projectionMatrix.fromArray(view.projectionMatrix);
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();

    // ビュー行列（逆行列からワールド行列を取得）
    const viewMatrix = new Matrix4().fromArray(view.transform.inverse.matrix);
    camera.matrixWorldInverse.copy(viewMatrix);
    camera.matrixWorld.copy(viewMatrix).invert();

    // position, quaternionを行列から抽出
    const position = new Vector3();
    const quaternion = new Quaternion();
    const scale = new Vector3();
    camera.matrixWorld.decompose(position, quaternion, scale);
    camera.position.copy(position);
    camera.quaternion.copy(quaternion);
  }

  // 内部GPUTextureの取得（RenderTargetから）
  // 注意: これはThree.jsの内部APIに依存
  getRenderTargetGPUTexture(): GPUTexture | null {
    if (!this.renderTarget || !this._initialized) return null;

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const backend = (this.renderer as any).backend;
      if (!backend) return null;

      const textureData = backend.get(this.renderTarget.texture);
      return textureData?.texture || null;
    } catch (e) {
      console.error('Failed to get GPUTexture from RenderTarget:', e);
      return null;
    }
  }

  // GPUDeviceの取得
  getGPUDevice(): GPUDevice | null {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const backend = (this.renderer as any).backend;
      return backend?.device || null;
    } catch {
      return null;
    }
  }

  // リサイズ
  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.renderer.setSize(width, height);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  // 初期化済みかどうか
  get initialized(): boolean {
    return this._initialized;
  }

  // canvasの取得
  get canvas(): HTMLCanvasElement {
    return this.renderer.domElement;
  }

  // リソース解放
  dispose(): void {
    if (this.renderTarget) {
      this.renderTarget.dispose();
      this.renderTarget = null;
    }
    this.renderer.dispose();
    console.log('ThreeRenderer disposed');
  }
}
