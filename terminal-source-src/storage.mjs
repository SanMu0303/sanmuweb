export class LocalStorageAdapter {
  read(key, fallback) {
    try {
      const value = JSON.parse(localStorage.getItem("tsd:v1:" + key));
      return value ?? fallback;
    } catch {
      return fallback;
    }
  }
  write(key, value) {
    try {
      localStorage.setItem("tsd:v1:" + key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  }
}
export const storage = new LocalStorageAdapter();
