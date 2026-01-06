// フレームコールバック型
export type FrameCallback = (time: number, xrFrame?: XRFrame) => void;

// レンダーループ管理クラス（通常モード/XRモード対応）
export class RenderLoop {
  private callback: FrameCallback | null = null;
  private xrSession: XRSession | null = null;
  private running = false;
  private animationFrameId: number | null = null;

  // ループ開始
  start(callback: FrameCallback): void {
    if (this.running) {
      console.warn('Render loop already running');
      return;
    }

    this.callback = callback;
    this.running = true;

    if (this.xrSession) {
      this.runXRLoop();
    } else {
      this.runNormalLoop();
    }
  }

  // ループ停止
  stop(): void {
    this.running = false;

    if (this.animationFrameId !== null && !this.xrSession) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }

    this.callback = null;
  }

  // XRセッション設定（ループモード切り替え）
  // 新しいコールバックを指定してモードを切り替える
  setXRSession(session: XRSession | null, newCallback?: FrameCallback): void {
    // 既存ループを停止
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }

    const wasRunning = this.running;
    this.running = false;

    this.xrSession = session;

    // コールバック更新
    if (newCallback) {
      this.callback = newCallback;
    }

    // ループ再開
    if (wasRunning && this.callback) {
      this.running = true;

      if (session) {
        this.runXRLoop();
      } else {
        this.runNormalLoop();
      }
    }
  }

  // 通常モードのループ（requestAnimationFrame）
  private runNormalLoop(): void {
    const tick = (time: number): void => {
      if (!this.running || this.xrSession) return;

      if (this.callback) {
        this.callback(time);
      }

      this.animationFrameId = requestAnimationFrame(tick);
    };

    this.animationFrameId = requestAnimationFrame(tick);
  }

  // XRモードのループ（xrSession.requestAnimationFrame）
  private runXRLoop(): void {
    if (!this.xrSession) return;

    const tick = (time: number, xrFrame: XRFrame): void => {
      if (!this.running || !this.xrSession) return;

      if (this.callback) {
        this.callback(time, xrFrame);
      }

      this.xrSession.requestAnimationFrame(tick);
    };

    this.xrSession.requestAnimationFrame(tick);
  }

}
