/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  Group,
  Vector3,
  PlaneGeometry,
  BufferGeometry,
  Mesh,
  InstancedMesh,
  SpriteNodeMaterial,
  MeshBasicNodeMaterial,
  AdditiveBlending,
  DoubleSide,
  StorageInstancedBufferAttribute,
  StorageBufferAttribute,
  DynamicDrawUsage,
  WebGPURenderer
} from 'three/webgpu';
import {
  Fn,
  float,
  vec2,
  vec3,
  color,
  uniform,
  storage,
  instanceIndex,
  deltaTime,
  time,
  uv,
  step,
  hash,
  Loop,
  If,
  atan,
  sin,
  cos,
  max,
  min,
  mix,
  PI,
  mx_fractal_noise_vec3,
  mx_fractal_noise_float,
  pcurve,
  hue
} from 'three/tsl';

// TWO_PIはTSLに存在しない場合があるので自前で定義
const TWO_PI = float(Math.PI * 2);

export interface LinkedParticlesOptions {
  nbParticles?: number;
  particleLifetime?: number;
  nbToSpawn?: number;
  colorHueOffset?: number; // 色相オフセット（両手で色を変える用）
}

// ランタイム変更可能なパラメータセット
export interface ParticleParams {
  particleLifetime?: number;
  turbFrequency?: number;
  turbAmplitude?: number;
  turbFriction?: number;
  colorVariance?: number;
  colorRotationSpeed?: number;
  // 初速度バイアス（射出方向のオフセット）
  velocityBias?: { x: number; y: number; z: number };
  // 表示サイズ
  particleSize?: number;
  linksWidth?: number;
}

// TSLベースのリンクドパーティクルシステム
export class LinkedParticles {
  group: Group;

  // パブリックuniform（外部からアクセス可能）
  spawnPosition: ReturnType<typeof uniform>;
  previousSpawnPosition: ReturnType<typeof uniform>;
  spawnEnabled: ReturnType<typeof uniform>;

  private nbParticles: number;
  private nbToSpawn: number;
  private particleLifetime: ReturnType<typeof uniform>;

  // ストレージバッファ
  private particlePositionsSBA: StorageInstancedBufferAttribute;
  private particleVelocitiesSBA: StorageInstancedBufferAttribute;
  private linksVerticesSBA: StorageBufferAttribute;
  private linksColorsSBA: StorageBufferAttribute;

  // メッシュ
  private particleMesh: InstancedMesh;
  private linksMesh: Mesh;

  // コンピュートシェーダー
  private initCompute: any;
  private spawnCompute: any;
  private updateCompute: any;

  // 内部状態
  private spawnIndex: ReturnType<typeof uniform>;
  private colorOffset: ReturnType<typeof uniform>;
  private initialized = false;

  // 乱流パラメータ
  private turbFrequency: ReturnType<typeof uniform>;
  private turbOctaves: number;
  private turbLacunarity: number;
  private turbGain: number;
  private turbAmplitude: ReturnType<typeof uniform>;
  private turbFriction: ReturnType<typeof uniform>;

  // 色相回転速度
  private _colorRotationSpeed: number;

  // 初速度バイアス
  private velocityBiasX: ReturnType<typeof uniform>;
  private velocityBiasY: ReturnType<typeof uniform>;
  private velocityBiasZ: ReturnType<typeof uniform>;

  // 表示サイズ
  private particleSize: ReturnType<typeof uniform>;
  private linksWidth: ReturnType<typeof uniform>;

