import { useEffect, useMemo, useRef, useState } from 'react';
import type { AiEvent, AiStatus, MultiPrediction, MultiPredictionDetection, Product, Receipt } from './electron';

const productNames: Record<string, string> = {
  bread: 'ブレッド',
  twist: 'ツイスト',
  danish: 'デニッシュ',
  roll: 'ロール',
  baguette: 'バゲット',
  campagne: 'カンパーニュ',
};

type CartLine = Product & { quantity: number };
type DetectionCandidate = MultiPredictionDetection & { selectedLabel: string };

function yen(amount: number) {
  return `${new Intl.NumberFormat('ja-JP').format(amount)}円`;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : '予期しないエラーが発生しました。';
}

function topProbabilities(detection: MultiPredictionDetection) {
  return detection.probabilities
    .slice()
    .sort((a, b) => b.probability - a.probability)
    .slice(0, 3);
}

export default function App() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [multiPrediction, setMultiPrediction] = useState<MultiPrediction | null>(null);
  const [detections, setDetections] = useState<DetectionCandidate[]>([]);
  const [preview, setPreview] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [progress, setProgress] = useState<AiEvent | null>(null);
  const [training, setTraining] = useState(false);
  const [predicting, setPredicting] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);

  const productsById = useMemo(() => new Map(products.map((product) => [product.id, product])), [products]);
  const total = cart.reduce((sum, item) => sum + item.priceYen * item.quantity, 0);

  async function refresh() {
    try {
      const [nextStatus, nextProducts] = await Promise.all([
        window.aiBread.ai.status(),
        window.aiBread.pos.listProducts(),
      ]);
      setStatus(nextStatus);
      setProducts(nextProducts);
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  useEffect(() => {
    void refresh();
    const unsubscribe = window.aiBread.ai.onEvent((event) => {
      if (event.event === 'log') {
        setLogs((current) => [...current.slice(-9), event.message]);
      }
      if (event.event === 'progress') setProgress(event);
    });
    return () => {
      unsubscribe();
      stopCamera();
    };
  }, []);

  function stopCamera() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setCameraReady(false);
  }

  async function startCamera() {
    setError(null);
    try {
      stopCamera();
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 960 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraReady(true);
    } catch (caught) {
      setError(`カメラを起動できません: ${errorMessage(caught)}`);
    }
  }

  async function train() {
    setError(null);
    setReceipt(null);
    setTraining(true);
    setProgress(null);
    setLogs((current) => [...current, '学習を開始します。']);
    try {
      const nextStatus = await window.aiBread.ai.train();
      setStatus(nextStatus);
      setLogs((current) => [...current, '学習が完了しました。']);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setTraining(false);
    }
  }

  async function captureAndPredict() {
    if (!videoRef.current || !cameraReady) return;
    setError(null);
    setReceipt(null);
    setMultiPrediction(null);
    setDetections([]);
    setPredicting(true);
    try {
      const video = videoRef.current;
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      canvas.getContext('2d')?.drawImage(video, 0, 0);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
      setPreview(dataUrl);
      const imagePath = await window.aiBread.capture.save(dataUrl);
      const result = await window.aiBread.ai.predictMany(imagePath);
      setMultiPrediction(result);
      setDetections(result.detections.map((detection) => ({ ...detection, selectedLabel: detection.label })));
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setPredicting(false);
    }
  }

  function removeDetection(detectionId: string) {
    setDetections((current) => current.filter((detection) => detection.id !== detectionId));
  }

  function updateDetectionLabel(detectionId: string, label: string) {
    setDetections((current) =>
      current.map((detection) =>
        detection.id === detectionId ? { ...detection, selectedLabel: label } : detection,
      ),
    );
  }

  function addDetectionsToCart() {
    if (detections.length === 0) return;
    const additions = new Map<string, number>();
    const missingLabels = new Set<string>();

    for (const detection of detections) {
      if (!productsById.has(detection.selectedLabel)) {
        missingLabels.add(detection.selectedLabel);
        continue;
      }
      additions.set(detection.selectedLabel, (additions.get(detection.selectedLabel) ?? 0) + 1);
    }

    if (missingLabels.size > 0) {
      setError(`価格マスタが見つからないパン種があります: ${Array.from(missingLabels).join(', ')}`);
      return;
    }

    setCart((current) => {
      let next = [...current];
      for (const [productId, quantity] of additions) {
        const product = productsById.get(productId);
        if (!product) continue;
        const existing = next.find((item) => item.id === productId);
        if (existing) {
          next = next.map((item) =>
            item.id === productId ? { ...item, quantity: item.quantity + quantity } : item,
          );
        } else {
          next = [...next, { ...product, quantity }];
        }
      }
      return next;
    });
    setMultiPrediction(null);
    setDetections([]);
  }

  function updateQuantity(productId: string, quantity: number) {
    setCart((current) =>
      current
        .map((item) => (item.id === productId ? { ...item, quantity } : item))
        .filter((item) => item.quantity > 0),
    );
  }

  async function checkout() {
    setError(null);
    try {
      const nextReceipt = await window.aiBread.pos.checkout(
        cart.map((item) => ({ productId: item.id, quantity: item.quantity })),
      );
      setReceipt(nextReceipt);
      setCart([]);
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  const modelReady = status?.model.available ?? false;

  return (
    <main>
      <header className="hero">
        <div>
          <p className="eyebrow">LOCAL AI BAKERY POS</p>
          <h1>AIパンレジ</h1>
          <p>イパーイ食べてネ</p>
        </div>
        <div className={`model-state ${modelReady ? 'ready' : 'idle'}`}>
          {modelReady ? '学習済みモデルを使用中' : 'モデル未学習'}
        </div>
      </header>

      {error && <div className="notice error">{error}</div>}
      {receipt && <div className="notice success">会計 #{receipt.saleId}: {yen(receipt.totalYen)} で承りました。</div>}

      <section className="workspace">
        <section className="panel dataset-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">STEP 1</p>
              <h2>学習データと学習</h2>
            </div>
            <button className="secondary" onClick={() => void refresh()} disabled={training}>再読込</button>
          </div>

          <div className="class-grid">
            {status?.classes.map((item) => (
              <article className="class-card" key={item.id}>
                <strong>{productNames[item.id] ?? item.id}</strong>
                <span>{item.count} 枚</span>
                <small className={item.warning ? 'warning' : 'good'}>
                  {item.warning ?? `推奨 ${item.recommendedCount} 枚を満たしています`}
                </small>
              </article>
            ))}
          </div>

          {status?.unsupportedFiles.length ? (
            <p className="warning">未対応ファイル: {status.unsupportedFiles.join(', ')}</p>
          ) : null}

          <button className="primary large" onClick={() => void train()} disabled={training || !status}>
            {training ? '学習中…' : 'AIに学習させる'}
          </button>
          {progress?.event === 'progress' && (
            <div className="progress-box">
              <progress value={progress.currentEpoch} max={progress.totalEpochs} />
              <span>
                {progress.currentEpoch} / {progress.totalEpochs} epoch ・ 正答率 {(progress.accuracy * 100).toFixed(1)}%
                {' ・ '}検証 {(progress.validationAccuracy * 100).toFixed(1)}%
              </span>
            </div>
          )}
          <div className="log" aria-live="polite">
            {logs.length ? logs.map((line, index) => <div key={`${line}-${index}`}>{line}</div>) : '学習ログはここに表示されます。'}
          </div>
        </section>

        <section className="panel camera-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">STEP 2</p>
              <h2>パンを判定する</h2>
            </div>
          </div>
          <div className="camera-stage">
            <video ref={videoRef} muted playsInline />
            {!cameraReady && <p>カメラを起動して、パンを複数映してください。</p>}
          </div>
          <div className="button-row">
            <button className="secondary" onClick={() => void startCamera()}>カメラ起動</button>
            <button className="primary" onClick={() => void captureAndPredict()} disabled={!cameraReady || !modelReady || predicting}>
              {predicting ? '判定中…' : 'これを判定する'}
            </button>
            <button className="danger" onClick={stopCamera} disabled={!cameraReady}>カメラ停止</button>
          </div>

          {multiPrediction && preview && (
            <div className="prediction-result">
              <div className="prediction-preview">
                <img src={preview} alt="判定したパン" />
                {detections.map((detection, index) => (
                  <div
                    className="detection-box"
                    key={detection.id}
                    style={{
                      left: `${(detection.box.x / multiPrediction.image.width) * 100}%`,
                      top: `${(detection.box.y / multiPrediction.image.height) * 100}%`,
                      width: `${(detection.box.width / multiPrediction.image.width) * 100}%`,
                      height: `${(detection.box.height / multiPrediction.image.height) * 100}%`,
                    }}
                  >
                    <span>{index + 1}</span>
                  </div>
                ))}
              </div>
              <div className="prediction-copy">
                <p>判定結果</p>
                <h3>{detections.length} 件の候補</h3>
                {multiPrediction.fallback && (
                  <p className="fallback-note">個別のパン領域を検出できなかったため、画像全体を1件として判定しました。</p>
                )}
                <div className="detection-list">
                  {detections.length === 0 ? (
                    <p className="empty compact">候補はすべて削除されました。</p>
                  ) : detections.map((detection, index) => (
                    <article className="detection-card" key={detection.id}>
                      <div className="detection-card-heading">
                        <strong>#{index + 1} {productNames[detection.label] ?? detection.label}</strong>
                        <button className="link-danger" onClick={() => removeDetection(detection.id)}>削除</button>
                      </div>
                      <label>
                        <span>カートに入れる商品</span>
                        <select
                          value={detection.selectedLabel}
                          onChange={(event) => updateDetectionLabel(detection.id, event.target.value)}
                        >
                          {!productsById.has(detection.selectedLabel) && (
                            <option value={detection.selectedLabel}>{productNames[detection.selectedLabel] ?? detection.selectedLabel}</option>
                          )}
                          {products.map((product) => (
                            <option key={product.id} value={product.id}>{product.name}</option>
                          ))}
                        </select>
                      </label>
                      <small>AI判定の確信度 {(detection.confidence * 100).toFixed(1)}%</small>
                      <div className="probabilities">
                        {topProbabilities(detection).map((item) => (
                          <div className="probability" key={item.label}>
                            <span>{productNames[item.label] ?? item.label}</span>
                            <progress value={item.probability} max="1" />
                            <small>{(item.probability * 100).toFixed(1)}%</small>
                          </div>
                        ))}
                      </div>
                    </article>
                  ))}
                </div>
                <button className="primary add-button" onClick={addDetectionsToCart} disabled={detections.length === 0}>
                  検出結果をまとめてカートに入れる
                </button>
              </div>
            </div>
          )}
        </section>

        <aside className="panel cart-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">STEP 3</p>
              <h2>お会計</h2>
            </div>
          </div>
          <div className="price-list">
            {products.map((product) => <span key={product.id}>{product.name}: {yen(product.priceYen)}</span>)}
          </div>
          <div className="cart-lines">
            {cart.length === 0 ? <p className="empty">カートは空です。</p> : cart.map((item) => (
              <article className="cart-line" key={item.id}>
                <div>
                  <strong>{item.name}</strong>
                  <small>{yen(item.priceYen)} × {item.quantity}</small>
                </div>
                <div className="quantity">
                  <button onClick={() => updateQuantity(item.id, item.quantity - 1)} aria-label={`${item.name} を1つ減らす`}>−</button>
                  <span>{item.quantity}</span>
                  <button onClick={() => updateQuantity(item.id, item.quantity + 1)} aria-label={`${item.name} を1つ増やす`}>＋</button>
                </div>
                <strong>{yen(item.priceYen * item.quantity)}</strong>
              </article>
            ))}
          </div>
          <div className="total"><span>合計</span><strong>{yen(total)}</strong></div>
          <button className="checkout" onClick={() => void checkout()} disabled={cart.length === 0}>支払う</button>
        </aside>
      </section>
    </main>
  );
}
