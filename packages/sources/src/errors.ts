/** A source endpoint answered with an unusable HTTP status. */
export class SourceRequestError extends Error {
  readonly sourceId: string;
  readonly url: string;
  readonly status: number | null;

  constructor(sourceId: string, url: string, status: number | null, message: string) {
    super(`[${sourceId}] ${message} (status ${status ?? "n/a"}, ${url})`);
    this.name = "SourceRequestError";
    this.sourceId = sourceId;
    this.url = url;
    this.status = status;
  }
}

/** The source answered 200 but the payload no longer matches the known shape. */
export class SourceSchemaError extends Error {
  readonly sourceId: string;
  readonly url: string;

  constructor(sourceId: string, url: string, detail: string) {
    super(
      `[${sourceId}] Unexpected payload shape: ${detail} (${url}). ` +
        "The source may have changed its schema — update the adapter and its fixtures."
    );
    this.name = "SourceSchemaError";
    this.sourceId = sourceId;
    this.url = url;
  }
}
