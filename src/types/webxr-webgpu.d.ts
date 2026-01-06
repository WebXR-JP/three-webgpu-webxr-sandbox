// WebXR-WebGPU Binding API型定義
// https://github.com/nicatronTg/WebXR-WebGPU-Binding/blob/main/explainer.md

// XRGPUBinding - WebXRとWebGPUを接続するバインディング
interface XRGPUBinding {
  readonly device: GPUDevice;
  createProjectionLayer(options?: XRGPUProjectionLayerInit): XRProjectionLayer;
  getViewSubImage(layer: XRProjectionLayer, view: XRView): XRGPUSubImage;
  getPreferredColorFormat(): GPUTextureFormat;
}

interface XRGPUProjectionLayerInit {
  colorFormat?: GPUTextureFormat;
  depthStencilFormat?: GPUTextureFormat;
  textureUsage?: GPUTextureUsageFlags;
  scaleFactor?: number;
}

// XRGPUSubImage - 特定のビュー用のテクスチャサブイメージ
interface XRGPUSubImage {
  readonly colorTexture: GPUTexture;
  readonly depthStencilTexture: GPUTexture | null;
  readonly imageIndex: number;
  readonly viewport: XRViewport;
}

// XRProjectionLayer - XR投影レイヤー
interface XRProjectionLayer extends XRLayer {
  readonly textureWidth: number;
  readonly textureHeight: number;
  readonly textureArrayLength: number;
  readonly ignoreDepthValues: boolean;
  fixedFoveation?: number;
}

// XRGPUBindingコンストラクタ
declare var XRGPUBinding: {
  prototype: XRGPUBinding;
  new(session: XRSession, device: GPUDevice): XRGPUBinding;
};

// XRSession拡張（WebGPU対応）
interface XRSessionInit {
  requiredFeatures?: string[];
  optionalFeatures?: string[];
}

// XRSystemのrequestSession戻り値型を拡張
interface XRSystem {
  requestSession(mode: XRSessionMode, options?: XRSessionInit): Promise<XRSession>;
}

// GPURequestAdapterOptionsの拡張
interface GPURequestAdapterOptions {
  xrCompatible?: boolean;
}

// XRWebGLLayerへの型追加（既存との互換）
interface XRRenderStateInit {
  baseLayer?: XRWebGLLayer | null;
  layers?: XRLayer[];
}

// XRLayer基底型
interface XRLayer extends EventTarget {}

// XRViewport
interface XRViewport {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}
