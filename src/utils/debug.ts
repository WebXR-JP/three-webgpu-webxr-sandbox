export const debugLog = (...args: unknown[]): void => {
  if (import.meta.env.DEV) console.log(...args);
};
