import './types/webxr-webgpu.d.ts';
import { PerspectiveCamera, PostProcessing } from 'three/webgpu';
import { pass } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { WebGPUContext } from './core/WebGPUContext';
import { XRSessionManager } from './core/XRSessionManager';
import { RenderLoop } from './core/RenderLoop';
import { ThreeRenderer } from './renderer/ThreeRenderer';
import { XRBlitter } from './renderer/XRBlitter';
import { DemoScene } from './scene/DemoScene';
import { PointerManager } from './input/PointerManager';
import { debugLog } from './utils/debug';

// UI要素
const vrButton = document.getElementById('vr-button') as HTMLButtonElement;
const statusEl = document.getElementById('status') as HTMLDivElement;
const container = document.getElementById('canvas-container') as HTMLDivElement;

// 状態更新
function setStatus(message: string): void {
  statusEl.textContent = message;
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
  private pointerManager: PointerManager | null = null;
  private postProcessing: PostProcessing | null = null;

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
    debugLog('Support check:', support);

    if (!support.webgpu) {
      setStatus('WebGPU未サポート');
      return;
    }

    // XR互換GPUDeviceを先に作成
    await this.gpuContext.init({ xrCompatible: true });
    const device = this.gpuContext.device;
    if (!device) {
      setStatus('GPUDevice作成失敗');
      return;
    }
    debugLog('XR compatible GPU device created');

    // Three.js Renderer初期化（外部GPUDeviceを使用）
    this.threeRenderer = new ThreeRenderer({
      width: window.innerWidth,
      height: window.innerHeight,
      device  // XR互換デバイスを渡す
    });
    await this.threeRenderer.init();
    container.appendChild(this.threeRenderer.canvas);

    // XRSessionManagerにデバイスを設定
    this.xrManager.setDevice(device);

    // Blitter初期化
    this.blitter = new XRBlitter(device);

    // PointerManager初期化
    this.pointerManager = new PointerManager(this.threeRenderer.camera);
    this.pointerManager.setupMouseListeners(container);

    // PostProcessing初期化（ブルームエフェクト）
    this.setupPostProcessing();

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

  // PostProcessing初期化
  private setupPostProcessing(): void {
    if (!this.threeRenderer) return;

    const scenePass = pass(this.demoScene.scene, this.threeRenderer.camera);
    const scenePassColor = scenePass.getTextureNode('output');
    const bloomPass = bloom(scenePassColor, 0.75, 0.1, 0.5);

    this.postProcessing = new PostProcessing(this.threeRenderer.renderer);
    this.postProcessing.outputNode = scenePassColor.add(bloomPass);
  }

  // 非XRモードのレンダーループ
  private startNormalRenderLoop(): void {
    this.pointerManager?.setXRMode(false);

    this.renderLoop.start((time) => {
      // マウス位置更新
      this.pointerManager?.updateMousePosition();
      const points = this.pointerManager?.getSpawnPoints() ?? [];
      this.demoScene.setParticleSpawnPoints(points);

      // コンピュートシェーダー実行
      if (this.threeRenderer) {
        this.demoScene.compute(this.threeRenderer.renderer);
      }

      // シーン更新
      this.demoScene.update(time);

      // PostProcessingでレンダリング（ブルーム付き）
      this.postProcessing?.renderAsync();
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

    // XRモードに切り替え
    this.pointerManager?.setXRMode(true);
    this.demoScene.setXRMode(true);

    // ProjectionLayerサイズにcanvasをリサイズ
    const size = this.xrManager.getProjectionSize();
    if (size && this.threeRenderer) {
      this.threeRenderer.setXRSize(size.width, size.height);
    }

    // XRレンダーループに切り替え（コールバックも同時に指定）
    this.renderLoop.setXRSession(
      this.xrManager.session,
      (time, xrFrame) => this.xrRenderFrame(time, xrFrame!)
    );
  }

  // XRセッション終了時
  private onXRSessionEnd(): void {
    setStatus('VRセッション終了');
    vrButton.textContent = 'VR開始';

    // 非XRモードに戻す
    this.pointerManager?.setXRMode(false);
    this.demoScene.setXRMode(false);

    // 通常レンダーループに戻る
    this.renderLoop.setXRSession(null, (time) => {
      // マウス位置更新
      this.pointerManager?.updateMousePosition();
      const points = this.pointerManager?.getSpawnPoints() ?? [];
      this.demoScene.setParticleSpawnPoints(points);

      // コンピュートシェーダー実行
      if (this.threeRenderer) {
        this.demoScene.compute(this.threeRenderer.renderer);
      }

      // シーン更新
      this.demoScene.update(time);

      // PostProcessingでレンダリング
      this.postProcessing?.renderAsync();
    });
  }

  // XRフレームレンダリング
  private xrRenderFrame(time: number, xrFrame: XRFrame): void {
    const { xrGpuBinding, projectionLayer, refSpace } = this.xrManager;
    if (!xrGpuBinding || !projectionLayer || !refSpace) {
      console.warn('Missing XR resources:', { xrGpuBinding: !!xrGpuBinding, projectionLayer: !!projectionLayer, refSpace: !!refSpace });
      return;
    }
    if (!this.threeRenderer || !this.blitter) {
      console.warn('Missing renderer/blitter');
      return;
    }

    // コントローラー位置更新
    const inputSources = this.xrManager.inputSources;
    if (inputSources && this.pointerManager) {
      this.pointerManager.updateFromXRFrame(xrFrame, refSpace, inputSources);
    }
    const points = this.pointerManager?.getSpawnPoints() ?? [];
    this.demoScene.setParticleSpawnPoints(points);

    // コンピュートシェーダー実行（両眼描画前に1回）
    this.demoScene.compute(this.threeRenderer.renderer);

    // シーン更新
    this.demoScene.update(time);

    // ビューワーポーズ取得
    const pose = xrFrame.getViewerPose(refSpace);
    if (!pose) {
      console.warn('No viewer pose');
      return;
    }

    const commandEncoder = this.threeRenderer.getGPUDevice()!.createCommandEncoder();

    // 各ビューに対してレンダリング
    for (let i = 0; i < pose.views.length; i++) {
      const view = pose.views[i];

      // カメラ行列更新
      this.threeRenderer.updateCameraFromXRView(view, this.xrCamera);

      // RenderTargetに描画
      this.threeRenderer.renderForXR(this.demoScene.scene, this.xrCamera);

      // RenderTargetのGPUTextureを取得（キャッシュされたもの）
      const sourceTexture = this.threeRenderer.getRenderTargetGPUTexture();
      if (!sourceTexture) {
        console.warn('No RenderTarget GPUTexture');
        continue;
      }

      // XRProjectionLayerにコピー
      const subImage = xrGpuBinding.getViewSubImage(projectionLayer, view);
      this.blitter.blit(commandEncoder, sourceTexture, subImage, i);
    }

    // コマンドサブミット
    this.threeRenderer.getGPUDevice()!.queue.submit([commandEncoder.finish()]);
  }

  // リサイズ
  private onResize(): void {
    if (!this.xrManager.isSessionActive && this.threeRenderer) {
      this.threeRenderer.resize(window.innerWidth, window.innerHeight);

      // PostProcessing再構築
      this.setupPostProcessing();
    }
  }

  // 破棄
  dispose(): void {
    this.renderLoop.stop();
    this.xrManager.dispose();
    this.threeRenderer?.dispose();
    this.demoScene.dispose();
    this.gpuContext.dispose();
    this.pointerManager?.dispose();
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
