import '../types/webxr-webgpu.d.ts';

// フルスクリーンクアッドシェーダー（RGBA→BGRA変換対応）
const BLIT_SHADER = /* wgsl */`
struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) texCoord: vec2f,
}

@vertex
fn vertexMain(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
  // フルスクリーンクアッド（2三角形で構成）
  var positions = array<vec2f, 6>(
    vec2f(-1.0, -1.0),
    vec2f( 1.0, -1.0),
    vec2f(-1.0,  1.0),
    vec2f(-1.0,  1.0),
    vec2f( 1.0, -1.0),
    vec2f( 1.0,  1.0)
  );

  var texCoords = array<vec2f, 6>(
    vec2f(0.0, 1.0),
    vec2f(1.0, 1.0),
    vec2f(0.0, 0.0),
    vec2f(0.0, 0.0),
    vec2f(1.0, 1.0),
    vec2f(1.0, 0.0)
  );

  var output: VertexOutput;
  output.position = vec4f(positions[vertexIndex], 0.0, 1.0);
  output.texCoord = texCoords[vertexIndex];
  return output;
}

@group(0) @binding(0) var sourceTexture: texture_2d<f32>;
@group(0) @binding(1) var sourceSampler: sampler;

@fragment
fn fragmentMain(@location(0) texCoord: vec2f) -> @location(0) vec4f {
  let color = textureSample(sourceTexture, sourceSampler, texCoord);
  // RGBA→BGRA変換（RとBをスワップ）
  return vec4f(color.b, color.g, color.r, color.a);
}
`;

// RenderTargetからXRProjectionLayerへのテクスチャコピー（シェーダーブリット方式）
export class XRBlitter {
  private device: GPUDevice;
  private pipeline: GPURenderPipeline | null = null;
  private sampler: GPUSampler | null = null;
  private pipelineCache: Map<string, GPURenderPipeline> = new Map();

  constructor(device: GPUDevice) {
    this.device = device;
    this.initPipeline();
  }

  // パイプライン初期化
  private initPipeline(): void {
    this.sampler = this.device.createSampler({
      magFilter: 'linear',
      minFilter: 'linear'
    });
  }

  // フォーマットに応じたパイプラインを取得（キャッシュ）
  private getPipeline(targetFormat: GPUTextureFormat): GPURenderPipeline {
    const cached = this.pipelineCache.get(targetFormat);
    if (cached) return cached;

    const shaderModule = this.device.createShaderModule({
      code: BLIT_SHADER
    });

    const pipeline = this.device.createRenderPipeline({
      layout: 'auto',
      vertex: {
        module: shaderModule,
        entryPoint: 'vertexMain'
      },
      fragment: {
        module: shaderModule,
        entryPoint: 'fragmentMain',
        targets: [{ format: targetFormat }]
      },
      primitive: {
        topology: 'triangle-list'
      }
    });

    this.pipelineCache.set(targetFormat, pipeline);
    return pipeline;
  }

  // シェーダーブリット実行
  // eyeIndex: 左目=0, 右目=1（imageIndexがundefinedの場合に使用）
  blit(
    commandEncoder: GPUCommandEncoder,
    sourceTexture: GPUTexture,
    xrSubImage: XRGPUSubImage,
    shouldLog = false,
    eyeIndex = 0
  ): void {
    const { colorTexture, viewport, imageIndex } = xrSubImage;
    // imageIndexが未定義の場合はeyeIndexを使用
    const layerIndex = imageIndex ?? eyeIndex;

    if (shouldLog) {
      console.log('Blit details:', {
        source: {
          format: sourceTexture.format,
          width: sourceTexture.width,
          height: sourceTexture.height
        },
        dest: {
          format: colorTexture.format,
          width: colorTexture.width,
          height: colorTexture.height
        },
        viewport,
        imageIndex,
        layerIndex
      });
    }

    // パイプライン取得
    const pipeline = this.getPipeline(colorTexture.format);

    // ソーステクスチャのビュー
    const sourceView = sourceTexture.createView();

    // デスティネーションテクスチャのビュー（配列レイヤー指定）
    const destView = colorTexture.createView({
      dimension: '2d',
      baseArrayLayer: layerIndex,
      arrayLayerCount: 1
    });

    // バインドグループ作成
    const bindGroup = this.device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: sourceView },
        { binding: 1, resource: this.sampler! }
      ]
    });

    // レンダーパス
    const renderPass = commandEncoder.beginRenderPass({
      colorAttachments: [{
        view: destView,
        loadOp: 'clear',
        storeOp: 'store',
        clearValue: { r: 0, g: 0, b: 0, a: 1 }
      }]
    });

    renderPass.setPipeline(pipeline);
    renderPass.setBindGroup(0, bindGroup);
    renderPass.setViewport(
      viewport.x,
      viewport.y,
      viewport.width,
      viewport.height,
      0,
      1
    );
    renderPass.draw(6); // フルスクリーンクアッド
    renderPass.end();
  }

  // GPUDevice更新
  setDevice(device: GPUDevice): void {
    this.device = device;
    this.pipelineCache.clear();
    this.initPipeline();
  }
}
