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
  device?: GPUDevice;  // 外部GPUDeviceを渡す場合
}

// Three.js WebGPURendererのラッパークラス
export class ThreeRenderer {
  renderer: WebGPURenderer;
  renderTarget: RenderTarget | null = null;
  camera: PerspectiveCamera;

  private width: number;
  private height: number;
  private _initialized = false;

  constructor(options: ThreeRendererOptions) {
    const { width, height, canvas, device } = options;

    this.width = width;
    this.height = height;

    // WebGPURendererの作成
    // deviceパラメータはWebGPUBackendに渡される
    this.renderer = new WebGPURenderer({
      canvas,
      antialias: true,
      alpha: true,
      device  // XR互換デバイスを渡す
    } as ConstructorParameters<typeof WebGPURenderer>[0]);
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
    console.log('ThreeRenderer initialized', {
      device: this.getGPUDevice()
    });
  }

  // RenderTargetのGPUTextureをキャッシュ
  private cachedGPUTexture: GPUTexture | null = null;
  private renderTargetInitialized = false;

  // RenderTargetの作成（XR用）
  // Three.jsのライフタイム管理でRenderTargetを作成
  createRenderTarget(width: number, height: number): void {
    // 既存のRenderTargetがあれば破棄
    if (this.renderTarget) {
      this.renderTarget.dispose();
    }
    this.cachedGPUTexture = null;
    this.renderTargetInitialized = false;

    // Three.jsのRenderTargetを作成
    this.renderTarget = new RenderTarget(width, height, {
      format: RGBAFormat,
      type: UnsignedByteType,
      depthBuffer: true,
      stencilBuffer: false,
      samples: 1
    });

    console.log('RenderTarget created', { width, height });
  }

  // RenderTargetを初期化（一度描画してGPUTextureを作成させる）
  initializeRenderTarget(scene: Scene, camera: Camera): void {
    if (!this.renderTarget || this.renderTargetInitialized) return;

    // 一度描画してThree.jsにGPUTextureを作成させる
    this.renderer.setRenderTarget(this.renderTarget);
    this.renderer.render(scene, camera);
    this.renderer.setRenderTarget(null);

    // GPUTextureを取得してキャッシュ
    this.cachedGPUTexture = this.extractGPUTexture();
    this.renderTargetInitialized = true;

    console.log('RenderTarget initialized, GPUTexture cached:', this.cachedGPUTexture);
  }

  // backendからGPUTextureを抽出
  private extractGPUTexture(): GPUTexture | null {
    if (!this.renderTarget) return null;

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const backend = (this.renderer as any).backend;
      if (!backend) return null;

      const textureData = backend.get(this.renderTarget.texture);
      console.log('Extracted textureData:', textureData);

      // Three.jsのWebGPUBackendでは texture プロパティにGPUTextureが格納される
      return textureData?.texture || null;
    } catch (e) {
      console.error('Failed to extract GPUTexture:', e);
      return null;
    }
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

  // GPUTextureの取得（キャッシュされたRenderTargetテクスチャ）
  getRenderTargetGPUTexture(): GPUTexture | null {
    return this.cachedGPUTexture;
  }

  // XRモード用のサイズ設定（RenderTargetも作成）
  setXRSize(width: number, height: number): void {
    this.createRenderTarget(width, height);
  }

  // XR用レンダリング（RenderTargetに描画）
  renderForXR(scene: Scene, camera: Camera): void {
    if (!this._initialized) {
      console.warn('Renderer not initialized');
      return;
    }

    if (!this.renderTarget) {
      console.warn('RenderTarget not created');
      return;
    }

    // 初回は初期化してGPUTextureをキャッシュ
    if (!this.renderTargetInitialized) {
      this.initializeRenderTarget(scene, camera);
    } else {
      // 通常のRenderTarget描画
      this.renderer.setRenderTarget(this.renderTarget);
      this.renderer.render(scene, camera);
      this.renderer.setRenderTarget(null);
    }
  }

  // CanvasのGPUTexture取得（フォールバック用）
  getCanvasTexture(): GPUTexture | null {
    try {
      const context = this.renderer.domElement.getContext('webgpu') as GPUCanvasContext;
      return context?.getCurrentTexture() || null;
    } catch {
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
