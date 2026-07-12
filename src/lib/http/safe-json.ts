export async function safeJsonFetch<T>(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<{ success: true; data: T } | { success: false; error: string; status?: number; raw?: string }> {
  try {
    const response = await fetch(input, init);
    const contentType = response.headers.get("content-type") || "";
    const raw = await response.text();

    if (!raw.trim()) {
      return {
        success: false,
        status: response.status,
        error: `Empty response from server (${response.status})`,
        raw,
      };
    }

    if (!contentType.includes("application/json")) {
      const serviceUnavailable = response.status >= 500;
      return {
        success: false,
        status: response.status,
        error: serviceUnavailable
          ? `The API service is temporarily unavailable (HTTP ${response.status}). Please try again shortly.`
          : `The server returned an unexpected response (HTTP ${response.status}).`,
        raw,
      };
    }

    try {
      const parsed = JSON.parse(raw);
      if (!response.ok) {
        return {
          success: false,
          status: response.status,
          error: parsed?.error || parsed?.message || `Request failed with status ${response.status}`,
          raw,
        };
      }

      return {
        success: true,
        data: parsed as T,
      };
    } catch {
      return {
        success: false,
        status: response.status,
        error: `Invalid JSON response. First characters: ${raw.slice(0, 120)}`,
        raw,
      };
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Network request failed",
    };
  }
}
