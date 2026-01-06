import '../types/webxr-webgpu.d.ts';

// RenderTargetからXRProjectionLayerへのテクスチャコピー
export class XRBlitter {
  private device: GPUDevice;

  constructor(device: GPUDevice) {
    this.device = device;
  }

  // テクスチャコピー実行
  // sourceTexture: Three.js RenderTargetから取得したGPUTexture
  // xrSubImage: XRGPUBinding.getViewSubImage()で取得したサブイメージ
  blit(
    commandEncoder: GPUCommandEncoder,
    sourceTexture: GPUTexture,
    xrSubImage: XRGPUSubImage
  ): void {
    const { colorTexture, viewport, imageIndex } = xrSubImage;

    // コピー元（Three.js RenderTarget）
    const source: GPUImageCopyTexture = {
      texture: sourceTexture,
      mipLevel: 0,
      origin: { x: 0, y: 0, z: 0 }
    };

    // コピー先（XRProjectionLayerのサブイメージ）
    // imageIndexはテクスチャ配列のインデックス（左右眼でarray layerが異なる場合）
    const destination: GPUImageCopyTexture = {
      texture: colorTexture,
      mipLevel: 0,
      origin: { x: viewport.x, y: viewport.y, z: imageIndex }
    };

    // コピーサイズ
    const copySize: GPUExtent3DStrict = {
      width: Math.min(viewport.width, sourceTexture.width),
      height: Math.min(viewport.height, sourceTexture.height),
      depthOrArrayLayers: 1
    };

    // テクスチャコピー実行
    commandEncoder.copyTextureToTexture(source, destination, copySize);
  }

  // フルフレームブリット（両眼分をまとめて処理）
  blitFrame(
    sourceTexture: GPUTexture,
    xrGpuBinding: XRGPUBinding,
    projectionLayer: XRProjectionLayer,
    views: readonly XRView[],
    renderEyeCallback: (view: XRView, viewIndex: number) => void
  ): void {
    const commandEncoder = this.device.createCommandEncoder();

    for (let i = 0; i < views.length; i++) {
      const view = views[i];

      // 各ビュー用のレンダリングコールバック
      // （カメラ更新とRenderTargetへの描画を行う）
      renderEyeCallback(view, i);

      // XRSubImageの取得
      const subImage = xrGpuBinding.getViewSubImage(projectionLayer, view);

      // テクスチャコピー
      this.blit(commandEncoder, sourceTexture, subImage);
    }

    // コマンドバッファのサブミット
    this.device.queue.submit([commandEncoder.finish()]);
  }

  // GPUDevice更新
  setDevice(device: GPUDevice): void {
    this.device = device;
  }
}
