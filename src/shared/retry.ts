interface RetryOptions {
  retries: number;
  delayMs: number;
  shouldRetry: (error: unknown) => boolean;
}

export async function withRetry<T>(operation: () => Promise<T>, options: RetryOptions): Promise<T> {
  let attempt = 0;

  while (true) {
    try {
      return await operation();
    } catch (error) {
      const canRetry = attempt < options.retries && options.shouldRetry(error);
      if (!canRetry) {
        throw error;
      }

      attempt += 1;
      await sleep(options.delayMs * attempt);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
