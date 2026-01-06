import '../types/webxr-webgpu.d.ts';
import { debugLog } from '../utils/debug';

export interface WebGPUContextOptions {
  xrCompatible?: boolean;
}

// WebGPU Adapter/Device管理クラス
export class WebGPUContext {
  device: GPUDevice | null = null;

  // 初期化
  async init(options: WebGPUContextOptions = {}): Promise<void> {
    const { xrCompatible = true } = options;

    // WebGPU対応チェック
    if (!navigator.gpu) {
      throw new Error('WebGPU is not supported in this browser');
    }

    // XR互換アダプタの取得
    const adapter = await navigator.gpu.requestAdapter({
      xrCompatible
    });

    if (!adapter) {
      throw new Error('Failed to get GPU adapter');
    }

    // デバイスの作成
    this.device = await adapter.requestDevice({
      requiredFeatures: [],
      requiredLimits: {}
    });

    if (!this.device) {
      throw new Error('Failed to get GPU device');
    }

    // デバイスロスト時のハンドリング
    this.device.lost.then((info) => {
      console.error('WebGPU device lost:', info.message);
      if (info.reason !== 'destroyed') {
        // 自動リカバリを試みる場合はここで再初期化
        debugLog('Attempting to recover...');
      }
    });
  }

  // リソース解放
  dispose(): void {
    if (this.device) {
      this.device.destroy();
      this.device = null;
    }
  }

  // WebXR + WebGPUサポートチェック
  static async checkSupport(): Promise<{
    webgpu: boolean;
    webxr: boolean;
  }> {
    const webgpu = !!navigator.gpu;
    const webxr = !!navigator.xr;
    return { webgpu, webxr };
  }
}
