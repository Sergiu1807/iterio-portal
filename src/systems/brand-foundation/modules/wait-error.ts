/** Signals the pipeline to requeue this job (a dependency or async run isn't ready yet)
 *  WITHOUT burning an attempt — used by compliance (waits on website) and reviews
 *  (polls an async Apify scrape across ticks). Caught in claimAndRunExtract. */
export class WaitError extends Error {
  constructor(message = "waiting for dependency") {
    super(message);
    this.name = "WaitError";
  }
}
