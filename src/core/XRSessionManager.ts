import '../types/webxr-webgpu.d.ts';
import { debugLog } from '../utils/debug';

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
    const colorFormat = this.xrGpuBinding.getPreferredColorFormat();
    debugLog('XR preferred color format:', colorFormat);

    // ProjectionLayerの作成
    this.projectionLayer = this.xrGpuBinding.createProjectionLayer({
      colorFormat,
      depthStencilFormat: 'depth24plus',
      textureUsage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_DST
    });

    // レンダーステートの更新（layersを使用）
    await this.session.updateRenderState({
      layers: [this.projectionLayer]
    });

    // リファレンススペースの取得（フォールバック付き）
    // local-floor: 床レベルを原点とする（推奨）
    // local: デバイス起動位置を原点とする（フォールバック）
    try {
      this.refSpace = await this.session.requestReferenceSpace('local-floor');
      debugLog('Using local-floor reference space');
    } catch {
      console.warn('local-floor not supported, falling back to local');
      this.refSpace = await this.session.requestReferenceSpace('local');
    }

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

  }

  // イベントリスナー登録
  on(event: XRSessionEventType, callback: XRSessionEventCallback): void {
    this.eventListeners.get(event)?.add(callback);
  }

  // イベントリスナー解除
  private emitEvent(event: XRSessionEventType, session: XRSession | null): void {
    this.eventListeners.get(event)?.forEach(callback => callback(session));
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
