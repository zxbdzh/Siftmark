export type CapturePermission = 'allowed' | 'blocked';

export interface PagePolicy {
  body: CapturePermission;
  screenshot: CapturePermission;
  reason?: 'internal' | 'password' | 'login' | 'payment' | 'blocked-domain' | 'intranet';
}

export interface PageCapture {
  title: string;
  canonicalUrl: string;
  description: string;
  keywords: string[];
  language: string;
  text: string;
  truncated: boolean;
  policy: PagePolicy;
}

export interface LocationLike {
  href: string;
  protocol: string;
  hostname: string;
  pathname: string;
}
