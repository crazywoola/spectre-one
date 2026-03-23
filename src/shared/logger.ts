type LogLevel = 'info' | 'warn' | 'error';

export const logger = {
  info: (event: string, data?: Record<string, unknown>) => log('info', event, data),
  warn: (event: string, data?: Record<string, unknown>) => log('warn', event, data),
  error: (event: string, data?: Record<string, unknown>) => log('error', event, data)
};

function log(level: LogLevel, event: string, data: Record<string, unknown> = {}): void {
  const payload = {
    timestamp: new Date().toISOString(),
    level,
    event,
    ...sanitize(data)
  };

  const line = JSON.stringify(payload);
  if (level === 'error') {
    console.error(line);
    return;
  }

  if (level === 'warn') {
    console.warn(line);
    return;
  }

  console.log(line);
}

function sanitize(data: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(data).map(([key, value]) => {
      if (value instanceof Error) {
        return [
          key,
          {
            name: value.name,
            message: value.message,
            stack: value.stack
          }
        ];
      }

      return [key, value];
    })
  );
}