  constructor(options: LinkedParticlesOptions = {}) {
    this.nbParticles = options.nbParticles ?? 8192;
    this.nbToSpawn = options.nbToSpawn ?? 20;

    this.group = new Group();

    // Uniforms
    this.spawnPosition = uniform(new Vector3(0, 1.5, -1));
    this.previousSpawnPosition = uniform(new Vector3(0, 1.5, -1));
    this.spawnIndex = uniform(0);
    this.spawnEnabled = uniform(0); // 1=有効, 0=無効（デフォルト無効）
    this.particleLifetime = uniform(options.particleLifetime ?? 0.5);
    this.colorOffset = uniform(options.colorHueOffset ?? 0);

    // 乱流パラメータ（スクリーンショットの値）
    this.turbFrequency = uniform(0.5);
    this.turbOctaves = 2;
    this.turbLacunarity = 2.0;
    this.turbGain = 0.5;
    this.turbAmplitude = uniform(0.5);
    this.turbFriction = uniform(0.01);

    // 色のばらつき
    this.colorVariance = uniform(2.0);

    // 色相回転速度（外部から変更可能）
    this._colorRotationSpeed = 1.0;

    // 初速度バイアス（デフォルト: なし）
    this.velocityBiasX = uniform(0.0);
    this.velocityBiasY = uniform(0.0);
    this.velocityBiasZ = uniform(0.0);

    // 表示サイズ
    this.particleSize = uniform(1.0);
    this.linksWidth = uniform(0.005);

    // ストレージバッファ作成
    this.particlePositionsSBA = new StorageInstancedBufferAttribute(
      new Float32Array(this.nbParticles * 4),
      4
    );
    this.particleVelocitiesSBA = new StorageInstancedBufferAttribute(
      new Float32Array(this.nbParticles * 4),
      4
    );

    // リンク用バッファ（各パーティクルに8頂点: 2本のリンク × 4頂点）
    const nbVertices = this.nbParticles * 8;
    this.linksVerticesSBA = new StorageBufferAttribute(new Float32Array(nbVertices * 4), 4);
    this.linksColorsSBA = new StorageBufferAttribute(new Float32Array(nbVertices * 4), 4);

    // コンピュートシェーダー作成
    this.initCompute = this.createInitCompute();
    this.spawnCompute = this.createSpawnCompute();
    this.updateCompute = this.createUpdateCompute();

    // メッシュ作成
    this.particleMesh = this.createParticleMesh();
    this.linksMesh = this.createLinksMesh();

    this.group.add(this.particleMesh);
    this.group.add(this.linksMesh);
  }

  // 色のばらつき（0.3=元サンプル相当、0.5~0.8=より強いばらつき）
  private colorVariance: ReturnType<typeof uniform>;

  // 色生成関数（インスタンス間で共有）
  // hue(baseColor, offset): baseColorの色相をoffset分回転
  private getInstanceColor = Fn(([index]: [any]) => {
    const hueOffset = this.colorOffset.add(
      mx_fractal_noise_float(index.toFloat().mul(0.1), 2, 2.0, 0.5, this.colorVariance)
    );
    return hue(color(0x0000ff), hueOffset);
  });

  // 初期化コンピュート（全パーティクルを非表示に）
  private createInitCompute(): any {
    const particlePositions = storage(this.particlePositionsSBA, 'vec4', this.nbParticles);

    const initFn = (Fn as any)(() => {
      particlePositions.element(instanceIndex).xyz.assign(vec3(10000.0));
      particlePositions.element(instanceIndex).w.assign(float(-1.0));
    });
    return initFn().compute(this.nbParticles);
  }

  // スポーンコンピュート
  private createSpawnCompute(): any {
    const particlePositions = storage(this.particlePositionsSBA, 'vec4', this.nbParticles);
    const particleVelocities = storage(this.particleVelocitiesSBA, 'vec4', this.nbParticles);

    const spawnFn = (Fn as any)(() => {
      // スポーン有効時のみ実行
      If(this.spawnEnabled.greaterThanEqual(0.5), () => {
        const particleIndex = this.spawnIndex.add(instanceIndex).mod(this.nbParticles).toInt();
        const position = particlePositions.element(particleIndex).xyz;
        const life = particlePositions.element(particleIndex).w;
        const velocity = particleVelocities.element(particleIndex).xyz;

        life.assign(1.0);

        // ランダム方向（球面上）
        const rRange = float(0.01);
        const rTheta = hash(particleIndex).mul(TWO_PI);
        const rPhi = hash(particleIndex.add(1)).mul(PI);
        const rx = sin(rTheta).mul(cos(rPhi));
        const ry = sin(rTheta).mul(sin(rPhi));
        const rz = cos(rTheta);
        const rDir = vec3(rx, ry, rz);

        // 前回位置と現在位置を補間してスポーン
        const t = instanceIndex.toFloat().div(float(this.nbToSpawn - 1)).clamp();
        const pos = mix(this.previousSpawnPosition, this.spawnPosition, t);
        position.assign(pos.add(rDir.mul(rRange)));

        // 初速度 = ランダム方向 + バイアス
        const bias = vec3(this.velocityBiasX, this.velocityBiasY, this.velocityBiasZ);
        velocity.assign(rDir.mul(5.0).add(bias));
      });
    });
    return spawnFn().compute(this.nbToSpawn);
  }

