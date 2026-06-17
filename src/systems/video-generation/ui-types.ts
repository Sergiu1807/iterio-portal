export type VideoGen = {
  id: string;
  videoType: string; // ugc | broll | aroll
  arollStyle: string | null;
  mode: string;
  status: string; // pending | generating | completed | error
  duration: number;
  aspectRatio: string;
  resolution: string;
  videoUrl: string | null;
  thumbUrl: string | null;
  errorMessage: string | null;
  finalPrompt: string | null;
  script: string | null;
  productId: string | null;
  batchId: string | null;
  batchIndex: number;
  batchSize: number;
  createdAt: string;
};

/** Character + Scene library items share this shape. */
export type VideoRef = {
  id: string;
  name: string;
  description: string | null;
  imagePath: string;
  url: string | null;
  createdAt: string;
};
