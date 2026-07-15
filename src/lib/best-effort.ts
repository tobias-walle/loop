export function bestEffort(action: () => unknown, onError: (error: unknown) => void): void {
  try {
    action();
  } catch (error) {
    onError(error);
  }
}
