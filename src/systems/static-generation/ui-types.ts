export type Generation = {
  id: string;
  mode: string; // custom | brief | refined | edited
  status: string; // pending | generating | completed | error
  aspectRatio: string;
  resolution: string;
  imageUrl: string | null;
  errorMessage: string | null;
  finalPrompt: string | null;
  adCopy: string | null;
  productId: string | null;
  batchId: string | null;
  batchIndex: number;
  batchSize: number;
  sourceGenerationId: string | null;
  createdAt: string;
};

export type ReferenceItem = {
  id: string;
  name: string | null;
  imagePath: string;
  url: string | null;
  createdAt: string;
};

export type ProductLite = {
  id: string;
  name: string;
  isHero?: boolean;
  imageUrl: string | null; // signed 1:1 thumbnail
};
