export function ContentToast({
  message,
  tone = 'success'
}: {
  message?: string;
  tone?: 'processing' | 'success' | 'error';
}) {
  return message ? (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      aria-live={tone === 'error' ? 'assertive' : 'polite'}
      className="siftmark-toast"
      data-tone={tone}
    >
      {message}
    </div>
  ) : null;
}
