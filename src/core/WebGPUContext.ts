import '../types/webxr-webgpu.d.ts';

export interface WebGPUContextOptions {
  xrCompatible?: boolean;
}

// WebGPU Adapter/Device管理クラス
export class WebGPUContext {
  adapter: GPUAdapter | null = null;
  device: GPUDevice | null = null;
  private _xrCompatible = false;

  get xrCompatible(): boolean {
    return this._xrCompatible;
  }

  // 初期化
  async init(options: WebGPUContextOptions = {}): Promise<void> {
    const { xrCompatible = true } = options;

    // WebGPU対応チェック
    if (!navigator.gpu) {
      throw new Error('WebGPU is not supported in this browser');
    }

    // XR互換アダプタの取得
    this.adapter = await navigator.gpu.requestAdapter({
      xrCompatible
    });

    if (!this.adapter) {
      throw new Error('Failed to get GPU adapter');
    }

    // デバイスの作成
    this.device = await this.adapter.requestDevice({
      requiredFeatures: [],
      requiredLimits: {}
    });

    if (!this.device) {
      throw new Error('Failed to get GPU device');
    }

    this._xrCompatible = xrCompatible;

    // デバイスロスト時のハンドリング
    this.device.lost.then((info) => {
      console.error('WebGPU device lost:', info.message);
      if (info.reason !== 'destroyed') {
        // 自動リカバリを試みる場合はここで再初期化
        console.log('Attempting to recover...');
      }
    });

    console.log('WebGPU context initialized', {
      xrCompatible: this._xrCompatible,
      adapter: this.adapter,
      device: this.device
    });
  }

  // リソース解放
  dispose(): void {
    if (this.device) {
      this.device.destroy();
      this.device = null;
    }
    this.adapter = null;
    console.log('WebGPU context disposed');
  }

  // WebXR + WebGPUサポートチェック
  static async checkSupport(): Promise<{
    webgpu: boolean;
    webxr: boolean;
    webxrWebgpu: boolean;
  }> {
    const webgpu = !!navigator.gpu;
    const webxr = !!navigator.xr;

    let webxrWebgpu = false;
    if (webxr) {
      try {
        // immersive-vrセッションとwebgpu機能のサポートチェック
        const supported = await navigator.xr!.isSessionSupported('immersive-vr');
        webxrWebgpu = supported && webgpu;
      } catch {
        webxrWebgpu = false;
      }
    }

    return { webgpu, webxr, webxrWebgpu };
  }
}
