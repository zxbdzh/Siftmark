const prefix = '[Siftmark]';

export const logger = {
  info(message: string): void {
    console.info(prefix, message);
  },
  error(message: string): void {
    console.error(prefix, message);
  }
};
