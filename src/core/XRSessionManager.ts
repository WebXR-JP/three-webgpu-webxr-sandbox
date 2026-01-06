import '../types/webxr-webgpu.d.ts';

export type XRSessionEventType = 'sessionstart' | 'sessionend';
export type XRSessionEventCallback = (session: XRSession | null) => void;

// WebXRセッション管理クラス
export class XRSessionManager {
  session: XRSession | null = null;
  xrGpuBinding: XRGPUBinding | null = null;
  projectionLayer: XRProjectionLayer | null = null;
  refSpace: XRReferenceSpace | null = null;

  private device: GPUDevice | null = null;
  private eventListeners: Map<XRSessionEventType, Set<XRSessionEventCallback>> = new Map();
  private colorFormat: GPUTextureFormat = 'rgba8unorm';

  constructor() {
    this.eventListeners.set('sessionstart', new Set());
    this.eventListeners.set('sessionend', new Set());
  }

  // GPUDeviceの設定
  setDevice(device: GPUDevice): void {
    this.device = device;
  }

  // セッション開始
  async requestSession(): Promise<void> {
    if (!this.device) {
      throw new Error('GPU device not set. Call setDevice() first.');
    }

    if (!navigator.xr) {
      throw new Error('WebXR is not supported');
    }

    if (this.session) {
      console.warn('XR session already active');
      return;
    }

    // immersive-vrセッションをwebgpu機能付きでリクエスト
    this.session = await navigator.xr.requestSession('immersive-vr', {
      requiredFeatures: ['webgpu']
    });

    // セッション終了時のハンドリング
    this.session.addEventListener('end', () => {
      this.onSessionEnd();
    });

    // XRGPUBindingの作成
    this.xrGpuBinding = new XRGPUBinding(this.session, this.device);

    // 推奨カラーフォーマットの取得
    this.colorFormat = this.xrGpuBinding.getPreferredColorFormat();
    console.log('XR preferred color format:', this.colorFormat);

    // ProjectionLayerの作成
    this.projectionLayer = this.xrGpuBinding.createProjectionLayer({
      colorFormat: this.colorFormat,
      depthStencilFormat: 'depth24plus',
      textureUsage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_DST
    });

    // レンダーステートの更新（layersを使用）
    await this.session.updateRenderState({
      layers: [this.projectionLayer]
    });

    // リファレンススペースの取得
    this.refSpace = await this.session.requestReferenceSpace('local-floor');

    console.log('XR session started', {
      projectionLayer: this.projectionLayer,
      textureWidth: this.projectionLayer.textureWidth,
      textureHeight: this.projectionLayer.textureHeight
    });

    // イベント発火
    this.emitEvent('sessionstart', this.session);
  }

  // セッション終了
  async endSession(): Promise<void> {
    if (this.session) {
      await this.session.end();
    }
  }

  // セッション終了時の内部処理
  private onSessionEnd(): void {
    this.emitEvent('sessionend', null);

    this.session = null;
    this.xrGpuBinding = null;
    this.projectionLayer = null;
    this.refSpace = null;

    console.log('XR session ended');
  }

  // イベントリスナー登録
  on(event: XRSessionEventType, callback: XRSessionEventCallback): void {
    this.eventListeners.get(event)?.add(callback);
  }

  // イベントリスナー解除
  off(event: XRSessionEventType, callback: XRSessionEventCallback): void {
    this.eventListeners.get(event)?.delete(callback);
  }

  // イベント発火
  private emitEvent(event: XRSessionEventType, session: XRSession | null): void {
    this.eventListeners.get(event)?.forEach(callback => callback(session));
  }

  // カラーフォーマット取得
  getColorFormat(): GPUTextureFormat {
    return this.colorFormat;
  }

  // ProjectionLayerのサイズ取得
  getProjectionSize(): { width: number; height: number } | null {
    if (!this.projectionLayer) return null;
    return {
      width: this.projectionLayer.textureWidth,
      height: this.projectionLayer.textureHeight
    };
  }

  // セッションアクティブかどうか
  get isSessionActive(): boolean {
    return this.session !== null;
  }

  // リソース解放
  dispose(): void {
    if (this.session) {
      this.session.end().catch(console.error);
    }
    this.eventListeners.clear();
  }
}
