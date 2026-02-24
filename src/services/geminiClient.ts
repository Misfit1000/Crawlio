import { GoogleGenAI, GenerateContentParameters, GenerateContentResponse } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY as string });

export class GeminiError extends Error {
  constructor(message: string, public status?: number, public originalError?: any) {
    super(message);
    this.name = "GeminiError";
  }
}

export function isRateLimitError(error: any): boolean {
  if (!error) return false;
  const message = error.message?.toLowerCase() || "";
  const status = error.status;
  const errorString = JSON.stringify(error).toLowerCase();
  
  return (
    status === 429 || 
    message.includes("429") || 
    message.includes("quota") || 
    message.includes("rate limit") ||
    errorString.includes("429") ||
    errorString.includes("quota")
  );
}

export async function generateWithRetry(
  params: GenerateContentParameters,
  maxRetries = 3,
  initialDelay = 2000
): Promise<GenerateContentResponse> {
  let lastError: any;
  
  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await ai.models.generateContent(params);
      return response;
    } catch (error: any) {
      lastError = error;
      
      if (isRateLimitError(error) && i < maxRetries - 1) {
        const delay = initialDelay * Math.pow(2, i);
        console.warn(`Rate limit hit. Retrying in ${delay}ms... (Attempt ${i + 1}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      
      const status = error.status || (isRateLimitError(error) ? 429 : undefined);
      throw new GeminiError(error.message || "Unknown Gemini error", status, error);
    }
  }
  
  throw lastError;
}

export { ai };