  // 更新コンピュート
  private createUpdateCompute(): any {
    const particlePositions = storage(this.particlePositionsSBA, 'vec4', this.nbParticles);
    const particleVelocities = storage(this.particleVelocitiesSBA, 'vec4', this.nbParticles);
    const linksPositions = storage(this.linksVerticesSBA, 'vec4', this.linksVerticesSBA.count);
    const linksColors = storage(this.linksColorsSBA, 'vec4', this.linksColorsSBA.count);

    const timeScale = uniform(1.0);

    const updateFn = (Fn as any)(() => {
      const position = particlePositions.element(instanceIndex).xyz;
      const life = particlePositions.element(instanceIndex).w;
      const velocity = particleVelocities.element(instanceIndex).xyz;
      const dt = deltaTime.mul(0.1).mul(timeScale);

      If(life.greaterThan(0.0), () => {
        // 乱流速度
        const localVel = mx_fractal_noise_vec3(
          position.mul(this.turbFrequency),
          this.turbOctaves,
          this.turbLacunarity,
          this.turbGain,
          this.turbAmplitude
        ).mul(life.add(0.01));

        velocity.addAssign(localVel);
        velocity.mulAssign(this.turbFriction.oneMinus());
        position.addAssign(velocity.mul(dt));
        life.subAssign(dt.mul(this.particleLifetime.reciprocal()));

        // 最近接パーティクル探索（2つ）
        const closestDist1 = float(10000.0).toVar();
        const closestPos1 = vec3(0.0).toVar();
        const closestLife1 = float(0.0).toVar();
        const closestDist2 = float(10000.0).toVar();
        const closestPos2 = vec3(0.0).toVar();
        const closestLife2 = float(0.0).toVar();

        Loop(this.nbParticles, ({ i }: { i: any }) => {
          const otherPart = particlePositions.element(i);
          If((i as any).notEqual(instanceIndex).and(otherPart.w.greaterThan(0.0)), () => {
            const otherPosition = otherPart.xyz;
            const dist = position.sub(otherPosition).lengthSq();
            const moreThanZero = dist.greaterThan(0.0);

            If(dist.lessThan(closestDist1).and(moreThanZero), () => {
              closestDist2.assign(closestDist1);
              closestPos2.assign(closestPos1);
              closestLife2.assign(closestLife1);
              closestDist1.assign(dist);
              closestPos1.assign(otherPosition);
              closestLife1.assign(otherPart.w);
            }).ElseIf(dist.lessThan(closestDist2).and(moreThanZero), () => {
              closestDist2.assign(dist);
              closestPos2.assign(otherPosition);
              closestLife2.assign(otherPart.w);
            });
          });
        });

        // リンク頂点の更新
        const firstLinkIndex = instanceIndex.mul(8);
        const secondLinkIndex = firstLinkIndex.add(4);

        // リンク1の4頂点
        linksPositions.element(firstLinkIndex).xyz.assign(position);
        linksPositions.element(firstLinkIndex).y.addAssign(this.linksWidth);
        linksPositions.element(firstLinkIndex.add(1)).xyz.assign(position);
        linksPositions.element(firstLinkIndex.add(1)).y.addAssign(this.linksWidth.negate());
        linksPositions.element(firstLinkIndex.add(2)).xyz.assign(closestPos1);
        linksPositions.element(firstLinkIndex.add(2)).y.addAssign(this.linksWidth.negate());
        linksPositions.element(firstLinkIndex.add(3)).xyz.assign(closestPos1);
        linksPositions.element(firstLinkIndex.add(3)).y.addAssign(this.linksWidth);

        // リンク2の4頂点
        linksPositions.element(secondLinkIndex).xyz.assign(position);
        linksPositions.element(secondLinkIndex).y.addAssign(this.linksWidth);
        linksPositions.element(secondLinkIndex.add(1)).xyz.assign(position);
        linksPositions.element(secondLinkIndex.add(1)).y.addAssign(this.linksWidth.negate());
        linksPositions.element(secondLinkIndex.add(2)).xyz.assign(closestPos2);
        linksPositions.element(secondLinkIndex.add(2)).y.addAssign(this.linksWidth.negate());
        linksPositions.element(secondLinkIndex.add(3)).xyz.assign(closestPos2);
        linksPositions.element(secondLinkIndex.add(3)).y.addAssign(this.linksWidth);

        // リンク色
        const linkColor = this.getInstanceColor(instanceIndex);
        const l1 = max(0.0, min(closestLife1, life)).pow(0.8);
        const l2 = max(0.0, min(closestLife2, life)).pow(0.8);

        Loop(4, ({ i }: { i: any }) => {
          linksColors.element(firstLinkIndex.add(i)).xyz.assign(linkColor);
          linksColors.element(firstLinkIndex.add(i)).w.assign(l1);
          linksColors.element(secondLinkIndex.add(i)).xyz.assign(linkColor);
          linksColors.element(secondLinkIndex.add(i)).w.assign(l2);
        });
      });
    });
    return updateFn().compute(this.nbParticles);
  }

