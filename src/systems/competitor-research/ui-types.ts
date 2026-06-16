export type Ad = {
  id: string;
  adArchiveId: string;
  brandPageName: string | null;
  competitorPageId: string | null;
  mediaType: string | null; // video | image | carousel | text
  thumbUrl: string | null;
  videoUrl: string | null;
  cardUrls: string[];
  displayPrimaryText: string | null;
  headlineTitle: string | null;
  ctaButtonType: string | null;
  destinationUrl: string | null;
  displayDomain: string | null;
  adLibraryUrl: string | null;
  platformsDisplay: string | null;
  dedupCount: number;
  isDco: boolean;
  mediaCaptureFailed: boolean;
  metaSortRank: number | null;
  snapshotDate: string | null;
  adStartDate: string | null;
  creativeAngle: string | null;
  adDescription: string | null;
  targetPersona: string | null;
  coreMotivation: string | null;
  proofMechanism: string | null;
  visualHook: string | null;
  spokenHook: string | null;
  outroOffer: string | null;
  fullTranscript: string | null;
  aiAnalysisStatus: string;
};

export type Job = {
  id: string;
  status: string;
  mode: string;
  query: string;
  country: string;
  requestedCount: number;
  stats: { adsFound?: number; adsAnalyzed?: number };
  errorMessage: string | null;
  createdAt: string;
};

export type Source = {
  id: string;
  name: string;
  metaLibraryUrl: string | null;
  country: string | null;
  metaPageId: string | null;
  type: string | null;
  isActive: boolean;
  lastScrapedAt: string | null;
};
