import './types/webxr-webgpu.d.ts';
import { PerspectiveCamera } from 'three/webgpu';
import { WebGPUContext } from './core/WebGPUContext';
import { XRSessionManager } from './core/XRSessionManager';
import { RenderLoop } from './core/RenderLoop';
import { ThreeRenderer } from './renderer/ThreeRenderer';
import { XRBlitter } from './renderer/XRBlitter';
import { DemoScene } from './scene/DemoScene';

// UI要素
const vrButton = document.getElementById('vr-button') as HTMLButtonElement;
const statusEl = document.getElementById('status') as HTMLDivElement;
const container = document.getElementById('canvas-container') as HTMLDivElement;

// 状態更新
function setStatus(message: string): void {
  statusEl.textContent = message;
  console.log(message);
}

// メインアプリケーション
class App {
  private gpuContext: WebGPUContext;
  private xrManager: XRSessionManager;
  private renderLoop: RenderLoop;
  private threeRenderer: ThreeRenderer | null = null;
  private blitter: XRBlitter | null = null;
  private demoScene: DemoScene;
  private xrCamera: PerspectiveCamera;

  constructor() {
    this.gpuContext = new WebGPUContext();
    this.xrManager = new XRSessionManager();
    this.renderLoop = new RenderLoop();
    this.demoScene = new DemoScene();
    this.xrCamera = new PerspectiveCamera(70, 1, 0.1, 100);
  }

  async init(): Promise<void> {
    setStatus('WebGPU初期化中...');

    // サポートチェック
    const support = await WebGPUContext.checkSupport();
    console.log('Support check:', support);

    if (!support.webgpu) {
      setStatus('WebGPU未サポート');
      return;
    }

    // Three.js Renderer初期化（内部でGPUDeviceを作成）
    this.threeRenderer = new ThreeRenderer({
      width: window.innerWidth,
      height: window.innerHeight
    });
    await this.threeRenderer.init();
    container.appendChild(this.threeRenderer.canvas);

    // Three.jsのGPUDeviceを取得してXRに使用
    const device = this.threeRenderer.getGPUDevice();
    if (!device) {
      setStatus('GPUDevice取得失敗');
      return;
    }

    // XRSessionManagerにデバイスを設定
    this.xrManager.setDevice(device);

    // Blitter初期化
    this.blitter = new XRBlitter(device);

    // XRセッションイベント
    this.xrManager.on('sessionstart', () => this.onXRSessionStart());
    this.xrManager.on('sessionend', () => this.onXRSessionEnd());

    // リサイズハンドリング
    window.addEventListener('resize', () => this.onResize());

    // VRボタン
    if (support.webxr) {
      vrButton.disabled = false;
      vrButton.addEventListener('click', () => this.toggleVR());
      setStatus('準備完了 - VR開始可能');
    } else {
      setStatus('WebXR未サポート - 非XRモードのみ');
    }

    // レンダーループ開始（非XRモード）
    this.startNormalRenderLoop();
  }

  // 非XRモードのレンダーループ
  private startNormalRenderLoop(): void {
    this.renderLoop.start((time) => {
      this.demoScene.update(time);
      this.threeRenderer?.renderToCanvas(this.demoScene.scene);
    });
  }

  // VRトグル
  private async toggleVR(): Promise<void> {
    if (this.xrManager.isSessionActive) {
      await this.xrManager.endSession();
    } else {
      try {
        setStatus('VRセッション開始中...');
        await this.xrManager.requestSession();
      } catch (e) {
        console.error('VR session request failed:', e);
        setStatus(`VR開始失敗: ${(e as Error).message}`);
      }
    }
  }

  // XRセッション開始時
  private onXRSessionStart(): void {
    setStatus('VRセッションアクティブ');
    vrButton.textContent = 'VR終了';

    // ProjectionLayerサイズでRenderTarget作成
    const size = this.xrManager.getProjectionSize();
    if (size && this.threeRenderer) {
      this.threeRenderer.createRenderTarget(size.width, size.height);
    }

    // XRレンダーループに切り替え
    this.renderLoop.setXRSession(this.xrManager.session);
    this.renderLoop.start((time, xrFrame) => this.xrRenderFrame(time, xrFrame!));
  }

  // XRセッション終了時
  private onXRSessionEnd(): void {
    setStatus('VRセッション終了');
    vrButton.textContent = 'VR開始';

    // 通常レンダーループに戻る
    this.renderLoop.setXRSession(null);
    this.startNormalRenderLoop();
  }

  // XRフレームレンダリング
  private xrRenderFrame(time: number, xrFrame: XRFrame): void {
    const { xrGpuBinding, projectionLayer, refSpace } = this.xrManager;
    if (!xrGpuBinding || !projectionLayer || !refSpace) return;
    if (!this.threeRenderer || !this.blitter) return;

    // シーン更新
    this.demoScene.update(time);

    // ビューワーポーズ取得
    const pose = xrFrame.getViewerPose(refSpace);
    if (!pose) return;

    // 各ビューに対してレンダリング
    const sourceTexture = this.threeRenderer.getRenderTargetGPUTexture();
    if (!sourceTexture) return;

    const commandEncoder = this.threeRenderer.getGPUDevice()!.createCommandEncoder();

    for (const view of pose.views) {
      // カメラ行列更新
      this.threeRenderer.updateCameraFromXRView(view, this.xrCamera);

      // RenderTargetに描画
      this.threeRenderer.renderToTarget(this.demoScene.scene, this.xrCamera);

      // XRProjectionLayerにコピー
      const subImage = xrGpuBinding.getViewSubImage(projectionLayer, view);
      this.blitter.blit(commandEncoder, sourceTexture, subImage);
    }

    // コマンドサブミット
    this.threeRenderer.getGPUDevice()!.queue.submit([commandEncoder.finish()]);
  }

  // リサイズ
  private onResize(): void {
    if (!this.xrManager.isSessionActive && this.threeRenderer) {
      this.threeRenderer.resize(window.innerWidth, window.innerHeight);
    }
  }

  // 破棄
  dispose(): void {
    this.renderLoop.stop();
    this.xrManager.dispose();
    this.threeRenderer?.dispose();
    this.demoScene.dispose();
    this.gpuContext.dispose();
  }
}

// アプリ起動
const app = new App();
app.init().catch((e) => {
  console.error('App initialization failed:', e);
  setStatus(`初期化失敗: ${(e as Error).message}`);
});

// ページ離脱時のクリーンアップ
window.addEventListener('beforeunload', () => {
  app.dispose();
});