  // パーティクルメッシュ作成
  private createParticleMesh(): InstancedMesh {
    const particlePositions = storage(this.particlePositionsSBA, 'vec4', this.nbParticles);
    const particleVelocities = storage(this.particleVelocitiesSBA, 'vec4', this.nbParticles);

    // パーティクルサイズ
    const particleQuadSize = 0.05;
    const geometry = new PlaneGeometry(particleQuadSize, particleQuadSize);

    const material = new SpriteNodeMaterial();
    material.blending = AdditiveBlending;
    material.depthWrite = false;
    material.positionNode = (particlePositions as any).toAttribute();
    material.scaleNode = vec2(this.particleSize);
    // atan2相当: y/xの角度
    const velAttr = (particleVelocities as any).toAttribute();
    material.rotationNode = (atan as any)(velAttr.y, velAttr.x);

    // 色: パルスアニメーション付き
    material.colorNode = Fn(() => {
      const life = (particlePositions as any).toAttribute().w;
      const modLife = pcurve(life.oneMinus(), 8.0, 1.0);
      const pulse = pcurve(
        sin(hash(instanceIndex).mul(TWO_PI).add(time.mul(0.5).mul(TWO_PI))).mul(0.5).add(0.5),
        0.25,
        0.25
      ).mul(10.0).add(1.0);
      return this.getInstanceColor(instanceIndex).mul(pulse.mul(modLife));
    })();

    // 不透明度: 円形マスク + life
    material.opacityNode = Fn(() => {
      const circle = step(uv().xy.sub(0.5).length(), 0.5);
      const life = (particlePositions as any).toAttribute().w;
      return circle.mul(life);
    })();

    const mesh = new InstancedMesh(geometry, material, this.nbParticles);
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    mesh.frustumCulled = false;
    return mesh;
  }

