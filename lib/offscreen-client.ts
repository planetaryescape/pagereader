import { browser } from "#imports";

export async function sendToOffscreen<T = unknown>(
  data: Record<string, unknown>
): Promise<T> {
  const response = await browser.runtime.sendMessage({
    target: "background",
    action: "toOffscreen",
    data,
  });
  return response as T;
}
