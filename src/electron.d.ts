export type DatasetClass = {
  id: string;
  count: number;
  recommendedCount: number;
  warning: string | null;
};

export type ModelMetadata = {
  classNames: string[];
  imageCounts: Record<string, number>;
  epochs: number;
  finalAccuracy: number;
  finalValidationAccuracy: number;
};

export type AiStatus = {
  classes: DatasetClass[];
  unsupportedFiles: string[];
  model: { available: boolean; metadata: ModelMetadata | null };
};

export type Prediction = {
  label: string;
  confidence: number;
  probabilities: Array<{ label: string; probability: number }>;
};

export type DetectionBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type MultiPredictionDetection = Prediction & {
  id: string;
  box: DetectionBox;
};

export type MultiPrediction = {
  image: { width: number; height: number };
  detections: MultiPredictionDetection[];
  fallback: boolean;
};

export type Product = { id: string; name: string; priceYen: number };
export type CartItemRequest = { productId: string; quantity: number };
export type Receipt = {
  saleId: number;
  totalYen: number;
  items: Array<{
    productId: string;
    name: string;
    unitPriceYen: number;
    quantity: number;
    subtotalYen: number;
  }>;
};

export type AiEvent =
  | { event: 'log'; message: string }
  | {
      event: 'progress';
      currentEpoch: number;
      totalEpochs: number;
      accuracy: number;
      validationAccuracy: number;
      loss: number;
    };

declare global {
  interface Window {
    aiBread: {
      ai: {
        status(): Promise<AiStatus>;
        train(): Promise<AiStatus>;
        predict(imagePath: string): Promise<Prediction>;
        predictMany(imagePath: string): Promise<MultiPrediction>;
        onEvent(listener: (event: AiEvent) => void): () => void;
      };
      capture: { save(dataUrl: string): Promise<string> };
      pos: {
        listProducts(): Promise<Product[]>;
        checkout(items: CartItemRequest[]): Promise<Receipt>;
      };
    };
  }
}
