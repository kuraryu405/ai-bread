import { useEffect, useMemo, useRef, useState } from 'react';
import type { AiEvent, AiStatus, Prediction, Product, Receipt } from './electron';

const productNames: Record<string, string> = {
  bread: 'ブレッド',
  twist: 'ツイスト',
  danish: 'デニッシュ',
  roll: 'ロール',
  baguette: 'バゲット',
  campagne: 'カンパーニュ',
};

type CartLine = Product & { quantity: number };

function yen(amount: number) {
  return `${new Intl.NumberFormat('ja-JP').format(amount)}円`;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : '予期しないエラーが発生しました。';
}

export default function App() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [prediction, setPrediction] = useState<Prediction | null>(null);
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
      const result = await window.aiBread.ai.predict(imagePath);
      setPrediction(result);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setPredicting(false);
    }
  }

  function addPredictionToCart() {
    if (!prediction) return;
    const product = productsById.get(prediction.label);
    if (!product) {
      setError(`「${prediction.label}」の価格マスタが見つかりません。`);
      return;
    }
    setCart((current) => {
      const existing = current.find((item) => item.id === product.id);
      if (existing) {
        return current.map((item) => (item.id === product.id ? { ...item, quantity: item.quantity + 1 } : item));
      }
      return [...current, { ...product, quantity: 1 }];
    });
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
          <p>手元の写真で学習し、カメラ判定から会計までをローカルで完結します。</p>
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
            {!cameraReady && <p>カメラを起動して、パンを1つ映してください。</p>}
          </div>
          <div className="button-row">
            <button className="secondary" onClick={() => void startCamera()}>カメラ起動</button>
            <button className="primary" onClick={() => void captureAndPredict()} disabled={!cameraReady || !modelReady || predicting}>
              {predicting ? '判定中…' : 'これを判定する'}
            </button>
            <button className="danger" onClick={stopCamera} disabled={!cameraReady}>カメラ停止</button>
          </div>

          {prediction && (
            <div className="prediction-result">
              {preview && <img src={preview} alt="判定したパン" />}
              <div className="prediction-copy">
                <p>判定結果</p>
                <h3>{productNames[prediction.label] ?? prediction.label}</h3>
                <strong>確信度 {(prediction.confidence * 100).toFixed(1)}%</strong>
                <div className="probabilities">
                  {prediction.probabilities.map((item) => (
                    <div className="probability" key={item.label}>
                      <span>{productNames[item.label] ?? item.label}</span>
                      <progress value={item.probability} max="1" />
                      <small>{(item.probability * 100).toFixed(1)}%</small>
                    </div>
                  ))}
                </div>
                <button className="primary add-button" onClick={addPredictionToCart}>カートに入れる</button>
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