  // リンクメッシュ作成
  private createLinksMesh(): Mesh {
    const linksColors = storage(this.linksColorsSBA, 'vec4', this.linksColorsSBA.count);

    // インデックス配列（各パーティクルに2つのクワッド）
    const linksIndices: number[] = [];
    for (let i = 0; i < this.nbParticles; i++) {
      const baseIndex = i * 8;
      for (let j = 0; j < 2; j++) {
        const offset = baseIndex + j * 4;
        linksIndices.push(offset, offset + 1, offset + 2, offset, offset + 2, offset + 3);
      }
    }

    const geometry = new BufferGeometry();
    geometry.setAttribute('position', this.linksVerticesSBA);
    geometry.setAttribute('color', this.linksColorsSBA);
    geometry.setIndex(linksIndices);

    const material = new MeshBasicNodeMaterial();
    material.vertexColors = true;
    material.side = DoubleSide;
    material.transparent = true;
    material.depthWrite = false;
    material.depthTest = false;
    material.blending = AdditiveBlending;
    material.opacityNode = (linksColors as any).toAttribute().w;

    const mesh = new Mesh(geometry, material);
    mesh.frustumCulled = false;
    return mesh;
  }

  // スポーン位置を更新
  setSpawnPosition(position: Vector3): void {
    (this.previousSpawnPosition.value as Vector3).copy(this.spawnPosition.value as Vector3);
    (this.spawnPosition.value as Vector3).lerp(position, 0.1);
  }

  // スポーンの有効/無効切り替え
  setSpawnEnabled(enabled: boolean): void {
    this.spawnEnabled.value = enabled ? 1 : 0;
  }

  // コンピュートシェーダー実行
  compute(renderer: WebGPURenderer): void {
    // 初回は初期化コンピュートを実行
    if (!this.initialized) {
      renderer.compute(this.initCompute);
      this.initialized = true;
    }

    renderer.compute(this.updateCompute);
    renderer.compute(this.spawnCompute);

    // スポーンインデックス更新
    this.spawnIndex.value = ((this.spawnIndex.value as number) + this.nbToSpawn) % this.nbParticles;
  }

  // 色相オフセットを回転（deltaTimeを渡す）
  rotateColorOffset(deltaTime: number): void {
    this.colorOffset.value = (this.colorOffset.value as number) + deltaTime * this._colorRotationSpeed;
  }

  // パラメータセットを適用
  setParams(params: ParticleParams): void {
    if (params.particleLifetime !== undefined) {
      this.particleLifetime.value = params.particleLifetime;
    }
    if (params.turbFrequency !== undefined) {
      this.turbFrequency.value = params.turbFrequency;
    }
    if (params.turbAmplitude !== undefined) {
      this.turbAmplitude.value = params.turbAmplitude;
    }
    if (params.turbFriction !== undefined) {
      this.turbFriction.value = params.turbFriction;
    }
    if (params.colorVariance !== undefined) {
      this.colorVariance.value = params.colorVariance;
    }
    if (params.colorRotationSpeed !== undefined) {
      this._colorRotationSpeed = params.colorRotationSpeed;
    }
    if (params.velocityBias !== undefined) {
      this.velocityBiasX.value = params.velocityBias.x;
      this.velocityBiasY.value = params.velocityBias.y;
      this.velocityBiasZ.value = params.velocityBias.z;
    }
    if (params.particleSize !== undefined) {
      this.particleSize.value = params.particleSize;
    }
    if (params.linksWidth !== undefined) {
      this.linksWidth.value = params.linksWidth;
    }
  }

  // 現在のパラメータを取得
  getParams(): ParticleParams {
    return {
      particleLifetime: this.particleLifetime.value as number,
      turbFrequency: this.turbFrequency.value as number,
      turbAmplitude: this.turbAmplitude.value as number,
      turbFriction: this.turbFriction.value as number,
      colorVariance: this.colorVariance.value as number,
      colorRotationSpeed: this._colorRotationSpeed,
      velocityBias: {
        x: this.velocityBiasX.value as number,
        y: this.velocityBiasY.value as number,
        z: this.velocityBiasZ.value as number
      },
      particleSize: this.particleSize.value as number,
      linksWidth: this.linksWidth.value as number
    };
  }

  // リソース解放
  dispose(): void {
    this.particleMesh.geometry.dispose();
    (this.particleMesh.material as SpriteNodeMaterial).dispose();
    this.linksMesh.geometry.dispose();
    (this.linksMesh.material as MeshBasicNodeMaterial).dispose();
  }
}
