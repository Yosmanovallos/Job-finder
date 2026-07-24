export interface Job {
  jobId: string;
  title: string;
  company: string;
  location: string;
  url: string;
  dateText: string;
  source: string;
  publishedAt?: string;
  [key: string]: any;
}

export interface SourceAdapter {
  readonly name: string;
  fetch(keywords: string[], dateRange?: string): Promise<Job[]>;
}
